import type { AppConfig } from '../config.js';
import type { ServerTerminalMessage } from '../../shared/protocol.js';
import type { TerminalId, TerminalSummary } from '../../shared/types.js';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Disposable, PtyAdapter, PtyProcess } from './PtyAdapter.js';
import { resolveProcessCwd } from './cwdResolver.js';
import { OutputBuffer } from './outputBuffer.js';

export interface CreateTerminalOptions {
  parentTerminalId?: TerminalId;
  cwd?: string;
  cols?: number;
  rows?: number;
}

export interface AttachTerminalOptions {
  replay?: boolean;
}

export interface TerminalAttachment {
  terminal: TerminalSummary;
  output: string[];
  dispose(): void;
}

export interface TerminalManagerOptions {
  resolveCwd?: (pid: number) => Promise<string | null>;
  now?: () => Date;
}

type TerminalSubscriber = (message: ServerTerminalMessage) => void;

interface TerminalRecord {
  summary: TerminalSummary;
  pty: PtyProcess | null;
  output: OutputBuffer;
  subscribers: Set<TerminalSubscriber>;
  dataDisposable: Disposable;
  exitDisposable: Disposable;
}

export class TerminalManager {
  private readonly terminals = new Map<TerminalId, TerminalRecord>();
  private readonly resolveCwd: (pid: number) => Promise<string | null>;
  private readonly now: () => Date;

  constructor(
    private readonly config: AppConfig,
    private readonly ptyAdapter: PtyAdapter,
    options: TerminalManagerOptions = {}
  ) {
    this.resolveCwd = options.resolveCwd ?? resolveProcessCwd;
    this.now = options.now ?? (() => new Date());
  }

  async createTerminal(options: CreateTerminalOptions = {}): Promise<TerminalSummary> {
    const cwd = await this.resolveInitialCwd(options);
    const cols = normalizeDimension(options.cols, 80);
    const rows = normalizeDimension(options.rows, 24);
    const id = randomUUID();
    const timestamp = this.timestamp();
    const pty = this.ptyAdapter.spawn({
      shell: this.config.shell,
      cwd,
      cols,
      rows,
      env: terminalEnv()
    });

    const record: TerminalRecord = {
      summary: {
        id,
        title: this.createTitle(cwd),
        cwd,
        pid: pty.pid,
        cols,
        rows,
        createdAt: timestamp,
        updatedAt: timestamp,
        status: 'running',
        exitCode: null
      },
      pty,
      output: new OutputBuffer(),
      subscribers: new Set(),
      dataDisposable: { dispose: () => undefined },
      exitDisposable: { dispose: () => undefined }
    };

    record.dataDisposable = pty.onData((data) => {
      record.output.push(data);
      record.summary.updatedAt = this.timestamp();
      this.publish(record, { type: 'output', terminalId: id, data });
    });
    record.exitDisposable = pty.onExit((event) => {
      record.summary.status = 'exited';
      record.summary.exitCode = event.exitCode;
      record.summary.pid = null;
      record.summary.updatedAt = this.timestamp();
      record.pty = null;
      this.publish(record, { type: 'exit', terminalId: id, exitCode: event.exitCode });
    });

    this.terminals.set(id, record);
    return cloneSummary(record.summary);
  }

  listTerminals(): TerminalSummary[] {
    return [...this.terminals.values()].map((record) => cloneSummary(record.summary));
  }

  getTerminal(id: TerminalId): TerminalSummary | null {
    const record = this.terminals.get(id);
    return record ? cloneSummary(record.summary) : null;
  }

  getOutputSnapshot(id: TerminalId): string[] | null {
    return this.terminals.get(id)?.output.snapshot() ?? null;
  }

  attachTerminal(id: TerminalId, subscriber: TerminalSubscriber, options: AttachTerminalOptions = {}): TerminalAttachment | null {
    const record = this.terminals.get(id);
    if (!record) {
      return null;
    }
    const output = record.output.snapshot();
    record.subscribers.add(subscriber);
    if (options.replay ?? true) {
      for (const data of output) {
        subscriber({ type: 'output', terminalId: id, data });
      }
    }
    return {
      terminal: cloneSummary(record.summary),
      output,
      dispose: () => {
        record.subscribers.delete(subscriber);
      }
    };
  }

  writeToTerminal(id: TerminalId, data: string): boolean {
    const record = this.terminals.get(id);
    if (!record?.pty || record.summary.status !== 'running') {
      return false;
    }
    record.pty.write(data);
    record.summary.updatedAt = this.timestamp();
    return true;
  }

  resizeTerminal(id: TerminalId, cols: number, rows: number): boolean {
    const record = this.terminals.get(id);
    if (!record?.pty || record.summary.status !== 'running') {
      return false;
    }
    const normalizedCols = normalizeDimension(cols, record.summary.cols);
    const normalizedRows = normalizeDimension(rows, record.summary.rows);
    if (record.summary.cols === normalizedCols && record.summary.rows === normalizedRows) {
      return true;
    }
    record.pty.resize(normalizedCols, normalizedRows);
    record.summary.cols = normalizedCols;
    record.summary.rows = normalizedRows;
    record.summary.updatedAt = this.timestamp();
    this.publish(record, { type: 'terminal_updated', terminal: cloneSummary(record.summary) });
    return true;
  }

  closeTerminal(id: TerminalId): boolean {
    const record = this.terminals.get(id);
    if (!record) {
      return false;
    }
    this.disposeRecord(record);
    this.terminals.delete(id);
    return true;
  }

  closeAll(): void {
    for (const id of [...this.terminals.keys()]) {
      this.closeTerminal(id);
    }
  }

  private async resolveInitialCwd(options: CreateTerminalOptions): Promise<string> {
    if (options.cwd?.trim()) {
      return path.resolve(options.cwd);
    }

    if (options.parentTerminalId) {
      const parent = this.terminals.get(options.parentTerminalId);
      if (parent) {
        const resolved = parent.summary.pid ? await this.safeResolveCwd(parent.summary.pid) : null;
        return resolved ?? parent.summary.cwd;
      }
    }

    return this.config.workspaceRoot;
  }

  private async safeResolveCwd(pid: number): Promise<string | null> {
    try {
      return await this.resolveCwd(pid);
    } catch {
      return null;
    }
  }

  private publish(record: TerminalRecord, message: ServerTerminalMessage): void {
    for (const subscriber of record.subscribers) {
      subscriber(message);
    }
  }

  private disposeRecord(record: TerminalRecord): void {
    record.dataDisposable.dispose();
    record.exitDisposable.dispose();
    record.subscribers.clear();
    if (record.pty && record.summary.status === 'running') {
      record.pty.kill();
    }
    record.pty = null;
  }

  private createTitle(cwd: string): string {
    return path.basename(cwd) || 'Terminal';
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

function normalizeDimension(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

function cloneSummary(summary: TerminalSummary): TerminalSummary {
  return { ...summary };
}

function terminalEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const allowedKeys = ['HOME', 'LANG', 'LC_ALL', 'LOGNAME', 'PATH', 'SHELL', 'TMPDIR', 'USER'];
  for (const key of allowedKeys) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  env.TERM = process.env.TERM ?? 'xterm-256color';
  env.COLORTERM = process.env.COLORTERM ?? 'truecolor';
  return env;
}
