import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import React, { useEffect, useRef, useState } from 'react';
import type { ServerTerminalMessage } from '../../shared/protocol.js';
import type { TerminalSummary } from '../../shared/types.js';
import { createTerminalWebSocketUrl } from '../api/client.js';
import { terminalFontFamily, terminalFontSize, waitForTerminalFonts } from './fontStack.js';
import { HangulInputComposer } from './hangulInput.js';

interface XtermPaneProps {
  terminal: TerminalSummary;
  active: boolean;
  onSelect: () => void;
  onExit: (exitCode: number | null) => void;
  onSnapshot: (terminal: TerminalSummary) => void;
}

export function XtermPane({ terminal, active, onSelect, onExit, onSnapshot }: XtermPaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const callbacksRef = useRef({ onExit, onSnapshot });
  const reconnectEnabledRef = useRef(terminal.status === 'running');
  const lastReportedSizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const pendingFitTimerRef = useRef<number | null>(null);
  const [, setConnectionStatus] = useState<'connecting' | 'connected' | 'reconnecting' | 'closed'>('connecting');

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
    let dataDisposable: { dispose(): void } | null = null;
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
      scrollback: 10_000,
      theme: {
        background: '#101318',
        foreground: '#d8dee9',
        cursor: '#f6c177',
        selectionBackground: '#344054'
      }
    });
    const fit = new FitAddon();
    xterm.loadAddon(fit);
    xtermRef.current = xterm;
    fitRef.current = fit;

    void waitForTerminalFonts(terminalFontSize).then(() => {
      if (disposed) {
        return;
      }

      xterm.open(container);

      const inputComposer = new HangulInputComposer();
      dataDisposable = xterm.onData((data) => {
        const composedData = inputComposer.accept(data);
        if (composedData) {
          sendSocketMessage({ type: 'input', terminalId: terminal.id, data: composedData });
        }
      });

      resizeObserver = new ResizeObserver(() => {
        scheduleFitAndReportSize();
      });
      resizeObserver.observe(container);
      scheduleFitAndReportSize(0);
    });

    return () => {
      disposed = true;
      clearScheduledFit();
      resizeObserver?.disconnect();
      dataDisposable?.dispose();
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
        scheduleFitAndReportSize(0);
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
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        scheduleFitAndReportSize(0);
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [terminal.id]);

  function handleServerMessage(message: ServerTerminalMessage) {
    if (message.type === 'snapshot' && message.terminal.id === terminal.id) {
      callbacksRef.current.onSnapshot(message.terminal);
      const xterm = xtermRef.current;
      if (!xterm) {
        return;
      }
      xterm.clear();
      for (const chunk of message.output) {
        xterm.write(chunk);
      }
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
    if (pendingFitTimerRef.current !== null) {
      return;
    }
    pendingFitTimerRef.current = window.setTimeout(() => {
      pendingFitTimerRef.current = null;
      fitAndReportSize();
    }, delayMs);
  }

  function clearScheduledFit() {
    if (pendingFitTimerRef.current !== null) {
      window.clearTimeout(pendingFitTimerRef.current);
      pendingFitTimerRef.current = null;
    }
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

  return (
    <section className="terminal-pane" data-active={active} onMouseDown={onSelect}>
      <div className="xterm-container" ref={containerRef} />
    </section>
  );
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
