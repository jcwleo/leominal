import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config.js';
import type { AuthService } from '../auth/authService.js';
import type { TerminalManager } from '../terminal/TerminalManager.js';
import type { TerminalSummary } from '../../shared/types.js';
import type {
  FileCreateRequest,
  FileDeletePreviewRequest,
  FileDeleteRequest,
  FileListRequest,
  FileMoveRequest,
  FileOpenRequest,
  FilePathRequest,
  FileReadRequest,
  FileRootRequest,
  FileWriteRequest
} from '../../shared/protocol.js';
import { requireAllowedOrigin } from './authRoutes.js';
import { authenticateTerminalRequest } from './terminalRoutes.js';
import { FileExplorerError, FileExplorerService } from '../files/fileExplorerService.js';
import { FileRootTokenError, signFileRootToken, verifyFileRootToken } from '../files/rootToken.js';

export interface FileRouteServices {
  authService: AuthService;
  terminalManager: TerminalManager;
  fileExplorerService?: FileExplorerService;
}

export async function registerFileRoutes(app: FastifyInstance, config: AppConfig, services: FileRouteServices): Promise<void> {
  const fileExplorerService = services.fileExplorerService ?? new FileExplorerService(config);

  app.post<{ Body: FileRootRequest }>(
    '/api/files/root',
    { preHandler: (request, reply) => requireAllowedOrigin(config, request, reply) },
    async (request, reply) => {
      const auth = await authenticateTerminalRequest(services.authService, request, reply);
      if (!auth) {
        return reply;
      }
      const terminalId = request.body?.terminalId;
      if (typeof terminalId !== 'string' || !terminalId.trim()) {
        return reply.code(400).send({ error: 'invalid_file_root_request' });
      }
      if (!services.terminalManager.getTerminal(terminalId)) {
        return reply.code(404).send({ error: 'terminal_not_found' });
      }
      const liveCwd = await services.terminalManager.resolveTerminalCwd(terminalId);
      if (!liveCwd) {
        return reply.code(409).send({ error: 'terminal_cwd_unavailable' });
      }
      try {
        const rootPath = await fileExplorerService.resolveRootPath(liveCwd);
        const signed = signFileRootToken(config, { terminalId, rootPath });
        return {
          rootToken: signed.rootToken,
          terminalId,
          rootPath,
          issuedAt: signed.issuedAt
        };
      } catch (error) {
        if (error instanceof FileExplorerError && error.code === 'root_unavailable') {
          return reply.code(409).send({ error: 'terminal_cwd_unavailable' });
        }
        throw error;
      }
    }
  );

  app.post<{ Body: FileListRequest }>(
    '/api/files/list',
    { preHandler: (request, reply) => requireAllowedOrigin(config, request, reply) },
    async (request, reply) =>
      withAuthenticatedFileRoot(
        services.authService,
        config,
        request,
        reply,
        async (root, body) => fileExplorerService.list(root.rootPath, body.path),
        services.terminalManager,
        fileExplorerService
      )
  );

  app.post<{ Body: FileReadRequest }>(
    '/api/files/read',
    { preHandler: (request, reply) => requireAllowedOrigin(config, request, reply) },
    async (request, reply) =>
      withAuthenticatedFileRoot(
        services.authService,
        config,
        request,
        reply,
        async (root, body) => fileExplorerService.readText(root.rootPath, body.path),
        services.terminalManager,
        fileExplorerService
      )
  );

  app.post<{ Body: FileWriteRequest }>(
    '/api/files/write',
    { preHandler: (request, reply) => requireAllowedOrigin(config, request, reply) },
    async (request, reply) =>
      withAuthenticatedFileRoot(
        services.authService,
        config,
        request,
        reply,
        async (root, body) => {
          if (typeof body.content !== 'string' || !isFileVersion(body.expectedVersion)) {
            return reply.code(400).send({ error: 'invalid_file_write_request' });
          }
          return fileExplorerService.writeText(root.rootPath, body.path, body.content, body.expectedVersion);
        },
        services.terminalManager,
        fileExplorerService
      )
  );

  app.post<{ Body: FileCreateRequest }>(
    '/api/files/create',
    { preHandler: (request, reply) => requireAllowedOrigin(config, request, reply) },
    async (request, reply) =>
      withAuthenticatedFileRoot(
        services.authService,
        config,
        request,
        reply,
        async (root, body) => {
          if (body.kind !== 'file' && body.kind !== 'directory') {
            return reply.code(400).send({ error: 'invalid_file_create_request' });
          }
          return { entry: await fileExplorerService.createEntry(root.rootPath, body.path, body.kind) };
        },
        services.terminalManager,
        fileExplorerService
      )
  );

  app.post<{ Body: FileMoveRequest }>(
    '/api/files/move',
    { preHandler: (request, reply) => requireAllowedOrigin(config, request, reply) },
    async (request, reply) => {
      const auth = await authenticateTerminalRequest(services.authService, request, reply);
      if (!auth) {
        return reply;
      }
      const body = request.body;
      const root = await verifyRequestRoot(config, body, reply, services.terminalManager, fileExplorerService);
      if (!root) {
        return reply;
      }
      if (typeof body?.sourcePath !== 'string' || typeof body.destinationPath !== 'string') {
        return reply.code(400).send({ error: 'invalid_file_move_request' });
      }
      return handleFileError(reply, async () => ({
        entry: await fileExplorerService.moveEntry(root.rootPath, body.sourcePath, body.destinationPath)
      }));
    }
  );

  app.post<{ Body: FileDeletePreviewRequest }>(
    '/api/files/delete-preview',
    { preHandler: (request, reply) => requireAllowedOrigin(config, request, reply) },
    async (request, reply) =>
      withAuthenticatedFileRoot(
        services.authService,
        config,
        request,
        reply,
        async (root, body) => fileExplorerService.previewDelete(root.rootPath, body.path, body.rootToken),
        services.terminalManager,
        fileExplorerService
      )
  );

  app.post<{ Body: FileDeleteRequest }>(
    '/api/files/delete',
    { preHandler: (request, reply) => requireAllowedOrigin(config, request, reply) },
    async (request, reply) =>
      withAuthenticatedFileRoot(
        services.authService,
        config,
        request,
        reply,
        async (root, body) => {
          if (typeof body.previewToken !== 'string') {
            return reply.code(400).send({ error: 'invalid_file_delete_request' });
          }
          return fileExplorerService.deleteEntry(root.rootPath, body.path, body.previewToken, body.rootToken);
        },
        services.terminalManager,
        fileExplorerService
      )
  );

  app.post<{ Body: FileOpenRequest }>(
    '/api/files/open',
    { preHandler: (request, reply) => requireAllowedOrigin(config, request, reply) },
    async (request, reply) =>
      withAuthenticatedFileRoot(
        services.authService,
        config,
        request,
        reply,
        async (root, body) => {
          const target = await fileExplorerService.resolveFileForTerminalOpen(root.rootPath, body.path);
          const terminalId = openTargetTerminalId(body.terminalId, root.terminalId);
          const opened = services.terminalManager.writeToTerminal(terminalId, terminalOpenCommand(target.absolutePath));
          if (!opened) {
            return reply.code(404).send({ error: 'terminal_not_found' });
          }
          return { opened: true };
        },
        services.terminalManager,
        fileExplorerService
      )
  );

  app.post<{ Body: FilePathRequest }>(
    '/api/files/preview',
    { preHandler: (request, reply) => requireAllowedOrigin(config, request, reply) },
    async (request, reply) =>
      withAuthenticatedFileRoot(
        services.authService,
        config,
        request,
        reply,
        async (root, body) => {
          const preview = await fileExplorerService.previewFile(root.rootPath, body.path);
          return reply.type(preview.contentType).header('Content-Length', preview.size).send(preview.stream);
        },
        services.terminalManager,
        fileExplorerService
      )
  );
}

