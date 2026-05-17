import type { FastifyInstance } from 'fastify';
import { normalizeTerminalLayoutState } from '../../shared/layoutState.js';
import type { TerminalLayoutResponse, UpdateTerminalLayoutRequest } from '../../shared/protocol.js';
import type { TerminalLayoutState } from '../../shared/types.js';
import type { AuthService } from '../auth/authService.js';
import type { AppConfig } from '../config.js';
import type { FileStore, StoredTerminalLayout } from '../storage/fileStore.js';
import { requireAllowedOrigin } from './authRoutes.js';
import { authenticateTerminalRequest } from './terminalRoutes.js';

export interface TerminalLayoutRouteServices {
  authService: AuthService;
  fileStore: FileStore;
}

interface ParsedUpdateRequest {
  layout: TerminalLayoutState;
  baseRevision?: number;
}

class RevisionConflict extends Error {
  constructor(public readonly current: StoredTerminalLayout | null) {
    super('Stale terminal layout revision');
  }
}

export async function registerTerminalLayoutRoutes(app: FastifyInstance, config: AppConfig, services: TerminalLayoutRouteServices): Promise<void> {
  app.get('/api/terminal-layout', async (request, reply) => {
    const auth = await authenticateTerminalRequest(services.authService, request, reply);
    if (!auth) {
      return reply;
    }
    const state = await services.fileStore.read();
    return terminalLayoutResponse(state.terminalLayout);
  });

  app.put(
    '/api/terminal-layout',
    { preHandler: (request, reply) => requireAllowedOrigin(config, request, reply) },
    async (request, reply) => {
      const auth = await authenticateTerminalRequest(services.authService, request, reply);
      if (!auth) {
        return reply;
      }
      const body = parseUpdateRequest(request.body);
      if (!body) {
        return reply.code(400).send({ error: 'invalid_terminal_layout' });
      }

      try {
        const next = await services.fileStore.update((state) => {
          const currentRevision = state.terminalLayout?.revision ?? 0;
          if (body.baseRevision !== undefined && body.baseRevision !== currentRevision) {
            throw new RevisionConflict(state.terminalLayout);
          }
          const terminalLayout: StoredTerminalLayout = {
            layout: body.layout,
            revision: currentRevision + 1,
            updatedAt: new Date().toISOString()
          };
          return {
            ...state,
            terminalLayout
          };
        });
        return terminalLayoutResponse(next.terminalLayout);
      } catch (error) {
        if (error instanceof RevisionConflict) {
          return reply.code(409).send(terminalLayoutResponse(error.current));
        }
        throw error;
      }
    }
  );
}

function parseUpdateRequest(value: unknown): ParsedUpdateRequest | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const request = value as Partial<UpdateTerminalLayoutRequest>;
  const layout = normalizeTerminalLayoutState(request.layout);
  if (!layout) {
    return null;
  }
  if (request.baseRevision !== undefined && (!Number.isInteger(request.baseRevision) || request.baseRevision < 0)) {
    return null;
  }
  return request.baseRevision === undefined ? { layout } : { layout, baseRevision: request.baseRevision };
}

function terminalLayoutResponse(stored: StoredTerminalLayout | null): TerminalLayoutResponse {
  if (!stored) {
    return { layout: null, revision: 0, updatedAt: null };
  }
  return {
    layout: stored.layout,
    revision: stored.revision,
    updatedAt: stored.updatedAt
  };
}
