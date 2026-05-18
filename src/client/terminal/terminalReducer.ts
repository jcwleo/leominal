import type { LayoutNode, TerminalId, TerminalSummary, TerminalTabLayout, TerminalWorkspaceLayout } from '../../shared/types.js';

export interface SerializedWorkspaceState {
  activeWorkspaceId: string | null;
  workspaces: TerminalWorkspaceLayout[];
}

export interface TerminalState {
  workspaces: TerminalWorkspaceLayout[];
  activeWorkspaceId: string | null;
  terminals: Record<TerminalId, TerminalSummary>;
}

export type TerminalAction =
  | {
      type: 'workspace.hydrated';
      terminals: TerminalSummary[];
      savedTabs?: TerminalTabLayout[];
      savedWorkspaces?: TerminalWorkspaceLayout[];
      savedActiveWorkspaceId?: string | null;
    }
  | { type: 'workspace.created'; workspaceId: string; title: string }
  | { type: 'workspace.closed'; workspaceId: string }
  | { type: 'workspace.selected'; workspaceId: string }
  | { type: 'workspace.renamed'; workspaceId: string; title: string }
  | { type: 'terminal.created'; terminal: TerminalSummary }
  | { type: 'terminal.split'; terminal: TerminalSummary; direction: 'horizontal' | 'vertical' }
  | { type: 'terminal.updated'; terminal: TerminalSummary }
  | { type: 'terminal.exited'; terminalId: TerminalId; exitCode: number | null }
  | { type: 'terminal.closed'; terminalId: TerminalId }
  | { type: 'pane.selected'; terminalId: TerminalId }
  | { type: 'pane.resized'; path: number[]; ratio: number }
  | { type: 'tab.selected'; tabId: string }
  | { type: 'tab.renamed'; tabId: string; title: string }
  | { type: 'activePane.closed' };

const defaultWorkspaceId = 'workspace-default';
const defaultWorkspaceTitle = 'Leominal';

export function createEmptyTerminalState(): TerminalState {
  return {
    workspaces: [],
    activeWorkspaceId: null,
    terminals: {}
  };
}

export function terminalReducer(state: TerminalState, action: TerminalAction): TerminalState {
  switch (action.type) {
    case 'workspace.hydrated':
      return reconstructTerminalState(action.terminals, action.savedTabs, action.savedWorkspaces, action.savedActiveWorkspaceId);
    case 'workspace.created':
      return createWorkspace(state, { id: action.workspaceId, title: action.title });
    case 'workspace.closed':
      return closeWorkspace(state, action.workspaceId);
    case 'workspace.selected':
      return selectWorkspace(state, action.workspaceId);
    case 'workspace.renamed':
      return renameWorkspace(state, action.workspaceId, action.title);
    case 'terminal.created':
      return createTabForTerminal(state, action.terminal);
    case 'terminal.split':
      return splitActivePane(state, action.terminal, action.direction);
    case 'terminal.updated':
      return updateTerminal(state, action.terminal);
    case 'terminal.exited':
      return markTerminalExited(state, action.terminalId, action.exitCode);
    case 'terminal.closed':
      return removeTerminalPane(state, action.terminalId);
    case 'pane.selected':
      return selectPane(state, action.terminalId);
    case 'pane.resized':
      return resizePane(state, action.path, action.ratio);
    case 'tab.selected':
      return selectTab(state, action.tabId);
    case 'tab.renamed':
      return renameTab(state, action.tabId, action.title);
    case 'activePane.closed':
      return closeActivePane(state);
    default:
      return state;
  }
}

export function createWorkspace(state: TerminalState, workspace: Pick<TerminalWorkspaceLayout, 'id' | 'title'>): TerminalState {
  if (state.workspaces.some((candidate) => candidate.id === workspace.id)) {
    return selectWorkspace(state, workspace.id);
  }

  const nextWorkspace: TerminalWorkspaceLayout = {
    id: workspace.id,
    title: workspace.title,
    tabs: [],
    activeTabId: null
  };

  return {
    ...state,
    workspaces: [...state.workspaces, nextWorkspace],
    activeWorkspaceId: nextWorkspace.id
  };
}

export function selectWorkspace(state: TerminalState, workspaceId: string): TerminalState {
  if (!state.workspaces.some((workspace) => workspace.id === workspaceId)) {
    return state;
  }
  return { ...state, activeWorkspaceId: workspaceId };
}

