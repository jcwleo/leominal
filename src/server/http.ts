import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import path from 'node:path';
import type { AppConfig } from './config.js';
import { registerAuthRoutes, type AuthRouteServices } from './routes/authRoutes.js';
import { registerTerminalLayoutRoutes, type TerminalLayoutRouteServices } from './routes/terminalLayoutRoutes.js';
import { registerTerminalRoutes, type TerminalRouteServices } from './routes/terminalRoutes.js';
import { registerTerminalWebSocket } from './routes/terminalWebSocket.js';
import { registerUploadRoutes, type UploadRouteServices } from './routes/uploadRoutes.js';

export interface BuildAppServices extends AuthRouteServices, TerminalRouteServices, TerminalLayoutRouteServices, UploadRouteServices {}

export async function buildApp(config: AppConfig, services: BuildAppServices): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });
  await app.register(fastifyCookie, {
    secret: config.sessionSecret
  });
  await app.register(fastifyWebsocket);
  await app.register(fastifyMultipart, {
    throwFileSizeLimit: false,
    limits: {
      files: config.uploadMaxFiles,
      fileSize: config.uploadMaxFileBytes + 1,
      parts: config.uploadMaxFiles + 1,
      fields: 1
    }
  });

  await registerAuthRoutes(app, config, services);
  await registerTerminalRoutes(app, config, services);
  await registerTerminalLayoutRoutes(app, config, services);
  await registerUploadRoutes(app, config, services);
  await registerTerminalWebSocket(app, config, services);

  app.addHook('onSend', async (_request, reply, payload) => {
    const contentType = reply.getHeader('content-type');
    if (typeof contentType === 'string' && contentType.includes('text/html')) {
      reply.header('Cache-Control', 'no-store');
    }
    return payload;
  });

  await app.register(fastifyStatic, {
    root: config.staticRoot,
    prefix: '/'
  });

  app.setNotFoundHandler(async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return reply.sendFile('index.html', path.resolve(config.staticRoot));
  });

  return app;
}
