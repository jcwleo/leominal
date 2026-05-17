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
