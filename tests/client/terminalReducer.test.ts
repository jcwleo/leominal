import { describe, expect, it } from 'vitest';
import type { TerminalSummary, TerminalTabLayout } from '../../src/shared/types.js';
import {
  closeActivePane,
  closeWorkspace,
  createEmptyTerminalState,
  createTabForTerminal,
  createWorkspace,
  reconstructTerminalState,
  renameTab,
  renameWorkspace,
  selectWorkspace,
  serializeWorkspaceState,
  splitActivePane,
  terminalReducer
} from '../../src/client/terminal/terminalReducer.js';

function terminal(id: string, title = id): TerminalSummary {
  return {
    id,
    title,
    cwd: `/workspace/${id}`,
    pid: 100,
    cols: 80,
    rows: 24,
    createdAt: '2026-05-17T00:00:00.000Z',
    updatedAt: '2026-05-17T00:00:00.000Z',
    status: 'running',
    exitCode: null
  };
}

describe('terminal layout reducer', () => {
  it('creates a tab for a new terminal and selects it', () => {
    const alpha = terminal('term-alpha', 'Alpha');

    const state = createTabForTerminal(createEmptyTerminalState(), alpha);

    const workspace = state.workspaces[0];
    expect(state.activeWorkspaceId).toBe('workspace-default');
    expect(workspace?.activeTabId).toBe('tab-term-alpha');
    expect(workspace?.tabs).toHaveLength(1);
    expect(workspace?.tabs[0]).toEqual({
      id: 'tab-term-alpha',
      title: 'Alpha',
      activeTerminalId: 'term-alpha',
      root: { type: 'pane', terminalId: 'term-alpha' }
    });
    expect(state.terminals['term-alpha']).toBe(alpha);
  });

  it('splits the active pane into a right-hand pane and makes the new terminal active', () => {
    const alpha = terminal('term-alpha', 'Alpha');
    const beta = terminal('term-beta', 'Beta');
    const initial = createTabForTerminal(createEmptyTerminalState(), alpha);

    const state = splitActivePane(initial, beta, 'vertical');

    const activeWorkspace = state.workspaces[0];
    expect(activeWorkspace?.activeTabId).toBe('tab-term-alpha');
    expect(activeWorkspace?.tabs[0]?.activeTerminalId).toBe('term-beta');
    expect(activeWorkspace?.tabs[0]?.root).toEqual({
      type: 'split',
      direction: 'vertical',
      ratio: 0.5,
      first: { type: 'pane', terminalId: 'term-alpha' },
      second: { type: 'pane', terminalId: 'term-beta' }
    });
  });

  it('splits an embedded editor pane beside the active terminal without persisting the editor node', () => {
    const alpha = terminal('term-alpha', 'Alpha');
    const initial = createTabForTerminal(createEmptyTerminalState(), alpha);

    const state = terminalReducer(initial, {
      type: 'editor.split',
      editorId: 'editor-notes',
      title: 'notes.txt',
      direction: 'vertical'
    });

    const activeWorkspace = state.workspaces[0];
    expect(activeWorkspace?.tabs[0]?.activeTerminalId).toBe('term-alpha');
    expect(activeWorkspace?.tabs[0]?.root).toEqual({
      type: 'split',
      direction: 'vertical',
      ratio: 0.5,
      first: { type: 'pane', terminalId: 'term-alpha' },
      second: { type: 'editor', editorId: 'editor-notes', title: 'notes.txt' }
    });
    expect(serializeWorkspaceState(state).workspaces[0]?.tabs[0]?.root).toEqual({ type: 'pane', terminalId: 'term-alpha' });
  });

  it('updates a split ratio at the requested tree path', () => {
    const alpha = terminal('term-alpha', 'Alpha');
    const beta = terminal('term-beta', 'Beta');
    const gamma = terminal('term-gamma', 'Gamma');
    const firstSplit = splitActivePane(createTabForTerminal(createEmptyTerminalState(), alpha), beta, 'vertical');
    const nestedSplit = splitActivePane(firstSplit, gamma, 'horizontal');

    const state = terminalReducer(nestedSplit, {
      type: 'pane.resized',
      path: [1],
      ratio: 0.72
    });

    const root = state.workspaces[0]?.tabs[0]?.root;
    expect(root).toMatchObject({
      type: 'split',
      ratio: 0.5,
      second: {
        type: 'split',
        ratio: 0.72
      }
    });
  });

  it('collapses the remaining sibling when the active split pane closes', () => {
    const alpha = terminal('term-alpha', 'Alpha');
    const beta = terminal('term-beta', 'Beta');
    const split = splitActivePane(createTabForTerminal(createEmptyTerminalState(), alpha), beta, 'vertical');

    const state = closeActivePane(split);

    const activeWorkspace = state.workspaces[0];
    expect(activeWorkspace?.tabs).toHaveLength(1);
    expect(activeWorkspace?.tabs[0]?.activeTerminalId).toBe('term-alpha');
    expect(activeWorkspace?.tabs[0]?.root).toEqual({ type: 'pane', terminalId: 'term-alpha' });
    expect(state.terminals['term-beta']).toBeUndefined();
  });

  it('removes the tab when its last pane closes and selects the next tab', () => {
    const first = createTabForTerminal(createEmptyTerminalState(), terminal('term-alpha', 'Alpha'));
    const twoTabs = createTabForTerminal(first, terminal('term-beta', 'Beta'));

    const state = closeActivePane(twoTabs);

    const activeWorkspace = state.workspaces[0];
    expect(activeWorkspace?.activeTabId).toBe('tab-term-alpha');
    expect(activeWorkspace?.tabs.map((tab) => tab.id)).toEqual(['tab-term-alpha']);
    expect(state.terminals['term-beta']).toBeUndefined();
  });

  it('keeps tabs scoped to the selected workspace', () => {
    const first = createTabForTerminal(createEmptyTerminalState(), terminal('term-alpha', 'Alpha'));
    const secondWorkspace = createWorkspace(first, { id: 'workspace-two', title: 'Two' });
    const inSecondWorkspace = createTabForTerminal(secondWorkspace, terminal('term-beta', 'Beta'));
    const backToFirst = selectWorkspace(inSecondWorkspace, 'workspace-default');

    expect(backToFirst.activeWorkspaceId).toBe('workspace-default');
    expect(backToFirst.workspaces.map((workspace) => workspace.id)).toEqual(['workspace-default', 'workspace-two']);
    expect(backToFirst.workspaces[0]?.tabs.map((tab) => tab.title)).toEqual(['Alpha']);
    expect(backToFirst.workspaces[1]?.tabs.map((tab) => tab.title)).toEqual(['Beta']);
    expect(backToFirst.workspaces[0]?.activeTabId).toBe('tab-term-alpha');
    expect(backToFirst.workspaces[1]?.activeTabId).toBe('tab-term-beta');
  });

  it('preserves empty workspaces when serializing layout changes', () => {
    const first = createTabForTerminal(createEmptyTerminalState(), terminal('term-alpha', 'Alpha'));
    const secondWorkspace = createWorkspace(first, { id: 'workspace-two', title: 'Two' });

    expect(serializeWorkspaceState(secondWorkspace)).toMatchObject({
      activeWorkspaceId: 'workspace-two',
      workspaces: [
        { id: 'workspace-default', tabs: [{ id: 'tab-term-alpha' }] },
        { id: 'workspace-two', title: 'Two', activeTabId: null, tabs: [] }
      ]
    });
  });

  it('renames a tab without changing terminal state', () => {
    const state = createTabForTerminal(createEmptyTerminalState(), terminal('term-alpha', 'Alpha'));

    const renamed = renameTab(state, 'tab-term-alpha', 'Ops shell');

    expect(renamed.workspaces[0]?.tabs[0]?.title).toBe('Ops shell');
    expect(renamed.terminals['term-alpha']?.title).toBe('Alpha');
  });

  it('renames a workspace', () => {
    const state = createWorkspace(createEmptyTerminalState(), { id: 'workspace-two', title: 'Two' });

    const renamed = renameWorkspace(state, 'workspace-two', 'Ops');

    expect(renamed.workspaces[0]?.title).toBe('Ops');
  });

  it('ignores blank workspace names', () => {
    const state = createWorkspace(createEmptyTerminalState(), { id: 'workspace-two', title: 'Two' });

    expect(renameWorkspace(state, 'workspace-two', '   ')).toBe(state);
  });

  it('ignores blank tab names', () => {
    const state = createTabForTerminal(createEmptyTerminalState(), terminal('term-alpha', 'Alpha'));

    expect(renameTab(state, 'tab-term-alpha', '   ')).toBe(state);
  });

  it('closes a workspace and removes only its terminals', () => {
    const first = createTabForTerminal(createEmptyTerminalState(), terminal('term-alpha', 'Alpha'));
    const secondWorkspace = createWorkspace(first, { id: 'workspace-two', title: 'Two' });
    const inSecondWorkspace = createTabForTerminal(secondWorkspace, terminal('term-beta', 'Beta'));

    const closed = closeWorkspace(inSecondWorkspace, 'workspace-two');

    expect(closed.activeWorkspaceId).toBe('workspace-default');
    expect(closed.workspaces.map((workspace) => workspace.id)).toEqual(['workspace-default']);
    expect(closed.terminals['term-alpha']).toBeDefined();
    expect(closed.terminals['term-beta']).toBeUndefined();
  });

  it('keeps the last workspace open', () => {
    const state = createTabForTerminal(createEmptyTerminalState(), terminal('term-alpha', 'Alpha'));

    expect(closeWorkspace(state, 'workspace-default')).toBe(state);
  });

  it('reconstructs saved layout by pruning missing panes and adding unrepresented terminals', () => {
    const saved: TerminalTabLayout[] = [
      {
        id: 'tab-saved',
        title: 'Saved',
        activeTerminalId: 'term-missing',
          root: {
            type: 'split',
            direction: 'horizontal',
            ratio: 0.64,
            first: { type: 'pane', terminalId: 'term-alpha' },
            second: { type: 'pane', terminalId: 'term-missing' }
          }
      }
    ];

    const state = reconstructTerminalState([terminal('term-alpha', 'Alpha'), terminal('term-beta', 'Beta')], saved);

    expect(state.workspaces).toEqual([
      {
        id: 'workspace-default',
        title: 'Leominal',
        activeTabId: 'tab-saved',
        tabs: [
          {
            id: 'tab-saved',
            title: 'Saved',
            activeTerminalId: 'term-alpha',
            root: { type: 'pane', terminalId: 'term-alpha' }
          },
          {
            id: 'tab-term-beta',
            title: 'Beta',
            activeTerminalId: 'term-beta',
            root: { type: 'pane', terminalId: 'term-beta' }
          }
        ]
      }
    ]);
    expect(state.activeWorkspaceId).toBe('workspace-default');
  });

  it('ignores malformed saved layouts during reconstruction', () => {
    const malformed = [
      {
        id: 'tab-bad',
        title: 'Bad',
        activeTerminalId: 'term-alpha',
        root: { unexpected: true }
      }
    ] as unknown as TerminalTabLayout[];

    const state = reconstructTerminalState([terminal('term-alpha', 'Alpha')], malformed);

    expect(state.workspaces[0]?.tabs).toEqual([
      {
        id: 'tab-term-alpha',
        title: 'Alpha',
        activeTerminalId: 'term-alpha',
        root: { type: 'pane', terminalId: 'term-alpha' }
      }
    ]);
  });

  it('updates state through reducer actions', () => {
    const state = terminalReducer(createEmptyTerminalState(), {
      type: 'terminal.created',
      terminal: terminal('term-alpha', 'Alpha')
    });

    expect(state.workspaces[0]?.tabs[0]?.activeTerminalId).toBe('term-alpha');
  });
});