export function renameWorkspace(state: TerminalState, workspaceId: string, title: string): TerminalState {
  const normalizedTitle = title.trim();
  if (!normalizedTitle) {
    return state;
  }

  let changed = false;
  const workspaces = state.workspaces.map((workspace) => {
    if (workspace.id !== workspaceId || workspace.title === normalizedTitle) {
      return workspace;
    }
    changed = true;
    return { ...workspace, title: normalizedTitle };
  });

  return changed ? { ...state, workspaces } : state;
}

export function closeWorkspace(state: TerminalState, workspaceId: string): TerminalState {
  if (state.workspaces.length <= 1 || !state.workspaces.some((workspace) => workspace.id === workspaceId)) {
    return state;
  }

  const closedWorkspace = state.workspaces.find((workspace) => workspace.id === workspaceId);
  const closedTerminalIds = new Set(closedWorkspace ? listWorkspaceTerminalIds(closedWorkspace) : []);
  const terminals = { ...state.terminals };
  for (const terminalId of closedTerminalIds) {
    delete terminals[terminalId];
  }

  const workspaces = state.workspaces.filter((workspace) => workspace.id !== workspaceId);
  const activeWorkspaceId = state.activeWorkspaceId === workspaceId ? workspaces[0]?.id ?? null : state.activeWorkspaceId;

  return {
    workspaces,
    activeWorkspaceId,
    terminals
  };
}

export function createTabForTerminal(state: TerminalState, terminal: TerminalSummary): TerminalState {
  const base = ensureActiveWorkspace(state);
  const activeWorkspace = getActiveWorkspace(base) ?? emptyDefaultWorkspace();
  const tab = tabForTerminal(terminal);

  return {
    ...base,
    activeWorkspaceId: activeWorkspace.id,
    terminals: { ...base.terminals, [terminal.id]: terminal },
    workspaces: base.workspaces.map((workspace) =>
      workspace.id === activeWorkspace.id
        ? {
            ...workspace,
            tabs: [...workspace.tabs, tab],
            activeTabId: tab.id
          }
        : workspace
    )
  };
}

export function splitActivePane(
  state: TerminalState,
  terminal: TerminalSummary,
  direction: 'horizontal' | 'vertical'
): TerminalState {
  const activeWorkspace = getActiveWorkspace(state);
  const activeTab = activeWorkspace ? getActiveTab(activeWorkspace) : undefined;
  if (!activeWorkspace || !activeTab) {
    return createTabForTerminal(state, terminal);
  }

  const activeTerminalId = activeTab.activeTerminalId;
  const nextRoot = replacePane(activeTab.root, activeTerminalId, {
    type: 'split',
    direction,
    ratio: 0.5,
    first: { type: 'pane', terminalId: activeTerminalId },
    second: { type: 'pane', terminalId: terminal.id }
  });

  return {
    ...state,
    terminals: { ...state.terminals, [terminal.id]: terminal },
    workspaces: state.workspaces.map((workspace) =>
      workspace.id === activeWorkspace.id
        ? {
            ...workspace,
            tabs: workspace.tabs.map((tab) =>
              tab.id === activeTab.id
                ? {
                    ...tab,
                    root: nextRoot,
                    activeTerminalId: terminal.id
                  }
                : tab
            )
          }
        : workspace
    )
  };
}

export function closeActivePane(state: TerminalState): TerminalState {
  const activeWorkspace = getActiveWorkspace(state);
  const activeTab = activeWorkspace ? getActiveTab(activeWorkspace) : undefined;
  if (!activeTab) {
    return state;
  }
  return removeTerminalPane(state, activeTab.activeTerminalId);
}

export function selectTab(state: TerminalState, tabId: string): TerminalState {
  const activeWorkspace = getActiveWorkspace(state);
  if (!activeWorkspace || !activeWorkspace.tabs.some((tab) => tab.id === tabId)) {
    return state;
  }

  return {
    ...state,
    workspaces: state.workspaces.map((workspace) => (workspace.id === activeWorkspace.id ? { ...workspace, activeTabId: tabId } : workspace))
  };
}

export function renameTab(state: TerminalState, tabId: string, title: string): TerminalState {
  const normalizedTitle = title.trim();
  if (!normalizedTitle) {
    return state;
  }

  let changed = false;
  const workspaces = state.workspaces.map((workspace) => {
    let workspaceChanged = false;
    const tabs = workspace.tabs.map((tab) => {
      if (tab.id !== tabId || tab.title === normalizedTitle) {
        return tab;
      }
      changed = true;
      workspaceChanged = true;
      return { ...tab, title: normalizedTitle };
    });
    return workspaceChanged ? { ...workspace, tabs } : workspace;
  });

  return changed ? { ...state, workspaces } : state;
}

