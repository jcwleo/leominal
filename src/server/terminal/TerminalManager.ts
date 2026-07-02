import type { AppConfig } from '../config.js';
import type { ServerTerminalMessage } from '../../shared/protocol.js';
import type { TerminalId, TerminalSummary } from '../../shared/types.js';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import headlessPkg from '@xterm/headless';
import serializePkg from '@xterm/addon-serialize';
import type { Terminal as HeadlessTerminal } from '@xterm/headless';
import type { SerializeAddon } from '@xterm/addon-serialize';
import type { Disposable, PtyAdapter, PtyProcess } from './PtyAdapter.js';
import { resolveProcessCwd } from './cwdResolver.js';

// Both packages ship CJS bundles; Node ESM named imports fail at runtime, so use default-import interop.
const { Terminal: HeadlessTerminalCtor } = headlessPkg;
const { SerializeAddon: SerializeAddonCtor } = serializePkg;

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
  maxSnapshotLength?: number;
}

type TerminalSubscriber = (message: ServerTerminalMessage) => void;

interface TerminalRecord {
  summary: TerminalSummary;
  pty: PtyProcess | null;
  mirror: HeadlessTerminal;
  serializeAddon: SerializeAddon;
  subscribers: Set<TerminalSubscriber>;
  dataDisposable: Disposable;
  exitDisposable: Disposable;
  mirrorOverflowActive: boolean;
  nudgeInFlight: boolean;
}

const maxTerminalCols = 2000;
const maxTerminalRows = 1000;
const nudgeRestoreDelayMs = 50;
const defaultMaxSnapshotLength = 8 * 1024 * 1024;
const mirrorScrollback = 10_000;
// Attach snapshots retry with less scrollback until they fit; 0 (screen only) cannot shrink further.
const snapshotScrollbackFallbacks = [mirrorScrollback, 2_500, 500, 0];

export class TerminalManager {
  private readonly terminals = new Map<TerminalId, TerminalRecord>();
  private readonly resolveCwd: (pid: number) => Promise<string | null>;
  private readonly now: () => Date;
  private readonly maxSnapshotLength: number;

  constructor(
    private readonly config: AppConfig,
    private readonly ptyAdapter: PtyAdapter,
    options: TerminalManagerOptions = {}
  ) {
    this.resolveCwd = options.resolveCwd ?? resolveProcessCwd;
    this.now = options.now ?? (() => new Date());
    this.maxSnapshotLength = options.maxSnapshotLength ?? defaultMaxSnapshotLength;
  }

  async createTerminal(options: CreateTerminalOptions = {}): Promise<TerminalSummary> {
    const cwd = await this.resolveInitialCwd(options);
    const cols = clampDimension(normalizeDimension(options.cols, 80), maxTerminalCols);
    const rows = clampDimension(normalizeDimension(options.rows, 24), maxTerminalRows);
    const id = randomUUID();
    const timestamp = this.timestamp();
    const pty = this.ptyAdapter.spawn({
      shell: this.config.shell,
      cwd,
      cols,
      rows,
      env: terminalEnv()
    });

    const mirror = new HeadlessTerminalCtor({ cols, rows, scrollback: mirrorScrollback, allowProposedApi: true });
    const serializeAddon = new SerializeAddonCtor();
    // SerializeAddon types target the browser Terminal; the headless core implements the same addon surface.
    mirror.loadAddon(serializeAddon as unknown as Parameters<HeadlessTerminal['loadAddon']>[0]);

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
      mirror,
      serializeAddon,
      subscribers: new Set(),
      dataDisposable: { dispose: () => undefined },
      exitDisposable: { dispose: () => undefined },
      mirrorOverflowActive: false,
      nudgeInFlight: false
    };

