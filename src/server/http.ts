import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import path from 'node:path';
import type { AppConfig } from './config.js';
import { registerAuthRoutes, type AuthRouteServices } from './routes/authRoutes.js';
import { registerTerminalLayoutRoutes, type TerminalLayoutRouteServices } from './routes/terminalLayoutRoutes.js';
import { registerTerminalRoutes, type TerminalRouteServices } from './routes/terminalRoutes.js';
import { registerTerminalWebSocket } from './routes/terminalWebSocket.js';

export interface BuildAppServices extends AuthRouteServices, TerminalRouteServices, TerminalLayoutRouteServices {}

export async function buildApp(config: AppConfig, services: BuildAppServices): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });
  await app.register(fastifyCookie, {
    secret: config.sessionSecret
  });
  await app.register(fastifyWebsocket);

  await registerAuthRoutes(app, config, services);
  await registerTerminalRoutes(app, config, services);
  await registerTerminalLayoutRoutes(app, config, services);
  await registerTerminalWebSocket(app, config, services);

  await app.register(fastifyStatic, {
    root: config.staticRoot,
    prefix: '/'
  });

  app.setNotFoundHandler(async (_request, reply) => {
    return reply.sendFile('index.html', path.resolve(config.staticRoot));
  });

  return app;
}
