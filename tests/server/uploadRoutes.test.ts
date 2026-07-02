import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../src/server/config.js';
import { buildApp } from '../../src/server/http.js';
import type { UploadManifest } from '../../src/shared/protocol.js';

describe('upload routes', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    await app?.close();
    app = null;
  });

  it('rejects unauthenticated upload requests', async () => {
    const built = await buildUploadTestApp({ authenticated: false });
    app = built.app;
    const upload = multipartUpload({
      manifest: manifest([{ fieldName: 'file-1', relativePath: 'note.txt', size: 5 }]),
      files: [{ fieldName: 'file-1', filename: 'note.txt', content: 'hello' }]
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/uploads',
      headers: { ...upload.headers, origin: 'http://127.0.0.1:3107' },
      payload: upload.body
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'unauthorized' });
  });

  it('rejects upload requests without an allowed origin', async () => {
    const built = await buildUploadTestApp();
    app = built.app;
    const upload = multipartUpload({
      manifest: manifest([{ fieldName: 'file-1', relativePath: 'note.txt', size: 5 }]),
      files: [{ fieldName: 'file-1', filename: 'note.txt', content: 'hello' }]
    });

    const missingOrigin = await app.inject({
      method: 'POST',
      url: '/api/uploads',
      headers: upload.headers,
      payload: upload.body
    });
    const disallowedOrigin = await app.inject({
      method: 'POST',
      url: '/api/uploads',
      headers: { ...upload.headers, origin: 'https://evil.example' },
      payload: upload.body
    });

    expect(missingOrigin.statusCode).toBe(403);
    expect(missingOrigin.json()).toEqual({ error: 'origin_required' });
    expect(disallowedOrigin.statusCode).toBe(403);
    expect(disallowedOrigin.json()).toEqual({ error: 'origin_not_allowed' });
  });

  it('fails closed when the target terminal is missing or its live cwd is unavailable', async () => {
    const missing = await buildUploadTestApp({ terminalExists: false });
    app = missing.app;
    const upload = multipartUpload({
      manifest: manifest([{ fieldName: 'file-1', relativePath: 'note.txt', size: 5 }]),
      files: [{ fieldName: 'file-1', filename: 'note.txt', content: 'hello' }]
    });

    const missingResponse = await app.inject({
      method: 'POST',
      url: '/api/uploads',
      headers: { ...upload.headers, origin: 'http://127.0.0.1:3107' },
      payload: upload.body
    });
    await app.close();

    const unavailable = await buildUploadTestApp({ terminalCwd: null });
    app = unavailable.app;
    const unavailableResponse = await app.inject({
      method: 'POST',
      url: '/api/uploads',
      headers: { ...upload.headers, origin: 'http://127.0.0.1:3107' },
      payload: upload.body
    });

    expect(missingResponse.statusCode).toBe(404);
    expect(missingResponse.json()).toEqual({ error: 'terminal_not_found' });
    expect(unavailableResponse.statusCode).toBe(409);
    expect(unavailableResponse.json()).toEqual({ error: 'terminal_cwd_unavailable' });
  });

  it('uploads files into the live terminal cwd with collision-free relative result paths', async () => {
    const uploadRoot = await tempDir('leominal-upload-route-cwd-');
    await writeFile(path.join(uploadRoot, 'note.txt'), 'existing');
    const built = await buildUploadTestApp({ terminalCwd: uploadRoot });
    app = built.app;
    const upload = multipartUpload({
      manifest: manifest([{ fieldName: 'file-1', relativePath: 'note.txt', size: 5 }]),
      files: [{ fieldName: 'file-1', filename: 'note.txt', content: 'hello' }]
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/uploads',
      headers: { ...upload.headers, origin: 'http://127.0.0.1:3107' },
      payload: upload.body
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      destinationCwd: uploadRoot,
      uploaded: 1,
      failed: 0,
      results: [{ relativePath: 'note.txt', savedRelativePath: 'note 2.txt', status: 'uploaded', size: 5 }]
    });
    expect(await readFile(path.join(uploadRoot, 'note.txt'), 'utf8')).toBe('existing');
    expect(await readFile(path.join(uploadRoot, 'note 2.txt'), 'utf8')).toBe('hello');
    expect(JSON.stringify(response.json().results)).not.toContain(uploadRoot);
  });

  it('preserves dropped folder paths under the destination cwd', async () => {
    const uploadRoot = await tempDir('leominal-upload-route-folder-');
    const built = await buildUploadTestApp({ terminalCwd: uploadRoot });
    app = built.app;
    const upload = multipartUpload({
      manifest: manifest([
        { fieldName: 'file-1', relativePath: 'project/src/index.ts', size: 13 },
        { fieldName: 'file-2', relativePath: 'project/README.md', size: 6 }
      ]),
      files: [
        { fieldName: 'file-1', filename: 'index.ts', content: 'console.log()' },
        { fieldName: 'file-2', filename: 'README.md', content: 'readme' }
      ]
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/uploads',
      headers: { ...upload.headers, origin: 'http://127.0.0.1:3107' },
      payload: upload.body
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().results).toEqual([
      { relativePath: 'project/src/index.ts', savedRelativePath: 'project/src/index.ts', status: 'uploaded', size: 13 },
      { relativePath: 'project/README.md', savedRelativePath: 'project/README.md', status: 'uploaded', size: 6 }
    ]);
    expect(await readFile(path.join(uploadRoot, 'project', 'src', 'index.ts'), 'utf8')).toBe('console.log()');
    expect(await readFile(path.join(uploadRoot, 'project', 'README.md'), 'utf8')).toBe('readme');
  });

  it('reports unsafe-path partial failures without blocking safe files', async () => {
    const uploadRoot = await tempDir('leominal-upload-route-partial-');
    const built = await buildUploadTestApp({ terminalCwd: uploadRoot });
    app = built.app;
    const upload = multipartUpload({
      manifest: manifest([
        { fieldName: 'file-1', relativePath: 'ok.txt', size: 2 },
        { fieldName: 'file-2', relativePath: '../escape.txt', size: 6 }
      ]),
      files: [
        { fieldName: 'file-1', filename: 'ok.txt', content: 'ok' },
        { fieldName: 'file-2', filename: 'escape.txt', content: 'escape' }
      ]
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/uploads',
      headers: { ...upload.headers, origin: 'http://127.0.0.1:3107' },
      payload: upload.body
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      destinationCwd: uploadRoot,
      uploaded: 1,
      failed: 1,
      results: [
        { relativePath: 'ok.txt', savedRelativePath: 'ok.txt', status: 'uploaded', size: 2 },
        { relativePath: '../escape.txt', status: 'failed', error: 'unsafe_relative_path' }
      ]
    });
    expect(await readFile(path.join(uploadRoot, 'ok.txt'), 'utf8')).toBe('ok');
    await expect(access(path.resolve(uploadRoot, '..', 'escape.txt'))).rejects.toThrow();
  });

  it('does not write files when a file part arrives before the manifest', async () => {
    const uploadRoot = await tempDir('leominal-upload-route-order-');
    const built = await buildUploadTestApp({ terminalCwd: uploadRoot });
    app = built.app;
    const upload = multipartUpload({
      manifest: manifest([{ fieldName: 'file-1', relativePath: 'early.txt', size: 5 }]),
      files: [{ fieldName: 'file-1', filename: 'early.txt', content: 'early' }],
      manifestFirst: false
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/uploads',
      headers: { ...upload.headers, origin: 'http://127.0.0.1:3107' },
      payload: upload.body
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'manifest_required' });
    await expect(access(path.join(uploadRoot, 'early.txt'))).rejects.toThrow();
  });

  it('removes files created by the upload when multipart parsing later fails', async () => {
    const uploadRoot = await tempDir('leominal-upload-route-abort-');
    const built = await buildUploadTestApp({ terminalCwd: uploadRoot, uploadMaxFiles: 2 });
    app = built.app;
    const upload = multipartUpload({
      manifest: manifest([{ fieldName: 'file-1', relativePath: 'created.txt', size: 7 }]),
      files: [
        { fieldName: 'file-1', filename: 'created.txt', content: 'created' },
        { fieldName: 'extra-1', filename: 'extra-1.txt', content: 'ignored' },
        { fieldName: 'extra-2', filename: 'extra-2.txt', content: 'limit' }
      ]
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/uploads',
      headers: { ...upload.headers, origin: 'http://127.0.0.1:3107' },
      payload: upload.body
    });

    expect(response.statusCode).toBe(413);
    await expect(access(path.join(uploadRoot, 'created.txt'))).rejects.toThrow();
  });
});

