import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { isAllowedOrigin, type AppConfig } from '../config.js';
import type { AuthService } from '../auth/authService.js';
import type { TerminalManager } from '../terminal/TerminalManager.js';
import { parseClientTerminalMessage } from '../../shared/protocol.js';
import type { ServerTerminalMessage } from '../../shared/protocol.js';
import { authenticateTerminalRequest } from './terminalRoutes.js';

type FlushScheduler = (callback: () => void) => () => void;
type Disposable = { dispose(): void };

const terminalSocketMaxBufferedAmount = 16 * 1024 * 1024;
const terminalSocketSlowClientCloseCode = 1013;
const terminalSocketSlowClientReason = 'client too slow';
const terminalSocketRevokedSessionCloseCode = 1008;
const terminalSocketRevokedSessionReason = 'session revoked';

const scheduleNextTickFlush: FlushScheduler = (callback) => {
  const handle = setImmediate(callback);
  return () => clearImmediate(handle);
};

export interface TerminalWebSocketServices {
  authService: AuthService;
  terminalManager: TerminalManager;
}

export async function registerTerminalWebSocket(
  app: FastifyInstance,
  config: AppConfig,
  services: TerminalWebSocketServices
): Promise<void> {
  app.get<{ Params: { id: string } }>('/api/terminals/:id/ws', { websocket: true }, async (socket, request) => {
    if (!request.headers.origin) {
      socket.close(1008, 'origin required');
      return;
    }
    if (!isAllowedOrigin(config, request.headers.origin)) {
      socket.close(1008, 'origin not allowed');
      return;
    }
    const auth = await authenticateTerminalRequest(services.authService, request);
    if (!auth) {
      socket.close(1008, 'unauthorized');
      return;
    }

    const terminalId = request.params.id;
    let snapshotSent = false;
    const pendingMessages: ServerTerminalMessage[] = [];
    const sender = new TerminalSocketSender(socket);
    const attachment = services.terminalManager.attachTerminal(
      terminalId,
      (message) => {
        if (!snapshotSent) {
          pendingMessages.push(message);
          return;
        }
        sender.send(message);
      },
      { replay: false }
    );

    if (!attachment) {
      socket.close(1008, 'terminal not found');
      return;
    }

    const sessionRevocationSubscription = auth.sessionId
      ? subscribeToSessionRevocation(services.authService, auth.sessionId, () => closeForRevokedSession(socket))
      : null;

    sender.send({ type: 'snapshot', terminal: attachment.terminal, output: attachment.output });
    snapshotSent = true;
    for (const message of pendingMessages) {
      sender.send(message);
    }
    pendingMessages.length = 0;

    let isAlive = true;
    const heartbeat = setInterval(() => {
      if (socket.readyState !== WebSocket.OPEN) {
        return;
      }
      if (!isAlive) {
        socket.terminate();
        return;
      }
      isAlive = false;
      socket.ping();
    }, 30_000);

    socket.on('pong', () => {
      isAlive = true;
    });

    socket.on('message', (raw) => {
      const message = parseClientTerminalMessage(raw.toString());
      if (!message) {
        sendJson(socket, { type: 'error', message: 'invalid terminal message' });
        return;
      }
      if (message.type === 'ping') {
        sendJson(socket, { type: 'pong', nonce: message.nonce });
        return;
      }
      if (message.terminalId !== terminalId) {
        sendJson(socket, { type: 'error', message: 'terminal id mismatch' });
        return;
      }
      if (message.type === 'refresh_cwd') {
        void services.terminalManager.refreshTerminalCwd(message.terminalId);
        return;
      }
      if (message.type === 'input') {
        if (!services.terminalManager.writeToTerminal(message.terminalId, message.data)) {
          sendJson(socket, { type: 'error', message: 'terminal is not writable' });
        }
        return;
      }
      if (!services.terminalManager.resizeTerminal(message.terminalId, message.cols, message.rows)) {
        sendJson(socket, { type: 'error', message: 'terminal is not resizable' });
      }
    });

    socket.on('close', () => {
      clearInterval(heartbeat);
      sessionRevocationSubscription?.dispose();
      sender.dispose();
      attachment.dispose();
    });
  });
}

function subscribeToSessionRevocation(authService: AuthService, sessionId: string, onRevoked: () => void): Disposable | null {
  const service = authService as AuthService & { onSessionRevoked?: (listener: (revokedSessionId: string) => void) => Disposable };
  if (typeof service.onSessionRevoked !== 'function') {
    return null;
  }
  return service.onSessionRevoked((revokedSessionId) => {
    if (revokedSessionId === sessionId) {
      onRevoked();
    }
  });
}

function closeForRevokedSession(socket: WebSocket): void {
  if (socket.readyState !== WebSocket.CLOSING && socket.readyState !== WebSocket.CLOSED) {
    socket.close(terminalSocketRevokedSessionCloseCode, terminalSocketRevokedSessionReason);
  }
}

function sendJson(socket: WebSocket, payload: unknown): void {
  if (socket.readyState !== WebSocket.CLOSING && socket.readyState !== WebSocket.CLOSED) {
    socket.send(JSON.stringify(payload));
  }
}

export class TerminalSocketSender {
  private pendingOutput: Extract<ServerTerminalMessage, { type: 'output' }> | null = null;
  private cancelFlush: (() => void) | null = null;
  private closedForBackpressure = false;

  constructor(
    private readonly socket: WebSocket,
    private readonly scheduleFlush: FlushScheduler = scheduleNextTickFlush,
    private readonly maxBufferedAmount = terminalSocketMaxBufferedAmount
  ) {}

  send(message: ServerTerminalMessage): void {
    if (message.type === 'output') {
      this.queueOutput(message);
      return;
    }

    this.flushOutput();
    this.sendNow(message);
  }

  dispose(): void {
    this.cancelPendingFlush();
    this.pendingOutput = null;
  }

  private queueOutput(message: Extract<ServerTerminalMessage, { type: 'output' }>): void {
    if (this.pendingOutput && this.pendingOutput.terminalId === message.terminalId) {
      this.pendingOutput = {
        ...this.pendingOutput,
        data: `${this.pendingOutput.data}${message.data}`
      };
    } else {
      this.flushOutput();
      this.pendingOutput = { ...message };
    }

    if (!this.cancelFlush) {
      this.cancelFlush = this.scheduleFlush(() => {
        this.cancelFlush = null;
        this.flushOutput();
      });
    }
  }

  private flushOutput(): void {
    this.cancelPendingFlush();
    const output = this.pendingOutput;
    this.pendingOutput = null;
    if (output) {
      this.sendNow(output);
    }
  }

  private cancelPendingFlush(): void {
    this.cancelFlush?.();
    this.cancelFlush = null;
  }

  private sendNow(payload: ServerTerminalMessage): void {
    if (this.shouldCloseForBackpressure()) {
      this.closeSlowClient();
      return;
    }

    sendJson(this.socket, payload);
  }

  private shouldCloseForBackpressure(): boolean {
    return this.socket.bufferedAmount > this.maxBufferedAmount;
  }

  private closeSlowClient(): void {
    if (this.closedForBackpressure || this.socket.readyState === WebSocket.CLOSING || this.socket.readyState === WebSocket.CLOSED) {
      return;
    }
    this.closedForBackpressure = true;
    this.socket.close(terminalSocketSlowClientCloseCode, terminalSocketSlowClientReason);
  }
}
