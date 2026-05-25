import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { normalizeTerminalLayoutState } from '../../shared/layoutState.js';
import type { TerminalLayoutState } from '../../shared/types.js';

export interface StoredPasswordCredential {
  algorithm: 'scrypt';
  hash: string;
  salt: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredTotpCredential {
  algorithm: 'totp';
  secret: string;
  issuer: string;
  accountName: string;
  digits: number;
  period: number;
  createdAt: string;
  updatedAt: string;
}

export interface StoredTerminalLayout {
  layout: TerminalLayoutState;
  revision: number;
  updatedAt: string;
}

export interface StoredState {
  passwordCredential: StoredPasswordCredential | null;
  terminalLayout: StoredTerminalLayout | null;
  totpCredential: StoredTotpCredential | null;
}

const emptyState = (): StoredState => ({ passwordCredential: null, terminalLayout: null, totpCredential: null });

function normalizeState(value: unknown): StoredState {
  if (!value || typeof value !== 'object') {
    return emptyState();
  }
  const state = value as Partial<StoredState>;
  const passwordCredential =
    state.passwordCredential &&
    typeof state.passwordCredential === 'object' &&
    state.passwordCredential.algorithm === 'scrypt' &&
    typeof state.passwordCredential.hash === 'string' &&
    typeof state.passwordCredential.salt === 'string' &&
    typeof state.passwordCredential.createdAt === 'string' &&
    typeof state.passwordCredential.updatedAt === 'string'
      ? state.passwordCredential
      : null;

  return {
    passwordCredential,
    terminalLayout: normalizeStoredTerminalLayout(state.terminalLayout),
    totpCredential: normalizeStoredTotpCredential(state.totpCredential)
  };
}

function normalizeStoredTotpCredential(value: unknown): StoredTotpCredential | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Partial<StoredTotpCredential>;
  const digits = candidate.digits;
  const period = candidate.period;
  if (
    candidate.algorithm !== 'totp' ||
    typeof candidate.secret !== 'string' ||
    !isBase32Secret(candidate.secret) ||
    typeof candidate.issuer !== 'string' ||
    typeof candidate.accountName !== 'string' ||
    typeof digits !== 'number' ||
    !Number.isInteger(digits) ||
    typeof period !== 'number' ||
    !Number.isInteger(period) ||
    typeof candidate.createdAt !== 'string' ||
    typeof candidate.updatedAt !== 'string'
  ) {
    return null;
  }
  return {
    algorithm: 'totp',
    secret: candidate.secret,
    issuer: candidate.issuer,
    accountName: candidate.accountName,
    digits,
    period,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt
  };
}

function isBase32Secret(value: string): boolean {
  return value.length > 0 && /^[A-Z2-7]+=*$/i.test(value);
}

function normalizeStoredTerminalLayout(value: unknown): StoredTerminalLayout | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Partial<StoredTerminalLayout>;
  const layout = normalizeTerminalLayoutState(candidate.layout);
  const revision = candidate.revision;
  if (!layout || typeof revision !== 'number' || !Number.isInteger(revision) || revision < 0 || typeof candidate.updatedAt !== 'string') {
    return null;
  }
  return {
    layout,
    revision,
    updatedAt: candidate.updatedAt
  };
}

export class FileStore {
  private updateQueue: Promise<void> = Promise.resolve();

  constructor(public readonly path: string) {}

  async init(): Promise<void> {
    await mkdir(path.dirname(this.path), { recursive: true, mode: 0o700 });
    try {
      await this.read();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      await this.write(emptyState());
    }
  }

  async read(): Promise<StoredState> {
    const raw = await readFile(this.path, 'utf8');
    return normalizeState(JSON.parse(raw));
  }

  async write(state: StoredState): Promise<void> {
    await mkdir(path.dirname(this.path), { recursive: true, mode: 0o700 });
    const tempPath = `${this.path}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
    const handle = await open(tempPath, 'w', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`, 'utf8');
    } finally {
      await handle.close();
    }
    await rename(tempPath, this.path);
  }

  async update(updater: (state: StoredState) => StoredState | Promise<StoredState>): Promise<StoredState> {
    const run = async (): Promise<StoredState> => {
      const current = await this.read();
      const next = await updater(current);
      await this.write(next);
      return next;
    };
    const result = this.updateQueue.then(run, run);
    this.updateQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}