    record.dataDisposable = pty.onData((data) => {
      try {
        record.mirror.write(data);
        record.mirrorOverflowActive = false;
      } catch (error) {
        // xterm's WriteBuffer throws once >50MB is pending unparsed. Drop the mirror write instead
        // of crashing; the mirror self-heals on the app's next full repaint. Live output is
        // published below regardless.
        if (!record.mirrorOverflowActive) {
          record.mirrorOverflowActive = true;
          console.error(`terminal ${id}: mirror write overflow, dropping mirror data until it drains`, error);
        }
      }
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

  async resolveTerminalCwd(id: TerminalId): Promise<string | null> {
    const record = this.terminals.get(id);
    if (!record?.pty || record.summary.status !== 'running') {
      return null;
    }
    return this.safeResolveCwd(record.pty.pid);
  }

  async refreshTerminalCwd(id: TerminalId): Promise<TerminalSummary | null> {
    const record = this.terminals.get(id);
    if (!record?.pty || record.summary.status !== 'running') {
      return null;
    }
    await this.refreshCwd(record);
    return cloneSummary(record.summary);
  }

  async attachTerminal(
    id: TerminalId,
    subscriber: TerminalSubscriber,
    options: AttachTerminalOptions = {}
  ): Promise<TerminalAttachment | null> {
    const record = this.terminals.get(id);
    if (!record) {
      return null;
    }
    // Subscribe and queue the flush sentinel in one synchronous block so nothing interleaves:
    // chunks parsed before the sentinel land in the snapshot and were published before this
    // subscriber existed; chunks arriving after this block queue behind the sentinel (excluded
    // from the snapshot) and reach the subscriber live — exactly once either way, regardless of
    // xterm's parse-budget batch breaks.
    record.subscribers.add(subscriber);
    let serialized: string | null = null;
    try {
      serialized = await new Promise<string | null>((resolve) => {
        record.mirror.write('', () => {
          // Runs synchronously inside xterm's sentinel processing, before post-sentinel chunks parse.
          resolve(this.terminals.get(id) === record ? this.serializeSnapshot(record) : null);
        });
      });
    } catch {
      // Mirror write buffer overflow: serialize the currently-parsed (slightly stale) state so the
      // attach still succeeds instead of crashing.
      serialized = this.serializeSnapshot(record);
    }
    if (serialized === null || this.terminals.get(id) !== record) {
      // Terminal was closed (mirror disposed) while the flush was pending.
      record.subscribers.delete(subscriber);
      return null;
    }
    const output = [serialized];
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
    if (!this.applySize(record, normalizedCols, normalizedRows)) {
      return true;
    }
    record.summary.updatedAt = this.timestamp();
    this.publish(record, { type: 'terminal_updated', terminal: cloneSummary(record.summary) });
    return true;
  }

  nudgeTerminal(id: TerminalId): boolean {
    const record = this.terminals.get(id);
    if (!record?.pty || record.summary.status !== 'running' || record.summary.rows < 2) {
      return false;
    }
    if (record.nudgeInFlight) {
      return true;
    }
    // Same-size reattaches never generate SIGWINCH, so jiggle rows to make the foreground TUI
    // repaint. The shrink and restore happen on separate ticks: a synchronous pair can coalesce
    // into one SIGWINCH with an unchanged final winsize, which many curses apps ignore while the
    // mirror still went through a non-reflowing resize (mirror drift in later snapshots).
    const { cols, rows } = record.summary;
    record.nudgeInFlight = true;
    this.applySize(record, cols, rows - 1);
    setTimeout(() => {
      record.nudgeInFlight = false;
      if (
        this.terminals.get(id) !== record ||
        !record.pty ||
        record.summary.status !== 'running' ||
        record.summary.cols !== cols ||
        record.summary.rows !== rows - 1
      ) {
        // Closed, exited, or resized meanwhile: the jiggle restore no longer applies.
        return;
      }
      this.applySize(record, cols, rows);
    }, nudgeRestoreDelayMs);
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

  private async refreshCwd(record: TerminalRecord): Promise<void> {
    const pty = record.pty;
    if (!pty || record.summary.status !== 'running') {
      return;
    }

    const cwd = await this.safeResolveCwd(pty.pid);
    if (!cwd || record.pty !== pty || record.summary.status !== 'running' || cwd === record.summary.cwd) {
      return;
    }

    record.summary.cwd = cwd;
    record.summary.title = this.createTitle(cwd);
    record.summary.updatedAt = this.timestamp();
    this.publish(record, { type: 'terminal_updated', terminal: cloneSummary(record.summary) });
  }

  private publish(record: TerminalRecord, message: ServerTerminalMessage): void {
    for (const subscriber of record.subscribers) {
      subscriber(message);
    }
  }

  // Sole owner of the max-dimension clamp: every size change (resize, nudge) flows through here.
  // Returns whether the summary actually changed so callers can skip no-op publishes.
  private applySize(record: TerminalRecord, cols: number, rows: number): boolean {
    const clampedCols = clampDimension(cols, maxTerminalCols);
    const clampedRows = clampDimension(rows, maxTerminalRows);
    if (record.summary.cols === clampedCols && record.summary.rows === clampedRows) {
      return false;
    }
    record.pty?.resize(clampedCols, clampedRows);
    record.mirror.resize(clampedCols, clampedRows);
    record.summary.cols = clampedCols;
    record.summary.rows = clampedRows;
    return true;
  }

  private serializeSnapshot(record: TerminalRecord): string {
    let snapshot = '';
    for (const scrollback of snapshotScrollbackFallbacks) {
      snapshot = record.serializeAddon.serialize({ scrollback });
      if (snapshot.length <= this.maxSnapshotLength) {
        return snapshot;
      }
    }
    // Screen-only output cannot be reduced further; ship it even if it is still over the cap.
    return snapshot;
  }

  private disposeRecord(record: TerminalRecord): void {
    record.dataDisposable.dispose();
    record.exitDisposable.dispose();
    record.subscribers.clear();
    if (record.pty && record.summary.status === 'running') {
      record.pty.kill();
    }
    record.pty = null;
    record.serializeAddon.dispose();
    record.mirror.dispose();
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

function clampDimension(value: number, max: number): number {
  return Math.min(Math.max(Math.trunc(value), 1), max);
}

function cloneSummary(summary: TerminalSummary): TerminalSummary {
  return { ...summary };
}

function terminalEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const allowedKeys = ['HOME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'LOGNAME', 'PATH', 'SHELL', 'TMPDIR', 'USER'];
  for (const key of allowedKeys) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  env.TERM = 'xterm-256color';
  env.COLORTERM = process.env.COLORTERM ?? 'truecolor';
  ensureUtf8TerminalLocale(env);
  return env;
}

const fallbackTerminalLocale = 'en_US.UTF-8';

function ensureUtf8TerminalLocale(env: NodeJS.ProcessEnv): void {
  const characterLocale = env.LC_ALL ?? env.LC_CTYPE ?? env.LANG;
  if (isUtf8Locale(characterLocale)) {
    if (!env.LANG) {
      env.LANG = characterLocale;
    }
    if (!env.LC_ALL && !env.LC_CTYPE) {
      env.LC_CTYPE = characterLocale;
    }
    return;
  }

  env.LANG = fallbackTerminalLocale;
  if (!env.LC_ALL) {
    env.LC_CTYPE = fallbackTerminalLocale;
  }
}

function isUtf8Locale(value: string | undefined): value is string {
  return value !== undefined && /utf-?8/i.test(value);
}
