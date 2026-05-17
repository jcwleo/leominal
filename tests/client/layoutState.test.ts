import { describe, expect, it } from 'vitest';
import { isTerminalLayoutState, normalizeTerminalLayoutState } from '../../src/shared/layoutState.js';

describe('terminal layout state contract', () => {
  it('accepts a valid split workspace layout state', () => {
    const layout = {
      activeWorkspaceId: 'workspace-default',
      workspaces: [
        {
          id: 'workspace-default',
          title: 'Leominal',
          activeTabId: 'tab-alpha',
          tabs: [
            {
              id: 'tab-alpha',
              title: 'Ops',
              activeTerminalId: 'term-beta',
              root: {
                type: 'split',
                direction: 'vertical',
                first: { type: 'pane', terminalId: 'term-alpha' },
                second: { type: 'pane', terminalId: 'term-beta' }
              }
            }
          ]
        }
      ]
    };

    expect(isTerminalLayoutState(layout)).toBe(true);
    expect(normalizeTerminalLayoutState(layout)).toEqual(layout);
  });

  it('rejects malformed layout nodes', () => {
    const layout = {
      activeWorkspaceId: 'workspace-default',
      workspaces: [
        {
          id: 'workspace-default',
          title: 'Leominal',
          activeTabId: 'tab-alpha',
          tabs: [
            {
              id: 'tab-alpha',
              title: 'Ops',
              activeTerminalId: 'term-alpha',
              root: { type: 'split', direction: 'diagonal', first: { type: 'pane', terminalId: 'term-alpha' } }
            }
          ]
        }
      ]
    };

    expect(isTerminalLayoutState(layout)).toBe(false);
    expect(normalizeTerminalLayoutState(layout)).toBeNull();
  });

  it('rejects overly deep split trees without throwing', () => {
    let root: unknown = { type: 'pane', terminalId: 'term-leaf' };
    for (let index = 0; index < 10_000; index += 1) {
      root = {
        type: 'split',
        direction: 'vertical',
        first: root,
        second: { type: 'pane', terminalId: `term-${index}` }
      };
    }
    const layout = {
      activeWorkspaceId: 'workspace-default',
      workspaces: [
        {
          id: 'workspace-default',
          title: 'Leominal',
          activeTabId: 'tab-alpha',
          tabs: [
            {
              id: 'tab-alpha',
              title: 'Ops',
              activeTerminalId: 'term-leaf',
              root
            }
          ]
        }
      ]
    };

    expect(() => normalizeTerminalLayoutState(layout)).not.toThrow();
    expect(normalizeTerminalLayoutState(layout)).toBeNull();
  });
});
