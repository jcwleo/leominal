import crypto from 'node:crypto';
import { promisify } from 'node:util';
import type { AppConfig } from '../config.js';
import type { FileStore, StoredPasswordCredential, StoredTotpCredential } from '../storage/fileStore.js';
import { InMemoryRateLimit } from './rateLimit.js';
import { createTotpQrCodeDataUrl, createTotpUri, generateTotpSecret, totpDefaults, verifyTotpCode } from './totp.js';

const scrypt = promisify(crypto.scrypt);
const totpEnrollmentTtlMs = 10 * 60_000;
const totpLoginTtlMs = 5 * 60_000;

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

export interface AuthSessionStatus {
  passwordSet: boolean;
  authenticated: boolean;
  expiresAt: string | null;
  twoFactorEnabled: boolean;
}

export interface AuthSettingsStatus {
  security: {
    twoFactorEnabled: boolean;
  };
}

export interface TotpEnrollment {
  enrollmentId: string;
  manualKey: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
  expiresAt: string;
}

export interface TotpEnrollmentStatus {
  twoFactorEnabled: true;
}

export type PasswordLoginResult =
  | (PasswordSession & { status: 'authenticated' })
  | {
      status: 'totp_required';
      challengeId: string;
      expiresAt: string;
    };

export interface AuthServiceOptions {
  now?: () => number;
  passwordRateLimit?: InMemoryRateLimit;
  totpRateLimit?: InMemoryRateLimit;
  totpSecretFactory?: () => string;
  totpQrCodeDataUrl?: (uri: string) => Promise<string>;
}

export type SessionRevocationListener = (sessionId: string) => void;

export interface AuthEventSubscription {
  dispose(): void;
}

interface SessionRecord {
  expiresAtMs: number;
  twoFactorVerified: boolean;
}

interface TotpEnrollmentRecord {
  accountName: string;
  expiresAtMs: number;
  secret: string;
}

interface TotpLoginChallengeRecord {
  clientKey: string;
  expiresAtMs: number;
}

