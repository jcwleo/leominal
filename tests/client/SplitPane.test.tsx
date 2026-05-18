// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LayoutNode, TerminalSummary } from '../../src/shared/types.js';

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
        activeTerminalId="term-left"
        onSelect={() => undefined}
        onExit={() => undefined}
        onSnapshot={() => undefined}
        onClose={() => undefined}
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
        activeTerminalId="term-top"
        onSelect={() => undefined}
        onExit={() => undefined}
        onSnapshot={() => undefined}
        onClose={onClose}
        onResize={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Close pane term-top' }));
    expect(onClose).toHaveBeenCalledWith('term-top');

    rerender(
      <SplitPane
        node={{ type: 'pane', terminalId: 'term-top' }}
        terminals={{ 'term-top': terminal('term-top') }}
        activeTerminalId="term-top"
        onSelect={() => undefined}
        onExit={() => undefined}
        onSnapshot={() => undefined}
        onClose={onClose}
        onResize={() => undefined}
      />
    );

    expect(screen.queryByRole('button', { name: 'Close pane term-top' })).toBeNull();
  });
});
