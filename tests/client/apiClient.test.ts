import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient, createTerminalWebSocketUrl } from '../../src/client/api/client.js';
import type { TerminalLayoutState } from '../../src/shared/types.js';

describe('client API helper', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('posts initial password setup requests to the auth endpoint', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ passwordSet: true, authenticated: true, expiresAt: null }));
    const client = createApiClient(fetchMock);

    await client.setupPassword({ password: 'correct horse battery staple' });

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ password: 'correct horse battery staple' })
    });
  });

  it('posts password login requests to the auth endpoint', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ passwordSet: true, authenticated: true, expiresAt: null }));
    const client = createApiClient(fetchMock);

    await client.login({ password: 'correct horse battery staple' });

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ password: 'correct horse battery staple' })
    });
  });

  it('creates split terminals with the shared create-terminal request shape', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ terminal: { id: 'term-child' } }));
    const client = createApiClient(fetchMock);

    await client.createTerminal({ parentTerminalId: 'term-parent', cols: 120, rows: 32 });

    expect(fetchMock).toHaveBeenCalledWith('/api/terminals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ parentTerminalId: 'term-parent', cols: 120, rows: 32 })
    });
  });

  it('fetches the persisted terminal layout from the layout endpoint', async () => {
    const response = { layout: null, revision: 7, updatedAt: null };
    const fetchMock = vi.fn(async () => jsonResponse(response));
    const client = createApiClient(fetchMock);

    await expect(client.getTerminalLayout()).resolves.toEqual(response);

    expect(fetchMock).toHaveBeenCalledWith('/api/terminal-layout', { credentials: 'same-origin' });
  });

  it('puts terminal layout updates with the shared request shape', async () => {
    const layout: TerminalLayoutState = {
      activeWorkspaceId: 'workspace-default',
      workspaces: [
        {
          id: 'workspace-default',
          title: 'Leominal',
          activeTabId: 'tab-alpha',
          tabs: [
            {
              id: 'tab-alpha',
              title: 'Alpha',
              activeTerminalId: 'term-alpha',
              root: { type: 'pane', terminalId: 'term-alpha' }
            }
          ]
        }
      ]
    };
    const fetchMock = vi.fn(async () => jsonResponse({ layout, revision: 8, updatedAt: '2026-05-17T00:00:00.000Z' }));
    const client = createApiClient(fetchMock);

    await client.saveTerminalLayout({ layout, baseRevision: 7 });

    expect(fetchMock).toHaveBeenCalledWith('/api/terminal-layout', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ layout, baseRevision: 7 })
    });
  });

  it('posts file explorer root requests with the shared request shape', async () => {
    const response = {
      rootToken: 'root-token',
      terminalId: 'term-alpha',
      rootPath: '/workspace/project',
      issuedAt: '2026-05-20T00:00:00.000Z'
    };
    const fetchMock = vi.fn(async () => jsonResponse(response));
    const client = createApiClient(fetchMock);

    await expect(client.createFileRoot({ terminalId: 'term-alpha' })).resolves.toEqual(response);

    expect(fetchMock).toHaveBeenCalledWith('/api/files/root', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ terminalId: 'term-alpha' })
    });
  });

  it('posts file list, read, write, create, move, and delete requests to file endpoints', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    const client = createApiClient(fetchMock);
    const rootToken = 'root-token';
    const version = { size: 5, mtimeMs: 1000, ino: 2 };

    await client.listFiles({ rootToken, path: 'src' });
    await client.readFile({ rootToken, path: 'README.md' });
    await client.writeFile({ rootToken, path: 'README.md', content: '# title', expectedVersion: version });
    await client.createFileEntry({ rootToken, path: 'notes/todo.md', kind: 'file' });
    await client.moveFileEntry({ rootToken, sourcePath: 'notes/todo.md', destinationPath: 'docs/todo.md' });
    await client.previewDeleteFileEntry({ rootToken, path: 'docs/todo.md' });
    await client.deleteFileEntry({ rootToken, path: 'docs/todo.md', previewToken: 'delete-token' });
    await client.openFileInTerminal({ rootToken, path: 'README.md', terminalId: 'term-created' });

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/files/list', jsonPost({ rootToken, path: 'src' }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/files/read', jsonPost({ rootToken, path: 'README.md' }));
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/files/write',
      jsonPost({ rootToken, path: 'README.md', content: '# title', expectedVersion: version })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/files/create', jsonPost({ rootToken, path: 'notes/todo.md', kind: 'file' }));
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      '/api/files/move',
      jsonPost({ rootToken, sourcePath: 'notes/todo.md', destinationPath: 'docs/todo.md' })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(6, '/api/files/delete-preview', jsonPost({ rootToken, path: 'docs/todo.md' }));
    expect(fetchMock).toHaveBeenNthCalledWith(
      7,
      '/api/files/delete',
      jsonPost({ rootToken, path: 'docs/todo.md', previewToken: 'delete-token' })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(8, '/api/files/open', jsonPost({ rootToken, path: 'README.md', terminalId: 'term-created' }));
  });

  it('posts preview blob requests with same-origin credentials', async () => {
    const blob = new Blob(['preview'], { type: 'image/png' });
    const fetchMock = vi.fn(async () => new Response(blob, { status: 200, headers: { 'content-type': 'image/png' } }));
    const client = createApiClient(fetchMock);

    const response = await client.previewFile({ rootToken: 'root-token', path: 'image.png' });

    expect(await response.text()).toBe('preview');
    expect(fetchMock).toHaveBeenCalledWith('/api/files/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ rootToken: 'root-token', path: 'image.png' })
    });
  });

  it('throws ApiError for non-2xx responses', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: 'unauthorized' }, 401));
    const client = createApiClient(fetchMock);

    await expect(client.listTerminals()).rejects.toMatchObject(new ApiError(401, 'unauthorized'));
  });

  it('builds same-origin WebSocket URLs for terminal attach', () => {
    expect(createTerminalWebSocketUrl('term-alpha', 'http://127.0.0.1:3107/workspace')).toBe(
      'ws://127.0.0.1:3107/api/terminals/term-alpha/ws'
    );
    expect(createTerminalWebSocketUrl('term/a b', 'https://terminal.example.test')).toBe(
      'wss://terminal.example.test/api/terminals/term%2Fa%20b/ws'
    );
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function jsonPost(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body)
  };
}