export function selectPane(state: TerminalState, terminalId: TerminalId): TerminalState {
  const owningWorkspace = state.workspaces.find((workspace) => workspace.tabs.some((tab) => containsTerminal(tab.root, terminalId)));
  const owningTab = owningWorkspace?.tabs.find((tab) => containsTerminal(tab.root, terminalId));
  if (!owningWorkspace || !owningTab) {
    return state;
  }

  return {
    ...state,
    activeWorkspaceId: owningWorkspace.id,
    workspaces: state.workspaces.map((workspace) =>
      workspace.id === owningWorkspace.id
        ? {
            ...workspace,
            activeTabId: owningTab.id,
            tabs: workspace.tabs.map((tab) => (tab.id === owningTab.id ? { ...tab, activeTerminalId: terminalId } : tab))
          }
        : workspace
    )
  };
}

export function resizePane(state: TerminalState, path: number[], ratio: number): TerminalState {
  const activeWorkspace = getActiveWorkspace(state);
  const activeTab = activeWorkspace ? getActiveTab(activeWorkspace) : undefined;
  if (!activeWorkspace || !activeTab) {
    return state;
  }

  const nextRoot = setRatioAtPath(activeTab.root, path, clampRatio(ratio));
  if (nextRoot === activeTab.root) {
    return state;
  }

  return {
    ...state,
    workspaces: state.workspaces.map((workspace) =>
      workspace.id === activeWorkspace.id
        ? {
            ...workspace,
            tabs: workspace.tabs.map((tab) => (tab.id === activeTab.id ? { ...tab, root: nextRoot } : tab))
          }
        : workspace
    )
  };
}

export function reconstructTerminalState(
  terminals: TerminalSummary[],
  savedTabs?: TerminalTabLayout[],
  savedWorkspaces?: TerminalWorkspaceLayout[],
  savedActiveWorkspaceId?: string | null
): TerminalState {
  const terminalMap = Object.fromEntries(terminals.map((terminal) => [terminal.id, terminal]));
  const availableIds = new Set(terminals.map((terminal) => terminal.id));
  const representedIds = new Set<TerminalId>();
  let workspaces = reconstructSavedWorkspaces(savedTabs, savedWorkspaces, availableIds, representedIds);

  if (workspaces.length === 0) {
    workspaces = [emptyDefaultWorkspace()];
  }

  const activeWorkspaceId: string | null =
    typeof savedActiveWorkspaceId === 'string' && workspaces.some((workspace) => workspace.id === savedActiveWorkspaceId)
      ? savedActiveWorkspaceId
      : workspaces[0]?.id ?? null;
  const targetWorkspaceId = activeWorkspaceId ?? workspaces[0]?.id ?? defaultWorkspaceId;

  for (const terminal of terminals) {
    if (representedIds.has(terminal.id)) {
      continue;
    }
    const tab = tabForTerminal(terminal);
    workspaces = appendTabToWorkspace(workspaces, targetWorkspaceId, tab);
    representedIds.add(terminal.id);
  }

  return {
    workspaces: workspaces.map(normalizeWorkspaceActiveTab),
    activeWorkspaceId,
    terminals: terminalMap
  };
}

export function listTabTerminalIds(tab: TerminalTabLayout): TerminalId[] {
  return collectTerminalIds(tab.root);
}

export function listWorkspaceTerminalIds(workspace: TerminalWorkspaceLayout): TerminalId[] {
  return workspace.tabs.flatMap((tab) => collectTerminalIds(tab.root));
}

export function serializeWorkspaceState(state: TerminalState): SerializedWorkspaceState {
  return {
    activeWorkspaceId: state.activeWorkspaceId,
    workspaces: state.workspaces
  };
}

export function serializeTabs(state: TerminalState): TerminalTabLayout[] {
  return getActiveWorkspace(state)?.tabs ?? [];
}

function updateTerminal(state: TerminalState, terminal: TerminalSummary): TerminalState {
  return {
    ...state,
    terminals: { ...state.terminals, [terminal.id]: terminal },
    workspaces: state.workspaces.map((workspace) => ({
      ...workspace,
      tabs: workspace.tabs.map((tab) => (containsTerminal(tab.root, terminal.id) ? { ...tab, title: tab.title || terminal.title } : tab))
    }))
  };
}

