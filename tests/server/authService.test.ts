import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/server/config.js';
import { AuthService } from '../../src/server/auth/authService.js';
import { InMemoryRateLimit } from '../../src/server/auth/rateLimit.js';
import { FileStore } from '../../src/server/storage/fileStore.js';

async function makeAuth(now: () => number = () => Date.UTC(2026, 4, 17, 0, 0, 0)) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'leominal-auth-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    LEOMINAL_STATE_PATH: path.join(dir, 'state.json'),
    LEOMINAL_SESSION_SECRET: 'session-secret-with-enough-length',
    LEOMINAL_SESSION_TTL_SECONDS: '10'
  });
  const store = new FileStore(config.statePath);
  await store.init();
  return { auth: new AuthService(config, store, { now }), store, config };
}

describe('InMemoryRateLimit', () => {
  it('blocks after the configured number of attempts and resets after the window', () => {
    let now = 1_000;
    const limiter = new InMemoryRateLimit({ limit: 2, windowMs: 1_000, now: () => now });

    expect(limiter.consume('password').allowed).toBe(true);
    expect(limiter.consume('password').allowed).toBe(true);
    const blocked = limiter.consume('password');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBe(1_000);

    now = 2_001;
    expect(limiter.consume('password').allowed).toBe(true);
  });
});

describe('AuthService', () => {
  let now: number;

  beforeEach(() => {
    now = Date.UTC(2026, 4, 17, 0, 0, 0);
  });

  it('starts without a password and keeps sessions unauthenticated', async () => {
    const { auth } = await makeAuth(() => now);

    await expect(auth.getSessionStatus(undefined)).resolves.toEqual({
      passwordSet: false,
      authenticated: false,
      expiresAt: null
    });
  });

  it('sets the first password by storing a salted hash instead of the raw password', async () => {
    const { auth, store } = await makeAuth(() => now);

    const session = await auth.setupPassword('correct horse battery staple');
    const state = await store.read();

    expect(session.sessionId).toMatch(/^sess_/);
    expect(session.expiresAt).toBe(new Date(now + 10_000).toISOString());
    expect(state.passwordCredential?.hash).toBeTypeOf('string');
    expect(state.passwordCredential?.salt).toBeTypeOf('string');
    expect(JSON.stringify(state)).not.toContain('correct horse battery staple');
    await expect(auth.validateSession(session.sessionId)).resolves.toBe(true);
  });

  it('rejects replacing an existing password through initial setup', async () => {
    const { auth } = await makeAuth(() => now);
    await auth.setupPassword('correct horse battery staple');

    await expect(auth.setupPassword('new password value')).rejects.toMatchObject({ code: 'PASSWORD_ALREADY_SET' });
  });

  it('logs in with the stored password and rejects wrong passwords', async () => {
    const { auth } = await makeAuth(() => now);
    await auth.setupPassword('correct horse battery staple');

    await expect(auth.loginWithPassword('wrong password')).rejects.toMatchObject({ code: 'INVALID_PASSWORD' });
    const session = await auth.loginWithPassword('correct horse battery staple');

    expect(session.sessionId).toMatch(/^sess_/);
    await expect(auth.getSessionStatus(session.sessionId)).resolves.toMatchObject({
      passwordSet: true,
      authenticated: true,
      expiresAt: new Date(now + 10_000).toISOString()
    });
  });

  it('rate limits repeated bad password attempts', async () => {
    const { auth } = await makeAuth(() => now);
    await auth.setupPassword('correct horse battery staple');

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(auth.loginWithPassword('wrong password')).rejects.toMatchObject({ code: 'INVALID_PASSWORD' });
    }
    await expect(auth.loginWithPassword('wrong password')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('scopes password rate limits by client key', async () => {
    const { auth } = await makeAuth(() => now);
    await auth.setupPassword('correct horse battery staple');

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(auth.loginWithPassword('wrong password', 'client-a')).rejects.toMatchObject({ code: 'INVALID_PASSWORD' });
    }
    await expect(auth.loginWithPassword('wrong password', 'client-a')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await expect(auth.loginWithPassword('wrong password', 'client-b')).rejects.toMatchObject({ code: 'INVALID_PASSWORD' });
  });

  it('expires sessions after the configured TTL', async () => {
    const { auth } = await makeAuth(() => now);
    const session = await auth.setupPassword('correct horse battery staple');

    now += 10_001;

    await expect(auth.validateSession(session.sessionId)).resolves.toBe(false);
    await expect(auth.getSessionStatus(session.sessionId)).resolves.toEqual({
      passwordSet: true,
      authenticated: false,
      expiresAt: null
    });
  });
});
