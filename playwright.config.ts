import { defineConfig } from '@playwright/test';

const e2ePort = process.env.LEOMINAL_E2E_PORT ?? '3117';
const e2eBaseUrl = `http://127.0.0.1:${e2ePort}`;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  use: {
    baseURL: e2eBaseUrl
  },
  webServer: {
    command: 'rm -f .leominal/e2e-state.json && npm start',
    url: e2eBaseUrl,
    timeout: 15_000,
    reuseExistingServer: false,
    env: {
      NODE_ENV: 'test',
      LEOMINAL_HOST: '127.0.0.1',
      LEOMINAL_PORT: e2ePort,
      LEOMINAL_SESSION_SECRET: 'e2e-session-secret-with-enough-length',
      LEOMINAL_SESSION_TTL_SECONDS: '60',
      LEOMINAL_COOKIE_SECURE: 'false',
      LEOMINAL_ALLOWED_ORIGINS: e2eBaseUrl,
      LEOMINAL_STATE_PATH: '.leominal/e2e-state.json',
      LEOMINAL_SHELL: '/bin/sh'
    }
  }
});