function markTerminalExited(state: TerminalState, terminalId: TerminalId, exitCode: number | null): TerminalState {
  const terminal = state.terminals[terminalId];
  if (!terminal) {
    return state;
  }
  return {
    ...state,
    terminals: {
      ...state.terminals,
      [terminalId]: {
        ...terminal,
        status: 'exited',
        exitCode
      }
    }
  };
}

function removeTerminalPane(state: TerminalState, terminalId: TerminalId): TerminalState {
  const terminals = { ...state.terminals };
  delete terminals[terminalId];

  const workspaces = state.workspaces.map((workspace) => {
    const tabs: TerminalTabLayout[] = [];
    for (const tab of workspace.tabs) {
      const nextRoot = removePane(tab.root, terminalId);
      if (!nextRoot) {
        continue;
      }
      const paneIds = collectTerminalIds(nextRoot);
      const activeTerminalId = paneIds.includes(tab.activeTerminalId) ? tab.activeTerminalId : paneIds[0];
      if (!activeTerminalId) {
        continue;
      }
      tabs.push({
        ...tab,
        root: nextRoot,
        activeTerminalId
      });
    }

    return normalizeWorkspaceActiveTab({
      ...workspace,
      tabs
    });
  });

  const activeWorkspaceStillExists = workspaces.some((workspace) => workspace.id === state.activeWorkspaceId);
  return {
    workspaces,
    activeWorkspaceId: activeWorkspaceStillExists ? state.activeWorkspaceId : workspaces[0]?.id ?? null,
    terminals
  };
}

function reconstructSavedWorkspaces(
  savedTabs: TerminalTabLayout[] | undefined,
  savedWorkspaces: TerminalWorkspaceLayout[] | undefined,
  availableIds: Set<TerminalId>,
  representedIds: Set<TerminalId>
): TerminalWorkspaceLayout[] {
  if (savedWorkspaces && savedWorkspaces.length > 0) {
    const workspaces: TerminalWorkspaceLayout[] = [];
    for (const savedWorkspace of savedWorkspaces) {
      if (!isTerminalWorkspaceLayout(savedWorkspace)) {
        continue;
      }
      workspaces.push(pruneWorkspace(savedWorkspace, availableIds, representedIds));
    }
    if (workspaces.length > 0) {
      return workspaces;
    }
  }

  return [pruneWorkspace({ ...emptyDefaultWorkspace(), tabs: savedTabs ?? [] }, availableIds, representedIds)];
}

function pruneWorkspace(
  savedWorkspace: TerminalWorkspaceLayout,
  availableIds: Set<TerminalId>,
  representedIds: Set<TerminalId>
): TerminalWorkspaceLayout {
  const tabs: TerminalTabLayout[] = [];
  for (const savedTab of savedWorkspace.tabs) {
    if (!isTerminalTabLayout(savedTab)) {
      continue;
    }
    const prunedRoot = pruneLayout(savedTab.root, availableIds);
    if (!prunedRoot) {
      continue;
    }
    const terminalIds = collectTerminalIds(prunedRoot);
    for (const id of terminalIds) {
      representedIds.add(id);
    }
    const activeTerminalId = terminalIds.includes(savedTab.activeTerminalId) ? savedTab.activeTerminalId : terminalIds[0];
    if (!activeTerminalId) {
      continue;
    }
    tabs.push({
      ...savedTab,
      root: prunedRoot,
      activeTerminalId
    });
  }

  return normalizeWorkspaceActiveTab({
    ...savedWorkspace,
    tabs
  });
}

function ensureActiveWorkspace(state: TerminalState): TerminalState {
  if (getActiveWorkspace(state)) {
    return state;
  }
  return {
    ...state,
    workspaces: [emptyDefaultWorkspace()],
    activeWorkspaceId: defaultWorkspaceId
  };
}

function getActiveWorkspace(state: TerminalState): TerminalWorkspaceLayout | undefined {
  return state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId) ?? state.workspaces[0];
}

function getActiveTab(workspace: TerminalWorkspaceLayout): TerminalTabLayout | undefined {
  return workspace.tabs.find((tab) => tab.id === workspace.activeTabId) ?? workspace.tabs[0];
}

function emptyDefaultWorkspace(): TerminalWorkspaceLayout {
  return {
    id: defaultWorkspaceId,
    title: defaultWorkspaceTitle,
    tabs: [],
    activeTabId: null
  };
}

