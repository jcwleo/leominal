import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TerminalLayoutState } from '../../src/shared/types.js';
import type { StoredPasswordCredential } from '../../src/server/storage/fileStore.js';
import { FileStore } from '../../src/server/storage/fileStore.js';

describe('FileStore', () => {
  it('creates a restrictive JSON state file on init', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'leominal-store-'));
    const statePath = path.join(dir, 'nested', 'state.json');
    const store = new FileStore(statePath);

    await store.init();

    const state = await store.read();
    const fileMode = (await stat(statePath)).mode & 0o777;
    const raw = JSON.parse(await readFile(statePath, 'utf8'));

    expect(state).toEqual({ passwordCredential: null, terminalLayout: null });
    expect(raw).toEqual({ passwordCredential: null, terminalLayout: null });
    expect(fileMode).toBe(0o600);
  });

  it('persists the password credential without storing unrelated auth state', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'leominal-store-'));
    const store = new FileStore(path.join(dir, 'state.json'));
    await store.init();
    const credential = passwordCredential('hash-1');

    await store.update((state) => ({
      ...state,
      passwordCredential: credential
    }));

    const reloaded = new FileStore(path.join(dir, 'state.json'));
    await reloaded.init();

    expect(await reloaded.read()).toEqual({
      passwordCredential: credential,
      terminalLayout: null
    });
  });

  it('persists terminal layout metadata alongside the password credential', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'leominal-store-'));
    const store = new FileStore(path.join(dir, 'state.json'));
    await store.init();
    const credential = passwordCredential('hash-1');
    const layout = terminalLayout();

    await store.update((state) =>
      ({
        ...state,
        passwordCredential: credential,
        terminalLayout: {
          layout,
          revision: 3,
          updatedAt: '2026-05-17T00:00:03.000Z'
        }
      }) as never
    );

    const reloaded = new FileStore(path.join(dir, 'state.json'));
    await reloaded.init();

    expect(await reloaded.read()).toEqual({
      passwordCredential: credential,
      terminalLayout: {
        layout,
        revision: 3,
        updatedAt: '2026-05-17T00:00:03.000Z'
      }
    });
  });

  it('normalizes legacy browser-registration state to passwordless state', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'leominal-store-'));
    const statePath = path.join(dir, 'state.json');
    await writeFile(
      statePath,
      JSON.stringify({
        registeredDevices: [
          {
            id: 'device-1',
            label: 'Laptop',
            tokenHash: 'hash',
            createdAt: '2026-05-17T00:00:00.000Z',
            lastSeenAt: null
          }
        ]
      }),
      'utf8'
    );

    const store = new FileStore(statePath);

    expect(await store.read()).toEqual({ passwordCredential: null, terminalLayout: null });
  });

  it('normalizes legacy password-only state to an empty terminal layout slot', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'leominal-store-'));
    const statePath = path.join(dir, 'state.json');
    const credential = passwordCredential('hash-1');
    await writeFile(
      statePath,
      JSON.stringify({
        passwordCredential: credential
      }),
      'utf8'
    );

    const store = new FileStore(statePath);

    expect(await store.read()).toEqual({ passwordCredential: credential, terminalLayout: null });
  });

  it('drops malformed terminal layout state without dropping the password credential', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'leominal-store-'));
    const statePath = path.join(dir, 'state.json');
    const credential = passwordCredential('hash-1');
    await writeFile(
      statePath,
      JSON.stringify({
        passwordCredential: credential,
        terminalLayout: {
          layout: { activeWorkspaceId: 'workspace-1', workspaces: 'not-an-array' },
          revision: 2,
          updatedAt: '2026-05-17T00:00:02.000Z'
        }
      }),
      'utf8'
    );

    const store = new FileStore(statePath);

    expect(await store.read()).toEqual({ passwordCredential: credential, terminalLayout: null });
  });

  it('serializes overlapping updates so concurrent password writes do not lose state', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'leominal-store-'));
    const store = new FileStore(path.join(dir, 'state.json'));
    await store.init();

    let firstUpdaterEntered: (() => void) | undefined;
    let releaseFirstUpdater: (() => void) | undefined;
    const firstEntered = new Promise<void>((resolve) => {
      firstUpdaterEntered = resolve;
    });
    const releaseFirst = new Promise<void>((resolve) => {
      releaseFirstUpdater = resolve;
    });

    const first = store.update(async (state) => {
      firstUpdaterEntered?.();
      await releaseFirst;
      return {
        ...state,
        passwordCredential: passwordCredential('hash-1')
      };
    });

    await firstEntered;
    const second = store.update((state) => ({
      ...state,
      passwordCredential: {
        ...(state.passwordCredential ?? passwordCredential('missing')),
        hash: `${state.passwordCredential?.hash ?? 'missing'}-2`,
        updatedAt: '2026-05-17T00:00:01.000Z'
      }
    }));

    await new Promise((resolve) => setTimeout(resolve, 20));
    releaseFirstUpdater?.();
    await Promise.all([first, second]);

    expect((await store.read()).passwordCredential?.hash).toBe('hash-1-2');
  });
});

function terminalLayout(): TerminalLayoutState {
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
            title: 'Shell',
            activeTerminalId: 'terminal-1',
            root: {
              type: 'split',
              direction: 'horizontal',
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

function passwordCredential(hash: string): StoredPasswordCredential {
  return {
    algorithm: 'scrypt',
    hash,
    salt: 'salt',
    createdAt: '2026-05-17T00:00:00.000Z',
    updatedAt: '2026-05-17T00:00:00.000Z'
  };
}
