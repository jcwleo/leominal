import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TerminalLayoutState } from '../../src/shared/types.js';
import { AuthService } from '../../src/server/auth/authService.js';
import { cookieNames } from '../../src/server/auth/cookies.js';
import { loadConfig } from '../../src/server/config.js';
import type { AppConfig } from '../../src/server/config.js';
import { buildApp } from '../../src/server/http.js';
import { registerTerminalRoutes } from '../../src/server/routes/terminalRoutes.js';
import { registerTerminalWebSocket } from '../../src/server/routes/terminalWebSocket.js';
import { FileStore } from '../../src/server/storage/fileStore.js';
import type { PtyAdapter, PtyExit, PtyProcess, PtySpawnOptions, Disposable } from '../../src/server/terminal/PtyAdapter.js';
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
  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly exitListeners = new Set<(event: PtyExit) => void>();
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
}

class FakePtyAdapter implements PtyAdapter {
  readonly processes: FakePtyProcess[] = [];
  readonly spawns: PtySpawnOptions[] = [];

  spawn(options: PtySpawnOptions): PtyProcess {
    this.spawns.push(options);
    const process = new FakePtyProcess(20_000 + this.processes.length);
    this.processes.push(process);
    return process;
  }
}

async function buildTerminalTestApp(authenticated: boolean): Promise<{
  app: FastifyInstance;
  manager: TerminalManager;
  adapter: FakePtyAdapter;
}> {
  const app = Fastify({ logger: false });
  await app.register(fastifyWebsocket);
  const adapter = new FakePtyAdapter();
  const manager = new TerminalManager(testConfig(), adapter);
  const authService = {
    requireSession: async (request: { headers: Record<string, string | string[] | undefined> }) => {
      if (authenticated || request.headers['x-test-auth'] === 'yes') {
        return { sessionId: 'test-session' };
      }
      return null;
    }
  };
  const services = { authService, terminalManager: manager } as never;
  await registerTerminalRoutes(app, testConfig(), services);
  await registerTerminalWebSocket(app, testConfig(), services);
  return { app, manager, adapter };
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
}

function waitForMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    socket.once('message', (data) => resolve(JSON.parse(data.toString())));
  });
}

function waitForClose(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    socket.once('close', (code, reason) => resolve({ code, reason: reason.toString() }));
  });
}

function authCookieHeader(cookies: string[]): string {
  return cookies.map((cookie) => cookie.split(';')[0]).join('; ');
}

function setCookieHeaders(value: string | string[] | number | undefined): string[] {
  if (Array.isArray(value)) {
    return value;
  }
  return typeof value === 'string' ? [value] : [];
}

async function buildAuthTestApp(now: () => number = () => Date.UTC(2026, 4, 17, 0, 0, 0)) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'leominal-routes-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    LEOMINAL_STATE_PATH: path.join(dir, 'state.json'),
    LEOMINAL_STATIC_ROOT: dir,
    LEOMINAL_ALLOWED_ORIGINS: 'http://127.0.0.1:3107',
    LEOMINAL_SESSION_SECRET: 'session-secret-with-enough-length',
    LEOMINAL_SESSION_TTL_SECONDS: '10'
  });
  const store = new FileStore(config.statePath);
  await store.init();
  const authService = new AuthService(config, store, { now });
  const terminalManager = new TerminalManager(config, {} as never);
  const services = { authService, terminalManager, fileStore: store };
  const app = await buildApp(config, services);
  return { app, config, store };
}

async function buildAuthTestAppWithTerminalManager(
  terminalManager: Pick<TerminalManager, 'closeAll'>,
  now: () => number = () => Date.UTC(2026, 4, 17, 0, 0, 0)
) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'leominal-routes-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    LEOMINAL_STATE_PATH: path.join(dir, 'state.json'),
    LEOMINAL_STATIC_ROOT: dir,
    LEOMINAL_ALLOWED_ORIGINS: 'http://127.0.0.1:3107',
    LEOMINAL_SESSION_SECRET: 'session-secret-with-enough-length',
    LEOMINAL_SESSION_TTL_SECONDS: '10'
  });
  const store = new FileStore(config.statePath);
  await store.init();
  const authService = new AuthService(config, store, { now });
  const services = { authService, terminalManager: terminalManager as TerminalManager, fileStore: store };
  const app = await buildApp(config, services);
  return { app, config, store };
}

