// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LayoutNode, TerminalSummary } from '../../src/shared/types.js';
import type { ApiClient } from '../../src/client/api/client.js';

vi.mock('../../src/client/terminal/XtermPane.js', async () => {
  const ReactModule = await import('react');
  return {
    XtermPane: ({
      terminal,
      active,
      canClose,
      onClose,
      onSelect
    }: {
      terminal: TerminalSummary;
      active: boolean;
      canClose?: boolean;
      onClose?: () => void;
      onSelect: () => void;
    }) =>
      ReactModule.createElement(
        'section',
        {
          'data-active': active,
          'data-testid': `pane-${terminal.id}`,
          onMouseDown: onSelect
        },
        canClose
          ? ReactModule.createElement(
              'button',
              {
                'aria-label': `Close pane ${terminal.id}`,
                onClick: onClose
              },
              'x'
            )
          : null
      )
  };
});

import { SplitPane } from '../../src/client/terminal/SplitPane.js';

function terminal(id: string): TerminalSummary {
  return {
    id,
    title: id,
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

const api = {} as ApiClient;

describe('SplitPane', () => {
  afterEach(cleanup);

  it('updates the split ratio from divider pointer drag', () => {
    const onResize = vi.fn();
    const node = {
      type: 'split',
      direction: 'vertical',
      ratio: 0.4,
      first: { type: 'pane', terminalId: 'term-left' },
      second: { type: 'pane', terminalId: 'term-right' }
    } satisfies LayoutNode;

    render(
      <SplitPane
        node={node}
        terminals={{
          'term-left': terminal('term-left'),
          'term-right': terminal('term-right')
        }}
        editors={{}}
        api={api}
        activeTerminalId="term-left"
        onSelect={() => undefined}
        onExit={() => undefined}
        onSnapshot={() => undefined}
        onClose={() => undefined}
        onCloseEditor={() => undefined}
        onResize={onResize}
      />
    );

    const divider = screen.getByRole('separator', { name: 'Resize panes' });
    vi.spyOn(divider.parentElement as HTMLElement, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 10,
      top: 20,
      right: 210,
      bottom: 120,
      width: 200,
      height: 100,
      toJSON: () => undefined
    });

    fireEvent.pointerDown(divider, { pointerId: 1, clientX: 10, clientY: 20 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 170, clientY: 20 });
    fireEvent.pointerUp(window, { pointerId: 1 });

    expect(onResize).toHaveBeenCalledWith([], 0.8);
  });

  it('passes pane close callbacks only when a tab has multiple panes', () => {
    const onClose = vi.fn();
    const splitNode = {
      type: 'split',
      direction: 'horizontal',
      ratio: 0.5,
      first: { type: 'pane', terminalId: 'term-top' },
      second: { type: 'pane', terminalId: 'term-bottom' }
    } satisfies LayoutNode;

    const { rerender } = render(
      <SplitPane
        node={splitNode}
        terminals={{
          'term-top': terminal('term-top'),
          'term-bottom': terminal('term-bottom')
        }}
        editors={{}}
        api={api}
        activeTerminalId="term-top"
        onSelect={() => undefined}
        onExit={() => undefined}
        onSnapshot={() => undefined}
        onClose={onClose}
        onCloseEditor={() => undefined}
        onResize={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Close pane term-top' }));
    expect(onClose).toHaveBeenCalledWith('term-top');

    rerender(
      <SplitPane
        node={{ type: 'pane', terminalId: 'term-top' }}
        terminals={{ 'term-top': terminal('term-top') }}
        editors={{}}
        api={api}
        activeTerminalId="term-top"
        onSelect={() => undefined}
        onExit={() => undefined}
        onSnapshot={() => undefined}
        onClose={onClose}
        onCloseEditor={() => undefined}
        onResize={() => undefined}
      />
    );

    expect(screen.queryByRole('button', { name: 'Close pane term-top' })).toBeNull();
  });

  it('renders embedded editor panes and closes them through the editor callback', () => {
    const onCloseEditor = vi.fn();
    const editorApi = {
      writeFile: vi.fn()
    } as unknown as ApiClient;

    render(
      <SplitPane
        node={{
          type: 'split',
          direction: 'vertical',
          ratio: 0.5,
          first: { type: 'pane', terminalId: 'term-left' },
          second: { type: 'editor', editorId: 'editor-notes', title: 'notes.txt' }
        }}
        terminals={{ 'term-left': terminal('term-left') }}
        editors={{
          'editor-notes': {
            id: 'editor-notes',
            title: 'notes.txt',
            rootToken: 'root-alpha',
            path: 'notes.txt',
            read: {
              path: 'notes.txt',
              content: 'hello\n',
              language: 'text',
              version: { size: 6, mtimeMs: 1_779_000_000_000, ino: 7 }
            }
          }
        }}
        api={editorApi}
        activeTerminalId="term-left"
        onSelect={() => undefined}
        onExit={() => undefined}
        onSnapshot={() => undefined}
        onClose={() => undefined}
        onCloseEditor={onCloseEditor}
        onResize={() => undefined}
      />
    );

    expect(screen.getByLabelText('Editor for notes.txt')).toHaveValue('hello\n');
    fireEvent.click(screen.getByRole('button', { name: 'Close editor notes.txt' }));

    expect(onCloseEditor).toHaveBeenCalledWith('editor-notes');
  });
});
