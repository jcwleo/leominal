import { describe, expect, it, vi } from 'vitest';
import headlessPkg from '@xterm/headless';
import type { AppConfig } from '../../src/server/config.js';
import type { Disposable, PtyAdapter, PtyExit, PtyProcess, PtySpawnOptions } from '../../src/server/terminal/PtyAdapter.js';
import { TerminalManager } from '../../src/server/terminal/TerminalManager.js';

const { Terminal: HeadlessTerminalCtor } = headlessPkg;
const mirrorOverflowError = () => new Error('write data discarded, use flow control to avoid losing data');

function testConfig(): AppConfig {
  return {
    host: '127.0.0.1',
    port: 3107,
    workspaceRoot: '/workspace/root',
    shell: '/bin/zsh',
    statePath: '/tmp/leominal-state.json',
    sessionSecret: 'test-session-secret-that-is-long-enough',
    sessionTtlMs: 43_200_000,
    cookieSecure: false,
    allowedOrigins: ['http://127.0.0.1:3107'],
    staticRoot: '/tmp/static',
    isProduction: false,
    uploadMaxFiles: 1024,
    uploadMaxFileBytes: 536_870_912,
    uploadMaxBatchBytes: 2_147_483_648,
    fileListMaxEntries: 2000,
    fileTextMaxBytes: 1_048_576,
    filePreviewMaxBytes: 52_428_800
  };
}

class FakePtyProcess implements PtyProcess {
  readonly writes: string[] = [];
  readonly resizes: Array<{ cols: number; rows: number }> = [];
  readonly dataListeners = new Set<(data: string) => void>();
  readonly exitListeners = new Set<(event: PtyExit) => void>();
  killed = false;

  constructor(public readonly pid: number) {}

  write(data: string): void {
    this.writes.push(data);
  }

  resize(cols: number, rows: number): void {
    this.resizes.push({ cols, rows });
  }

  kill(): void {
    this.killed = true;
  }

  onData(listener: (data: string) => void): Disposable {
    this.dataListeners.add(listener);
    return { dispose: () => this.dataListeners.delete(listener) };
  }

  onExit(listener: (event: PtyExit) => void): Disposable {
    this.exitListeners.add(listener);
    return { dispose: () => this.exitListeners.delete(listener) };
  }

  emitData(data: string): void {
    for (const listener of this.dataListeners) {
      listener(data);
    }
  }

  emitExit(exitCode: number | null): void {
    for (const listener of this.exitListeners) {
      listener({ exitCode });
    }
  }
}

class FakePtyAdapter implements PtyAdapter {
  readonly spawns: PtySpawnOptions[] = [];
  readonly processes: FakePtyProcess[] = [];

  spawn(options: PtySpawnOptions): PtyProcess {
    this.spawns.push(options);
    const process = new FakePtyProcess(10_000 + this.processes.length);
    this.processes.push(process);
    return process;
  }
}

