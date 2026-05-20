import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../src/server/config.js';
import type { Disposable, PtyAdapter, PtyExit, PtyProcess, PtySpawnOptions } from '../../src/server/terminal/PtyAdapter.js';
import { TerminalManager } from '../../src/server/terminal/TerminalManager.js';

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

  it('replays buffered output on attach and keeps PTYs alive after detach', async () => {
    const adapter = new FakePtyAdapter();
    const manager = new TerminalManager(testConfig(), adapter);
    const terminal = await manager.createTerminal();
    const pty = adapter.processes[0]!;

    pty.emitData('first');

    const firstOutput: string[] = [];
    const firstAttach = manager.attachTerminal(terminal.id, (message) => {
      if (message.type === 'output') {
        firstOutput.push(message.data);
      }
    });
    expect(firstAttach).not.toBeNull();
    pty.emitData('second');
    firstAttach?.dispose();
    pty.emitData('third');

    const secondOutput: string[] = [];
    manager.attachTerminal(terminal.id, (message) => {
      if (message.type === 'output') {
        secondOutput.push(message.data);
      }
    });

    expect(firstOutput).toEqual(['first', 'second']);
    expect(secondOutput).toEqual(['first', 'second', 'third']);
    expect(pty.killed).toBe(false);
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

  it('publishes terminal updates only when resize changes the PTY size', async () => {
    const adapter = new FakePtyAdapter();
    const manager = new TerminalManager(testConfig(), adapter);
    const terminal = await manager.createTerminal();
    const messages: unknown[] = [];
    manager.attachTerminal(terminal.id, (message) => messages.push(message), { replay: false });

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

  it('does not resolve cwd from PTY output alone', async () => {
    const adapter = new FakePtyAdapter();
    const resolveCwd = vi.fn(async () => '/workspace/root/packages/app');
    const manager = new TerminalManager(testConfig(), adapter, { resolveCwd });
    const terminal = await manager.createTerminal();
    const messages: unknown[] = [];
    manager.attachTerminal(terminal.id, (message) => messages.push(message), { replay: false });

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
    manager.attachTerminal(terminal.id, (message) => messages.push(message), { replay: false });

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

    const attach = manager.attachTerminal(terminal.id, () => undefined);
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
