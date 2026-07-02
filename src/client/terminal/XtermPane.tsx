import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ServerTerminalMessage } from '../../shared/protocol.js';
import type { TerminalSummary } from '../../shared/types.js';
import { createTerminalWebSocketUrl } from '../api/client.js';
import { terminalFontFamily, terminalFontSize, waitForTerminalFonts } from './fontStack.js';
import { HangulInputComposer } from './hangulInput.js';
import { MobileTerminalKeyBar } from './MobileTerminalKeyBar.js';
import { ctrlModifiedData, terminalKeySequence, type MobileTerminalStandaloneKey } from './mobileTerminalKeys.js';
import { installTerminalClipboard } from './terminalClipboard.js';
import { installInactiveTerminalReportGuards } from './terminalReportGuards.js';

const terminalFitSettleDelaysMs = [0, 50, 150, 350] as const;
const cwdRefreshDelaysMs = [300, 1_200, 2_500] as const;
const touchScrollLineHeight = terminalFontSize * 1.2;

interface XtermPaneProps {
  terminal: TerminalSummary;
  active: boolean;
  canClose: boolean;
  refreshCwdOnEnter?: boolean;
  onSelect: () => void;
  onClose: () => void;
  onExit: (exitCode: number | null) => void;
  onSnapshot: (terminal: TerminalSummary) => void;
}

