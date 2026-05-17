import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AuthError } from '../auth/authService.js';
import { clearAuthCookies, cookieNames, setSessionCookie } from '../auth/cookies.js';
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

async function requireAuthOrigin(config: AppConfig, request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireAllowedOrigin(config, request, reply);
}

function sendAuthError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof AuthError) {
    return reply.code(error.statusCode).send({ error: error.code.toLowerCase() });
  }
  throw error;
}

export async function registerAuthRoutes(app: FastifyInstance, config: AppConfig, services: AuthRouteServices): Promise<void> {
  app.get('/api/auth/session', async (request) => {
    const requestCookies = cookies(request);
    return services.authService.getSessionStatus(requestCookies[cookieNames.session]);
  });

  app.post<{ Body: PasswordBody }>(
    '/api/auth/password',
    { preHandler: (request, reply) => requireAuthOrigin(config, request, reply) },
    async (request, reply) => {
      try {
        if (typeof request.body?.password !== 'string') {
          return reply.code(400).send({ error: 'password_required' });
        }
        const session = await services.authService.setupPassword(request.body.password);
        setSessionCookie(reply, config, session.sessionId);
        return { passwordSet: true, authenticated: true, expiresAt: session.expiresAt };
      } catch (error) {
        return sendAuthError(reply, error);
      }
    }
  );

  app.post<{ Body: PasswordBody }>(
    '/api/auth/login',
    { preHandler: (request, reply) => requireAuthOrigin(config, request, reply) },
    async (request, reply) => {
      try {
        if (typeof request.body?.password !== 'string') {
          return reply.code(400).send({ error: 'password_required' });
        }
        const session = await services.authService.loginWithPassword(request.body.password, request.ip);
        setSessionCookie(reply, config, session.sessionId);
        return { passwordSet: true, authenticated: true, expiresAt: session.expiresAt };
      } catch (error) {
        return sendAuthError(reply, error);
      }
    }
  );

  app.post(
    '/api/auth/logout',
    { preHandler: (request, reply) => requireAuthOrigin(config, request, reply) },
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
