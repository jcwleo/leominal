import type { FastifyReply } from 'fastify';
import type { FastifyCookieOptions } from '@fastify/cookie';
import type { AppConfig } from '../config.js';

export const cookieNames = {
  session: 'leominal_session',
  pendingTotp: 'leominal_2fa_pending'
} as const;

const legacyCookieNames = ['leominal_device_id', 'leominal_device_token'] as const;

export function authCookieOptions(config: AppConfig, maxAgeSeconds?: number) {
  const options: NonNullable<FastifyCookieOptions['parseOptions']> = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.cookieSecure,
    path: '/'
  };
  if (maxAgeSeconds !== undefined) {
    options.maxAge = maxAgeSeconds;
  }
  return options;
}

export function setSessionCookie(reply: FastifyReply, config: AppConfig, sessionId: string): void {
  clearLegacyAuthCookies(reply, config);
  clearPendingTotpCookie(reply, config);
  reply.setCookie(cookieNames.session, sessionId, authCookieOptions(config, Math.ceil(config.sessionTtlMs / 1000)));
}

export function setPendingTotpCookie(reply: FastifyReply, config: AppConfig, challengeId: string): void {
  reply.setCookie(cookieNames.pendingTotp, challengeId, authCookieOptions(config, 5 * 60));
}

export function clearAuthCookies(reply: FastifyReply, config: AppConfig): void {
  reply.clearCookie(cookieNames.session, authCookieOptions(config));
  clearPendingTotpCookie(reply, config);
  clearLegacyAuthCookies(reply, config);
}

export function clearPendingTotpCookie(reply: FastifyReply, config: AppConfig): void {
  reply.clearCookie(cookieNames.pendingTotp, authCookieOptions(config));
}

function clearLegacyAuthCookies(reply: FastifyReply, config: AppConfig): void {
  for (const name of legacyCookieNames) {
    reply.clearCookie(name, authCookieOptions(config));
  }
}
