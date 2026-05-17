import crypto from 'node:crypto';
import { promisify } from 'node:util';
import type { AppConfig } from '../config.js';
import type { FileStore, StoredPasswordCredential } from '../storage/fileStore.js';
import { InMemoryRateLimit } from './rateLimit.js';

const scrypt = promisify(crypto.scrypt);

export class AuthError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
  }
}

export interface PasswordSession {
  sessionId: string;
  expiresAt: string;
}

export interface AuthServiceOptions {
  now?: () => number;
  passwordRateLimit?: InMemoryRateLimit;
}

interface SessionRecord {
  expiresAtMs: number;
}

export class AuthService {
  private readonly now: () => number;
  private readonly passwordRateLimit: InMemoryRateLimit;
  private readonly sessions = new Map<string, SessionRecord>();

  constructor(
    private readonly config: AppConfig,
    private readonly store: FileStore,
    options: AuthServiceOptions = {}
  ) {
    this.now = options.now ?? Date.now;
    this.passwordRateLimit =
      options.passwordRateLimit ??
      new InMemoryRateLimit({
        limit: 5,
        windowMs: 60_000,
        now: this.now
      });
  }

  async setupPassword(password: string): Promise<PasswordSession> {
    this.validatePassword(password);
    const state = await this.store.read();
    if (state.passwordCredential) {
      throw new AuthError('PASSWORD_ALREADY_SET', 'Password is already set', 409);
    }

    const timestamp = new Date(this.now()).toISOString();
    const salt = crypto.randomBytes(16).toString('base64url');
    const credential: StoredPasswordCredential = {
      algorithm: 'scrypt',
      hash: await this.hashPassword(password, salt),
      salt,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await this.store.update((current) => {
      if (current.passwordCredential) {
        throw new AuthError('PASSWORD_ALREADY_SET', 'Password is already set', 409);
      }
      return { ...current, passwordCredential: credential };
    });
    return this.createSession();
  }

  async loginWithPassword(password: string, clientKey = 'default'): Promise<PasswordSession> {
    const credential = (await this.store.read()).passwordCredential;
    if (!credential) {
      throw new AuthError('PASSWORD_NOT_SET', 'Password is not set', 409);
    }

    const rateLimitKey = `password:${clientKey}`;
    const rate = this.passwordRateLimit.consume(rateLimitKey);
    if (!rate.allowed) {
      throw new AuthError('RATE_LIMITED', 'Too many password attempts', 429);
    }

    if (!(await this.verifyPassword(password, credential))) {
      throw new AuthError('INVALID_PASSWORD', 'Invalid password', 401);
    }

    this.passwordRateLimit.reset(rateLimitKey);
    return this.createSession();
  }

  async validateSession(sessionId: string | undefined): Promise<boolean> {
    if (!sessionId) {
      return false;
    }
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }
    if (session.expiresAtMs <= this.now()) {
      this.sessions.delete(sessionId);
      return false;
    }
    return true;
  }

  async getSessionStatus(sessionId: string | undefined): Promise<{ passwordSet: boolean; authenticated: boolean; expiresAt: string | null }> {
    const state = await this.store.read();
    const authenticated = await this.validateSession(sessionId);
    const session = sessionId ? this.sessions.get(sessionId) : undefined;
    return {
      passwordSet: Boolean(state.passwordCredential),
      authenticated,
      expiresAt: authenticated && session ? new Date(session.expiresAtMs).toISOString() : null
    };
  }

  async requireSession(request: {
    cookies?: Record<string, string | undefined>;
    headers?: Record<string, string | string[] | undefined>;
  }): Promise<{ sessionId: string } | null> {
    const cookies = request.cookies ?? this.parseCookieHeader(request.headers?.cookie);
    const sessionId = cookies.leominal_session;
    const ok = await this.validateSession(sessionId);
    return ok && sessionId ? { sessionId } : null;
  }

  logout(sessionId: string | undefined): void {
    if (sessionId) {
      this.sessions.delete(sessionId);
    }
  }

  private createSession(): PasswordSession {
    const sessionId = `sess_${crypto.randomBytes(32).toString('base64url')}`;
    const expiresAtMs = this.now() + this.config.sessionTtlMs;
    this.sessions.set(sessionId, { expiresAtMs });
    return { sessionId, expiresAt: new Date(expiresAtMs).toISOString() };
  }

  private validatePassword(password: string): void {
    if (password.length < 8) {
      throw new AuthError('PASSWORD_TOO_SHORT', 'Password must be at least 8 characters', 400);
    }
  }

  private async hashPassword(password: string, salt: string): Promise<string> {
    const hash = (await scrypt(`${password}:${this.config.sessionSecret}`, salt, 64)) as Buffer;
    return hash.toString('base64url');
  }

  private async verifyPassword(password: string, credential: StoredPasswordCredential): Promise<boolean> {
    const candidate = await this.hashPassword(password, credential.salt);
    return this.safeEqual(candidate, credential.hash);
  }

  private safeEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
  }

  private parseCookieHeader(header: string | string[] | undefined): Record<string, string | undefined> {
    const raw = Array.isArray(header) ? header.join('; ') : header;
    if (!raw) {
      return {};
    }
    return Object.fromEntries(
      raw
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
          const separator = part.indexOf('=');
          if (separator === -1) {
            return [part, ''];
          }
          return [part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))];
        })
    );
  }
}
