import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { isTerminalTabLayout, normalizeTerminalLayoutState } from '../../shared/layoutState.js';
import type { FileOpenRequest } from '../../shared/protocol.js';
import type { TerminalId, TerminalLayoutState, TerminalSummary, TerminalTabLayout, TerminalWorkspaceLayout } from '../../shared/types.js';
import { ApiError, type ApiClient, createApiClient } from '../api/client.js';
import type { TextEditorPaneModel } from '../files/TextEditorPane.js';
import { uploadFiles } from '../api/uploadClient.js';
import { FileExplorer } from '../files/FileExplorer.js';
import { AppSettingsModal } from '../settings/AppSettingsModal.js';
import { workspaceIndexShortcutLabel } from './keyboardShortcuts.js';
import { LeominalMark } from './LeominalMark.js';
import { SplitPane } from './SplitPane.js';
import { TerminalTabs } from './TerminalTabs.js';
import { UploadToast, type UploadToastModel } from './UploadToast.js';
import {
  getDirectionalPaneTarget,
  getNextPaneTarget,
  getPaneTargetByIndex,
  getPreviousPaneTarget,
  type PaneNavigationDirection
} from './paneNavigation.js';
import {
  createEmptyTerminalState,
  listTabTerminalIds,
  listWorkspaceTerminalIds,
  reconstructTerminalState,
  serializeWorkspaceState,
  countTabPanes,
  type TerminalAction,
  terminalReducer
} from './terminalReducer.js';
import { collectUploadDrop, hasFileDrop } from './uploadDrop.js';

const layoutStorageKey = 'leominal.terminalLayout.v1';
const workspaceStorageKey = 'leominal.terminalWorkspaces.v2';
const sidebarCollapsedStorageKey = 'leominal.sidebarCollapsed.v1';
const layoutSaveDebounceMs = 75;

interface TerminalWorkspaceProps {
  api?: ApiClient;
  sessionExpiresAt?: string | null;
  onLogout?: () => Promise<void>;
  onReload?: () => void;
}

