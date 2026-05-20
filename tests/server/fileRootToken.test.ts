import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../src/server/config.js';
import { FileRootTokenError, signFileRootToken, verifyFileRootToken } from '../../src/server/files/rootToken.js';

describe('file root tokens', () => {
  it('signs a terminal root path into a verifiable token', () => {
    const issuedAt = new Date(Date.UTC(2026, 4, 20, 7, 0, 0));

    const signed = signFileRootToken(testConfig(), {
      terminalId: 'terminal-1',
      rootPath: '/workspace/project',
      now: () => issuedAt,
      nonce: () => 'nonce-1'
    });

    expect(signed.issuedAt).toBe(issuedAt.toISOString());
    expect(verifyFileRootToken(testConfig(), signed.rootToken)).toEqual({
      version: 1,
      terminalId: 'terminal-1',
      rootPath: '/workspace/project',
      issuedAt: issuedAt.toISOString(),
      nonce: 'nonce-1'
    });
  });

  it('rejects malformed, tampered, and wrong-secret tokens', () => {
    const signed = signFileRootToken(testConfig(), {
      terminalId: 'terminal-1',
      rootPath: '/workspace/project',
      now: () => new Date(Date.UTC(2026, 4, 20, 7, 0, 0)),
      nonce: () => 'nonce-1'
    });
    const [prefix, payload, signature] = signed.rootToken.split('.');
    const tamperedPayload = Buffer.from(
      JSON.stringify({
        version: 1,
        terminalId: 'terminal-1',
        rootPath: '/workspace/other',
        issuedAt: new Date(Date.UTC(2026, 4, 20, 7, 0, 0)).toISOString(),
        nonce: 'nonce-1'
      }),
      'utf8'
    ).toString('base64url');

    expect(() => verifyFileRootToken(testConfig(), 'not-a-token')).toThrow(FileRootTokenError);
    expect(() => verifyFileRootToken(testConfig(), `${prefix}.${tamperedPayload}.${signature}`)).toThrow(FileRootTokenError);
    expect(() => verifyFileRootToken(testConfig('different-secret-that-is-long-enough'), signed.rootToken)).toThrow(FileRootTokenError);
    expect(() => verifyFileRootToken(testConfig(), `${prefix}.${payload}.bad-signature`)).toThrow(FileRootTokenError);
  });
});

function testConfig(sessionSecret = 'file-root-token-test-secret'): Pick<AppConfig, 'sessionSecret'> {
  return { sessionSecret };
}