export class AuthService {
  private readonly now: () => number;
  private readonly passwordRateLimit: InMemoryRateLimit;
  private readonly totpRateLimit: InMemoryRateLimit;
  private readonly totpSecretFactory: () => string;
  private readonly totpQrCodeDataUrl: (uri: string) => Promise<string>;
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly totpEnrollments = new Map<string, TotpEnrollmentRecord>();
  private readonly totpLoginChallenges = new Map<string, TotpLoginChallengeRecord>();
  private readonly sessionRevocationListeners = new Set<SessionRevocationListener>();

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
    this.totpRateLimit =
      options.totpRateLimit ??
      new InMemoryRateLimit({
        limit: 5,
        windowMs: 60_000,
        now: this.now
      });
    this.totpSecretFactory = options.totpSecretFactory ?? generateTotpSecret;
    this.totpQrCodeDataUrl = options.totpQrCodeDataUrl ?? createTotpQrCodeDataUrl;
  }

  onSessionRevoked(listener: SessionRevocationListener): AuthEventSubscription {
    this.sessionRevocationListeners.add(listener);
    return { dispose: () => this.sessionRevocationListeners.delete(listener) };
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

  async loginWithPassword(password: string, clientKey = 'default'): Promise<PasswordLoginResult> {
    const state = await this.store.read();
    const credential = state.passwordCredential;
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
    if (state.totpCredential) {
      return this.createTotpLoginChallenge(clientKey);
    }
    return { status: 'authenticated', ...this.createSession() };
  }

  async getSettingsStatus(sessionId: string | undefined): Promise<AuthSettingsStatus> {
    await this.requireValidSessionId(sessionId);
    const state = await this.store.read();
    return { security: { twoFactorEnabled: Boolean(state.totpCredential) } };
  }

  async startTotpEnrollment(sessionId: string | undefined): Promise<TotpEnrollment> {
    await this.requireValidSessionId(sessionId);
    const state = await this.store.read();
    if (!state.passwordCredential) {
      throw new AuthError('PASSWORD_NOT_SET', 'Password is not set', 409);
    }
    if (state.totpCredential) {
      throw new AuthError('TOTP_ALREADY_ENABLED', 'TOTP is already enabled', 409);
    }

    const enrollmentId = `totp_enroll_${crypto.randomBytes(32).toString('base64url')}`;
    const secret = this.totpSecretFactory();
    const accountName = this.totpAccountName();
    const otpauthUrl = createTotpUri({ accountName, secret });
    const expiresAtMs = this.now() + totpEnrollmentTtlMs;
    this.totpEnrollments.set(enrollmentId, { accountName, expiresAtMs, secret });
    return {
      enrollmentId,
      manualKey: secret,
      otpauthUrl,
      qrCodeDataUrl: await this.totpQrCodeDataUrl(otpauthUrl),
      expiresAt: new Date(expiresAtMs).toISOString()
    };
  }

  async confirmTotpEnrollment(sessionId: string | undefined, enrollmentId: string, code: string): Promise<TotpEnrollmentStatus> {
    const verifiedSessionId = await this.requireValidSessionId(sessionId);
    const enrollment = this.validTotpEnrollment(enrollmentId);
    const rateLimitKey = `totp_enroll:${verifiedSessionId}`;
    this.consumeTotpRateLimit(rateLimitKey);
    if (!verifyTotpCode(enrollment.secret, code, this.now())) {
      throw new AuthError('INVALID_TOTP', 'Invalid TOTP code', 401);
    }

    const timestamp = new Date(this.now()).toISOString();
    const credential: StoredTotpCredential = {
      algorithm: 'totp',
      secret: enrollment.secret,
      issuer: totpDefaults.issuer,
      accountName: enrollment.accountName,
      digits: totpDefaults.digits,
      period: totpDefaults.period,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await this.store.update((current) => {
      if (current.totpCredential) {
        throw new AuthError('TOTP_ALREADY_ENABLED', 'TOTP is already enabled', 409);
      }
      return { ...current, totpCredential: credential };
    });
    this.markOnlySessionTwoFactorVerified(verifiedSessionId);
    this.totpRateLimit.reset(rateLimitKey);
    this.totpEnrollments.delete(enrollmentId);
    return { twoFactorEnabled: true };
  }

  async completeTotpLogin(challengeId: string | undefined, code: string): Promise<PasswordSession> {
    if (!challengeId) {
      throw new AuthError('TOTP_REQUIRED', 'TOTP challenge required', 401);
    }
    const challenge = this.validTotpLoginChallenge(challengeId);
    const state = await this.store.read();
    if (!state.totpCredential) {
      this.totpLoginChallenges.delete(challengeId);
      throw new AuthError('TOTP_NOT_ENABLED', 'TOTP is not enabled', 409);
    }

    const rateLimitKey = `totp_login:${challenge.clientKey}`;
    this.consumeTotpRateLimit(rateLimitKey);
    if (!verifyTotpCode(state.totpCredential.secret, code, this.now())) {
      throw new AuthError('INVALID_TOTP', 'Invalid TOTP code', 401);
    }

    this.totpRateLimit.reset(rateLimitKey);
    this.totpLoginChallenges.delete(challengeId);
    return this.createSession({ twoFactorVerified: true });
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
      this.revokeSession(sessionId);
      return false;
    }
    const state = await this.store.read();
    if (state.totpCredential && !session.twoFactorVerified) {
      this.revokeSession(sessionId);
      return false;
    }
    return true;
  }

  async getSessionStatus(sessionId: string | undefined): Promise<AuthSessionStatus> {
    const state = await this.store.read();
    const authenticated = await this.validateSession(sessionId);
    const session = sessionId ? this.sessions.get(sessionId) : undefined;
    return {
      passwordSet: Boolean(state.passwordCredential),
      authenticated,
      expiresAt: authenticated && session ? new Date(session.expiresAtMs).toISOString() : null,
      twoFactorEnabled: Boolean(state.totpCredential)
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
      this.revokeSession(sessionId);
    }
  }

  private createSession(options: { twoFactorVerified?: boolean } = {}): PasswordSession {
    const sessionId = `sess_${crypto.randomBytes(32).toString('base64url')}`;
    const expiresAtMs = this.now() + this.config.sessionTtlMs;
    this.sessions.set(sessionId, { expiresAtMs, twoFactorVerified: options.twoFactorVerified ?? false });
    return { sessionId, expiresAt: new Date(expiresAtMs).toISOString() };
  }

  private createTotpLoginChallenge(clientKey: string): PasswordLoginResult {
    const challengeId = `totp_login_${crypto.randomBytes(32).toString('base64url')}`;
    const expiresAtMs = this.now() + totpLoginTtlMs;
    this.totpLoginChallenges.set(challengeId, { clientKey, expiresAtMs });
    return { status: 'totp_required', challengeId, expiresAt: new Date(expiresAtMs).toISOString() };
  }

  private markOnlySessionTwoFactorVerified(sessionId: string): void {
    const currentSession = this.sessions.get(sessionId);
    const revokedSessionIds = [...this.sessions.keys()].filter((currentSessionId) => currentSessionId !== sessionId);
    this.sessions.clear();
    if (currentSession && currentSession.expiresAtMs > this.now()) {
      this.sessions.set(sessionId, { ...currentSession, twoFactorVerified: true });
    } else if (currentSession) {
      revokedSessionIds.push(sessionId);
    }
    for (const revokedSessionId of revokedSessionIds) {
      this.notifySessionRevoked(revokedSessionId);
    }
  }

  private revokeSession(sessionId: string): void {
    if (this.sessions.delete(sessionId)) {
      this.notifySessionRevoked(sessionId);
    }
  }

  private notifySessionRevoked(sessionId: string): void {
    for (const listener of this.sessionRevocationListeners) {
      listener(sessionId);
    }
  }

  private async requireValidSessionId(sessionId: string | undefined): Promise<string> {
    if (!sessionId || !(await this.validateSession(sessionId))) {
      throw new AuthError('UNAUTHORIZED', 'Authentication required', 401);
    }
    return sessionId;
  }

  private validTotpEnrollment(enrollmentId: string): TotpEnrollmentRecord {
    const enrollment = this.totpEnrollments.get(enrollmentId);
    if (!enrollment || enrollment.expiresAtMs <= this.now()) {
      this.totpEnrollments.delete(enrollmentId);
      throw new AuthError('TOTP_CHALLENGE_EXPIRED', 'TOTP challenge expired', 401);
    }
    return enrollment;
  }

  private validTotpLoginChallenge(challengeId: string | undefined): TotpLoginChallengeRecord {
    if (!challengeId) {
      throw new AuthError('TOTP_REQUIRED', 'TOTP challenge required', 401);
    }
    const challenge = this.totpLoginChallenges.get(challengeId);
    if (!challenge || challenge.expiresAtMs <= this.now()) {
      this.totpLoginChallenges.delete(challengeId);
      throw new AuthError('TOTP_CHALLENGE_EXPIRED', 'TOTP challenge expired', 401);
    }
    return challenge;
  }

  private consumeTotpRateLimit(key: string): void {
    const rate = this.totpRateLimit.consume(key);
    if (!rate.allowed) {
      throw new AuthError('RATE_LIMITED', 'Too many TOTP attempts', 429);
    }
  }

  private totpAccountName(): string {
    return `${this.config.host}:${this.config.port}`;
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
