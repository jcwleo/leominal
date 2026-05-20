import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { isAllowedOrigin, type AppConfig } from '../config.js';
import type { AuthService } from '../auth/authService.js';
import type { TerminalManager } from '../terminal/TerminalManager.js';
import { parseClientTerminalMessage } from '../../shared/protocol.js';
import type { ServerTerminalMessage } from '../../shared/protocol.js';
import { authenticateTerminalRequest } from './terminalRoutes.js';

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
    const attachment = services.terminalManager.attachTerminal(
      terminalId,
      (message) => {
        if (!snapshotSent) {
          pendingMessages.push(message);
          return;
        }
        sendJson(socket, message);
      },
      { replay: false }
    );

    if (!attachment) {
      socket.close(1008, 'terminal not found');
      return;
    }

    sendJson(socket, { type: 'snapshot', terminal: attachment.terminal, output: attachment.output });
    snapshotSent = true;
    for (const message of pendingMessages) {
      sendJson(socket, message);
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
      attachment.dispose();
    });
  });
}

function sendJson(socket: WebSocket, payload: unknown): void {
  if (socket.readyState !== WebSocket.CLOSING && socket.readyState !== WebSocket.CLOSED) {
    socket.send(JSON.stringify(payload));
  }
}
