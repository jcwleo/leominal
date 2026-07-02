import { access, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../src/server/config.js';
import { signFileRootToken } from '../../src/server/files/rootToken.js';
import { buildApp } from '../../src/server/http.js';
import type { FileReadResponse, FileRootResponse } from '../../src/shared/protocol.js';

describe('file routes', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    await app?.close();
    app = null;
  });

  it('rejects unauthenticated file route requests', async () => {
    const built = await buildFileTestApp({ authenticated: false });
    app = built.app;

    const response = await app.inject({
      method: 'POST',
      url: '/api/files/root',
      headers: { origin: allowedOrigin },
      payload: { terminalId: 'terminal-1' }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'unauthorized' });
  });

  it('rejects unauthenticated file operations even with a valid root token', async () => {
    const root = await tempDir('leominal-file-route-unauth-token-');
    await writeFile(path.join(root, 'README.md'), '# hello');
    const built = await buildFileTestApp({ authenticated: false, terminalCwd: root });
    app = built.app;
    const rootToken = signFileRootToken(built.config, {
      terminalId: 'terminal-1',
      rootPath: await realpath(root),
      now: () => new Date(Date.UTC(2026, 4, 20, 7, 0, 0)),
      nonce: () => 'route-test'
    }).rootToken;

    const response = await app.inject({
      method: 'POST',
      url: '/api/files/list',
      headers: { origin: allowedOrigin },
      payload: { rootToken, path: '' }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'unauthorized' });
  });

  it('rejects file route requests without an allowed origin', async () => {
    const built = await buildFileTestApp();
    app = built.app;

    const missingOrigin = await app.inject({
      method: 'POST',
      url: '/api/files/root',
      payload: { terminalId: 'terminal-1' }
    });
    const disallowedOrigin = await app.inject({
      method: 'POST',
      url: '/api/files/root',
      headers: { origin: 'https://evil.example' },
      payload: { terminalId: 'terminal-1' }
    });

    expect(missingOrigin.statusCode).toBe(403);
    expect(missingOrigin.json()).toEqual({ error: 'origin_required' });
    expect(disallowedOrigin.statusCode).toBe(403);
    expect(disallowedOrigin.json()).toEqual({ error: 'origin_not_allowed' });
  });

  it('fails closed when the target terminal is missing or its live cwd is unavailable', async () => {
    const missing = await buildFileTestApp({ terminalExists: false });
    app = missing.app;
    const missingResponse = await app.inject({
      method: 'POST',
      url: '/api/files/root',
      headers: { origin: allowedOrigin },
      payload: { terminalId: 'terminal-1' }
    });
    await app.close();

    const unavailable = await buildFileTestApp({ terminalCwd: null });
    app = unavailable.app;
    const unavailableResponse = await app.inject({
      method: 'POST',
      url: '/api/files/root',
      headers: { origin: allowedOrigin },
      payload: { terminalId: 'terminal-1' }
    });

    expect(missingResponse.statusCode).toBe(404);
    expect(missingResponse.json()).toEqual({ error: 'terminal_not_found' });
    expect(unavailableResponse.statusCode).toBe(409);
    expect(unavailableResponse.json()).toEqual({ error: 'terminal_cwd_unavailable' });
  });

  it('serves authenticated file operations inside a signed terminal root', async () => {
    const root = await tempDir('leominal-file-route-root-');
    await mkdir(path.join(root, 'docs'));
    await writeFile(path.join(root, 'README.md'), '# old');
    const built = await buildFileTestApp({ terminalCwd: root });
    app = built.app;

    const rootResponse = await app.inject({
      method: 'POST',
      url: '/api/files/root',
      headers: { origin: allowedOrigin },
      payload: { terminalId: 'terminal-1' }
    });
    const rootBody = rootResponse.json<FileRootResponse>();
    const readResponse = await postFile('/api/files/read', { rootToken: rootBody.rootToken, path: 'README.md' });
    const readBody = readResponse.json<FileReadResponse>();
    const writeResponse = await postFile('/api/files/write', {
      rootToken: rootBody.rootToken,
      path: 'README.md',
      content: '# newer',
      expectedVersion: readBody.version
    });
    const staleWriteResponse = await postFile('/api/files/write', {
      rootToken: rootBody.rootToken,
      path: 'README.md',
      content: '# stale',
      expectedVersion: readBody.version
    });
    const createResponse = await postFile('/api/files/create', { rootToken: rootBody.rootToken, path: 'docs/todo.txt', kind: 'file' });
    const moveResponse = await postFile('/api/files/move', {
      rootToken: rootBody.rootToken,
      sourcePath: 'docs/todo.txt',
      destinationPath: 'docs/done.txt'
    });
    const previewResponse = await postFile('/api/files/delete-preview', { rootToken: rootBody.rootToken, path: 'docs/done.txt' });
    const deleteResponse = await postFile('/api/files/delete', {
      rootToken: rootBody.rootToken,
      path: 'docs/done.txt',
      previewToken: previewResponse.json<{ previewToken: string }>().previewToken
    });

    expect(rootResponse.statusCode).toBe(200);
    expect(rootBody).toEqual({
      rootToken: expect.any(String),
      terminalId: 'terminal-1',
      rootPath: await realpath(root),
      issuedAt: expect.any(String)
    });
    expect(readResponse.statusCode).toBe(200);
    expect(readBody).toEqual({
      path: 'README.md',
      content: '# old',
      language: 'markdown',
      version: expect.objectContaining({ size: 5 })
    });
    expect(writeResponse.statusCode).toBe(200);
    expect(staleWriteResponse.statusCode).toBe(409);
    expect(staleWriteResponse.json()).toEqual({ error: 'file_version_conflict' });
    expect(createResponse.json()).toEqual({ entry: expect.objectContaining({ path: 'docs/todo.txt', kind: 'file' }) });
    expect(moveResponse.json()).toEqual({ entry: expect.objectContaining({ path: 'docs/done.txt', kind: 'file' }) });
    expect(previewResponse.json()).toEqual({
      path: 'docs/done.txt',
      kind: 'file',
      descendantCount: 0,
      previewToken: expect.any(String)
    });
    expect(deleteResponse.statusCode).toBe(200);
    expect(deleteResponse.json()).toEqual({ path: 'docs/done.txt', deleted: true });
    expect(await readFile(path.join(root, 'README.md'), 'utf8')).toBe('# newer');
    await expect(access(path.join(root, 'docs', 'done.txt'))).rejects.toThrow();

    async function postFile(url: string, payload: unknown) {
      return app!.inject({
        method: 'POST',
        url,
        headers: { origin: allowedOrigin },
        payload
      });
    }
  });

  it('rejects invalid root tokens and unsafe paths', async () => {
    const root = await tempDir('leominal-file-route-invalid-');
    const built = await buildFileTestApp({ terminalCwd: root });
    app = built.app;
    const rootResponse = await app.inject({
      method: 'POST',
      url: '/api/files/root',
      headers: { origin: allowedOrigin },
      payload: { terminalId: 'terminal-1' }
    });
    const rootToken = rootResponse.json<FileRootResponse>().rootToken;

    const invalidToken = await app.inject({
      method: 'POST',
      url: '/api/files/list',
      headers: { origin: allowedOrigin },
      payload: { rootToken: 'invalid-token', path: '' }
    });
    const unsafePath = await app.inject({
      method: 'POST',
      url: '/api/files/list',
      headers: { origin: allowedOrigin },
      payload: { rootToken, path: '../escape.txt' }
    });

    expect(invalidToken.statusCode).toBe(401);
    expect(invalidToken.json()).toEqual({ error: 'invalid_root_token' });
    expect(unsafePath.statusCode).toBe(400);
    expect(unsafePath.json()).toEqual({ error: 'invalid_file_path' });
  });

  it('rejects file operations when the token terminal disappears after root creation', async () => {
    const root = await tempDir('leominal-file-route-terminal-gone-');
    await writeFile(path.join(root, 'README.md'), '# hello');
    const built = await buildFileTestApp({ terminalCwd: root });
    app = built.app;
    const rootResponse = await app.inject({
      method: 'POST',
      url: '/api/files/root',
      headers: { origin: allowedOrigin },
      payload: { terminalId: 'terminal-1' }
    });
    const rootToken = rootResponse.json<FileRootResponse>().rootToken;
    built.terminalManager.getTerminal.mockReturnValue(null);

    const response = await app.inject({
      method: 'POST',
      url: '/api/files/list',
      headers: { origin: allowedOrigin },
      payload: { rootToken, path: '' }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'terminal_not_found' });
  });

  it('rejects file operations when the token root no longer matches the live terminal cwd', async () => {
    const root = await tempDir('leominal-file-route-root-changed-');
    const nextRoot = await tempDir('leominal-file-route-root-next-');
    await writeFile(path.join(root, 'README.md'), '# hello');
    const built = await buildFileTestApp({ terminalCwd: root });
    app = built.app;
    const rootResponse = await app.inject({
      method: 'POST',
      url: '/api/files/root',
      headers: { origin: allowedOrigin },
      payload: { terminalId: 'terminal-1' }
    });
    const rootToken = rootResponse.json<FileRootResponse>().rootToken;
    built.terminalManager.resolveTerminalCwd.mockResolvedValue(nextRoot);

    const response = await app.inject({
      method: 'POST',
      url: '/api/files/list',
      headers: { origin: allowedOrigin },
      payload: { rootToken, path: '' }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'terminal_cwd_changed' });
  });

  it('opens an authenticated file in the requested terminal pane with a beginner-friendly editor first', async () => {
    const root = await tempDir('leominal-file-route-open-');
    await writeFile(path.join(root, "space 'quote'.md"), '# hello');
    const built = await buildFileTestApp({ terminalCwd: root });
    app = built.app;
    const rootResponse = await app.inject({
      method: 'POST',
      url: '/api/files/root',
      headers: { origin: allowedOrigin },
      payload: { terminalId: 'terminal-1' }
    });
    const rootToken = rootResponse.json<FileRootResponse>().rootToken;

    const response = await app.inject({
      method: 'POST',
      url: '/api/files/open',
      headers: { origin: allowedOrigin },
      payload: { rootToken, path: "space 'quote'.md", terminalId: 'terminal-2' }
    });
    const quotedPath = `'${path.join(await realpath(root), "space 'quote'.md").replace(/'/g, "'\\''")}'`;

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ opened: true });
    expect(built.terminalManager.writeToTerminal).toHaveBeenCalledWith(
      'terminal-2',
      `nano -- ${quotedPath} || micro -- ${quotedPath} || nvim -- ${quotedPath} || vim -- ${quotedPath} || vi -- ${quotedPath}\r`
    );
  });
});

