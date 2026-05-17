import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config.js';
import type { AuthService } from '../auth/authService.js';
import type { TerminalManager } from '../terminal/TerminalManager.js';
import type { CreateTerminalRequest } from '../../shared/protocol.js';
import { requireAllowedOrigin } from './authRoutes.js';

export interface TerminalRouteServices {
  authService: AuthService;
  terminalManager: TerminalManager;
}

interface AuthContext {
  sessionId?: string;
}

type GuardResult = boolean | string | null | undefined | { sessionId?: string; authenticated?: boolean };
type GuardMethod = (request: FastifyRequest, reply?: FastifyReply) => GuardResult | Promise<GuardResult>;

export async function authenticateTerminalRequest(
  authService: AuthService,
  request: FastifyRequest,
  reply?: FastifyReply
): Promise<AuthContext | null> {
  const auth = authService as unknown as Record<string, unknown>;
  const methodNames = ['requireSession', 'requireAuth', 'authenticateRequest', 'validateRequest', 'isAuthenticated', 'validateSession'];

  for (const methodName of methodNames) {
    const method = auth[methodName];
    if (typeof method !== 'function') {
      continue;
    }
    if (method.length > 2) {
      continue;
    }
    const result = await (method as GuardMethod).call(authService, request, reply);
    return normalizeAuthResult(result, reply);
  }

  if (reply && !reply.sent) {
    await reply.code(401).send({ error: 'unauthorized' });
  }
  return null;
}

export async function registerTerminalRoutes(app: FastifyInstance, config: AppConfig, services: TerminalRouteServices): Promise<void> {
  app.get('/api/terminals', async (request, reply) => {
    const auth = await authenticateTerminalRequest(services.authService, request, reply);
    if (!auth) {
      return reply;
    }
    return { terminals: services.terminalManager.listTerminals() };
  });

  app.post('/api/terminals', { preHandler: (request, reply) => requireAllowedOrigin(config, request, reply) }, async (request, reply) => {
    const auth = await authenticateTerminalRequest(services.authService, request, reply);
    if (!auth) {
      return reply;
    }
    const body = (request.body ?? {}) as CreateTerminalRequest;
    const createOptions = {
      ...(body.parentTerminalId !== undefined ? { parentTerminalId: body.parentTerminalId } : {}),
      ...(body.cols !== undefined ? { cols: body.cols } : {}),
      ...(body.rows !== undefined ? { rows: body.rows } : {})
    };
    const terminal = await services.terminalManager.createTerminal(createOptions);
    return reply.code(201).send({ terminal });
  });

  app.delete<{ Params: { id: string } }>(
    '/api/terminals/:id',
    { preHandler: (request, reply) => requireAllowedOrigin(config, request, reply) },
    async (request, reply) => {
      const auth = await authenticateTerminalRequest(services.authService, request, reply);
      if (!auth) {
        return reply;
      }
      if (!services.terminalManager.closeTerminal(request.params.id)) {
        return reply.code(404).send({ error: 'terminal_not_found' });
      }
      return reply.code(204).send();
    }
  );

  app.delete('/api/terminals', { preHandler: (request, reply) => requireAllowedOrigin(config, request, reply) }, async (request, reply) => {
    const auth = await authenticateTerminalRequest(services.authService, request, reply);
    if (!auth) {
      return reply;
    }
    services.terminalManager.closeAll();
    return reply.code(204).send();
  });
}

function normalizeAuthResult(result: GuardResult, reply?: FastifyReply): AuthContext | null {
  if (result === true) {
    return {};
  }
  if (typeof result === 'string') {
    return { sessionId: result };
  }
  if (result && typeof result === 'object') {
    if (result.authenticated === false) {
      sendUnauthorized(reply);
      return null;
    }
    return typeof result.sessionId === 'string' ? { sessionId: result.sessionId } : {};
  }

  sendUnauthorized(reply);
  return null;
}

function sendUnauthorized(reply?: FastifyReply): void {
  if (reply && !reply.sent) {
    void reply.code(401).send({ error: 'unauthorized' });
  }
}