async function withAuthenticatedFileRoot<T extends FilePathRequest>(
  authService: AuthService,
  config: AppConfig,
  request: FastifyRequest<{ Body: T }>,
  reply: FastifyReply,
  handler: (root: ReturnType<typeof verifyFileRootToken>, body: T) => Promise<unknown>,
  terminalManager: Pick<TerminalManager, 'getTerminal' | 'resolveTerminalCwd'>,
  fileExplorerService: Pick<FileExplorerService, 'resolveRootPath'>
): Promise<unknown> {
  const auth = await authenticateTerminalRequest(authService, request, reply);
  if (!auth) {
    return reply;
  }
  return withFileRoot(config, request.body as T | undefined, reply, handler, terminalManager, fileExplorerService);
}

async function withFileRoot<T extends FilePathRequest>(
  config: AppConfig,
  body: T | undefined,
  reply: FastifyReply,
  handler: (root: ReturnType<typeof verifyFileRootToken>, body: T) => Promise<unknown>,
  terminalManager: Pick<TerminalManager, 'getTerminal' | 'resolveTerminalCwd'>,
  fileExplorerService: Pick<FileExplorerService, 'resolveRootPath'>
): Promise<unknown> {
  const root = await verifyRequestRoot(config, body, reply, terminalManager, fileExplorerService);
  if (!root) {
    return reply;
  }
  if (typeof body?.path !== 'string') {
    return reply.code(400).send({ error: 'invalid_file_path' });
  }
  return handleFileError(reply, () => handler(root, body));
}