const allowedOrigin = 'http://127.0.0.1:3107';

interface BuildFileTestAppOptions {
  authenticated?: boolean;
  terminalExists?: boolean;
  terminalCwd?: string | null;
}

async function buildFileTestApp(options: BuildFileTestAppOptions = {}) {
  const staticRoot = await tempDir('leominal-file-route-static-');
  await writeFile(path.join(staticRoot, 'index.html'), '<!doctype html>');
  const terminalCwd = options.terminalCwd === undefined ? await tempDir('leominal-file-route-cwd-') : options.terminalCwd;
  const config = testConfig(staticRoot);
  const authService = {
    requireSession: vi.fn(async () => (options.authenticated === false ? null : { sessionId: 'test-session' }))
  };
  const terminalManager = {
    getTerminal: vi.fn(() =>
      options.terminalExists === false
        ? null
        : {
            id: 'terminal-1',
            title: 'Terminal',
            cwd: '/stale/cwd',
            pid: 1234,
            cols: 80,
            rows: 24,
            createdAt: new Date(0).toISOString(),
            updatedAt: new Date(0).toISOString(),
            status: 'running',
            exitCode: null
          }
    ),
    resolveTerminalCwd: vi.fn(async () => terminalCwd),
    listTerminals: vi.fn(() => []),
    closeTerminal: vi.fn(() => true),
    closeAll: vi.fn(),
    createTerminal: vi.fn(),
    attachTerminal: vi.fn(),
    writeToTerminal: vi.fn(() => true),
    resizeTerminal: vi.fn()
  };
  const fileStore = {
    read: vi.fn(async () => ({ terminalLayout: null })),
    update: vi.fn()
  };
  return { app: await buildApp(config, { authService, terminalManager, fileStore } as never), config, terminalManager };
}

function testConfig(staticRoot: string): AppConfig {
  return {
    host: '127.0.0.1',
    port: 3107,
    workspaceRoot: '/workspace/root',
    shell: '/bin/zsh',
    statePath: '/tmp/leominal-state.json',
    sessionSecret: 'test-session-secret-that-is-long-enough',
    sessionTtlMs: 43_200_000,
    cookieSecure: false,
    allowedOrigins: [allowedOrigin],
    staticRoot,
    isProduction: false,
    uploadMaxFiles: 1024,
    uploadMaxFileBytes: 536_870_912,
    uploadMaxBatchBytes: 2_147_483_648,
    fileListMaxEntries: 2000,
    fileTextMaxBytes: 1_048_576,
    filePreviewMaxBytes: 52_428_800
  };
}

async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}