export function TerminalWorkspace({
  api: providedApi,
  sessionExpiresAt = null,
  onLogout = async () => undefined,
  onReload = reloadApp
}: TerminalWorkspaceProps) {
  const api = useMemo(() => providedApi ?? createApiClient(), [providedApi]);
  const [state, dispatch] = useReducer(terminalReducer, undefined, createEmptyTerminalState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => readSidebarCollapsed());
  const [sidebarMode, setSidebarMode] = useState<'workspaces' | 'files'>('workspaces');
  const [editors, setEditors] = useState<Record<string, TextEditorPaneModel>>({});
  const [editingWorkspace, setEditingWorkspace] = useState<{ workspaceId: string; title: string } | null>(null);
  const workspaceEditInputRef = useRef<HTMLInputElement | null>(null);
  const workspaceRenameCancelledRef = useRef(false);
  const uploadIdRef = useRef(0);
  const editorIdRef = useRef(0);
  const stateRef = useRef(state);
  const layoutRevisionRef = useRef<number | null>(null);
  const lastPersistedLayoutJsonRef = useRef<string | null>(null);
  const pendingLayoutSaveRef = useRef<TerminalLayoutState | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(false);

  const activeWorkspace = state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId) ?? state.workspaces[0];
  const activeTab = activeWorkspace?.tabs.find((tab) => tab.id === activeWorkspace.activeTabId) ?? activeWorkspace?.tabs[0];
  const activeTerminalId = activeTab?.activeTerminalId ?? null;
  const activeTerminal = activeTerminalId ? state.terminals[activeTerminalId] : undefined;
  const [uploadToast, setUploadToast] = useState<UploadToastModel | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      flushPendingLayoutSave();
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    workspaceEditInputRef.current?.focus();
    workspaceEditInputRef.current?.select();
  }, [editingWorkspace?.workspaceId]);

  useEffect(() => {
    writeSidebarCollapsed(sidebarCollapsed);
    if (sidebarCollapsed) {
      setEditingWorkspace(null);
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    let cancelled = false;
    async function loadWorkspace() {
      setLoading(true);
      setError(null);
      try {
        const savedLayout = readSavedLayout();
        const [listed, serverLayout] = await Promise.all([api.listTerminals(), api.getTerminalLayout()]);
        const terminals =
          listed.terminals.length > 0 ? listed.terminals : [(await api.createTerminal({ cols: 80, rows: 24 })).terminal];
        if (!cancelled) {
          layoutRevisionRef.current = serverLayout.revision;
          const serverSavedLayout = serverLayout.layout ? layoutHydrationFromState(serverLayout.layout) : null;
          const hydrationLayout: SavedLayoutResult = serverSavedLayout ?? savedLayout ?? {};
          const hydratedState = reconstructTerminalState(
            terminals,
            hydrationLayout.savedTabs,
            hydrationLayout.savedWorkspaces,
            hydrationLayout.savedActiveWorkspaceId
          );
          const hydratedLayout = serializeWorkspaceState(hydratedState);
          lastPersistedLayoutJsonRef.current = JSON.stringify(hydratedLayout);

          const hydrateAction = {
            type: 'workspace.hydrated',
            terminals
          } as const;
          stateRef.current = hydratedState;
          dispatch({
            ...hydrateAction,
            ...(hydrationLayout.savedTabs ? { savedTabs: hydrationLayout.savedTabs } : {}),
            ...(hydrationLayout.savedWorkspaces ? { savedWorkspaces: hydrationLayout.savedWorkspaces } : {}),
            ...(hydrationLayout.savedActiveWorkspaceId !== undefined ? { savedActiveWorkspaceId: hydrationLayout.savedActiveWorkspaceId } : {})
          });

          if (!serverSavedLayout && savedLayout) {
            void persistLayout(hydratedLayout, { baseRevision: serverLayout.revision });
          }
        }
      } catch (caught) {
        if (!cancelled) {
          setError(errorMessage(caught));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void loadWorkspace();
    return () => {
      cancelled = true;
    };
  }, [api]);

  function createNewWorkspace() {
    const nextNumber = state.workspaces.length + 1;
    dispatchLayoutChange({
      type: 'workspace.created',
      workspaceId: `workspace-${Date.now().toString(36)}-${nextNumber}`,
      title: `Workspace ${nextNumber}`
    });
  }

  function beginRenameWorkspace(workspaceId: string, title: string) {
    if (sidebarCollapsed && !sidebarOpen) {
      return;
    }
    workspaceRenameCancelledRef.current = false;
    setEditingWorkspace({ workspaceId, title });
  }

  function commitRenameWorkspace() {
    if (!editingWorkspace) {
      return;
    }
    if (workspaceRenameCancelledRef.current) {
      workspaceRenameCancelledRef.current = false;
      setEditingWorkspace(null);
      return;
    }
    const title = editingWorkspace.title.trim();
    if (title) {
      dispatchLayoutChange({ type: 'workspace.renamed', workspaceId: editingWorkspace.workspaceId, title });
    }
    setEditingWorkspace(null);
  }

  async function createNewTab() {
    await runAction(async () => {
      const response = await api.createTerminal({ cols: 80, rows: 24 });
      dispatchLayoutChange({ type: 'terminal.created', terminal: response.terminal });
    });
  }

  async function split(direction: 'horizontal' | 'vertical') {
    await runAction(async () => {
      const request = activeTerminalId ? { parentTerminalId: activeTerminalId, cols: 80, rows: 24 } : { cols: 80, rows: 24 };
      const response = await api.createTerminal(request);
      dispatchLayoutChange({ type: 'terminal.split', terminal: response.terminal, direction });
    });
  }

  async function openFileInEditorPane(request: FileOpenRequest) {
    if (!activeTerminalId) {
      throw new Error('No active pane is available.');
    }

    const read = await api.readFile(request);
    const editorId = `editor-${Date.now().toString(36)}-${(editorIdRef.current += 1)}`;
    const title = fileNameFromPath(read.path);
    setEditors((current) => ({
      ...current,
      [editorId]: {
        id: editorId,
        title,
        rootToken: request.rootToken,
        path: read.path,
        read
      }
    }));
    dispatchLayoutChange({ type: 'editor.split', editorId, title, direction: 'vertical' });
  }

  function closeEditorPane(editorId: string) {
    setEditors((current) => {
      const next = { ...current };
      delete next[editorId];
      return next;
    });
    dispatchLayoutChange({ type: 'editor.closed', editorId });
  }

  async function closeTerminal(terminalId: TerminalId) {
    await closeTerminals([terminalId]);
  }

  async function closeTerminals(terminalIds: TerminalId[]) {
    await runAction(async () => {
      await Promise.all(terminalIds.map((terminalId) => closeTerminalIfPresent(terminalId)));
      for (const terminalId of terminalIds) {
        dispatchLayoutChange({ type: 'terminal.closed', terminalId });
      }
    });
  }

  async function closeWorkspace(workspaceId: string) {
    const workspace = state.workspaces.find((candidate) => candidate.id === workspaceId);
    if (!workspace || state.workspaces.length <= 1) {
      return;
    }
    const terminalIds = listWorkspaceTerminalIds(workspace);
    await runAction(async () => {
      await Promise.all(terminalIds.map((terminalId) => closeTerminalIfPresent(terminalId)));
      dispatchLayoutChange({ type: 'workspace.closed', workspaceId });
    });
  }

  async function closeTerminalIfPresent(terminalId: TerminalId) {
    try {
      await api.closeTerminal(terminalId);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 404) {
        return;
      }
      throw caught;
    }
  }

  async function logout() {
    await runAction(async () => {
      await onLogout();
    });
  }

  async function runAction(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  function dispatchLayoutChange(action: TerminalAction) {
    const nextState = terminalReducer(stateRef.current, action);
    stateRef.current = nextState;
    dispatch(action);
    if (loading || nextState.workspaces.length === 0) {
      return;
    }
    const layout = serializeWorkspaceState(nextState);
    if (JSON.stringify(layout) !== lastPersistedLayoutJsonRef.current) {
      queueLayoutSave(layout);
    }
  }

  function dispatchTerminalState(action: TerminalAction) {
    stateRef.current = terminalReducer(stateRef.current, action);
    dispatch(action);
  }

  function handleWorkspaceKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.nativeEvent.isComposing || event.key === 'Process' || isEditableShortcutTarget(event.target)) {
      return;
    }

    const shortcut = parseWorkspaceShortcut(event);
    if (!shortcut) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (shortcut.type === 'workspace.index') {
      const workspace = stateRef.current.workspaces[shortcut.index - 1];
      if (workspace) {
        dispatchLayoutChange({ type: 'workspace.selected', workspaceId: workspace.id });
      }
      return;
    }

    const currentState = stateRef.current;
    const workspace = currentState.workspaces.find((candidate) => candidate.id === currentState.activeWorkspaceId) ?? currentState.workspaces[0];
    const tab = workspace?.tabs.find((candidate) => candidate.id === workspace.activeTabId) ?? workspace?.tabs[0];
    if (!tab) {
      return;
    }

    if (shortcut.type === 'split') {
      void split(shortcut.direction);
      return;
    }

    const targetTerminalId = paneTargetForShortcut(tab.root, tab.activeTerminalId, shortcut);
    if (targetTerminalId) {
      dispatchLayoutChange({ type: 'pane.selected', terminalId: targetTerminalId });
    }
  }

  function handleWorkspaceDragOver(event: React.DragEvent<HTMLElement>) {
    if (!hasFileDrop(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }

  function handleWorkspaceDrop(event: React.DragEvent<HTMLElement>) {
    if (!hasFileDrop(event.dataTransfer)) {
      return;
    }
    event.preventDefault();

    const terminal = getActiveRunningTerminal(stateRef.current);
    const uploadId = uploadIdRef.current + 1;
    uploadIdRef.current = uploadId;

    if (!terminal) {
      setUploadToast({
        id: uploadId,
        status: 'failed',
        fileCount: 0,
        message: 'No active running terminal is available for upload.'
      });
      return;
    }

    setUploadToast({
      id: uploadId,
      status: 'queued',
      fileCount: 0,
      message: 'Preparing upload...'
    });
    void runDroppedUpload(uploadId, terminal.id, event.dataTransfer);
  }

  async function runDroppedUpload(uploadId: number, terminalId: TerminalId, dataTransfer: DataTransfer) {
    try {
      const files = await collectUploadDrop(dataTransfer);
      if (files.length === 0) {
        throw new Error('No files were found in the drop.');
      }

      updateUploadToast(uploadId, {
        id: uploadId,
        status: 'uploading',
        fileCount: files.length,
        loaded: 0,
        total: null,
        percent: null
      });

      const response = await uploadFiles({
        terminalId,
        files,
        onProgress: (progress) => {
          updateUploadToast(uploadId, {
            id: uploadId,
            status: 'uploading',
            fileCount: files.length,
            loaded: progress.loaded,
            total: progress.total,
            percent: progress.percent
          });
        }
      });

      const uploadStatus = response.failed > 0 ? (response.uploaded > 0 ? 'partial' : 'failed') : 'success';
      const uploadError = response.failed > 0 ? firstUploadError(response) : undefined;
      const resultToast: UploadToastModel = {
        id: uploadId,
        status: uploadStatus,
        fileCount: files.length,
        response
      };
      if (uploadError) {
        resultToast.message = uploadError;
      }
      updateUploadToast(uploadId, resultToast);
    } catch (caught) {
      updateUploadToast(uploadId, {
        id: uploadId,
        status: 'failed',
        fileCount: 0,
        message: errorMessage(caught)
      });
    }
  }

  function updateUploadToast(uploadId: number, toast: UploadToastModel) {
    setUploadToast((current) => (current?.id === uploadId ? toast : current));
  }

  function queueLayoutSave(layout: TerminalLayoutState) {
    pendingLayoutSaveRef.current = layout;
    writeSavedLayout(layout);
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      const pendingLayout = pendingLayoutSaveRef.current;
      pendingLayoutSaveRef.current = null;
      if (pendingLayout && mountedRef.current) {
        void persistLayout(pendingLayout);
      }
    }, layoutSaveDebounceMs);
  }

  function flushPendingLayoutSave() {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const pendingLayout = pendingLayoutSaveRef.current;
    pendingLayoutSaveRef.current = null;
    if (pendingLayout) {
      writeSavedLayout(pendingLayout);
      void persistLayout(pendingLayout);
    }
  }

  async function persistLayout(layout: TerminalLayoutState, options: { baseRevision?: number | null } = {}) {
    const baseRevision = options.baseRevision ?? layoutRevisionRef.current;
    const request = {
      layout,
      ...(typeof baseRevision === 'number' ? { baseRevision } : {})
    };

    try {
      const response = await api.saveTerminalLayout(request);
      const persistedLayout = response.layout ?? layout;
      layoutRevisionRef.current = response.revision;
      lastPersistedLayoutJsonRef.current = JSON.stringify(persistedLayout);
      writeSavedLayout(persistedLayout);
      return;
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        try {
          const response = await api.getTerminalLayout();
          layoutRevisionRef.current = response.revision;
          if (response.layout) {
            const serverState = reconstructTerminalState(
              Object.values(stateRef.current.terminals),
              undefined,
              response.layout.workspaces,
              response.layout.activeWorkspaceId
            );
            const persistedLayout = serializeWorkspaceState(serverState);
            stateRef.current = serverState;
            lastPersistedLayoutJsonRef.current = JSON.stringify(persistedLayout);
            writeSavedLayout(persistedLayout);
            if (mountedRef.current) {
              dispatch({
                type: 'workspace.hydrated',
                terminals: Object.values(serverState.terminals),
                savedWorkspaces: persistedLayout.workspaces,
                savedActiveWorkspaceId: persistedLayout.activeWorkspaceId
              });
            }
          }
          return;
        } catch {
          // Fall back to the local cache below.
        }
      }
      writeSavedLayout(layout);
    }
  }

  const sessionLabel = formatSessionExpiry(sessionExpiresAt);
  const showSidebarDetails = !sidebarCollapsed || sidebarOpen;
  const effectiveSidebarMode = showSidebarDetails ? sidebarMode : 'workspaces';

  return (
    <main
      className="terminal-shell"
      data-collapsed={sidebarCollapsed}
      data-sidebar-open={sidebarOpen}
      onKeyDownCapture={handleWorkspaceKeyDown}
      onDragOver={handleWorkspaceDragOver}
      onDrop={handleWorkspaceDrop}
    >
      <button type="button" className="workspace-backdrop" aria-label="Close workspaces" onClick={() => setSidebarOpen(false)} />
      <aside className="workspace-sidebar">
        <header className="workspace-brand">
          <LeominalMark size={18} />
          {showSidebarDetails ? <span className="workspace-brand-name">leominal</span> : null}
          <button
            type="button"
            className="sidebar-collapse-button"
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
          >
            {sidebarCollapsed ? '>' : '<'}
          </button>
          <button
            type="button"
            className="sidebar-drawer-close-button"
            aria-label="Close workspaces"
            title="Close workspaces"
            onClick={() => setSidebarOpen(false)}
          >
            x
          </button>
        </header>
        <div className="workspace-sidebar-content">
          {showSidebarDetails ? (
            <div className="workspace-sidebar-tabs" role="tablist" aria-label="Sidebar mode">
              <button
                type="button"
                role="tab"
                aria-selected={sidebarMode === 'workspaces'}
                onClick={() => {
                  setSidebarMode('workspaces');
                  setEditingWorkspace(null);
                }}
              >
                Workspaces
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={sidebarMode === 'files'}
                onClick={() => {
                  setSidebarMode('files');
                  setEditingWorkspace(null);
                }}
              >
                Files
              </button>
            </div>
          ) : null}

          {effectiveSidebarMode === 'workspaces' ? (
            <nav className="workspace-nav" aria-label="Workspaces">
              {showSidebarDetails ? (
                <div className="workspace-sidebar-header">
                  <span>workspaces</span>
                  <button type="button" aria-label="New workspace" title="New workspace" onClick={createNewWorkspace}>
                    +
                  </button>
                </div>
              ) : null}
              <div className="workspace-list">
                {state.workspaces.map((workspace, workspaceIndex) => {
                  const workspaceActiveTab = workspace.tabs.find((tab) => tab.id === workspace.activeTabId) ?? workspace.tabs[0];
                  const workspaceActiveTerminal = workspaceActiveTab ? state.terminals[workspaceActiveTab.activeTerminalId] : undefined;
                  const workspaceSummary = workspaceActiveTerminal?.cwd ?? `${workspace.tabs.length} tab${workspace.tabs.length === 1 ? '' : 's'}`;
                  const active = workspace.id === state.activeWorkspaceId;
                  const editing = editingWorkspace?.workspaceId === workspace.id && showSidebarDetails;
                  const workspaceInitial = (workspace.title.trim()[0] ?? '?').toUpperCase();
                  const workspaceShortcut = workspaceIndexShortcutLabel(workspaceIndex + 1);
                  const workspaceTitle = showSidebarDetails
                    ? `${workspace.title} - ${workspaceShortcut} - double-click to rename`
                    : `${workspace.title} - ${workspaceShortcut}`;
                  return (
                    <div
                      className="workspace-entry"
                      data-active={active}
                      key={workspace.id}
                    >
                      {editing ? (
                        <form
                          className="workspace-name-editor"
                          onSubmit={(event) => {
                            event.preventDefault();
                            commitRenameWorkspace();
                          }}
                        >
                          <input
                            ref={workspaceEditInputRef}
                            aria-label={`Rename workspace ${workspace.title}`}
                            value={editingWorkspace.title}
                            onBlur={commitRenameWorkspace}
                            onChange={(event) => setEditingWorkspace({ workspaceId: workspace.id, title: event.target.value })}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                commitRenameWorkspace();
                                return;
                              }
                              if (event.key === 'Escape') {
                                event.preventDefault();
                                workspaceRenameCancelledRef.current = true;
                                setEditingWorkspace(null);
                              }
                            }}
                          />
                          <span className="workspace-entry-meta">
                            <span className="workspace-entry-cwd">{workspaceSummary}</span>
                            <span>{workspace.tabs.length}</span>
                          </span>
                        </form>
                      ) : (
                        <button
                          type="button"
                          className="workspace-select-button"
                          aria-current={active ? 'page' : undefined}
                          aria-label={!showSidebarDetails ? `Select workspace ${workspace.title}` : undefined}
                          title={workspaceTitle}
                          onClick={() => {
                            dispatchLayoutChange({ type: 'workspace.selected', workspaceId: workspace.id });
                            setSidebarOpen(false);
                          }}
                          onDoubleClick={(event) => {
                            event.preventDefault();
                            if (showSidebarDetails) {
                              beginRenameWorkspace(workspace.id, workspace.title);
                            }
                          }}
                        >
                          {!showSidebarDetails ? (
                            <span className="workspace-initial">{workspaceInitial}</span>
                          ) : (
                            <>
                              <strong>{workspace.title}</strong>
                              <span className="workspace-entry-meta">
                                <span className="workspace-entry-cwd">{workspaceSummary}</span>
                                <span>{workspace.tabs.length}</span>
                              </span>
                            </>
                          )}
                        </button>
                      )}
                      {state.workspaces.length > 1 && showSidebarDetails ? (
                        <button
                          type="button"
                          className="workspace-close-button"
                          aria-label={`Close ${workspace.title}`}
                          title={`Close ${workspace.title}`}
                          onClick={() => void closeWorkspace(workspace.id)}
                        >
                          x
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </nav>
          ) : (
            <FileExplorer
              api={api}
              activeTerminalId={activeTerminalId}
              activeTerminalCwd={activeTerminal?.cwd ?? null}
              onOpenFile={openFileInEditorPane}
            />
          )}
        </div>
        {showSidebarDetails ? (
          <div className="workspace-sidebar-footer">
            <span>{sessionLabel}</span>
            <div className="workspace-session-actions">
              <button type="button" className="secondary-button" onClick={() => setSettingsOpen(true)}>
                Settings
              </button>
              <button type="button" className="secondary-button" onClick={() => void logout()}>
                logout
              </button>
            </div>
          </div>
        ) : null}
      </aside>

      <section className="terminal-main" aria-label="Terminal workspace">
        <TerminalTabs
          tabs={activeWorkspace?.tabs ?? []}
          activeTabId={activeWorkspace?.activeTabId ?? null}
          terminals={state.terminals}
          onSelectTab={(tabId) => dispatchLayoutChange({ type: 'tab.selected', tabId })}
          onCreateTab={() => void createNewTab()}
          onToggleWorkspaces={() => setSidebarOpen((open) => !open)}
          onCloseTerminals={(terminalIds) => void closeTerminals(terminalIds)}
          onSplitVertical={() => void split('vertical')}
          onSplitHorizontal={() => void split('horizontal')}
          onRenameTab={(tabId, title) => dispatchLayoutChange({ type: 'tab.renamed', tabId, title })}
          activePaneAvailable={Boolean(activeTerminalId)}
        />

        {error ? <div className="workspace-error">{error}</div> : null}

        <section className="workspace-body" aria-busy={loading}>
          {loading ? <div className="workspace-placeholder">Opening shell...</div> : null}
          {!loading && !activeTab ? <EmptyWorkspace onCreate={() => void createNewTab()} /> : null}
          {!loading && activeTab ? (
            <SplitPane
              node={activeTab.root}
              terminals={state.terminals}
              editors={editors}
              api={api}
              activeTerminalId={activeTab.activeTerminalId}
              refreshCwdOnEnter={effectiveSidebarMode === 'files'}
              onSelect={(terminalId) => dispatchLayoutChange({ type: 'pane.selected', terminalId })}
              onClose={(terminalId) => void closeTerminal(terminalId)}
              onCloseEditor={closeEditorPane}
              onResize={(path, ratio) => dispatchLayoutChange({ type: 'pane.resized', path, ratio })}
              onExit={(terminalId, exitCode) => dispatchTerminalState({ type: 'terminal.exited', terminalId, exitCode })}
              onSnapshot={(terminal) => dispatchTerminalState({ type: 'terminal.updated', terminal })}
            />
          ) : null}
        </section>
        {activeWorkspace && activeTab ? (
          <StatusBar
            activeTerminal={activeTerminal}
            tab={activeTab}
            tabCount={activeWorkspace.tabs.length}
            onReload={onReload}
          />
        ) : null}
        <UploadToast toast={uploadToast} onDismiss={() => setUploadToast(null)} />
      </section>
      {settingsOpen ? <AppSettingsModal api={api} onClose={() => setSettingsOpen(false)} /> : null}
    </main>
  );
}

type WorkspaceShortcut =
  | { type: 'pane.direction'; direction: PaneNavigationDirection }
  | { type: 'pane.previous' }
  | { type: 'pane.next' }
  | { type: 'pane.index'; index: number }
  | { type: 'workspace.index'; index: number }
  | { type: 'split'; direction: 'horizontal' | 'vertical' };

function parseWorkspaceShortcut(event: React.KeyboardEvent<HTMLElement>): WorkspaceShortcut | null {
  const digit = digitKey(event);
  if (!event.ctrlKey || event.metaKey) {
    return null;
  }

  if (event.altKey) {
    if (event.shiftKey) {
      const splitDirection = splitDirectionForShortcut(event.key);
      return splitDirection ? { type: 'split', direction: splitDirection } : null;
    }
    const direction = arrowDirection(event.key);
    if (direction) {
      return { type: 'pane.direction', direction };
    }
    if (bracketKey(event) === 'previous') {
      return { type: 'pane.previous' };
    }
    if (bracketKey(event) === 'next') {
      return { type: 'pane.next' };
    }
    return null;
  }

  if (event.shiftKey) {
    return digit !== null ? { type: 'workspace.index', index: digit } : null;
  }
  return digit !== null ? { type: 'pane.index', index: digit } : null;
}

function paneTargetForShortcut(
  root: TerminalTabLayout['root'],
  activeTerminalId: TerminalId,
  shortcut: Exclude<WorkspaceShortcut, { type: 'workspace.index' } | { type: 'split' }>
): TerminalId | null {
  switch (shortcut.type) {
    case 'pane.direction':
      return getDirectionalPaneTarget(root, activeTerminalId, shortcut.direction);
    case 'pane.previous':
      return getPreviousPaneTarget(root, activeTerminalId);
    case 'pane.next':
      return getNextPaneTarget(root, activeTerminalId);
    case 'pane.index':
      return getPaneTargetByIndex(root, shortcut.index);
    default:
      return null;
  }
}

function splitDirectionForShortcut(key: string): 'horizontal' | 'vertical' | null {
  switch (key) {
    case 'ArrowRight':
      return 'vertical';
    case 'ArrowDown':
      return 'horizontal';
    default:
      return null;
  }
}

function arrowDirection(key: string): PaneNavigationDirection | null {
  switch (key) {
    case 'ArrowLeft':
      return 'left';
    case 'ArrowRight':
      return 'right';
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    default:
      return null;
  }
}

function digitKey(event: React.KeyboardEvent<HTMLElement>): number | null {
  const codeMatch = /^Digit([1-9])$/.exec(event.code);
  if (codeMatch?.[1]) {
    return Number(codeMatch[1]);
  }
  return /^[1-9]$/.test(event.key) ? Number(event.key) : null;
}

function bracketKey(event: React.KeyboardEvent<HTMLElement>): 'previous' | 'next' | null {
  if (event.code === 'BracketLeft' || event.key === '[') {
    return 'previous';
  }
  if (event.code === 'BracketRight' || event.key === ']') {
    return 'next';
  }
  return null;
}

function isEditableShortcutTarget(target: EventTarget): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.closest('.xterm')) {
    return false;
  }
  if (target.closest('input, textarea, select, [role="textbox"]')) {
    return true;
  }
  const editable = target.closest('[contenteditable]');
  return editable instanceof HTMLElement && editable.getAttribute('contenteditable')?.toLowerCase() !== 'false';
}

function EmptyWorkspace({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="empty-workspace">
      <span>No terminal is open.</span>
      <button type="button" onClick={onCreate}>
        New tab
      </button>
    </div>
  );
}

function StatusBar({
  activeTerminal,
  tab,
  tabCount,
  onReload
}: {
  activeTerminal: TerminalSummary | undefined;
  tab: TerminalTabLayout;
  tabCount: number;
  onReload: () => void;
}) {
  const paneCount = countTabPanes(tab);
  return (
    <footer className="terminal-status-bar">
      <span className="terminal-status-cwd">{activeTerminal?.cwd ?? '~'}</span>
      <span className="terminal-status-separator">·</span>
      <span>{activeTerminal?.title ?? 'shell'}</span>
      <span className="terminal-status-separator">·</span>
      <span>zsh</span>
      <span className="terminal-status-spacer" />
      <span>
        {tabCount} tab · {paneCount} pane
      </span>
      <span className="terminal-status-separator">·</span>
      <span className="terminal-status-connected">● connected</span>
      <button type="button" className="terminal-status-reload-button" aria-label="Reload app" title="Reload app" onClick={onReload}>
        <svg className="terminal-status-reload-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="M12.9 7.1a4.9 4.9 0 1 0-1.4 3.4" />
          <path d="M12.9 3.8v3.3H9.6" />
        </svg>
      </button>
    </footer>
  );
}

function reloadApp() {
  window.location.reload();
}

interface SavedLayoutResult {
  savedTabs?: TerminalTabLayout[];
  savedWorkspaces?: TerminalWorkspaceLayout[];
  savedActiveWorkspaceId?: string | null;
}

function readSavedLayout(): SavedLayoutResult | null {
  const workspaceRaw = localStorage.getItem(workspaceStorageKey);
  if (workspaceRaw) {
    try {
      const parsed = JSON.parse(workspaceRaw) as unknown;
      const layout = normalizeTerminalLayoutState(parsed);
      if (layout) {
        return layoutHydrationFromState(layout);
      }
    } catch {
      // Fall through to the legacy v1 layout if the v2 state is corrupt.
    }
  }

  const raw = localStorage.getItem(layoutStorageKey);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || !parsed.every(isTerminalTabLayout)) {
      return null;
    }
    return { savedTabs: parsed };
  } catch {
    return null;
  }
}

