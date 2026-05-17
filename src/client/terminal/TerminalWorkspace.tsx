import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { isTerminalTabLayout, normalizeTerminalLayoutState } from '../../shared/layoutState.js';
import type { TerminalId, TerminalLayoutState, TerminalTabLayout, TerminalWorkspaceLayout } from '../../shared/types.js';
import { ApiError, type ApiClient, createApiClient } from '../api/client.js';
import { SplitPane } from './SplitPane.js';
import { TerminalTabs } from './TerminalTabs.js';
import {
  createEmptyTerminalState,
  listWorkspaceTerminalIds,
  reconstructTerminalState,
  serializeWorkspaceState,
  type TerminalAction,
  terminalReducer
} from './terminalReducer.js';

const layoutStorageKey = 'leominal.terminalLayout.v1';
const workspaceStorageKey = 'leominal.terminalWorkspaces.v2';
const layoutSaveDebounceMs = 75;

interface TerminalWorkspaceProps {
  api?: ApiClient;
  sessionExpiresAt?: string | null;
  onLogout?: () => Promise<void>;
}

export function TerminalWorkspace({
  api: providedApi,
  onLogout = async () => undefined
}: TerminalWorkspaceProps) {
  const api = useMemo(() => providedApi ?? createApiClient(), [providedApi]);
  const [state, dispatch] = useReducer(terminalReducer, undefined, createEmptyTerminalState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [editingWorkspace, setEditingWorkspace] = useState<{ workspaceId: string; title: string } | null>(null);
  const workspaceEditInputRef = useRef<HTMLInputElement | null>(null);
  const workspaceRenameCancelledRef = useRef(false);
  const stateRef = useRef(state);
  const layoutRevisionRef = useRef<number | null>(null);
  const lastPersistedLayoutJsonRef = useRef<string | null>(null);
  const pendingLayoutSaveRef = useRef<TerminalLayoutState | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(false);

  const activeWorkspace = state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId) ?? state.workspaces[0];
  const activeTab = activeWorkspace?.tabs.find((tab) => tab.id === activeWorkspace.activeTabId) ?? activeWorkspace?.tabs[0];
  const activeTerminalId = activeTab?.activeTerminalId ?? null;

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

  async function closeActivePane() {
    if (!activeTerminalId) {
      return;
    }
    await closeTerminal(activeTerminalId);
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

  return (
    <main className="terminal-shell" data-sidebar-open={sidebarOpen}>
      <button type="button" className="workspace-backdrop" aria-label="Close workspaces" onClick={() => setSidebarOpen(false)} />
      <aside className="workspace-sidebar">
        <nav className="workspace-nav" aria-label="Workspaces">
          <div className="workspace-sidebar-header">
            <span>WORKSPACES</span>
            <button type="button" aria-label="New workspace" title="New workspace" onClick={createNewWorkspace}>
              +
            </button>
          </div>
          <div className="workspace-list">
            {state.workspaces.map((workspace) => {
              const workspaceTerminalIds = listWorkspaceTerminalIds(workspace);
              const workspaceActiveTab = workspace.tabs.find((tab) => tab.id === workspace.activeTabId) ?? workspace.tabs[0];
              const workspaceActiveTerminal = workspaceActiveTab ? state.terminals[workspaceActiveTab.activeTerminalId] : undefined;
              const workspaceSummary = workspaceActiveTerminal?.cwd ?? `${workspace.tabs.length} tab${workspace.tabs.length === 1 ? '' : 's'}`;
              const summaryText = `${workspaceSummary}${workspaceTerminalIds.length > 0 ? ` | ${workspaceTerminalIds.length} pane${workspaceTerminalIds.length === 1 ? '' : 's'}` : ''}`;
              const active = workspace.id === state.activeWorkspaceId;
              const editing = editingWorkspace?.workspaceId === workspace.id;
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
                      <span>{summaryText}</span>
                    </form>
                  ) : (
                    <button
                      type="button"
                      className="workspace-select-button"
                      aria-current={active ? 'page' : undefined}
                      onClick={() => {
                        dispatchLayoutChange({ type: 'workspace.selected', workspaceId: workspace.id });
                        setSidebarOpen(false);
                      }}
                      onDoubleClick={(event) => {
                        event.preventDefault();
                        beginRenameWorkspace(workspace.id, workspace.title);
                      }}
                    >
                      <strong>{workspace.title}</strong>
                      <span>{summaryText}</span>
                    </button>
                  )}
                  {state.workspaces.length > 1 ? (
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
        <div className="workspace-sidebar-footer">
          <span>Leominal</span>
          <button type="button" className="secondary-button" onClick={() => void logout()}>
            Logout
          </button>
        </div>
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
          onCloseActivePane={() => void closeActivePane()}
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
              activeTerminalId={activeTab.activeTerminalId}
              onSelect={(terminalId) => dispatchLayoutChange({ type: 'pane.selected', terminalId })}
              onExit={(terminalId, exitCode) => dispatchTerminalState({ type: 'terminal.exited', terminalId, exitCode })}
              onSnapshot={(terminal) => dispatchTerminalState({ type: 'terminal.updated', terminal })}
            />
          ) : null}
        </section>
      </section>
    </main>
  );
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed';
}