describe('TerminalManager', () => {
  it('creates and lists PTY-backed terminals in the workspace root', async () => {
    const adapter = new FakePtyAdapter();
    const manager = new TerminalManager(testConfig(), adapter);

    const terminal = await manager.createTerminal({ cols: 120, rows: 32 });

    expect(adapter.spawns[0]).toMatchObject({
      shell: '/bin/zsh',
      cwd: '/workspace/root',
      cols: 120,
      rows: 32
    });
    expect(terminal).toMatchObject({
      id: expect.any(String),
      cwd: '/workspace/root',
      pid: 10_000,
      cols: 120,
      rows: 32,
      status: 'running',
      exitCode: null
    });
    expect(manager.listTerminals()).toEqual([terminal]);
  });

  it('clamps oversized creation dimensions before allocating the pty and mirror', async () => {
    const adapter = new FakePtyAdapter();
    const manager = new TerminalManager(testConfig(), adapter);

    const terminal = await manager.createTerminal({ cols: 999_999, rows: 888_888 });

    expect(adapter.spawns[0]).toMatchObject({ cols: 2000, rows: 1000 });
    expect(terminal).toMatchObject({ cols: 2000, rows: 1000 });
  });

  it('does not pass Leominal auth secrets into spawned PTY environments', async () => {
    const previousSessionSecret = process.env.LEOMINAL_SESSION_SECRET;
    process.env.LEOMINAL_SESSION_SECRET = 'do-not-pass-session';
    try {
      const adapter = new FakePtyAdapter();
      const manager = new TerminalManager(testConfig(), adapter);

      await manager.createTerminal();

      expect(adapter.spawns[0]!.env.LEOMINAL_SESSION_SECRET).toBeUndefined();
      expect(adapter.spawns[0]!.env.TERM).toBeDefined();
    } finally {
      setOrDeleteEnv('LEOMINAL_SESSION_SECRET', previousSessionSecret);
    }
  });

  it('spawns PTYs with browser-terminal and UTF-8 defaults for tmux glyph rendering', async () => {
    const previousEnv = captureEnv(['COLORTERM', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM']);
    process.env.TERM = 'tmux-256color';
    delete process.env.COLORTERM;
    delete process.env.LANG;
    delete process.env.LC_ALL;
    delete process.env.LC_CTYPE;
    try {
      const adapter = new FakePtyAdapter();
      const manager = new TerminalManager(testConfig(), adapter);

      await manager.createTerminal();

      expect(adapter.spawns[0]!.env).toMatchObject({
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        LANG: 'en_US.UTF-8',
        LC_CTYPE: 'en_US.UTF-8'
      });
    } finally {
      restoreEnv(previousEnv);
    }
  });

  it('preserves an existing UTF-8 locale for spawned PTYs', async () => {
    const previousEnv = captureEnv(['LANG', 'LC_ALL', 'LC_CTYPE']);
    process.env.LANG = 'ko_KR.UTF-8';
    delete process.env.LC_ALL;
    delete process.env.LC_CTYPE;
    try {
      const adapter = new FakePtyAdapter();
      const manager = new TerminalManager(testConfig(), adapter);

      await manager.createTerminal();

      expect(adapter.spawns[0]!.env.LANG).toBe('ko_KR.UTF-8');
      expect(adapter.spawns[0]!.env.LC_CTYPE).toBe('ko_KR.UTF-8');
    } finally {
      restoreEnv(previousEnv);
    }
  });

  it('replays a serialized screen snapshot on attach and keeps PTYs alive after detach', async () => {
    const adapter = new FakePtyAdapter();
    const manager = new TerminalManager(testConfig(), adapter);
    const terminal = await manager.createTerminal();
    const pty = adapter.processes[0]!;

    pty.emitData('first');

    const firstOutput: string[] = [];
    const firstAttach = await manager.attachTerminal(terminal.id, (message) => {
      if (message.type === 'output') {
        firstOutput.push(message.data);
      }
    });
    expect(firstAttach).not.toBeNull();
    pty.emitData('second');
    firstAttach?.dispose();
    pty.emitData('third');

    const secondOutput: string[] = [];
    await manager.attachTerminal(terminal.id, (message) => {
      if (message.type === 'output') {
        secondOutput.push(message.data);
      }
    });

    expect(firstOutput).toHaveLength(2);
    expect(firstOutput[0]).toContain('first');
    expect(firstOutput[1]).toBe('second');
    expect(secondOutput).toHaveLength(1);
    expect(secondOutput[0]).toContain('firstsecondthird');
    expect(pty.killed).toBe(false);
  });

  it('reconstructs the full screen on attach after a repaint scrolls past 500 sparse update chunks', async () => {
    const adapter = new FakePtyAdapter();
    const manager = new TerminalManager(testConfig(), adapter);
    const terminal = await manager.createTerminal({ cols: 80, rows: 24 });
    const pty = adapter.processes[0]!;

    pty.emitData('\x1b[2J\x1b[H');
    for (let row = 1; row <= 24; row += 1) {
      pty.emitData(`\x1b[${row};1Hrow-${row}-content`);
    }
    for (let tick = 0; tick < 600; tick += 1) {
      pty.emitData(`\x1b[2;1Htick-${tick}`);
    }

    const attachment = await manager.attachTerminal(terminal.id, () => undefined, { replay: false });

    expect(attachment).not.toBeNull();
    const snapshot = attachment!.output.join('');
    expect(snapshot).toContain('row-10-content');
    expect(snapshot).toContain('row-24-content');
    expect(snapshot).toContain('tick-599');
  });

  it('serves the final serialized screen when attaching to an exited terminal', async () => {
    const adapter = new FakePtyAdapter();
    const manager = new TerminalManager(testConfig(), adapter);
    const terminal = await manager.createTerminal({ cols: 80, rows: 24 });
    const pty = adapter.processes[0]!;

    pty.emitData('final-screen-content');
    pty.emitExit(0);

    const attachment = await manager.attachTerminal(terminal.id, () => undefined, { replay: false });

    expect(attachment).not.toBeNull();
    expect(attachment!.terminal.status).toBe('exited');
    expect(attachment!.output.join('')).toContain('final-screen-content');
  });

  it('keeps the mirror dimensions in sync with resizes so snapshots reflect the new geometry', async () => {
    const adapter = new FakePtyAdapter();
    const manager = new TerminalManager(testConfig(), adapter);
    const terminal = await manager.createTerminal({ cols: 80, rows: 24 });
    const pty = adapter.processes[0]!;

    manager.resizeTerminal(terminal.id, 20, 24);
    // Cursor addressed past the new right edge: a 20-col mirror clamps to col 20 (19 cells forward),
    // while a stale 80-col mirror would place it at col 30 (29 cells forward).
    pty.emitData('\x1b[1;30HX');

    const attachment = await manager.attachTerminal(terminal.id, () => undefined, { replay: false });

    const snapshot = attachment!.output.join('');
    expect(snapshot).toContain('\x1b[19CX');
    expect(snapshot).not.toContain('\x1b[29CX');
  });

  it('drops mirror writes without crashing and keeps publishing live output when the mirror overflows', async () => {
    const adapter = new FakePtyAdapter();
    const manager = new TerminalManager(testConfig(), adapter);
    const terminal = await manager.createTerminal();
    const pty = adapter.processes[0]!;
    const received: string[] = [];
    await manager.attachTerminal(
      terminal.id,
      (message) => {
        if (message.type === 'output') {
          received.push(message.data);
        }
      },
      { replay: false }
    );
    const writeSpy = vi.spyOn(HeadlessTerminalCtor.prototype, 'write');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      writeSpy
        .mockImplementationOnce(() => {
          throw mirrorOverflowError();
        })
        .mockImplementationOnce(() => {
          throw mirrorOverflowError();
        });

      expect(() => pty.emitData('dropped-1')).not.toThrow();
      expect(() => pty.emitData('dropped-2')).not.toThrow();
      pty.emitData('recovered');

      expect(received).toEqual(['dropped-1', 'dropped-2', 'recovered']);
      // One log per overflow episode, not per dropped chunk.
      expect(errorSpy).toHaveBeenCalledTimes(1);

      writeSpy.mockImplementationOnce(() => {
        throw mirrorOverflowError();
      });
      pty.emitData('dropped-3');
      expect(errorSpy).toHaveBeenCalledTimes(2);

      const attachment = await manager.attachTerminal(terminal.id, () => undefined, { replay: false });
      expect(attachment).not.toBeNull();
      const snapshot = attachment!.output.join('');
      expect(snapshot).toContain('recovered');
      expect(snapshot).not.toContain('dropped-1');
    } finally {
      writeSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it('still returns a snapshot when the attach flush write overflows the mirror', async () => {
    const adapter = new FakePtyAdapter();
    const manager = new TerminalManager(testConfig(), adapter);
    const terminal = await manager.createTerminal();
    const pty = adapter.processes[0]!;
    pty.emitData('kept-content');
    const first = await manager.attachTerminal(terminal.id, () => undefined, { replay: false });
    first!.dispose();

    const writeSpy = vi.spyOn(HeadlessTerminalCtor.prototype, 'write');
    try {
      writeSpy.mockImplementationOnce(() => {
        throw mirrorOverflowError();
      });
      const received: string[] = [];
      const attachment = await manager.attachTerminal(
        terminal.id,
        (message) => {
          if (message.type === 'output') {
            received.push(message.data);
          }
        },
        { replay: false }
      );

      expect(attachment).not.toBeNull();
      expect(attachment!.output.join('')).toContain('kept-content');
      pty.emitData('live-after-overflow');
      expect(received).toEqual(['live-after-overflow']);
    } finally {
      writeSpy.mockRestore();
    }
  });

  it('delivers chunks that arrive during the attach flush exactly once', async () => {
    const adapter = new FakePtyAdapter();
    const manager = new TerminalManager(testConfig(), adapter);
    const terminal = await manager.createTerminal({ cols: 80, rows: 24 });
    const pty = adapter.processes[0]!;

    pty.emitData('before-attach\r\n');
    const live: string[] = [];
    const attachPromise = manager.attachTerminal(
      terminal.id,
      (message) => {
        if (message.type === 'output') {
          live.push(message.data);
        }
      },
      { replay: false }
    );
    // Chunks arriving during the flush window. The big chunk forces xterm's 12ms parse budget to
    // break the write batch between the flush sentinel and the marker, exposing snapshot/live races.
    pty.emitData(`${'x'.repeat(8_000_000)}\r\n`);
    pty.emitData('during-marker');
    const attachment = await attachPromise;
    pty.emitData('post-attach');

    expect(attachment).not.toBeNull();
    const snapshot = attachment!.output.join('');
    const liveData = live.join('');
    expect(countOccurrences(snapshot, 'during-marker') + countOccurrences(liveData, 'during-marker')).toBe(1);
    expect(countOccurrences(snapshot, 'post-attach') + countOccurrences(liveData, 'post-attach')).toBe(1);
    expect(snapshot).toContain('before-attach');
  });

  it('bounds oversized attach snapshots by reducing serialized scrollback', async () => {
    const adapter = new FakePtyAdapter();
    const manager = new TerminalManager(testConfig(), adapter, { maxSnapshotLength: 4096 });
    const terminal = await manager.createTerminal({ cols: 80, rows: 24 });
    const pty = adapter.processes[0]!;
    for (let line = 0; line < 2000; line += 1) {
      pty.emitData(`\x1b[38;5;${(line % 200) + 16}mscroll-line-${String(line).padStart(4, '0')}\x1b[0m\r\n`);
    }

    const attachment = await manager.attachTerminal(terminal.id, () => undefined, { replay: false });

    expect(attachment).not.toBeNull();
    const snapshot = attachment!.output.join('');
    expect(snapshot).toContain('scroll-line-1999');
    expect(snapshot).not.toContain('scroll-line-0100');
    expect(snapshot.length).toBeLessThanOrEqual(4096);
  });

  it('routes input and resize to the PTY', async () => {
    const adapter = new FakePtyAdapter();
    const manager = new TerminalManager(testConfig(), adapter);
    const terminal = await manager.createTerminal();
    const pty = adapter.processes[0]!;

    manager.writeToTerminal(terminal.id, 'echo ok\r');
    manager.resizeTerminal(terminal.id, 100, 40);

    expect(pty.writes).toEqual(['echo ok\r']);
    expect(pty.resizes).toEqual([{ cols: 100, rows: 40 }]);
    expect(manager.getTerminal(terminal.id)).toMatchObject({ cols: 100, rows: 40 });
  });

  it('clamps resize dimensions to safe bounds', async () => {
    const adapter = new FakePtyAdapter();
    const manager = new TerminalManager(testConfig(), adapter);
    const terminal = await manager.createTerminal();
    const pty = adapter.processes[0]!;

    expect(manager.resizeTerminal(terminal.id, 999_999, 999_999)).toBe(true);

    expect(pty.resizes).toEqual([{ cols: 2000, rows: 1000 }]);
    expect(manager.getTerminal(terminal.id)).toMatchObject({ cols: 2000, rows: 1000 });
  });

  it('publishes terminal updates only when resize changes the PTY size', async () => {
    const adapter = new FakePtyAdapter();
    const manager = new TerminalManager(testConfig(), adapter);
    const terminal = await manager.createTerminal();
    const messages: unknown[] = [];
    await manager.attachTerminal(terminal.id, (message) => messages.push(message), { replay: false });

    manager.resizeTerminal(terminal.id, 100, 40);
    manager.resizeTerminal(terminal.id, 100, 40);

    expect(adapter.processes[0]!.resizes).toEqual([{ cols: 100, rows: 40 }]);
    expect(messages).toEqual([
      {
        type: 'terminal_updated',
        terminal: expect.objectContaining({ id: terminal.id, cols: 100, rows: 40 })
      }
    ]);
  });

  it('nudges a running terminal with a two-phase rows jiggle so foreground TUIs receive SIGWINCH', async () => {
    vi.useFakeTimers();
    try {
      const adapter = new FakePtyAdapter();
      const manager = new TerminalManager(testConfig(), adapter);
      const terminal = await manager.createTerminal({ cols: 100, rows: 40 });
      const pty = adapter.processes[0]!;

      expect(manager.nudgeTerminal(terminal.id)).toBe(true);

      // Phase 1 shrinks immediately; the restore happens on a later tick so the two winsize
      // changes cannot coalesce into a single no-op SIGWINCH.
      expect(pty.resizes).toEqual([{ cols: 100, rows: 39 }]);
      expect(manager.getTerminal(terminal.id)).toMatchObject({ cols: 100, rows: 39 });

      await vi.advanceTimersByTimeAsync(50);

      expect(pty.resizes).toEqual([
        { cols: 100, rows: 39 },
        { cols: 100, rows: 40 }
      ]);
      expect(manager.getTerminal(terminal.id)).toMatchObject({ cols: 100, rows: 40 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('skips a new nudge while a nudge restore is still pending', async () => {
    vi.useFakeTimers();
    try {
      const adapter = new FakePtyAdapter();
      const manager = new TerminalManager(testConfig(), adapter);
      const terminal = await manager.createTerminal({ cols: 100, rows: 40 });
      const pty = adapter.processes[0]!;

      expect(manager.nudgeTerminal(terminal.id)).toBe(true);
      expect(manager.nudgeTerminal(terminal.id)).toBe(true);
      expect(pty.resizes).toEqual([{ cols: 100, rows: 39 }]);

      await vi.advanceTimersByTimeAsync(50);
      expect(pty.resizes).toEqual([
        { cols: 100, rows: 39 },
        { cols: 100, rows: 40 }
      ]);

      await vi.advanceTimersByTimeAsync(50);
      expect(pty.resizes).toHaveLength(2);

      expect(manager.nudgeTerminal(terminal.id)).toBe(true);
      expect(pty.resizes).toEqual([
        { cols: 100, rows: 39 },
        { cols: 100, rows: 40 },
        { cols: 100, rows: 39 }
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('skips the nudge restore when another resize lands during the jiggle window', async () => {
    vi.useFakeTimers();
    try {
      const adapter = new FakePtyAdapter();
      const manager = new TerminalManager(testConfig(), adapter);
      const terminal = await manager.createTerminal({ cols: 100, rows: 40 });
      const pty = adapter.processes[0]!;

      expect(manager.nudgeTerminal(terminal.id)).toBe(true);
      expect(manager.resizeTerminal(terminal.id, 120, 50)).toBe(true);

      await vi.advanceTimersByTimeAsync(50);

      expect(pty.resizes).toEqual([
        { cols: 100, rows: 39 },
        { cols: 120, rows: 50 }
      ]);
      expect(manager.getTerminal(terminal.id)).toMatchObject({ cols: 120, rows: 50 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not run the nudge restore after the terminal closes', async () => {
    vi.useFakeTimers();
    try {
      const adapter = new FakePtyAdapter();
      const manager = new TerminalManager(testConfig(), adapter);
      const terminal = await manager.createTerminal({ cols: 100, rows: 40 });
      const pty = adapter.processes[0]!;

      expect(manager.nudgeTerminal(terminal.id)).toBe(true);
      expect(manager.closeTerminal(terminal.id)).toBe(true);

      await vi.advanceTimersByTimeAsync(50);

      expect(pty.resizes).toEqual([{ cols: 100, rows: 39 }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not nudge missing or exited terminals', async () => {
    const adapter = new FakePtyAdapter();
    const manager = new TerminalManager(testConfig(), adapter);
    const terminal = await manager.createTerminal();
    const pty = adapter.processes[0]!;
    pty.emitExit(0);

    expect(manager.nudgeTerminal('missing-terminal')).toBe(false);
    expect(manager.nudgeTerminal(terminal.id)).toBe(false);
    expect(pty.resizes).toEqual([]);
  });

  it('does not nudge terminals with fewer than two rows', async () => {
    const adapter = new FakePtyAdapter();
    const manager = new TerminalManager(testConfig(), adapter);
    const terminal = await manager.createTerminal({ cols: 80, rows: 1 });
    const pty = adapter.processes[0]!;

    expect(manager.nudgeTerminal(terminal.id)).toBe(false);
    expect(pty.resizes).toEqual([]);
    expect(manager.getTerminal(terminal.id)).toMatchObject({ cols: 80, rows: 1 });
  });

  it('does not resolve cwd from PTY output alone', async () => {
    const adapter = new FakePtyAdapter();
    const resolveCwd = vi.fn(async () => '/workspace/root/packages/app');
    const manager = new TerminalManager(testConfig(), adapter, { resolveCwd });
    const terminal = await manager.createTerminal();
    const messages: unknown[] = [];
    await manager.attachTerminal(terminal.id, (message) => messages.push(message), { replay: false });

    adapter.processes[0]!.emitData('\r\n% ');

    expect(resolveCwd).not.toHaveBeenCalled();
    expect(messages).toEqual([{ type: 'output', terminalId: terminal.id, data: '\r\n% ' }]);
    expect(manager.getTerminal(terminal.id)).toMatchObject({ cwd: '/workspace/root', title: 'root' });
  });

  it('publishes a terminal update when requested cwd refresh observes a cwd change', async () => {
    const adapter = new FakePtyAdapter();
    const resolveCwd = vi.fn(async () => '/workspace/root/packages/app');
    const manager = new TerminalManager(testConfig(), adapter, { resolveCwd });
    const terminal = await manager.createTerminal();
    const messages: unknown[] = [];
    await manager.attachTerminal(terminal.id, (message) => messages.push(message), { replay: false });

    await manager.refreshTerminalCwd(terminal.id);

    expect(resolveCwd).toHaveBeenCalledWith(10_000);
    expect(messages).toEqual([
      {
        type: 'terminal_updated',
        terminal: expect.objectContaining({
          id: terminal.id,
          cwd: '/workspace/root/packages/app',
          title: 'app'
        })
      }
    ]);
    expect(manager.getTerminal(terminal.id)).toMatchObject({
      cwd: '/workspace/root/packages/app',
      title: 'app'
    });
  });

  it('kills the PTY only on explicit close', async () => {
    const adapter = new FakePtyAdapter();
    const manager = new TerminalManager(testConfig(), adapter);
    const terminal = await manager.createTerminal();
    const pty = adapter.processes[0]!;

    const attach = await manager.attachTerminal(terminal.id, () => undefined);
    expect(attach).not.toBeNull();
    attach?.dispose();
    expect(pty.killed).toBe(false);

    expect(manager.closeTerminal(terminal.id)).toBe(true);

    expect(pty.killed).toBe(true);
    expect(manager.getTerminal(terminal.id)).toBeNull();
  });

  it('marks a terminal exited when the PTY exits', async () => {
    const adapter = new FakePtyAdapter();
    const manager = new TerminalManager(testConfig(), adapter);
    const terminal = await manager.createTerminal();

    adapter.processes[0]!.emitExit(7);

    expect(manager.getTerminal(terminal.id)).toMatchObject({
      status: 'exited',
      exitCode: 7,
      pid: null
    });
  });

  it('resolves split cwd from the parent process and falls back to the parent cwd', async () => {
    const adapter = new FakePtyAdapter();
    const resolveCwd = vi.fn(async (pid: number) => (pid === 10_000 ? '/workspace/root/packages/app' : null));
    const manager = new TerminalManager(testConfig(), adapter, { resolveCwd });
    const parent = await manager.createTerminal();

    const split = await manager.createTerminal({ parentTerminalId: parent.id });
    resolveCwd.mockResolvedValueOnce(null);
    const fallbackSplit = await manager.createTerminal({ parentTerminalId: parent.id });

    expect(split.cwd).toBe('/workspace/root/packages/app');
    expect(fallbackSplit.cwd).toBe('/workspace/root');
    expect(adapter.spawns.map((spawn) => spawn.cwd)).toEqual([
      '/workspace/root',
      '/workspace/root/packages/app',
      '/workspace/root'
    ]);
  });

  it('resolves upload destinations from the live running PTY cwd', async () => {
    const adapter = new FakePtyAdapter();
    const resolveCwd = vi.fn(async (pid: number) => (pid === 10_000 ? '/workspace/root/live-cwd' : null));
    const manager = new TerminalManager(testConfig(), adapter, { resolveCwd });
    const terminal = await manager.createTerminal();

    const cwd = await manager.resolveTerminalCwd(terminal.id);

    expect(cwd).toBe('/workspace/root/live-cwd');
    expect(resolveCwd).toHaveBeenLastCalledWith(10_000);
  });

  it('fails closed when an upload destination cwd cannot be resolved', async () => {
    const adapter = new FakePtyAdapter();
    const resolveCwd = vi.fn(async () => {
      throw new Error('cwd unavailable');
    });
    const manager = new TerminalManager(testConfig(), adapter, { resolveCwd });
    const terminal = await manager.createTerminal();
    adapter.processes[0]!.emitExit(0);

    await expect(manager.resolveTerminalCwd('missing-terminal')).resolves.toBeNull();
    await expect(manager.resolveTerminalCwd(terminal.id)).resolves.toBeNull();
    expect(resolveCwd).toHaveBeenCalledTimes(0);

    const running = await manager.createTerminal();

    await expect(manager.resolveTerminalCwd(running.id)).resolves.toBeNull();
    expect(resolveCwd).toHaveBeenCalledTimes(1);
  });

  it('closes all active terminals for logout cleanup', async () => {
    const adapter = new FakePtyAdapter();
    const manager = new TerminalManager(testConfig(), adapter);
    await manager.createTerminal();
    await manager.createTerminal();

    manager.closeAll();

    expect(adapter.processes.every((process) => process.killed)).toBe(true);
    expect(manager.listTerminals()).toEqual([]);
  });
});

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function setOrDeleteEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

function captureEnv(keys: string[]): Map<string, string | undefined> {
  return new Map(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(values: Map<string, string | undefined>): void {
  for (const [key, value] of values) {
    setOrDeleteEnv(key, value);
  }
}