interface BuildUploadTestAppOptions {
  authenticated?: boolean;
  terminalExists?: boolean;
  terminalCwd?: string | null;
  uploadMaxFiles?: number;
}

async function buildUploadTestApp(options: BuildUploadTestAppOptions = {}) {
  const staticRoot = await tempDir('leominal-upload-static-');
  await mkdir(staticRoot, { recursive: true });
  await writeFile(path.join(staticRoot, 'index.html'), '<!doctype html>');
  const terminalCwd = options.terminalCwd === undefined ? await tempDir('leominal-upload-cwd-') : options.terminalCwd;
  const config = testConfig(staticRoot, options.uploadMaxFiles === undefined ? {} : { uploadMaxFiles: options.uploadMaxFiles });
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
    writeToTerminal: vi.fn(),
    resizeTerminal: vi.fn()
  };
  const fileStore = {
    read: vi.fn(async () => ({ terminalLayout: null })),
    update: vi.fn()
  };
  return { app: await buildApp(config, { authService, terminalManager, fileStore } as never), config, terminalManager };
}

function testConfig(staticRoot: string, overrides: Partial<Pick<AppConfig, 'uploadMaxFiles'>> = {}): AppConfig {
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
    staticRoot,
    isProduction: false,
    uploadMaxFiles: overrides.uploadMaxFiles ?? 1024,
    uploadMaxFileBytes: 536_870_912,
    uploadMaxBatchBytes: 2_147_483_648,
    fileListMaxEntries: 2000,
    fileTextMaxBytes: 1_048_576,
    filePreviewMaxBytes: 52_428_800
  };
}