function normalizeWorkspaceActiveTab(workspace: TerminalWorkspaceLayout): TerminalWorkspaceLayout {
  const activeTabStillExists = workspace.tabs.some((tab) => tab.id === workspace.activeTabId);
  return {
    ...workspace,
    activeTabId: activeTabStillExists ? workspace.activeTabId : workspace.tabs[0]?.id ?? null
  };
}

function appendTabToWorkspace(
  workspaces: TerminalWorkspaceLayout[],
  workspaceId: string,
  tab: TerminalTabLayout
): TerminalWorkspaceLayout[] {
  return workspaces.map((workspace) =>
    workspace.id === workspaceId
      ? {
          ...workspace,
          tabs: [...workspace.tabs, tab],
          activeTabId: workspace.activeTabId ?? tab.id
        }
      : workspace
  );
}

function tabForTerminal(terminal: TerminalSummary): TerminalTabLayout {
  return {
    id: `tab-${terminal.id}`,
    title: terminal.title || terminal.id,
    root: { type: 'pane', terminalId: terminal.id },
    activeTerminalId: terminal.id
  };
}

function replacePane(root: LayoutNode, terminalId: TerminalId, replacement: LayoutNode): LayoutNode {
  if (root.type === 'pane') {
    return root.terminalId === terminalId ? replacement : root;
  }
  return {
    ...root,
    first: replacePane(root.first, terminalId, replacement),
    second: replacePane(root.second, terminalId, replacement)
  };
}

function removePane(root: LayoutNode, terminalId: TerminalId): LayoutNode | null {
  if (root.type === 'pane') {
    return root.terminalId === terminalId ? null : root;
  }
  const first = removePane(root.first, terminalId);
  const second = removePane(root.second, terminalId);
  if (first && second) {
    return { ...root, first, second };
  }
  return first ?? second;
}

function pruneLayout(root: LayoutNode, availableIds: Set<TerminalId>): LayoutNode | null {
  if (root.type === 'pane') {
    return availableIds.has(root.terminalId) ? root : null;
  }
  const first = pruneLayout(root.first, availableIds);
  const second = pruneLayout(root.second, availableIds);
  if (first && second) {
    return { ...root, ratio: clampRatio(root.ratio), first, second };
  }
  return first ?? second;
}

function isTerminalWorkspaceLayout(value: unknown): value is TerminalWorkspaceLayout {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const workspace = value as Partial<TerminalWorkspaceLayout>;
  return (
    typeof workspace.id === 'string' &&
    typeof workspace.title === 'string' &&
    (typeof workspace.activeTabId === 'string' || workspace.activeTabId === null) &&
    Array.isArray(workspace.tabs)
  );
}

function isTerminalTabLayout(value: unknown): value is TerminalTabLayout {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const tab = value as Partial<TerminalTabLayout>;
  return (
    typeof tab.id === 'string' &&
    typeof tab.title === 'string' &&
    typeof tab.activeTerminalId === 'string' &&
    isLayoutNode(tab.root)
  );
}

function isLayoutNode(value: unknown): value is LayoutNode {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const node = value as Partial<LayoutNode>;
  if (node.type === 'pane') {
    return typeof node.terminalId === 'string';
  }
  if (node.type === 'split') {
    return (node.direction === 'horizontal' || node.direction === 'vertical') && isLayoutNode(node.first) && isLayoutNode(node.second);
  }
  return false;
}

function setRatioAtPath(root: LayoutNode, path: number[], ratio: number): LayoutNode {
  if (root.type === 'pane') {
    return root;
  }
  if (path.length === 0) {
    return root.ratio === ratio ? root : { ...root, ratio };
  }
  const [head, ...rest] = path;
  if (head === 0) {
    const first = setRatioAtPath(root.first, rest, ratio);
    return first === root.first ? root : { ...root, first };
  }
  if (head === 1) {
    const second = setRatioAtPath(root.second, rest, ratio);
    return second === root.second ? root : { ...root, second };
  }
  return root;
}

function clampRatio(ratio: number): number {
  return Number.isFinite(ratio) ? Math.min(0.9, Math.max(0.1, ratio)) : 0.5;
}

function containsTerminal(root: LayoutNode, terminalId: TerminalId): boolean {
  if (root.type === 'pane') {
    return root.terminalId === terminalId;
  }
  return containsTerminal(root.first, terminalId) || containsTerminal(root.second, terminalId);
}

function collectTerminalIds(root: LayoutNode): TerminalId[] {
  if (root.type === 'pane') {
    return [root.terminalId];
  }
  return [...collectTerminalIds(root.first), ...collectTerminalIds(root.second)];
}
