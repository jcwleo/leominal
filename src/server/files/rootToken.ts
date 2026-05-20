import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { AppConfig } from '../config.js';
import type { FileVersion } from '../../shared/protocol.js';

const ROOT_TOKEN_PREFIX = 'frt1';
const DELETE_PREVIEW_TOKEN_PREFIX = 'fdt1';

export interface FileRootTokenPayload {
  version: 1;
  terminalId: string;
  rootPath: string;
  issuedAt: string;
  nonce: string;
}

export interface SignFileRootTokenOptions {
  terminalId: string;
  rootPath: string;
  now?: () => Date;
  nonce?: () => string;
}

export interface SignedFileRootToken {
  rootToken: string;
  issuedAt: string;
}

interface FileDeletePreviewTokenPayload {
  version: 1;
  rootTokenHash: string;
  path: string;
  kind: string;
  descendantCount: number;
  entryVersion: FileVersion;
  issuedAt: string;
  nonce: string;
}

export interface SignFileDeletePreviewTokenOptions {
  rootToken: string;
  path: string;
  kind: string;
  descendantCount: number;
  entryVersion: FileVersion;
  now?: () => Date;
  nonce?: () => string;
}

export class FileRootTokenError extends Error {
  readonly code = 'invalid_root_token';

  constructor() {
    super('Invalid file root token');
  }
}

export class FileDeletePreviewTokenError extends Error {
  readonly code = 'invalid_delete_preview_token';

  constructor() {
    super('Invalid file delete preview token');
  }
}

export function signFileRootToken(config: Pick<AppConfig, 'sessionSecret'>, options: SignFileRootTokenOptions): SignedFileRootToken {
  const issuedAt = (options.now ?? (() => new Date()))().toISOString();
  const payload: FileRootTokenPayload = {
    version: 1,
    terminalId: options.terminalId,
    rootPath: options.rootPath,
    issuedAt,
    nonce: (options.nonce ?? randomUUID)()
  };
  return {
    rootToken: signToken(ROOT_TOKEN_PREFIX, config.sessionSecret, payload),
    issuedAt
  };
}

export function verifyFileRootToken(config: Pick<AppConfig, 'sessionSecret'>, token: string): FileRootTokenPayload {
  const payload = verifyToken(config.sessionSecret, token, ROOT_TOKEN_PREFIX, () => new FileRootTokenError());
  if (!isFileRootTokenPayload(payload)) {
    throw new FileRootTokenError();
  }
  return payload;
}

export function signFileDeletePreviewToken(
  config: Pick<AppConfig, 'sessionSecret'>,
  options: SignFileDeletePreviewTokenOptions
): string {
  const payload: FileDeletePreviewTokenPayload = {
    version: 1,
    rootTokenHash: tokenHash(config.sessionSecret, options.rootToken),
    path: options.path,
    kind: options.kind,
    descendantCount: options.descendantCount,
    entryVersion: options.entryVersion,
    issuedAt: (options.now ?? (() => new Date()))().toISOString(),
    nonce: (options.nonce ?? randomUUID)()
  };
  return signToken(DELETE_PREVIEW_TOKEN_PREFIX, config.sessionSecret, payload);
}

export function verifyFileDeletePreviewToken(
  config: Pick<AppConfig, 'sessionSecret'>,
  token: string,
  rootToken: string,
  expected: Pick<FileDeletePreviewTokenPayload, 'path' | 'kind' | 'descendantCount' | 'entryVersion'>
): void {
  const payload = verifyToken(config.sessionSecret, token, DELETE_PREVIEW_TOKEN_PREFIX, () => new FileDeletePreviewTokenError());
  if (!isFileDeletePreviewTokenPayload(payload)) {
    throw new FileDeletePreviewTokenError();
  }
  if (
    payload.rootTokenHash !== tokenHash(config.sessionSecret, rootToken) ||
    payload.path !== expected.path ||
    payload.kind !== expected.kind ||
    payload.descendantCount !== expected.descendantCount ||
    !sameFileVersion(payload.entryVersion, expected.entryVersion)
  ) {
    throw new FileDeletePreviewTokenError();
  }
}

function signToken(prefix: string, secret: string, payload: unknown): string {
  const payloadSegment = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = signatureSegment(secret, `${prefix}.${payloadSegment}`);
  return `${prefix}.${payloadSegment}.${signature}`;
}

function verifyToken(secret: string, token: string, expectedPrefix: string, error: () => Error): unknown {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== expectedPrefix || !parts[1] || !parts[2]) {
    throw error();
  }
  const signedValue = `${parts[0]}.${parts[1]}`;
  const expectedSignature = signatureSegment(secret, signedValue);
  if (!timingSafeEqualString(parts[2], expectedSignature)) {
    throw error();
  }
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as unknown;
  } catch {
    throw error();
  }
}

function signatureSegment(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function tokenHash(secret: string, token: string): string {
  return createHmac('sha256', secret).update(token).digest('base64url');
}

function timingSafeEqualString(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual, 'base64url');
  const expectedBuffer = Buffer.from(expected, 'base64url');
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function isFileRootTokenPayload(value: unknown): value is FileRootTokenPayload {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const payload = value as Partial<FileRootTokenPayload>;
  return (
    payload.version === 1 &&
    typeof payload.terminalId === 'string' &&
    payload.terminalId.length > 0 &&
    typeof payload.rootPath === 'string' &&
    payload.rootPath.length > 0 &&
    typeof payload.issuedAt === 'string' &&
    typeof payload.nonce === 'string' &&
    payload.nonce.length > 0
  );
}

function isFileDeletePreviewTokenPayload(value: unknown): value is FileDeletePreviewTokenPayload {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const payload = value as Partial<FileDeletePreviewTokenPayload>;
  return (
    payload.version === 1 &&
    typeof payload.rootTokenHash === 'string' &&
    typeof payload.path === 'string' &&
    typeof payload.kind === 'string' &&
    typeof payload.descendantCount === 'number' &&
    Number.isSafeInteger(payload.descendantCount) &&
    payload.descendantCount >= 0 &&
    isFileVersionPayload(payload.entryVersion) &&
    typeof payload.issuedAt === 'string' &&
    typeof payload.nonce === 'string' &&
    payload.nonce.length > 0
  );
}

function isFileVersionPayload(value: unknown): value is FileVersion {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const version = value as Partial<FileVersion>;
  return (
    typeof version.size === 'number' &&
    typeof version.mtimeMs === 'number' &&
    (version.ino === undefined || typeof version.ino === 'number')
  );
}

function sameFileVersion(left: FileVersion, right: FileVersion): boolean {
  return left.size === right.size && left.mtimeMs === right.mtimeMs && (right.ino === undefined || left.ino === right.ino);
}
