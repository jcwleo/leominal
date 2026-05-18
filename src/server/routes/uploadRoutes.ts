import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';
import type { AuthService } from '../auth/authService.js';
import type { TerminalManager } from '../terminal/TerminalManager.js';
import { requireAllowedOrigin } from './authRoutes.js';
import { authenticateTerminalRequest } from './terminalRoutes.js';
import { createUploadSession, parseUploadManifest, UploadRequestError, type UploadSession } from '../uploads/uploadService.js';

export interface UploadRouteServices {
  authService: AuthService;
  terminalManager: TerminalManager;
}

export async function registerUploadRoutes(app: FastifyInstance, config: AppConfig, services: UploadRouteServices): Promise<void> {
  app.post('/api/uploads', { preHandler: (request, reply) => requireAllowedOrigin(config, request, reply) }, async (request, reply) => {
    const auth = await authenticateTerminalRequest(services.authService, request, reply);
    if (!auth) {
      return reply;
    }
    if (!request.isMultipart()) {
      return reply.code(400).send({ error: 'multipart_required' });
    }

    let session: UploadSession | null = null;
    let responseError: { statusCode: number; code: string } | null = null;

    try {
      for await (const part of request.parts({
        limits: {
          files: config.uploadMaxFiles,
          fileSize: config.uploadMaxFileBytes + 1,
          parts: config.uploadMaxFiles + 1,
          fields: 1
        }
      })) {
        if (responseError) {
          if (part.type === 'file') {
            await drain(part.file);
          }
          continue;
        }

        if (part.type === 'field') {
          if (part.fieldname === 'manifest' && !session) {
            session = await createSessionFromManifest(part.value, config, services);
          }
          continue;
        }

        if (!session) {
          responseError = { statusCode: 400, code: 'manifest_required' };
          await drain(part.file);
          continue;
        }
        await session.writeFile(part.fieldname, part.file);
      }
    } catch (error) {
      await session?.abort();
      if (error instanceof UploadRequestError) {
        return reply.code(error.statusCode).send({ error: error.code });
      }
      throw error;
    }

    if (responseError) {
      await session?.abort();
      return reply.code(responseError.statusCode).send({ error: responseError.code });
    }
    if (!session) {
      return reply.code(400).send({ error: 'manifest_required' });
    }

    return session.finish();
  });
}

async function createSessionFromManifest(value: unknown, config: AppConfig, services: UploadRouteServices): Promise<UploadSession> {
  const manifest = parseUploadManifest(parseManifestValue(value));
  if (!manifest) {
    throw new UploadRequestError(400, 'invalid_upload_manifest');
  }
  if (!services.terminalManager.getTerminal(manifest.terminalId)) {
    throw new UploadRequestError(404, 'terminal_not_found');
  }
  const destinationCwd = await services.terminalManager.resolveTerminalCwd(manifest.terminalId);
  if (!destinationCwd) {
    throw new UploadRequestError(409, 'terminal_cwd_unavailable');
  }
  return createUploadSession({
    destinationCwd,
    limits: config,
    manifest
  });
}

function parseManifestValue(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function drain(stream: NodeJS.ReadableStream): Promise<void> {
  for await (const _chunk of stream) {
    // Consume the stream so multipart parsing can continue before returning.
  }
}
