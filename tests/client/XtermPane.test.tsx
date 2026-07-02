// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerminalSummary } from '../../src/shared/types.js';

const xtermMocks = vi.hoisted(() => ({
  terminals: [] as Array<{
    cols: number;
    rows: number;
    open: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
    reset: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    writeln: ReturnType<typeof vi.fn>;
    refresh: ReturnType<typeof vi.fn>;
    focus: ReturnType<typeof vi.fn>;
    scrollLines: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    options: Record<string, unknown>;
    element: HTMLElement | undefined;
    buffer: { active: { type: 'normal' | 'alternate' } };
    modes: { mouseTrackingMode: 'none' | 'x10' | 'vt200' | 'drag' | 'any' };
    parser: {
      registerCsiHandler: ReturnType<typeof vi.fn>;
      registerDcsHandler: ReturnType<typeof vi.fn>;
      registerOscHandler: ReturnType<typeof vi.fn>;
    };
    dataHandler: ((data: string) => void) | null;
    keyEventHandler: ((event: KeyboardEvent) => boolean) | null;
    selectionText: string;
    hasSelection: ReturnType<typeof vi.fn>;
    getSelection: ReturnType<typeof vi.fn>;
    attachCustomKeyEventHandler: ReturnType<typeof vi.fn>;
    paste: ReturnType<typeof vi.fn>;
  }>,
  nextSize: { cols: 120, rows: 34 }
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: class MockTerminal {
    cols = xtermMocks.nextSize.cols;
    rows = xtermMocks.nextSize.rows;
    options: Record<string, unknown>;
    clear = vi.fn();
    reset = vi.fn();
    resize = vi.fn();
    write = vi.fn();
    writeln = vi.fn();
    refresh = vi.fn();
    focus = vi.fn();
    scrollLines = vi.fn();
    dispose = vi.fn();
    element: HTMLElement | undefined;
    buffer = { active: { type: 'normal' as const } };
    modes = { mouseTrackingMode: 'none' as const };
    parser = {
      registerCsiHandler: vi.fn(() => ({ dispose: vi.fn() })),
      registerDcsHandler: vi.fn(() => ({ dispose: vi.fn() })),
      registerOscHandler: vi.fn(() => ({ dispose: vi.fn() }))
    };
    dataHandler: ((data: string) => void) | null = null;
    keyEventHandler: ((event: KeyboardEvent) => boolean) | null = null;
    selectionText = '';
    hasSelection = vi.fn(() => this.selectionText.length > 0);
    getSelection = vi.fn(() => this.selectionText);
    attachCustomKeyEventHandler = vi.fn((handler: (event: KeyboardEvent) => boolean) => {
      this.keyEventHandler = handler;
    });
    paste = vi.fn((data: string) => {
      this.dataHandler?.(data.replace(/\r?\n/g, '\r'));
    });

    constructor(options: Record<string, unknown>) {
      this.options = options;
      xtermMocks.terminals.push(this);
    }

    open = vi.fn((container: HTMLElement) => {
      this.element = document.createElement('div');
      this.element.className = 'xterm';
      container.appendChild(this.element);
    });

    loadAddon(addon: { activate?: (terminal: MockTerminal) => void }) {
      addon.activate?.(this);
    }

    onData(handler: (data: string) => void) {
      this.dataHandler = handler;
      return { dispose: vi.fn(() => (this.dataHandler = null)) };
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
      canClose={false}
      onClose={() => undefined}
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

function inputMessages(socket: MockWebSocket[]) {
  return socket.flatMap((candidate) =>
    candidate.sent
      .map((message) => JSON.parse(message) as { type?: string; terminalId?: string; data?: string })
      .filter((message) => message.type === 'input')
  );
}

function refreshCwdMessages(socket: MockWebSocket[]) {
  return socket.flatMap((candidate) =>
    candidate.sent
      .map((message) => JSON.parse(message) as { type?: string; terminalId?: string })
      .filter((message) => message.type === 'refresh_cwd')
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
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined
    });
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it('resets and pre-resizes to server dimensions before writing snapshot output', async () => {
    renderPane();
    const socket = await openSocketAfterXtermReady();
    const mockTerminal = xtermMocks.terminals[0];

    socket.receive({
      type: 'snapshot',
      terminal: { ...terminal(), cols: 120, rows: 40 },
      output: ['SERIALIZED']
    });

    expect(mockTerminal!.reset).toHaveBeenCalledOnce();
    expect(mockTerminal!.clear).not.toHaveBeenCalled();
    expect(mockTerminal!.resize).toHaveBeenCalledWith(120, 40);
    expect(mockTerminal!.write).toHaveBeenCalledWith('SERIALIZED', expect.any(Function));
    const resetOrder = mockTerminal!.reset.mock.invocationCallOrder[0] as number;
    const resizeOrder = mockTerminal!.resize.mock.invocationCallOrder[0] as number;
    const writeOrder = mockTerminal!.write.mock.invocationCallOrder[0] as number;
    expect(resetOrder).toBeLessThan(resizeOrder);
    expect(resizeOrder).toBeLessThan(writeOrder);
  });

  it('skips the snapshot pre-resize but still resets and writes when server dimensions are invalid', async () => {
    renderPane();
    const socket = await openSocketAfterXtermReady();
    const mockTerminal = xtermMocks.terminals[0];

    socket.receive({
      type: 'snapshot',
      terminal: { ...terminal(), cols: 0, rows: 40 },
      output: ['SERIALIZED']
    });

    expect(mockTerminal!.resize).not.toHaveBeenCalled();
    expect(mockTerminal!.reset).toHaveBeenCalledOnce();
    expect(mockTerminal!.write).toHaveBeenCalledWith('SERIALIZED', expect.any(Function));
  });

  it('skips the snapshot pre-resize but still resets and writes when server rows are invalid', async () => {
    renderPane();
    const socket = await openSocketAfterXtermReady();
    const mockTerminal = xtermMocks.terminals[0];

    socket.receive({
      type: 'snapshot',
      terminal: { ...terminal(), cols: 120, rows: 0 },
      output: ['SERIALIZED']
    });

    expect(mockTerminal!.resize).not.toHaveBeenCalled();
    expect(mockTerminal!.reset).toHaveBeenCalledOnce();
    expect(mockTerminal!.write).toHaveBeenCalledWith('SERIALIZED', expect.any(Function));
  });

  it('defers post-snapshot fit scheduling until the last snapshot write completes', async () => {
    renderPane();
    const socket = await openSocketAfterXtermReady();
    const mockTerminal = xtermMocks.terminals[0];

    await waitFor(() => expect(resizeMessages([socket])).toHaveLength(1));
    await new Promise((resolve) => window.setTimeout(resolve, 400));
    const settledRefreshCount = mockTerminal!.refresh.mock.calls.length;

    vi.useFakeTimers();
    socket.receive({
      type: 'snapshot',
      terminal: { ...terminal(), cols: 120, rows: 40 },
      output: ['CHUNK-ONE', 'CHUNK-TWO']
    });

    expect(mockTerminal!.write.mock.calls.map((call) => call[0])).toEqual(['CHUNK-ONECHUNK-TWO']);
    const resetOrder = mockTerminal!.reset.mock.invocationCallOrder[0] as number;
    const resizeOrder = mockTerminal!.resize.mock.invocationCallOrder[0] as number;
    const firstWriteOrder = mockTerminal!.write.mock.invocationCallOrder[0] as number;
    expect(resetOrder).toBeLessThan(resizeOrder);
    expect(resizeOrder).toBeLessThan(firstWriteOrder);

    await vi.advanceTimersByTimeAsync(350);
    expect(mockTerminal!.refresh.mock.calls.length).toBe(settledRefreshCount);

    const lastWriteCallback = mockTerminal!.write.mock.calls.at(-1)?.[1] as (() => void) | undefined;
    expect(lastWriteCallback).toBeTypeOf('function');
    lastWriteCallback?.();
    await vi.advanceTimersByTimeAsync(350);
    expect(mockTerminal!.refresh.mock.calls.length).toBeGreaterThan(settledRefreshCount);
    vi.useRealTimers();
  });

  it('cancels fit timers scheduled before the snapshot so none fire during the restore', async () => {
    renderPane();
    const socket = await openSocketAfterXtermReady();
    const mockTerminal = xtermMocks.terminals[0];

    await waitFor(() => expect(resizeMessages([socket])).toHaveLength(1));
    await new Promise((resolve) => window.setTimeout(resolve, 400));
    const settledRefreshCount = mockTerminal!.refresh.mock.calls.length;

    vi.useFakeTimers();
    window.dispatchEvent(new Event('resize'));
    socket.receive({
      type: 'snapshot',
      terminal: { ...terminal(), cols: 120, rows: 40 },
      output: ['SERIALIZED']
    });

    await vi.advanceTimersByTimeAsync(350);
    expect(mockTerminal!.refresh.mock.calls.length).toBe(settledRefreshCount);

    const lastWriteCallback = mockTerminal!.write.mock.calls.at(-1)?.[1] as (() => void) | undefined;
    expect(lastWriteCallback).toBeTypeOf('function');
    lastWriteCallback?.();
    await vi.advanceTimersByTimeAsync(350);
    expect(mockTerminal!.refresh.mock.calls.length).toBeGreaterThan(settledRefreshCount);
    vi.useRealTimers();
  });

  it('schedules the settled fit once the empty snapshot write completes', async () => {
    renderPane();
    const socket = await openSocketAfterXtermReady();
    const mockTerminal = xtermMocks.terminals[0];

    await waitFor(() => expect(resizeMessages([socket])).toHaveLength(1));
    await new Promise((resolve) => window.setTimeout(resolve, 400));
    const settledRefreshCount = mockTerminal!.refresh.mock.calls.length;

    vi.useFakeTimers();
    socket.receive({
      type: 'snapshot',
      terminal: { ...terminal(), cols: 120, rows: 40 },
      output: []
    });

    expect(mockTerminal!.reset).toHaveBeenCalledOnce();
    expect(mockTerminal!.write).toHaveBeenCalledWith('', expect.any(Function));
    const writeCallback = mockTerminal!.write.mock.calls.at(-1)?.[1] as (() => void) | undefined;
    writeCallback?.();
    await vi.advanceTimersByTimeAsync(350);
    expect(mockTerminal!.refresh.mock.calls.length).toBeGreaterThan(settledRefreshCount);
    vi.useRealTimers();
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

  it('reports the settled size after the visible document layout stabilizes late', async () => {
    renderPane();
    const socket = await openSocketAfterXtermReady();

    await waitFor(() =>
      expect(resizeMessages([socket])).toEqual([{ type: 'resize', terminalId: 'term-alpha', cols: 120, rows: 34 }])
    );

    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    window.setTimeout(() => {
      xtermMocks.nextSize = { cols: 96, rows: 27 };
    }, 5);

    await waitFor(() =>
      expect(resizeMessages([socket])).toContainEqual({ type: 'resize', terminalId: 'term-alpha', cols: 96, rows: 27 })
    );
  });

  it('renders a pane header close affordance that does not select the pane', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();

    renderPane({ onSelect, onClose, canClose: true });

    expect(screen.getByText('/workspace')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Close pane Alpha' }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('renders a mobile terminal key bar for the active running pane', async () => {
    renderPane();
    await waitFor(() => expect(xtermMocks.terminals[0]?.open).toHaveBeenCalled());

    const toolbar = screen.getByRole('toolbar', { name: 'Mobile terminal keys' });
    expect(toolbar).toBeVisible();
    expect(screen.getByRole('button', { name: 'Arm Control modifier' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Send Escape' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Send Tab' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Send Arrow Left' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Send Arrow Right' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Send Arrow Up' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Send Arrow Down' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /command/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /ctrl\+c/i })).toBeNull();
  });

  it('enables modifier-forced xterm selection so terminal mouse mode can still be copied', async () => {
    renderPane();
    await waitFor(() => expect(xtermMocks.terminals[0]?.open).toHaveBeenCalled());

    expect(xtermMocks.terminals[0]?.options).toMatchObject({
      macOptionClickForcesSelection: true
    });
  });

  it('copies selected terminal text on Command+C without sending input to the pty', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    });
    renderPane();
    const socket = await openSocketAfterXtermReady();
    const mockTerminal = xtermMocks.terminals[0];
    expect(mockTerminal?.keyEventHandler).toBeTypeOf('function');
    mockTerminal!.selectionText = 'selected output';

    const event = new KeyboardEvent('keydown', {
      key: 'c',
      metaKey: true,
      bubbles: true,
      cancelable: true
    });
    const shouldProcessInXterm = mockTerminal!.keyEventHandler!(event);

    expect(shouldProcessInXterm).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('selected output'));
    expect(inputMessages([socket])).toEqual([]);
  });

  it('falls back to a temporary textarea copy when the async Clipboard API is unavailable', async () => {
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand
    });
    renderPane();
    await openSocketAfterXtermReady();
    const mockTerminal = xtermMocks.terminals[0];
    mockTerminal!.selectionText = 'selected output';

    const event = new KeyboardEvent('keydown', {
      key: 'c',
      metaKey: true,
      bubbles: true,
      cancelable: true
    });
    mockTerminal!.keyEventHandler!(event);

    await waitFor(() => expect(execCommand).toHaveBeenCalledWith('copy'));
    expect(document.querySelector('textarea[readonly="true"]')).toBeNull();
  });

  it('writes selected terminal text into native copy events', async () => {
    renderPane();
    await openSocketAfterXtermReady();
    const mockTerminal = xtermMocks.terminals[0];
    const setData = vi.fn();
    mockTerminal!.selectionText = 'selected output';

    const event = new Event('copy', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, 'clipboardData', {
      configurable: true,
      value: { setData }
    });
    mockTerminal!.element!.dispatchEvent(event);

    expect(setData).toHaveBeenCalledWith('text/plain', 'selected output');
    expect(event.defaultPrevented).toBe(true);
  });

  it('keeps plain Ctrl+C available for terminal interrupt input', async () => {
    renderPane();
    await openSocketAfterXtermReady();
    const mockTerminal = xtermMocks.terminals[0];
    mockTerminal!.selectionText = 'selected output';

    const event = new KeyboardEvent('keydown', {
      key: 'c',
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    });

    expect(mockTerminal!.keyEventHandler?.(event)).toBe(true);
    expect(event.defaultPrevented).toBe(false);
  });

  it('strips a terminal-executing trailing line break from pasted text before Ctrl+C', async () => {
    renderPane();
    const socket = await openSocketAfterXtermReady();
    const mockTerminal = xtermMocks.terminals[0];
    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(pasteEvent, 'clipboardData', {
      configurable: true,
      value: { getData: vi.fn(() => 'echo should-not-run\n') }
    });

    mockTerminal!.element!.dispatchEvent(pasteEvent);
    mockTerminal!.dataHandler?.('\x03');

    expect(pasteEvent.defaultPrevented).toBe(true);
    expect(mockTerminal!.paste).toHaveBeenCalledWith('echo should-not-run');
    expect(inputMessages([socket])).toEqual([
      { type: 'input', terminalId: 'term-alpha', data: 'echo should-not-run' },
      { type: 'input', terminalId: 'term-alpha', data: '\x03' }
    ]);
  });

  it('does not reselect the already active pane when terminal selection starts', async () => {
    const onSelect = vi.fn();
    renderPane({ onSelect });
    await waitFor(() => expect(xtermMocks.terminals[0]?.open).toHaveBeenCalled());

    fireEvent.mouseDown(document.querySelector('.xterm-container') as HTMLElement);

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('selects the pane on mouse down when it is inactive', async () => {
    const onSelect = vi.fn();
    renderPane({ active: false, onSelect });
    await waitFor(() => expect(xtermMocks.terminals[0]?.open).toHaveBeenCalled());

    fireEvent.mouseDown(document.querySelector('.xterm-container') as HTMLElement);

    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('focuses the xterm when the pane becomes active', async () => {
    const { rerender } = render(
      <XtermPane
        terminal={terminal()}
        active={false}
        onSelect={() => undefined}
        onExit={() => undefined}
        onSnapshot={() => undefined}
        canClose={false}
        onClose={() => undefined}
      />
    );
    await waitFor(() => expect(xtermMocks.terminals[0]?.open).toHaveBeenCalled());
    expect(xtermMocks.terminals[0]?.focus).not.toHaveBeenCalled();

    rerender(
      <XtermPane
        terminal={terminal()}
        active
        onSelect={() => undefined}
        onExit={() => undefined}
        onSnapshot={() => undefined}
        canClose={false}
        onClose={() => undefined}
      />
    );

    expect(xtermMocks.terminals[0]?.focus).toHaveBeenCalledOnce();
  });

  it('sends standalone mobile key bar inputs to the active terminal socket', async () => {
    renderPane();
    const socket = await openSocketAfterXtermReady();

    fireEvent.click(screen.getByRole('button', { name: 'Send Escape' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send Tab' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send Arrow Up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send Arrow Down' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send Arrow Right' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send Arrow Left' }));

    expect(inputMessages([socket])).toEqual([
      { type: 'input', terminalId: 'term-alpha', data: '\x1b' },
      { type: 'input', terminalId: 'term-alpha', data: '\t' },
      { type: 'input', terminalId: 'term-alpha', data: '\x1b[A' },
      { type: 'input', terminalId: 'term-alpha', data: '\x1b[B' },
      { type: 'input', terminalId: 'term-alpha', data: '\x1b[C' },
      { type: 'input', terminalId: 'term-alpha', data: '\x1b[D' }
    ]);
    expect(xtermMocks.terminals[0]?.focus).toHaveBeenCalled();
  });

  it('applies Ctrl to one xterm input event and then resets', async () => {
    renderPane();
    const socket = await openSocketAfterXtermReady();
    const ctrlButton = screen.getByRole('button', { name: 'Arm Control modifier' });

    fireEvent.click(ctrlButton);
    expect(ctrlButton).toHaveAttribute('aria-pressed', 'true');
    xtermMocks.terminals[0]?.dataHandler?.('c');
    xtermMocks.terminals[0]?.dataHandler?.('c');

    expect(inputMessages([socket])).toEqual([
      { type: 'input', terminalId: 'term-alpha', data: '\x03' },
      { type: 'input', terminalId: 'term-alpha', data: 'c' }
    ]);
    await waitFor(() => expect(ctrlButton).toHaveAttribute('aria-pressed', 'false'));
  });

  it('requests follow-up cwd refreshes after Enter only when enabled', async () => {
    renderPane({ refreshCwdOnEnter: true });
    const socket = await openSocketAfterXtermReady();

    vi.useFakeTimers();
    xtermMocks.terminals[0]?.dataHandler?.('cd /tmp');
    xtermMocks.terminals[0]?.dataHandler?.('\r');

    expect(inputMessages([socket])).toEqual([
      { type: 'input', terminalId: 'term-alpha', data: 'cd /tmp' },
      { type: 'input', terminalId: 'term-alpha', data: '\r' }
    ]);
    expect(refreshCwdMessages([socket])).toEqual([]);

    await vi.advanceTimersByTimeAsync(300);
    expect(refreshCwdMessages([socket])).toEqual([{ type: 'refresh_cwd', terminalId: 'term-alpha' }]);

    await vi.advanceTimersByTimeAsync(900);
    expect(refreshCwdMessages([socket])).toEqual([
      { type: 'refresh_cwd', terminalId: 'term-alpha' },
      { type: 'refresh_cwd', terminalId: 'term-alpha' }
    ]);

    await vi.advanceTimersByTimeAsync(1_300);
    expect(refreshCwdMessages([socket])).toEqual([
      { type: 'refresh_cwd', terminalId: 'term-alpha' },
      { type: 'refresh_cwd', terminalId: 'term-alpha' },
      { type: 'refresh_cwd', terminalId: 'term-alpha' }
    ]);
    vi.useRealTimers();
  });

  it('does not request cwd refresh after Enter when disabled', async () => {
    renderPane({ refreshCwdOnEnter: false });
    const socket = await openSocketAfterXtermReady();

    xtermMocks.terminals[0]?.dataHandler?.('\r');
    await new Promise((resolve) => window.setTimeout(resolve, 450));

    expect(refreshCwdMessages([socket])).toEqual([]);
  });

  it('maps one-finger terminal drags to xterm scrollback without page panning', async () => {
    renderPane();
    await openSocketAfterXtermReady();

    const container = document.querySelector('.xterm-container');
    expect(container).toBeInstanceOf(HTMLElement);

    fireEvent.touchStart(container as HTMLElement, { touches: [{ clientY: 160 }] });
    const dragUp = new Event('touchmove', { bubbles: true, cancelable: true });
    Object.defineProperty(dragUp, 'touches', {
      configurable: true,
      value: [{ clientY: 120 }]
    });
    container?.dispatchEvent(dragUp);

    expect(dragUp.defaultPrevented).toBe(true);
    expect(xtermMocks.terminals[0]?.scrollLines).toHaveBeenCalledWith(expect.any(Number));
    expect((xtermMocks.terminals[0]?.scrollLines.mock.calls[0]?.[0] as number) > 0).toBe(true);
  });

  it('forwards one-finger drags to xterm wheel handling when tmux owns scrolling', async () => {
    renderPane();
    await openSocketAfterXtermReady();
    const mockTerminal = xtermMocks.terminals[0];
    expect(mockTerminal?.element).toBeInstanceOf(HTMLElement);
    mockTerminal!.buffer.active.type = 'alternate';
    const wheelHandler = vi.fn((event: WheelEvent) => event.preventDefault());
    mockTerminal!.element!.addEventListener('wheel', wheelHandler);

    const container = document.querySelector('.xterm-container');
    expect(container).toBeInstanceOf(HTMLElement);
    fireEvent.touchStart(container as HTMLElement, { touches: [{ clientX: 40, clientY: 160 }] });
    const dragUp = new Event('touchmove', { bubbles: true, cancelable: true });
    Object.defineProperty(dragUp, 'touches', {
      configurable: true,
      value: [{ clientX: 40, clientY: 120 }]
    });
    container?.dispatchEvent(dragUp);

    expect(dragUp.defaultPrevented).toBe(true);
    expect(xtermMocks.terminals[0]?.scrollLines).not.toHaveBeenCalled();
    expect(wheelHandler).toHaveBeenCalledOnce();
    expect(wheelHandler.mock.calls[0]?.[0]).toMatchObject({
      deltaY: 40,
      clientX: 40,
      clientY: 120
    });
  });

  it('passes through unhandled Ctrl-armed input and resets the modifier', async () => {
    renderPane();
    const socket = await openSocketAfterXtermReady();
    const ctrlButton = screen.getByRole('button', { name: 'Arm Control modifier' });

    fireEvent.click(ctrlButton);
    xtermMocks.terminals[0]?.dataHandler?.('\r');
    xtermMocks.terminals[0]?.dataHandler?.('c');

    expect(inputMessages([socket])).toEqual([
      { type: 'input', terminalId: 'term-alpha', data: '\r' },
      { type: 'input', terminalId: 'term-alpha', data: 'c' }
    ]);
    await waitFor(() => expect(ctrlButton).toHaveAttribute('aria-pressed', 'false'));
  });

  it('does not render the mobile key bar for inactive or exited panes', async () => {
    const exited = { ...terminal(), status: 'exited' as const, exitCode: 0 };

    const { rerender } = render(
      <XtermPane
        terminal={terminal()}
        active={false}
        onSelect={() => undefined}
        onExit={() => undefined}
        onSnapshot={() => undefined}
        canClose={false}
        onClose={() => undefined}
      />
    );
    await waitFor(() => expect(xtermMocks.terminals[0]?.open).toHaveBeenCalled());
    expect(screen.queryByRole('toolbar', { name: 'Mobile terminal keys' })).toBeNull();

    rerender(
      <XtermPane
        terminal={exited}
        active
        onSelect={() => undefined}
        onExit={() => undefined}
        onSnapshot={() => undefined}
        canClose={false}
        onClose={() => undefined}
      />
    );
    expect(screen.queryByRole('toolbar', { name: 'Mobile terminal keys' })).toBeNull();
  });
});
