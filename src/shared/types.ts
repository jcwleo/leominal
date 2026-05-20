export type TerminalId = string;

export interface TerminalSummary {
  id: TerminalId;
  title: string;
  cwd: string;
  pid: number | null;
  cols: number;
  rows: number;
  createdAt: string;
  updatedAt: string;
  status: 'running' | 'exited';
  exitCode: number | null;
}

export interface AuthSessionStatus {
  passwordSet: boolean;
  authenticated: boolean;
  expiresAt: string | null;
}

export interface SplitNode {
  type: 'split';
  direction: 'horizontal' | 'vertical';
  ratio: number;
  first: LayoutNode;
  second: LayoutNode;
}

export interface PaneNode {
  type: 'pane';
  terminalId: TerminalId;
}

export interface EditorPaneNode {
  type: 'editor';
  editorId: string;
  title: string;
}

export type LayoutNode = SplitNode | PaneNode | EditorPaneNode;

export interface TerminalTabLayout {
  id: string;
  title: string;
  root: LayoutNode;
  activeTerminalId: TerminalId;
}

export interface TerminalWorkspaceLayout {
  id: string;
  title: string;
  tabs: TerminalTabLayout[];
  activeTabId: string | null;
}

export interface TerminalLayoutState {
  activeWorkspaceId: string | null;
  workspaces: TerminalWorkspaceLayout[];
}