async function setPasswordAndGetCookie(app: FastifyInstance): Promise<string> {
  const setup = await app.inject({
    method: 'POST',
    url: '/api/auth/password',
    headers: { origin: 'http://127.0.0.1:3107' },
    payload: { password: 'correct horse battery staple' }
  });
  return authCookieHeader(setCookieHeaders(setup.headers['set-cookie']));
}

function terminalLayout(tabTitle = 'Shell'): TerminalLayoutState {
  return {
    activeWorkspaceId: 'workspace-1',
    workspaces: [
      {
        id: 'workspace-1',
        title: 'Main',
        activeTabId: 'tab-1',
        tabs: [
          {
            id: 'tab-1',
            title: tabTitle,
            activeTerminalId: 'terminal-1',
            root: {
              type: 'split',
              direction: 'vertical',
              ratio: 0.5,
              first: { type: 'pane', terminalId: 'terminal-1' },
              second: { type: 'pane', terminalId: 'terminal-2' }
            }
          }
        ]
      }
    ]
  };
}

describe('terminal routes', () => {
  let openApps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(openApps.map((app) => app.close()));
    openApps = [];
  });

  it('rejects unauthenticated terminal HTTP requests', async () => {
    const { app } = await buildTerminalTestApp(false);
    openApps.push(app);

    const response = await app.inject({ method: 'GET', url: '/api/terminals' });

    expect(response.statusCode).toBe(401);
  });

  it('creates, lists, and closes terminals over authenticated HTTP routes', async () => {
    const { app, adapter } = await buildTerminalTestApp(true);
    openApps.push(app);

    const create = await app.inject({
      method: 'POST',
      url: '/api/terminals',
      headers: { origin: 'http://127.0.0.1:3107' },
      payload: { cols: 100, rows: 40 }
    });
    const created = create.json();
    const list = await app.inject({ method: 'GET', url: '/api/terminals' });
    const close = await app.inject({
      method: 'DELETE',
      url: `/api/terminals/${created.terminal.id}`,
      headers: { origin: 'http://127.0.0.1:3107' }
    });

    expect(create.statusCode).toBe(201);
    expect(created.terminal).toMatchObject({ cols: 100, rows: 40, cwd: '/workspace/root' });
    expect(list.json()).toEqual({ terminals: [created.terminal] });
    expect(close.statusCode).toBe(204);
    expect(adapter.processes[0]!.killed).toBe(true);
  });

  it('rejects mutating terminal HTTP requests from disallowed origins', async () => {
    const { app } = await buildTerminalTestApp(true);
    openApps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/terminals',
      headers: { origin: 'https://evil.example' },
      payload: { cols: 80, rows: 24 }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'origin_not_allowed' });
  });

  it('rejects mutating terminal HTTP requests without an origin header', async () => {
    const { app } = await buildTerminalTestApp(true);
    openApps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/terminals',
      payload: { cols: 80, rows: 24 }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'origin_required' });
  });

  it('rejects unauthenticated terminal WebSocket connections', async () => {
    const { app } = await buildTerminalTestApp(false);
    openApps.push(app);
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('missing app address');
    }

    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/terminals/missing/ws`, {
      headers: { origin: 'http://127.0.0.1:3107' }
    });
    const closed = await waitForClose(socket);

    expect(closed).toMatchObject({ code: 1008 });
  });

  it('attaches authenticated WebSockets, replays output, routes input and resize, and keeps PTY alive on disconnect', async () => {
    const { app, manager, adapter } = await buildTerminalTestApp(true);
    openApps.push(app);
    const terminal = await manager.createTerminal();
    const refreshCwd = vi.spyOn(manager, 'refreshTerminalCwd');
    adapter.processes[0]!.emitData('boot');
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('missing app address');
    }

    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/terminals/${terminal.id}/ws`, {
      headers: { 'x-test-auth': 'yes', origin: 'http://127.0.0.1:3107' }
    });
    const snapshotPromise = waitForMessage(socket);
    await waitForOpen(socket);
    const snapshot = await snapshotPromise;
    socket.send(JSON.stringify({ type: 'input', terminalId: terminal.id, data: 'pwd\r' }));
    socket.send(JSON.stringify({ type: 'refresh_cwd', terminalId: terminal.id }));
    socket.send(JSON.stringify({ type: 'resize', terminalId: terminal.id, cols: 111, rows: 31 }));
    const terminalUpdate = await waitForMessage(socket);
    const outputPromise = waitForMessage(socket);
    adapter.processes[0]!.emitData('live');
    const output = await outputPromise;
    const closePromise = waitForClose(socket);
    socket.close();
    await closePromise;

    expect(snapshot).toMatchObject({ type: 'snapshot', output: ['boot'] });
    expect(terminalUpdate).toMatchObject({ type: 'terminal_updated', terminal: { id: terminal.id, cols: 111, rows: 31 } });
    expect(output).toEqual({ type: 'output', terminalId: terminal.id, data: 'live' });
    expect(refreshCwd).toHaveBeenCalledWith(terminal.id);
    expect(adapter.processes[0]!.writes).toEqual(['pwd\r']);
    expect(adapter.processes[0]!.resizes).toEqual([{ cols: 111, rows: 31 }]);
    expect(adapter.processes[0]!.killed).toBe(false);
  });

  it('rejects authenticated terminal WebSockets from disallowed origins', async () => {
    const { app, manager } = await buildTerminalTestApp(true);
    openApps.push(app);
    const terminal = await manager.createTerminal();
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('missing app address');
    }

    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/terminals/${terminal.id}/ws`, {
      headers: {
        'x-test-auth': 'yes',
        origin: 'https://evil.example'
      }
    });
    const closed = await waitForClose(socket);

    expect(closed).toMatchObject({ code: 1008, reason: 'origin not allowed' });
  });

  it('rejects authenticated terminal WebSockets without an origin header', async () => {
    const { app, manager } = await buildTerminalTestApp(true);
    openApps.push(app);
    const terminal = await manager.createTerminal();
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('missing app address');
    }

    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/terminals/${terminal.id}/ws`, {
      headers: { 'x-test-auth': 'yes' }
    });
    const closed = await waitForClose(socket);

    expect(closed).toMatchObject({ code: 1008, reason: 'origin required' });
  });

  it('accepts WebSocket authentication from the real auth session cookies', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'leominal-terminal-routes-'));
    const config = loadConfig({
      NODE_ENV: 'test',
      LEOMINAL_STATE_PATH: path.join(dir, 'state.json'),
      LEOMINAL_STATIC_ROOT: dir,
      LEOMINAL_ALLOWED_ORIGINS: 'http://127.0.0.1:3107',
      LEOMINAL_SESSION_SECRET: 'session-secret-with-enough-length',
      LEOMINAL_SESSION_TTL_SECONDS: '10'
    });
    const store = new FileStore(config.statePath);
    await store.init();
    const fixedNow = Date.UTC(2026, 4, 17, 0, 0, 0);
    const authService = new AuthService(config, store, { now: () => fixedNow });
    const adapter = new FakePtyAdapter();
    const manager = new TerminalManager(config, adapter);
    const services = { authService, terminalManager: manager, fileStore: store };
    const app = await buildApp(config, services);
    openApps.push(app);

    const setup = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      headers: { origin: 'http://127.0.0.1:3107' },
      payload: { password: 'correct horse battery staple' }
    });
    const cookie = authCookieHeader(setCookieHeaders(setup.headers['set-cookie']));
    const terminal = await manager.createTerminal();
    adapter.processes[0]!.emitData('ready');
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('missing app address');
    }

    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/terminals/${terminal.id}/ws`, {
      headers: { cookie, origin: 'http://127.0.0.1:3107' }
    });
    const snapshotPromise = waitForMessage(socket);
    await waitForOpen(socket);
    const snapshot = await snapshotPromise;
    const closePromise = waitForClose(socket);
    socket.close();
    await closePromise;

    expect(snapshot).toMatchObject({ type: 'snapshot', output: ['ready'] });
  });
});

describe('static app shell routes', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    await app?.close();
    app = null;
  });

  it('serves the app shell without browser storage caching', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'leominal-static-'));
    await writeFile(path.join(dir, 'index.html'), '<!doctype html><div id="root"></div>');
    const config = loadConfig({
      NODE_ENV: 'test',
      LEOMINAL_STATE_PATH: path.join(dir, 'state.json'),
      LEOMINAL_STATIC_ROOT: dir,
      LEOMINAL_ALLOWED_ORIGINS: 'http://127.0.0.1:3107',
      LEOMINAL_SESSION_SECRET: 'session-secret-with-enough-length'
    });
    const store = new FileStore(config.statePath);
    await store.init();
    const authService = new AuthService(config, store);
    const terminalManager = new TerminalManager(config, {} as never);
    app = await buildApp(config, { authService, terminalManager, fileStore: store });

    const response = await app.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
  });
});

describe('terminal layout routes', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    await app?.close();
    app = null;
  });

  it('rejects unauthenticated terminal layout reads', async () => {
    ({ app } = await buildAuthTestApp());

    const response = await app.inject({ method: 'GET', url: '/api/terminal-layout' });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'unauthorized' });
  });

  it('returns empty terminal layout metadata for authenticated sessions', async () => {
    ({ app } = await buildAuthTestApp());
    const cookie = await setPasswordAndGetCookie(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/terminal-layout',
      headers: { cookie }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ layout: null, revision: 0, updatedAt: null });
  });

  it('rejects unauthenticated terminal layout updates', async () => {
    ({ app } = await buildAuthTestApp());

    const response = await app.inject({
      method: 'PUT',
      url: '/api/terminal-layout',
      headers: { origin: 'http://127.0.0.1:3107' },
      payload: { layout: terminalLayout(), baseRevision: 0 }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'unauthorized' });
  });

  it('rejects terminal layout updates from disallowed origins', async () => {
    ({ app } = await buildAuthTestApp());
    const cookie = await setPasswordAndGetCookie(app);

    const response = await app.inject({
      method: 'PUT',
      url: '/api/terminal-layout',
      headers: { cookie, origin: 'https://evil.example' },
      payload: { layout: terminalLayout(), baseRevision: 0 }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'origin_not_allowed' });
  });

  it('rejects terminal layout updates without an origin header', async () => {
    ({ app } = await buildAuthTestApp());
    const cookie = await setPasswordAndGetCookie(app);

    const response = await app.inject({
      method: 'PUT',
      url: '/api/terminal-layout',
      headers: { cookie },
      payload: { layout: terminalLayout(), baseRevision: 0 }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'origin_required' });
  });

  it('rejects malformed terminal layout update payloads', async () => {
    ({ app } = await buildAuthTestApp());
    const cookie = await setPasswordAndGetCookie(app);

    const response = await app.inject({
      method: 'PUT',
      url: '/api/terminal-layout',
      headers: { cookie, origin: 'http://127.0.0.1:3107' },
      payload: {
        layout: {
          activeWorkspaceId: 'workspace-1',
          workspaces: 'not-an-array'
        },
        baseRevision: 0
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_terminal_layout' });
  });

  it('persists valid terminal layout updates with revision metadata', async () => {
    ({ app } = await buildAuthTestApp());
    const cookie = await setPasswordAndGetCookie(app);
    const layout = terminalLayout();

    const update = await app.inject({
      method: 'PUT',
      url: '/api/terminal-layout',
      headers: { cookie, origin: 'http://127.0.0.1:3107' },
      payload: { layout, baseRevision: 0 }
    });
    expect(update.statusCode).toBe(200);
    const body = update.json();
    const read = await app.inject({
      method: 'GET',
      url: '/api/terminal-layout',
      headers: { cookie }
    });

    expect(body).toEqual({
      layout,
      revision: 1,
      updatedAt: expect.any(String)
    });
    expect(Date.parse(body.updatedAt)).not.toBeNaN();
    expect(read.json()).toEqual(body);
  });

  it('returns the current terminal layout when baseRevision is stale', async () => {
    ({ app } = await buildAuthTestApp());
    const cookie = await setPasswordAndGetCookie(app);
    const initialLayout = terminalLayout('Shell');
    const staleLayout = terminalLayout('Stale local title');
    const first = await app.inject({
      method: 'PUT',
      url: '/api/terminal-layout',
      headers: { cookie, origin: 'http://127.0.0.1:3107' },
      payload: { layout: initialLayout, baseRevision: 0 }
    });

    const stale = await app.inject({
      method: 'PUT',
      url: '/api/terminal-layout',
      headers: { cookie, origin: 'http://127.0.0.1:3107' },
      payload: { layout: staleLayout, baseRevision: 0 }
    });

    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual(first.json());
  });
});

describe('auth routes', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    await app?.close();
    app = null;
  });

  it('reports anonymous session state and keeps terminal APIs unauthorized', async () => {
    ({ app } = await buildAuthTestApp());

    const session = await app.inject({ method: 'GET', url: '/api/auth/session' });
    const terminals = await app.inject({ method: 'GET', url: '/api/terminals' });

    expect(session.statusCode).toBe(200);
    expect(session.json()).toEqual({ passwordSet: false, authenticated: false, expiresAt: null });
    expect(terminals.statusCode).toBe(401);
  });

  it('rejects mutating auth requests from disallowed origins', async () => {
    ({ app } = await buildAuthTestApp());

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      headers: { origin: 'https://evil.example' },
      payload: { password: 'correct horse battery staple' }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'origin_not_allowed' });
  });

  it('rejects mutating auth requests without an origin header', async () => {
    ({ app } = await buildAuthTestApp());

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      payload: { password: 'correct horse battery staple' }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'origin_required' });
  });

  it('sets the initial password and authenticates with a private session cookie', async () => {
    ({ app } = await buildAuthTestApp());

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      headers: { origin: 'http://127.0.0.1:3107' },
      payload: { password: 'correct horse battery staple' }
    });

    const setCookies = response.cookies.map((cookie) => cookie.name);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ passwordSet: true, authenticated: true, expiresAt: new Date(Date.UTC(2026, 4, 17, 0, 0, 10)).toISOString() });
    expect(setCookies).toContain(cookieNames.session);
    expect(response.cookies.every((cookie) => cookie.httpOnly)).toBe(true);
    expect(response.cookies.every((cookie) => cookie.sameSite === 'Lax')).toBe(true);
  });

  it('clears legacy browser-device cookies when issuing the password session', async () => {
    ({ app } = await buildAuthTestApp());

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      headers: {
        origin: 'http://127.0.0.1:3107',
        cookie: 'leominal_device_id=old-id; leominal_device_token=old-token'
      },
      payload: { password: 'correct horse battery staple' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.cookies.find((cookie) => cookie.name === 'leominal_device_id')?.value).toBe('');
    expect(response.cookies.find((cookie) => cookie.name === 'leominal_device_token')?.value).toBe('');
  });

  it('logs in with the stored password and reports the authenticated session', async () => {
    const fixedNow = Date.UTC(2026, 4, 17, 0, 0, 0);
    const built = await buildAuthTestApp(() => fixedNow);
    app = built.app;
    await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      headers: { origin: 'http://127.0.0.1:3107' },
      payload: { password: 'correct horse battery staple' }
    });

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: {
        origin: 'http://127.0.0.1:3107'
      },
      payload: { password: 'correct horse battery staple' }
    });
    const allCookies = authCookieHeader(setCookieHeaders(login.headers['set-cookie']));
    const session = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { cookie: allCookies }
    });

    expect(login.statusCode).toBe(200);
    expect(login.json()).toEqual({ passwordSet: true, authenticated: true, expiresAt: new Date(fixedNow + 10_000).toISOString() });
    expect(login.cookies.map((cookie) => cookie.name)).toContain(cookieNames.session);
    expect(session.json()).toEqual({ passwordSet: true, authenticated: true, expiresAt: new Date(fixedNow + 10_000).toISOString() });
  });

  it('logs out by clearing the session cookie', async () => {
    const fixedNow = Date.UTC(2026, 4, 17, 0, 0, 0);
    const built = await buildAuthTestApp(() => fixedNow);
    app = built.app;
    const setup = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      headers: { origin: 'http://127.0.0.1:3107' },
      payload: { password: 'correct horse battery staple' }
    });

    const logout = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: {
        origin: 'http://127.0.0.1:3107',
        cookie: authCookieHeader(setCookieHeaders(setup.headers['set-cookie']))
      }
    });

    expect(logout.statusCode).toBe(200);
    expect(logout.json()).toEqual({ passwordSet: true, authenticated: false, expiresAt: null });
    expect(logout.cookies.find((cookie) => cookie.name === cookieNames.session)?.value).toBe('');
  });

  it('does not close active PTYs on unauthenticated logout or failed deregistration', async () => {
    const terminalManager = { closeAll: vi.fn() };
    ({ app } = await buildAuthTestAppWithTerminalManager(terminalManager));
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { origin: 'http://127.0.0.1:3107' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ passwordSet: false, authenticated: false, expiresAt: null });
    expect(terminalManager.closeAll).not.toHaveBeenCalled();
  });
});
