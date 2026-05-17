import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig, loadDotEnvFile, type ConfigEnv } from '../../src/server/config.js';

function testEnv(overrides: ConfigEnv = {}): ConfigEnv {
  return {
    NODE_ENV: 'test',
    ...overrides
  };
}

describe('loadConfig', () => {
  it('uses private-loopback defaults with test-only secrets', () => {
    const config = loadConfig(testEnv());

    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(3107);
    expect(config.sessionTtlMs).toBe(43_200_000);
    expect(config.cookieSecure).toBe(false);
    expect(config.allowedOrigins).toContain('http://127.0.0.1:3107');
    expect(config.sessionSecret).toBe('test-session-secret-that-is-long-enough');
  });

  it('applies environment overrides', () => {
    const config = loadConfig(
      testEnv({
        LEOMINAL_HOST: '0.0.0.0',
        LEOMINAL_PORT: '4444',
        LEOMINAL_SESSION_TTL_SECONDS: '60',
        LEOMINAL_ALLOWED_ORIGINS: 'https://terminal.example.test, http://vpn.local:4444',
        LEOMINAL_COOKIE_SECURE: 'true',
        LEOMINAL_SESSION_SECRET: 'session-secret-with-enough-length'
      })
    );

    expect(config.host).toBe('0.0.0.0');
    expect(config.port).toBe(4444);
    expect(config.sessionTtlMs).toBe(60_000);
    expect(config.allowedOrigins).toEqual(['https://terminal.example.test', 'http://vpn.local:4444']);
    expect(config.cookieSecure).toBe(true);
  });

  it('expands tilde workspace paths for local env files', () => {
    const config = loadConfig(
      testEnv({
        LEOMINAL_WORKSPACE_ROOT: '~/terminals'
      })
    );

    expect(config.workspaceRoot).toBe(path.join(os.homedir(), 'terminals'));
  });

  it('rejects invalid numeric settings', () => {
    expect(() => loadConfig(testEnv({ LEOMINAL_PORT: '0' }))).toThrow(/LEOMINAL_PORT/);
    expect(() => loadConfig(testEnv({ LEOMINAL_SESSION_TTL_SECONDS: '1.5' }))).toThrow(/LEOMINAL_SESSION_TTL_SECONDS/);
  });

  it('requires secrets outside test mode', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/LEOMINAL_SESSION_SECRET is required/);
  });

  it('loads .env values without overriding existing environment values', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'leominal-env-'));
    const envPath = path.join(dir, '.env');
    await writeFile(
      envPath,
      [
        'LEOMINAL_HOST=0.0.0.0',
        'LEOMINAL_PORT=4999',
        'LEOMINAL_SESSION_SECRET=file-session-secret-with-enough-length'
      ].join('\n')
    );

    const env = loadDotEnvFile(envPath, {
      NODE_ENV: 'production',
      LEOMINAL_PORT: '3111'
    });
    const config = loadConfig(env);

    expect(config.host).toBe('0.0.0.0');
    expect(config.port).toBe(3111);
    expect(config.sessionSecret).toBe('file-session-secret-with-enough-length');
  });

  it('rejects weak or malformed configured secrets', () => {
    expect(() =>
      loadConfig(
        testEnv({
          LEOMINAL_SESSION_SECRET: 'too-short'
        })
      )
    ).toThrow(/LEOMINAL_SESSION_SECRET/);
  });
});
