import type { FastifyReply } from 'fastify';
import type { FastifyCookieOptions } from '@fastify/cookie';
import type { AppConfig } from '../config.js';

export const cookieNames = {
  session: 'leominal_session'
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
  reply.setCookie(cookieNames.session, sessionId, authCookieOptions(config, Math.ceil(config.sessionTtlMs / 1000)));
}

export function clearAuthCookies(reply: FastifyReply, config: AppConfig): void {
  reply.clearCookie(cookieNames.session, authCookieOptions(config));
  clearLegacyAuthCookies(reply, config);
}

function clearLegacyAuthCookies(reply: FastifyReply, config: AppConfig): void {
  for (const name of legacyCookieNames) {
    reply.clearCookie(name, authCookieOptions(config));
  }
}