function manifest(entries: UploadManifest['entries']): UploadManifest {
  return { terminalId: 'terminal-1', entries };
}

function multipartUpload(options: {
  manifest: UploadManifest;
  files: Array<{ fieldName: string; filename: string; content: string | Buffer }>;
  manifestFirst?: boolean;
}): { body: Buffer; headers: { 'content-type': string } } {
  const boundary = `leominal-${Math.random().toString(16).slice(2)}`;
  const chunks: Buffer[] = [];
  if (options.manifestFirst !== false) {
    pushManifestPart(chunks, boundary, options.manifest);
  }
  for (const file of options.files) {
    pushFilePart(chunks, boundary, file);
  }
  if (options.manifestFirst === false) {
    pushManifestPart(chunks, boundary, options.manifest);
  }
  pushPart(chunks, `--${boundary}--\r\n`);
  return {
    body: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }
  };
}

function pushManifestPart(chunks: Buffer[], boundary: string, manifestValue: UploadManifest): void {
  pushPart(chunks, `--${boundary}\r\n`);
  pushPart(chunks, 'Content-Disposition: form-data; name="manifest"\r\n');
  pushPart(chunks, 'Content-Type: application/json\r\n\r\n');
  pushPart(chunks, `${JSON.stringify(manifestValue)}\r\n`);
}

function pushFilePart(
  chunks: Buffer[],
  boundary: string,
  file: { fieldName: string; filename: string; content: string | Buffer }
): void {
  pushPart(chunks, `--${boundary}\r\n`);
  pushPart(chunks, `Content-Disposition: form-data; name="${file.fieldName}"; filename="${file.filename}"\r\n`);
  pushPart(chunks, 'Content-Type: application/octet-stream\r\n\r\n');
  chunks.push(Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content));
  pushPart(chunks, '\r\n');
}

function pushPart(chunks: Buffer[], value: string): void {
  chunks.push(Buffer.from(value));
}

async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}
