import type { LayoutNode, TerminalLayoutState, TerminalTabLayout, TerminalWorkspaceLayout } from './types.js';

const maxWorkspaces = 128;
const maxTabsPerWorkspace = 512;
const maxLayoutNodeDepth = 64;
const maxLayoutNodes = 4_096;

export function isTerminalLayoutState(value: unknown): value is TerminalLayoutState {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const state = value as Partial<TerminalLayoutState>;
  return (
    (typeof state.activeWorkspaceId === 'string' || state.activeWorkspaceId === null) &&
    Array.isArray(state.workspaces) &&
    state.workspaces.length <= maxWorkspaces &&
    state.workspaces.every(isTerminalWorkspaceLayout)
  );
}

export function normalizeTerminalLayoutState(value: unknown): TerminalLayoutState | null {
  return isTerminalLayoutState(value) ? value : null;
}

export function isTerminalWorkspaceLayout(value: unknown): value is TerminalWorkspaceLayout {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const workspace = value as Partial<TerminalWorkspaceLayout>;
  return (
    typeof workspace.id === 'string' &&
    typeof workspace.title === 'string' &&
    (typeof workspace.activeTabId === 'string' || workspace.activeTabId === null) &&
    Array.isArray(workspace.tabs) &&
    workspace.tabs.length <= maxTabsPerWorkspace &&
    workspace.tabs.every(isTerminalTabLayout)
  );
}

export function isTerminalTabLayout(value: unknown): value is TerminalTabLayout {
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

export function isLayoutNode(value: unknown): value is LayoutNode {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const stack: Array<{ node: unknown; depth: number }> = [{ node: value, depth: 1 }];
  let nodeCount = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || !current.node || typeof current.node !== 'object') {
      return false;
    }
    nodeCount += 1;
    if (nodeCount > maxLayoutNodes || current.depth > maxLayoutNodeDepth) {
      return false;
    }

    const node = current.node as Partial<LayoutNode>;
    if (node.type === 'pane') {
      if (typeof node.terminalId !== 'string') {
        return false;
      }
      continue;
    }
    if (node.type === 'split') {
      if (node.direction !== 'horizontal' && node.direction !== 'vertical') {
        return false;
      }
      stack.push({ node: node.first, depth: current.depth + 1 });
      stack.push({ node: node.second, depth: current.depth + 1 });
      continue;
    }
    return false;
  }
  return true;
}
