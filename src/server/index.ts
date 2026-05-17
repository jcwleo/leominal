import { loadConfig, loadDotEnvFile } from './config.js';
import { buildApp } from './http.js';
import { AuthService } from './auth/authService.js';
import { FileStore } from './storage/fileStore.js';
import { NodePtyAdapter } from './terminal/NodePtyAdapter.js';
import { TerminalManager } from './terminal/TerminalManager.js';

const config = loadConfig(loadDotEnvFile());
const store = new FileStore(config.statePath);
await store.init();
const authService = new AuthService(config, store);
const terminalManager = new TerminalManager(config, new NodePtyAdapter());

const app = await buildApp(config, {
  authService,
  fileStore: store,
  terminalManager
});

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'shutting down');
  terminalManager.closeAll();
  await app.close();
  process.exit(0);
};

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: config.host, port: config.port });