async function verifyRequestRoot(
  config: AppConfig,
  body: { rootToken?: unknown } | undefined,
  reply: FastifyReply,
  terminalManager: Pick<TerminalManager, 'getTerminal' | 'resolveTerminalCwd'>,
  fileExplorerService: Pick<FileExplorerService, 'resolveRootPath'>
): Promise<ReturnType<typeof verifyFileRootToken> | null> {
  if (typeof body?.rootToken !== 'string') {
    reply.code(401).send({ error: 'invalid_root_token' });
    return null;
  }
  try {
    const root = verifyFileRootToken(config, body.rootToken);
    const terminal = terminalManager.getTerminal(root.terminalId) as TerminalSummary | null;
    if (!terminal) {
      reply.code(404).send({ error: 'terminal_not_found' });
      return null;
    }
    if (terminal.status !== 'running') {
      reply.code(409).send({ error: 'terminal_cwd_unavailable' });
      return null;
    }
    const liveCwd = await terminalManager.resolveTerminalCwd(root.terminalId);
    if (!liveCwd) {
      reply.code(409).send({ error: 'terminal_cwd_unavailable' });
      return null;
    }
    const liveRootPath = await fileExplorerService.resolveRootPath(liveCwd);
    if (liveRootPath !== root.rootPath) {
      reply.code(409).send({ error: 'terminal_cwd_changed' });
      return null;
    }
    return root;
  } catch (error) {
    if (error instanceof FileRootTokenError) {
      reply.code(401).send({ error: error.code });
      return null;
    }
    if (error instanceof FileExplorerError && error.code === 'root_unavailable') {
      reply.code(409).send({ error: 'terminal_cwd_unavailable' });
      return null;
    }
    throw error;
  }
}

async function handleFileError(reply: FastifyReply, handler: () => Promise<unknown>): Promise<unknown> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof FileExplorerError) {
      return reply.code(error.statusCode).send({ error: error.code });
    }
    throw error;
  }
}

function isFileVersion(value: unknown): value is FileWriteRequest['expectedVersion'] {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const version = value as Partial<FileWriteRequest['expectedVersion']>;
  return (
    typeof version.size === 'number' &&
    typeof version.mtimeMs === 'number' &&
    (version.ino === undefined || typeof version.ino === 'number')
  );
}

function terminalOpenCommand(absolutePath: string): string {
  const quotedPath = shellQuote(absolutePath);
  return `nano -- ${quotedPath} || micro -- ${quotedPath} || nvim -- ${quotedPath} || vim -- ${quotedPath} || vi -- ${quotedPath}\r`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function openTargetTerminalId(value: unknown, fallback: string): string {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === 'string' && value.trim()) {
    return value;
  }
  throw new FileExplorerError(400, 'invalid_terminal_id');
}
