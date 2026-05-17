import type { TerminalId, TerminalLayoutState, TerminalSummary } from './types.js';

export interface PasswordRequest {
  password: string;
}

export interface CreateTerminalRequest {
  parentTerminalId?: TerminalId;
  cwd?: string;
  cols?: number;
  rows?: number;
}

export interface TerminalListResponse {
  terminals: TerminalSummary[];
}

export interface TerminalResponse {
  terminal: TerminalSummary;
}

export interface TerminalLayoutResponse {
  layout: TerminalLayoutState | null;
  revision: number;
  updatedAt: string | null;
}

export interface UpdateTerminalLayoutRequest {
  layout: TerminalLayoutState;
  baseRevision?: number;
}

export type ClientTerminalMessage =
  | { type: 'input'; terminalId: TerminalId; data: string }
  | { type: 'resize'; terminalId: TerminalId; cols: number; rows: number }
  | { type: 'ping'; nonce: string };

export type ServerTerminalMessage =
  | { type: 'snapshot'; terminal: TerminalSummary; output: string[] }
  | { type: 'output'; terminalId: TerminalId; data: string }
  | { type: 'terminal_updated'; terminal: TerminalSummary }
  | { type: 'exit'; terminalId: TerminalId; exitCode: number | null }
  | { type: 'error'; message: string }
  | { type: 'pong'; nonce: string };

export function parseClientTerminalMessage(raw: string): ClientTerminalMessage | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    const message = parsed as Partial<ClientTerminalMessage>;
    if (message.type === 'input' && typeof message.terminalId === 'string' && typeof message.data === 'string') {
      return message as ClientTerminalMessage;
    }
    if (
      message.type === 'resize' &&
      typeof message.terminalId === 'string' &&
      Number.isInteger(message.cols) &&
      Number.isInteger(message.rows)
    ) {
      return message as ClientTerminalMessage;
    }
    if (message.type === 'ping' && typeof message.nonce === 'string') {
      return message as ClientTerminalMessage;
    }
    return null;
  } catch {
    return null;
  }
}
