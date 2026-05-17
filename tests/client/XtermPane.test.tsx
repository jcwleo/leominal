// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerminalSummary } from '../../src/shared/types.js';

const xtermMocks = vi.hoisted(() => ({
  terminals: [] as Array<{
    cols: number;
    rows: number;
    open: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    writeln: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  }>,
  nextSize: { cols: 120, rows: 34 }
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: class MockTerminal {
    cols = xtermMocks.nextSize.cols;
    rows = xtermMocks.nextSize.rows;
    options: Record<string, unknown>;
    open = vi.fn();
    clear = vi.fn();
    write = vi.fn();
    writeln = vi.fn();
    dispose = vi.fn();

    constructor(options: Record<string, unknown>) {
      this.options = options;
      xtermMocks.terminals.push(this);
    }

    loadAddon(addon: { activate?: (terminal: MockTerminal) => void }) {
      addon.activate?.(this);
    }

    onData() {
      return { dispose: vi.fn() };
    }
  }
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class MockFitAddon {
    terminal: { cols: number; rows: number } | null = null;

    activate(terminal: { cols: number; rows: number }) {
      this.terminal = terminal;
    }

    fit() {
      if (this.terminal) {
        this.terminal.cols = xtermMocks.nextSize.cols;
        this.terminal.rows = xtermMocks.nextSize.rows;
      }
    }
  }
}));

vi.mock('../../src/client/terminal/fontStack.js', () => ({
  terminalFontFamily: 'monospace',
  terminalFontSize: 14,
  waitForTerminalFonts: () => Promise.resolve()
}));

import { XtermPane } from '../../src/client/terminal/XtermPane.js';

class MockWebSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];

  constructor(public readonly url: string) {
    super();
    sockets.push(this);
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }

  receive(message: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
  }

  send(message: string) {
    this.sent.push(message);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.dispatchEvent(new CloseEvent('close'));
  }
}

class MockResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {
    resizeObservers.push(this);
  }

  observe = vi.fn();
  disconnect = vi.fn();

  trigger() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

const sockets: MockWebSocket[] = [];
const resizeObservers: MockResizeObserver[] = [];

function terminal(id = 'term-alpha'): TerminalSummary {
  return {
    id,
    title: 'Alpha',
    cwd: '/workspace',
    pid: 100,
    cols: 80,
    rows: 24,
    createdAt: '2026-05-17T00:00:00.000Z',
    updatedAt: '2026-05-17T00:00:00.000Z',
    status: 'running',
    exitCode: null
  };
}

function renderPane(props: Partial<React.ComponentProps<typeof XtermPane>> = {}) {
  const onSnapshot = vi.fn();
  render(
    <XtermPane
      terminal={terminal()}
      active
      onSelect={() => undefined}
      onExit={() => undefined}
      onSnapshot={onSnapshot}
      {...props}
    />
  );
  return { onSnapshot };
}

function resizeMessages(socket: MockWebSocket[]) {
  return socket.flatMap((candidate) =>
    candidate.sent
      .map((message) => JSON.parse(message) as { type?: string; cols?: number; rows?: number })
      .filter((message) => message.type === 'resize')
  );
}

async function openSocketAfterXtermReady(): Promise<MockWebSocket> {
  await waitFor(() => expect(xtermMocks.terminals[0]?.open).toHaveBeenCalled());
  const socket = sockets[0];
  expect(socket).toBeDefined();
  socket?.open();
  return socket as MockWebSocket;
}

function setVisibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value
  });
}

describe('XtermPane', () => {
  beforeEach(() => {
    sockets.length = 0;
    resizeObservers.length = 0;
    xtermMocks.terminals.length = 0;
    xtermMocks.nextSize = { cols: 120, rows: 34 };
    setVisibility('visible');
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('applies terminal_updated messages as terminal snapshots', async () => {
    const updated = { ...terminal(), cols: 132, rows: 40, updatedAt: '2026-05-17T00:01:00.000Z' };
    const { onSnapshot } = renderPane();
    const socket = await openSocketAfterXtermReady();

    socket.receive({ type: 'terminal_updated', terminal: updated });

    expect(onSnapshot).toHaveBeenCalledWith(updated);
  });

  it('does not resend unchanged resize dimensions for duplicate fit events', async () => {
    renderPane();
    const socket = await openSocketAfterXtermReady();

    await waitFor(() => expect(resizeMessages([socket])).toHaveLength(1));
    resizeObservers[0]?.trigger();
    resizeObservers[0]?.trigger();

    await new Promise((resolve) => window.setTimeout(resolve, 80));

    expect(resizeMessages([socket])).toEqual([{ type: 'resize', terminalId: 'term-alpha', cols: 120, rows: 34 }]);
  });

  it('suppresses resize messages while the document is hidden', async () => {
    setVisibility('hidden');
    renderPane();
    const socket = await openSocketAfterXtermReady();

    resizeObservers[0]?.trigger();
    await new Promise((resolve) => window.setTimeout(resolve, 80));

    expect(resizeMessages([socket])).toEqual([]);
  });

  it('refits and reports size when the document becomes visible again', async () => {
    setVisibility('hidden');
    renderPane();
    const socket = await openSocketAfterXtermReady();

    await new Promise((resolve) => window.setTimeout(resolve, 80));
    expect(resizeMessages([socket])).toEqual([]);

    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));

    await waitFor(() => expect(resizeMessages([socket])).toEqual([{ type: 'resize', terminalId: 'term-alpha', cols: 120, rows: 34 }]));
  });
});
