import type { LayoutNode, TerminalLayoutState, TerminalTabLayout, TerminalWorkspaceLayout } from './types.js';

const maxWorkspaces = 128;
const maxTabsPerWorkspace = 512;
const maxLayoutNodeDepth = 64;
const maxLayoutNodes = 4_096;

export function isTerminalLayoutState(value: unknown): value is TerminalLayoutState {
  return normalizeTerminalLayoutState(value) !== null;
}

export function normalizeTerminalLayoutState(value: unknown): TerminalLayoutState | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const state = value as Partial<TerminalLayoutState>;
  if (
    (typeof state.activeWorkspaceId !== 'string' && state.activeWorkspaceId !== null) ||
    !Array.isArray(state.workspaces) ||
    state.workspaces.length > maxWorkspaces
  ) {
    return null;
  }
  const workspaces = state.workspaces.map(normalizeTerminalWorkspaceLayout);
  if (workspaces.some((workspace) => workspace === null)) {
    return null;
  }
  return {
    activeWorkspaceId: state.activeWorkspaceId,
    workspaces: workspaces as TerminalWorkspaceLayout[]
  };
}

export function isTerminalWorkspaceLayout(value: unknown): value is TerminalWorkspaceLayout {
  return normalizeTerminalWorkspaceLayout(value) !== null;
}

function normalizeTerminalWorkspaceLayout(value: unknown): TerminalWorkspaceLayout | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const workspace = value as Partial<TerminalWorkspaceLayout>;
  if (
    typeof workspace.id !== 'string' ||
    typeof workspace.title !== 'string' ||
    (typeof workspace.activeTabId !== 'string' && workspace.activeTabId !== null) ||
    !Array.isArray(workspace.tabs) ||
    workspace.tabs.length > maxTabsPerWorkspace
  ) {
    return null;
  }
  const tabs = workspace.tabs.map(normalizeTerminalTabLayout);
  if (tabs.some((tab) => tab === null)) {
    return null;
  }
  return {
    id: workspace.id,
    title: workspace.title,
    activeTabId: workspace.activeTabId,
    tabs: tabs as TerminalTabLayout[]
  };
}

export function isTerminalTabLayout(value: unknown): value is TerminalTabLayout {
  return normalizeTerminalTabLayout(value) !== null;
}

function normalizeTerminalTabLayout(value: unknown): TerminalTabLayout | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const tab = value as Partial<TerminalTabLayout>;
  if (typeof tab.id !== 'string' || typeof tab.title !== 'string' || typeof tab.activeTerminalId !== 'string') {
    return null;
  }
  const root = normalizeLayoutNode(tab.root);
  if (!root) {
    return null;
  }
  return {
    id: tab.id,
    title: tab.title,
    activeTerminalId: tab.activeTerminalId,
    root
  };
}

export function isLayoutNode(value: unknown): value is LayoutNode {
  return normalizeLayoutNode(value) !== null;
}

function normalizeLayoutNode(value: unknown): LayoutNode | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  let nodeCount = 0;
  return normalizeLayoutNodeAtDepth(value, 1, () => {
    nodeCount += 1;
    return nodeCount <= maxLayoutNodes;
  });
}

function normalizeLayoutNodeAtDepth(value: unknown, depth: number, consumeNode: () => boolean): LayoutNode | null {
  if (!value || typeof value !== 'object' || depth > maxLayoutNodeDepth || !consumeNode()) {
    return null;
  }

  const node = value as Partial<LayoutNode>;
  if (node.type === 'pane') {
    return typeof node.terminalId === 'string' ? { type: 'pane', terminalId: node.terminalId } : null;
  }
  if (node.type !== 'split' || (node.direction !== 'horizontal' && node.direction !== 'vertical')) {
    return null;
  }
  const first = normalizeLayoutNodeAtDepth(node.first, depth + 1, consumeNode);
  const second = normalizeLayoutNodeAtDepth(node.second, depth + 1, consumeNode);
  if (!first || !second) {
    return null;
  }
  return {
    type: 'split',
    direction: node.direction,
    ratio: normalizeRatio((node as { ratio?: unknown }).ratio),
    first,
    second
  };
}

function normalizeRatio(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(0.9, Math.max(0.1, value)) : 0.5;
}
