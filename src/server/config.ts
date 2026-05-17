import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface AppConfig {
  host: string;
  port: number;
  workspaceRoot: string;
  shell: string;
  statePath: string;
  sessionSecret: string;
  sessionTtlMs: number;
  cookieSecure: boolean;
  allowedOrigins: string[];
  staticRoot: string;
  isProduction: boolean;
}

export interface ConfigEnv {
  [key: string]: string | undefined;
}

function readInt(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function requireSecret(env: ConfigEnv, name: string, fallbackForTest?: string): string {
  const value = env[name]?.trim();
  const secret = value || (env.NODE_ENV === 'test' ? fallbackForTest : undefined);
  if (!secret) {
    throw new Error(`${name} is required`);
  }
  if (secret.length < 16) {
    throw new Error(`${name} must be at least 16 characters`);
  }
  if (name === 'LEOMINAL_SESSION_SECRET' && secret.length < 24) {
    throw new Error(`${name} must be at least 24 characters`);
  }
  return secret;
}

function resolveShell(env: ConfigEnv): string {
  return env.LEOMINAL_SHELL?.trim() || env.SHELL?.trim() || (os.platform() === 'win32' ? 'powershell.exe' : '/bin/bash');
}

function parseOrigins(raw: string | undefined, host: string, port: number): string[] {
  const configured = raw
    ?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (configured && configured.length > 0) {
    return configured;
  }
  return [`http://${host}:${port}`, `http://localhost:${port}`, `http://127.0.0.1:${port}`];
}

export function loadDotEnvFile(filePath = '.env', baseEnv: ConfigEnv = process.env): ConfigEnv {
  if (!fs.existsSync(filePath)) {
    return baseEnv;
  }
  const parsed: ConfigEnv = { ...baseEnv };
  const content = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const separator = line.indexOf('=');
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    if (!key || parsed[key] !== undefined) {
      continue;
    }
    parsed[key] = stripEnvQuotes(line.slice(separator + 1).trim());
  }
  return parsed;
}

export function loadConfig(env: ConfigEnv = process.env): AppConfig {
  const host = env.LEOMINAL_HOST?.trim() || '127.0.0.1';
  const port = readInt(env.LEOMINAL_PORT, 3107, 'LEOMINAL_PORT');
  const workspaceRoot = path.resolve(expandHomePath(env.LEOMINAL_WORKSPACE_ROOT?.trim() || process.cwd()));
  const statePath = path.resolve(env.LEOMINAL_STATE_PATH?.trim() || '.leominal/state.json');
  const sessionTtlSeconds = readInt(env.LEOMINAL_SESSION_TTL_SECONDS, 43_200, 'LEOMINAL_SESSION_TTL_SECONDS');
  const isProduction = env.NODE_ENV === 'production';
  return {
    host,
    port,
    workspaceRoot,
    shell: resolveShell(env),
    statePath,
    sessionSecret: requireSecret(env, 'LEOMINAL_SESSION_SECRET', 'test-session-secret-that-is-long-enough'),
    sessionTtlMs: sessionTtlSeconds * 1000,
    cookieSecure: env.LEOMINAL_COOKIE_SECURE === 'true' || (isProduction && env.LEOMINAL_COOKIE_SECURE !== 'false'),
    allowedOrigins: parseOrigins(env.LEOMINAL_ALLOWED_ORIGINS, host, port),
    staticRoot: path.resolve(env.LEOMINAL_STATIC_ROOT?.trim() || 'dist/client'),
    isProduction
  };
}

export function isAllowedOrigin(config: Pick<AppConfig, 'allowedOrigins'>, origin: string | undefined): boolean {
  if (!origin) {
    return true;
  }
  return config.allowedOrigins.includes(origin);
}

function stripEnvQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function expandHomePath(value: string): string {
  if (value === '~') {
    return os.homedir();
  }
  if (value.startsWith('~/')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}