export function XtermPane({ terminal, active, canClose, refreshCwdOnEnter = false, onSelect, onClose, onExit, onSnapshot }: XtermPaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const callbacksRef = useRef({ onExit, onSnapshot });
  const reconnectEnabledRef = useRef(terminal.status === 'running');
  const lastReportedSizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const pendingFitTimersRef = useRef<Map<number, number>>(new Map());
  const cwdRefreshTimerRefs = useRef<number[]>([]);
  const ctrlModifierArmedRef = useRef(false);
  const activeRef = useRef(active);
  const refreshCwdOnEnterRef = useRef(refreshCwdOnEnter);
  const [, setConnectionStatus] = useState<'connecting' | 'connected' | 'reconnecting' | 'closed'>('connecting');
  const [ctrlModifierArmed, setCtrlModifierArmed] = useState(false);

  useLayoutEffect(() => {
    activeRef.current = active;
  }, [active]);

  useLayoutEffect(() => {
    refreshCwdOnEnterRef.current = refreshCwdOnEnter;
  }, [refreshCwdOnEnter]);

  useEffect(() => {
    if (!active) {
      // Hidden tab layers keep layout (visibility:hidden), so the browser does not move focus off
      // an invisible pane's textarea — release it so keystrokes cannot reach a background PTY.
      xtermRef.current?.blur();
      return;
    }
    if (terminal.status === 'running') {
      focusTerminal();
    }
  }, [active, terminal.status]);

  useEffect(() => {
    callbacksRef.current = { onExit, onSnapshot };
  }, [onExit, onSnapshot]);

  useEffect(() => {
    reconnectEnabledRef.current = terminal.status === 'running';
    const xterm = xtermRef.current;
    if (xterm) {
      xterm.options.disableStdin = terminal.status === 'exited';
    }
    if (terminal.status === 'exited') {
      socketRef.current?.close();
      setConnectionStatus('closed');
    }
  }, [terminal.status]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    let disposed = false;
    let clipboardDisposable: { dispose(): void } | null = null;
    let dataDisposable: { dispose(): void } | null = null;
    let reportGuardsDisposable: { dispose(): void } | null = null;
    let removeTouchScroll: (() => void) | null = null;
    let resizeObserver: ResizeObserver | null = null;
    lastReportedSizeRef.current = null;
    clearScheduledFit();

    const xterm = new Terminal({
      cursorBlink: true,
      convertEol: false,
      disableStdin: terminal.status === 'exited',
      fontFamily: terminalFontFamily,
      fontSize: terminalFontSize,
      fontWeight: 400,
      fontWeightBold: 700,
      macOptionClickForcesSelection: true,
      scrollback: 10_000,
      theme: {
        background: '#0a0d10',
        foreground: '#e2e8ee',
        cursor: '#5eead4',
        selectionBackground: '#1f3f45'
      }
    });
    const fit = new FitAddon();
    xterm.loadAddon(fit);
    reportGuardsDisposable = installInactiveTerminalReportGuards(xterm, () => activeRef.current);
    xtermRef.current = xterm;
    fitRef.current = fit;

    void waitForTerminalFonts(terminalFontSize).then(() => {
      if (disposed) {
        return;
      }

      xterm.open(container);
      clipboardDisposable = installTerminalClipboard(xterm);
      if (activeRef.current && terminal.status === 'running') {
        focusTerminal();
      }
      removeTouchScroll = installTerminalTouchScroll(container, xterm);

      const inputComposer = new HangulInputComposer();
      dataDisposable = xterm.onData((data) => {
        if (ctrlModifierArmedRef.current) {
          setCtrlModifier(false);
          const modifiedData = ctrlModifiedData(data);
          if (modifiedData) {
            sendTerminalInput(modifiedData);
            return;
          }
        }
        const composedData = inputComposer.accept(data);
        if (composedData) {
          sendTerminalInput(composedData);
        }
      });

      resizeObserver = new ResizeObserver(() => {
        scheduleFitAndReportSize();
      });
      resizeObserver.observe(container);
      scheduleSettledFitAndReportSize();
    });

    return () => {
      disposed = true;
      clearScheduledFit();
      clearScheduledCwdRefresh();
      removeTouchScroll?.();
      resizeObserver?.disconnect();
      clipboardDisposable?.dispose();
      dataDisposable?.dispose();
      reportGuardsDisposable?.dispose();
      xterm.dispose();
      xtermRef.current = null;
      fitRef.current = null;
    };
  }, [terminal.id]);

  useEffect(() => {
    let disposed = false;
    let reconnectTimer: number | null = null;

    function connect() {
      if (disposed || !reconnectEnabledRef.current) {
        return;
      }
      setConnectionStatus((current) => (current === 'closed' ? 'reconnecting' : 'connecting'));
      const socket = new WebSocket(createTerminalWebSocketUrl(terminal.id));
      socketRef.current = socket;

      socket.addEventListener('open', () => {
        setConnectionStatus('connected');
        scheduleSettledFitAndReportSize();
      });

      socket.addEventListener('message', (event) => {
        const message = parseServerMessage(event.data);
        if (!message) {
          return;
        }
        handleServerMessage(message);
      });

      socket.addEventListener('close', () => {
        if (socketRef.current === socket) {
          socketRef.current = null;
        }
        if (disposed || !reconnectEnabledRef.current) {
          setConnectionStatus('closed');
          return;
        }
        setConnectionStatus('reconnecting');
        reconnectTimer = window.setTimeout(connect, 1_000);
      });

      socket.addEventListener('error', () => {
        setConnectionStatus('reconnecting');
      });
    }

    if (!reconnectEnabledRef.current) {
      setConnectionStatus('closed');
      return undefined;
    }

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [terminal.id]);

  useEffect(() => {
    const visualViewport = window.visualViewport;

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        scheduleSettledFitAndReportSize();
      }
    }

    function handlePageShow() {
      scheduleSettledFitAndReportSize();
    }

    function handleViewportChange() {
      scheduleSettledFitAndReportSize();
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pageshow', handlePageShow);
    window.addEventListener('resize', handleViewportChange);
    visualViewport?.addEventListener('resize', handleViewportChange);
    visualViewport?.addEventListener('scroll', handleViewportChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pageshow', handlePageShow);
      window.removeEventListener('resize', handleViewportChange);
      visualViewport?.removeEventListener('resize', handleViewportChange);
      visualViewport?.removeEventListener('scroll', handleViewportChange);
    };
  }, [terminal.id]);

  function handleServerMessage(message: ServerTerminalMessage) {
    if (message.type === 'snapshot' && message.terminal.id === terminal.id) {
      callbacksRef.current.onSnapshot(message.terminal);
      const xterm = xtermRef.current;
      if (!xterm) {
        return;
      }
      // Fits scheduled before the snapshot (socket open, viewport events) must not resize the
      // terminal away from the server dims while the async restore write is still parsing.
      clearScheduledFit();
      xterm.reset();
      if (message.terminal.cols > 0 && message.terminal.rows > 0) {
        xterm.resize(message.terminal.cols, message.terminal.rows);
      }
      xterm.write(message.output.join(''), () => scheduleSettledFitAndReportSize());
      return;
    }

    if (message.type === 'terminal_updated' && message.terminal.id === terminal.id) {
      callbacksRef.current.onSnapshot(message.terminal);
      return;
    }

    const xterm = xtermRef.current;
    if (!xterm) {
      return;
    }

    if (message.type === 'output' && message.terminalId === terminal.id) {
      xterm.write(message.data);
      return;
    }

    if (message.type === 'exit' && message.terminalId === terminal.id) {
      reconnectEnabledRef.current = false;
      callbacksRef.current.onExit(message.exitCode);
      socketRef.current?.close();
      setConnectionStatus('closed');
      return;
    }

    if (message.type === 'error') {
      xterm.writeln(`\r\n[leominal] ${message.message}`);
    }
  }

  function scheduleFitAndReportSize(delayMs = 25) {
    if (document.visibilityState === 'hidden') {
      return;
    }
    if (pendingFitTimersRef.current.has(delayMs)) {
      return;
    }
    const timer = window.setTimeout(() => {
      pendingFitTimersRef.current.delete(delayMs);
      fitAndReportSize();
    }, delayMs);
    pendingFitTimersRef.current.set(delayMs, timer);
  }

  function scheduleSettledFitAndReportSize() {
    for (const delayMs of terminalFitSettleDelaysMs) {
      scheduleFitAndReportSize(delayMs);
    }
  }

  function clearScheduledFit() {
    for (const timer of pendingFitTimersRef.current.values()) {
      window.clearTimeout(timer);
    }
    pendingFitTimersRef.current.clear();
  }

  function clearScheduledCwdRefresh() {
    for (const timer of cwdRefreshTimerRefs.current) {
      window.clearTimeout(timer);
    }
    cwdRefreshTimerRefs.current = [];
  }

  function fitAndReportSize() {
    const xterm = xtermRef.current;
    const fit = fitRef.current;
    if (!xterm || !fit) {
      return;
    }
    if (document.visibilityState === 'hidden' || containerRef.current?.isConnected === false) {
      return;
    }
    try {
      fit.fit();
      xterm.refresh(0, Math.max(0, xterm.rows - 1));
      const size = { cols: xterm.cols, rows: xterm.rows };
      const previousSize = lastReportedSizeRef.current;
      if (previousSize && previousSize.cols === size.cols && previousSize.rows === size.rows) {
        return;
      }
      if (sendSocketMessage({ type: 'resize', terminalId: terminal.id, cols: size.cols, rows: size.rows })) {
        lastReportedSizeRef.current = size;
      }
    } catch {
      // xterm fit can throw while the pane is detached or hidden during layout changes.
    }
  }

  function sendSocketMessage(message: object): boolean {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  function sendTerminalInput(data: string) {
    if (sendSocketMessage({ type: 'input', terminalId: terminal.id, data }) && isEnterInput(data)) {
      scheduleCwdRefresh();
    }
  }

  function scheduleCwdRefresh() {
    if (!refreshCwdOnEnterRef.current || !activeRef.current) {
      return;
    }
    clearScheduledCwdRefresh();
    cwdRefreshTimerRefs.current = cwdRefreshDelaysMs.map((delay) => {
      const timer = window.setTimeout(() => {
        cwdRefreshTimerRefs.current = cwdRefreshTimerRefs.current.filter((candidate) => candidate !== timer);
        if (refreshCwdOnEnterRef.current && activeRef.current) {
          sendSocketMessage({ type: 'refresh_cwd', terminalId: terminal.id });
        }
      }, delay);
      return timer;
    });
  }

  function focusTerminal() {
    xtermRef.current?.focus();
  }

  function armCtrlModifier() {
    setCtrlModifier(true);
    focusTerminal();
  }

  function setCtrlModifier(armed: boolean) {
    ctrlModifierArmedRef.current = armed;
    setCtrlModifierArmed(armed);
  }

  function sendStandaloneKey(key: MobileTerminalStandaloneKey) {
    sendTerminalInput(terminalKeySequence(key));
    focusTerminal();
  }

  return (
    <section
      className="terminal-pane"
      data-active={active}
      onMouseDown={() => {
        if (!active) {
          onSelect();
        }
      }}
    >
      <header className="terminal-pane-header">
        <span className="terminal-pane-dot" aria-hidden="true" />
        <span className="terminal-pane-cwd" title={terminal.cwd}>
          {terminal.cwd}
        </span>
        <span className="terminal-pane-spacer" />
        <span className={`terminal-pane-state terminal-pane-state-${terminal.status}`}>{terminal.status}</span>
        {canClose ? (
          <button
            type="button"
            className="terminal-pane-close"
            aria-label={`Close pane ${terminal.title}`}
            title="Close pane"
            onMouseDown={(event) => {
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
          >
            x
          </button>
        ) : null}
      </header>
      <div className="xterm-container" ref={containerRef} />
      {active && terminal.status === 'running' ? (
        <MobileTerminalKeyBar
          ctrlActive={ctrlModifierArmed}
          onCtrl={armCtrlModifier}
          onStandaloneKey={sendStandaloneKey}
          onPreserveFocus={focusTerminal}
        />
      ) : null}
    </section>
  );
}

function isEnterInput(data: string): boolean {
  return data.includes('\r') || data.includes('\n');
}

function installTerminalTouchScroll(container: HTMLElement, xterm: Terminal): () => void {
  let lastTouch: TouchPoint | null = null;
  let pendingLines = 0;
  const touchOptions: AddEventListenerOptions = { passive: false };

  function handleTouchStart(event: TouchEvent) {
    const touch = readSingleTouchPoint(event);
    lastTouch = touch;
    pendingLines = 0;
  }

  function handleTouchMove(event: TouchEvent) {
    const touch = readSingleTouchPoint(event);
    if (touch === null) {
      lastTouch = null;
      pendingLines = 0;
      return;
    }
    if (lastTouch === null) {
      lastTouch = touch;
      return;
    }

    const deltaY = touch.clientY - lastTouch.clientY;
    lastTouch = touch;
    if (event.cancelable) {
      event.preventDefault();
    }
    if (deltaY === 0) {
      return;
    }

    if (shouldForwardTouchScrollToTerminal(xterm) && dispatchSyntheticTerminalWheel(xterm, touch, -deltaY)) {
      pendingLines = 0;
      return;
    }

    pendingLines -= deltaY / touchScrollLineHeight;
    const wholeLines = pendingLines < 0 ? Math.ceil(pendingLines) : Math.floor(pendingLines);
    if (wholeLines === 0) {
      return;
    }
    pendingLines -= wholeLines;
    xterm.scrollLines(wholeLines);
  }

  function handleTouchEnd(event: TouchEvent) {
    if (event.touches.length > 0) {
      lastTouch = readSingleTouchPoint(event);
      return;
    }
    lastTouch = null;
    pendingLines = 0;
  }

  container.addEventListener('touchstart', handleTouchStart, touchOptions);
  container.addEventListener('touchmove', handleTouchMove, touchOptions);
  container.addEventListener('touchend', handleTouchEnd);
  container.addEventListener('touchcancel', handleTouchEnd);

  return () => {
    container.removeEventListener('touchstart', handleTouchStart, touchOptions);
    container.removeEventListener('touchmove', handleTouchMove, touchOptions);
    container.removeEventListener('touchend', handleTouchEnd);
    container.removeEventListener('touchcancel', handleTouchEnd);
  };
}

interface TouchPoint {
  clientX: number;
  clientY: number;
}

function readSingleTouchPoint(event: TouchEvent): TouchPoint | null {
  if (event.touches.length !== 1) {
    return null;
  }
  const touch = event.touches[0];
  if (!touch) {
    return null;
  }
  return { clientX: touch.clientX, clientY: touch.clientY };
}

function shouldForwardTouchScrollToTerminal(xterm: Terminal): boolean {
  return xterm.buffer.active.type === 'alternate' || xterm.modes.mouseTrackingMode !== 'none';
}

function dispatchSyntheticTerminalWheel(xterm: Terminal, touch: TouchPoint, deltaY: number): boolean {
  const target = xterm.element;
  if (!target) {
    return false;
  }
  target.dispatchEvent(createTerminalWheelEvent(touch, deltaY));
  return true;
}

function createTerminalWheelEvent(touch: TouchPoint, deltaY: number): WheelEvent {
  const pixelDeltaMode = typeof WheelEvent === 'function' ? WheelEvent.DOM_DELTA_PIXEL : 0;
  const eventOptions: WheelEventInit = {
    bubbles: true,
    cancelable: true,
    clientX: touch.clientX,
    clientY: touch.clientY,
    deltaX: 0,
    deltaY,
    deltaMode: pixelDeltaMode
  };
  if (typeof WheelEvent === 'function') {
    return new WheelEvent('wheel', eventOptions);
  }
  const event = new Event('wheel', eventOptions) as WheelEvent;
  Object.defineProperties(event, {
    clientX: { value: touch.clientX },
    clientY: { value: touch.clientY },
    deltaX: { value: 0 },
    deltaY: { value: deltaY },
    deltaMode: { value: 0 }
  });
  return event;
}

function parseServerMessage(data: unknown): ServerTerminalMessage | null {
  if (typeof data !== 'string') {
    return null;
  }
  try {
    const parsed = JSON.parse(data) as ServerTerminalMessage;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