function layoutHydrationFromState(value: TerminalLayoutState): SavedLayoutResult | null {
  const layout = normalizeTerminalLayoutState(value);
  if (!layout) {
    return null;
  }
  return {
    savedWorkspaces: layout.workspaces,
    savedActiveWorkspaceId: layout.activeWorkspaceId
  };
}

function writeSavedLayout(layout: TerminalLayoutState) {
  if (layout.workspaces.length > 0) {
    localStorage.setItem(workspaceStorageKey, JSON.stringify(layout));
    localStorage.removeItem(layoutStorageKey);
    return;
  }
  localStorage.removeItem(workspaceStorageKey);
}

function getActiveRunningTerminal(state: ReturnType<typeof createEmptyTerminalState>): TerminalSummary | null {
  const workspace = state.workspaces.find((candidate) => candidate.id === state.activeWorkspaceId) ?? state.workspaces[0];
  const tab = workspace?.tabs.find((candidate) => candidate.id === workspace.activeTabId) ?? workspace?.tabs[0];
  const terminal = tab ? state.terminals[tab.activeTerminalId] : undefined;
  return terminal?.status === 'running' ? terminal : null;
}

function firstUploadError(response: { results: Array<{ status: 'uploaded' | 'failed'; error?: string }> }): string | undefined {
  return response.results.find((result) => result.status === 'failed' && result.error)?.error;
}

function fileNameFromPath(filePath: string): string {
  return filePath.split('/').filter(Boolean).pop() ?? filePath;
}

function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(sidebarCollapsedStorageKey) === 'true';
  } catch {
    return false;
  }
}

function writeSidebarCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem(sidebarCollapsedStorageKey, collapsed ? 'true' : 'false');
  } catch {
    // Ignore unavailable storage; the collapse control still works for the session.
  }
}

function formatSessionExpiry(expiresAt: string | null): string {
  if (!expiresAt) {
    return 'session · local';
  }
  const expiryMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiryMs)) {
    return 'session · local';
  }
  const remainingMs = expiryMs - Date.now();
  if (remainingMs <= 0) {
    return 'session · expired';
  }
  const minutes = Math.max(1, Math.floor(remainingMs / 60_000));
  if (minutes < 60) {
    return `session · ${minutes}m left`;
  }
  const hours = Math.floor(minutes / 60);
  return `session · ${hours}h left`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed';
}
