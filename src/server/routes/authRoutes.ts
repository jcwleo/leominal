import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AuthError } from '../auth/authService.js';
import { clearAuthCookies, clearPendingTotpCookie, cookieNames, setPendingTotpCookie, setSessionCookie } from '../auth/cookies.js';
import { isAllowedOrigin, type AppConfig } from '../config.js';
import type { AuthService } from '../auth/authService.js';
import type { TerminalManager } from '../terminal/TerminalManager.js';

export interface AuthRouteServices {
  authService: AuthService;
  terminalManager: TerminalManager;
}

interface PasswordBody {
  password?: string;
}

interface TotpConfirmBody {
  enrollmentId?: string;
  code?: string;
}

interface TotpVerifyBody {
  code?: string;
}

function cookies(request: FastifyRequest): Record<string, string | undefined> {
  return request.cookies as Record<string, string | undefined>;
}

export async function requireAllowedOrigin(config: AppConfig, request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.headers.origin) {
    await reply.code(403).send({ error: 'origin_required' });
    return;
  }
  if (!isAllowedOrigin(config, request.headers.origin)) {
    await reply.code(403).send({ error: 'origin_not_allowed' });
  }
}

function sendAuthError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof AuthError) {
    return reply.code(error.statusCode).send({ error: error.code.toLowerCase() });
  }
  throw error;
}

async function requireSession(services: AuthRouteServices, request: FastifyRequest, reply: FastifyReply): Promise<{ sessionId: string } | null> {
  const session = await services.authService.requireSession(request);
  if (!session) {
    await reply.code(401).send({ error: 'unauthorized' });
    return null;
  }
  return session;
}

export async function registerAuthRoutes(app: FastifyInstance, config: AppConfig, services: AuthRouteServices): Promise<void> {
  app.get('/api/auth/session', async (request) => {
    const requestCookies = cookies(request);
    return services.authService.getSessionStatus(requestCookies[cookieNames.session]);
  });

  app.get('/api/settings', async (request, reply) => {
    try {
      const session = await requireSession(services, request, reply);
      if (!session) {
        return reply;
      }
      return services.authService.getSettingsStatus(session.sessionId);
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  app.post<{ Body: PasswordBody }>(
    '/api/auth/password',
    { preHandler: (request, reply) => requireAllowedOrigin(config, request, reply) },
    async (request, reply) => {
      try {
        if (typeof request.body?.password !== 'string') {
          return reply.code(400).send({ error: 'password_required' });
        }
        const session = await services.authService.setupPassword(request.body.password);
        setSessionCookie(reply, config, session.sessionId);
        return { passwordSet: true, authenticated: true, expiresAt: session.expiresAt, twoFactorEnabled: false };
      } catch (error) {
        return sendAuthError(reply, error);
      }
    }
  );

  app.post<{ Body: PasswordBody }>(
    '/api/auth/login',
    { preHandler: (request, reply) => requireAllowedOrigin(config, request, reply) },
    async (request, reply) => {
      try {
        if (typeof request.body?.password !== 'string') {
          return reply.code(400).send({ error: 'password_required' });
        }
        const result = await services.authService.loginWithPassword(request.body.password, request.ip);
        if (result.status === 'totp_required') {
          setPendingTotpCookie(reply, config, result.challengeId);
          return {
            passwordSet: true,
            authenticated: false,
            expiresAt: null,
            twoFactorEnabled: true,
            twoFactorRequired: true,
            twoFactorChallengeExpiresAt: result.expiresAt
          };
        }
        setSessionCookie(reply, config, result.sessionId);
        return { passwordSet: true, authenticated: true, expiresAt: result.expiresAt, twoFactorEnabled: false };
      } catch (error) {
        return sendAuthError(reply, error);
      }
    }
  );

  app.post(
    '/api/auth/totp/enroll',
    { preHandler: (request, reply) => requireAllowedOrigin(config, request, reply) },
    async (request, reply) => {
      try {
        const session = await requireSession(services, request, reply);
        if (!session) {
          return reply;
        }
        return services.authService.startTotpEnrollment(session.sessionId);
      } catch (error) {
        return sendAuthError(reply, error);
      }
    }
  );

  app.post<{ Body: TotpConfirmBody }>(
    '/api/auth/totp/confirm',
    { preHandler: (request, reply) => requireAllowedOrigin(config, request, reply) },
    async (request, reply) => {
      try {
        const session = await requireSession(services, request, reply);
        if (!session) {
          return reply;
        }
        if (typeof request.body?.enrollmentId !== 'string') {
          return reply.code(400).send({ error: 'enrollment_required' });
        }
        if (typeof request.body?.code !== 'string') {
          return reply.code(400).send({ error: 'totp_required' });
        }
        return services.authService.confirmTotpEnrollment(session.sessionId, request.body.enrollmentId, request.body.code);
      } catch (error) {
        return sendAuthError(reply, error);
      }
    }
  );

  app.post<{ Body: TotpVerifyBody }>(
    '/api/auth/totp/verify',
    { preHandler: (request, reply) => requireAllowedOrigin(config, request, reply) },
    async (request, reply) => {
      try {
        if (typeof request.body?.code !== 'string') {
          return reply.code(400).send({ error: 'totp_required' });
        }
        const requestCookies = cookies(request);
        const session = await services.authService.completeTotpLogin(requestCookies[cookieNames.pendingTotp], request.body.code);
        clearPendingTotpCookie(reply, config);
        setSessionCookie(reply, config, session.sessionId);
        return { passwordSet: true, authenticated: true, expiresAt: session.expiresAt, twoFactorEnabled: true };
      } catch (error) {
        return sendAuthError(reply, error);
      }
    }
  );

  app.post(
    '/api/auth/logout',
    { preHandler: (request, reply) => requireAllowedOrigin(config, request, reply) },
    async (request, reply) => {
      const requestCookies = cookies(request);
      const session = await services.authService.requireSession(request);
      if (session) {
        services.authService.logout(requestCookies[cookieNames.session]);
        services.terminalManager.closeAll();
      }
      clearAuthCookies(reply, config);
      return services.authService.getSessionStatus(undefined);
    }
  );
}
