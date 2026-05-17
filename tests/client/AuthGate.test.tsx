// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AuthGate } from '../../src/client/auth/AuthGate.js';
import type { ApiClient } from '../../src/client/api/client.js';
import type { AuthSessionStatus } from '../../src/shared/types.js';

function api(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    getSession: vi.fn(async () => ({ passwordSet: false, authenticated: false, expiresAt: null })),
    setupPassword: vi.fn(async () => ({ passwordSet: true, authenticated: true, expiresAt: '2026-05-17T00:00:10.000Z' })),
    login: vi.fn(async () => ({ passwordSet: true, authenticated: true, expiresAt: '2026-05-17T00:00:10.000Z' })),
    logout: vi.fn(async () => ({ passwordSet: true, authenticated: false, expiresAt: null })),
    listTerminals: vi.fn(async () => ({ terminals: [] })),
    getTerminalLayout: vi.fn(async () => ({ layout: null, revision: 0, updatedAt: null })),
    saveTerminalLayout: vi.fn(async (request) => ({ layout: request.layout, revision: 1, updatedAt: '2026-05-17T00:00:00.000Z' })),
    createTerminal: vi.fn(),
    closeTerminal: vi.fn(),
    ...overrides
  };
}

describe('AuthGate', () => {
  it('shows initial password setup before a password exists', async () => {
    const client = api();
    render(<AuthGate api={client} />);

    await screen.findByRole('heading', { name: 'Set password' });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse battery staple' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'correct horse battery staple' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set password' }));

    await waitFor(() => expect(client.setupPassword).toHaveBeenCalledWith({ password: 'correct horse battery staple' }));
  });

  it('shows password login after a password exists', async () => {
    const client = api({
      getSession: vi.fn(async (): Promise<AuthSessionStatus> => ({ passwordSet: true, authenticated: false, expiresAt: null }))
    });
    render(<AuthGate api={client} />);

    await screen.findByRole('heading', { name: 'Unlock terminal' });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse battery staple' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));

    await waitFor(() => expect(client.login).toHaveBeenCalledWith({ password: 'correct horse battery staple' }));
  });

  it('keeps the setup form hidden when session status cannot be loaded', async () => {
    const client = api({
      getSession: vi.fn(async () => {
        throw new Error('session unavailable');
      })
    });
    render(<AuthGate api={client} />);

    await screen.findByText('session unavailable');

    expect(screen.queryByRole('button', { name: 'Set password' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry' }).hasAttribute('disabled')).toBe(false);
  });
});
