import { chmod, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const controlScript = path.join(repoRoot, 'scripts', 'leominalctl');

describe('leominalctl', () => {
  it('reports stopped when no pid file exists', async () => {
    const appDir = await createFakeApp();

    const result = await runCtl(appDir, ['status']);

    expect(result.status).toBe(3);
    expect(result.stdout).toContain('stopped');
  });

  it('starts, reports, restarts, and stops the local server process', async () => {
    const appDir = await createFakeApp();

    const started = await runCtl(appDir, ['start']);
    expect(started.status).toBe(0);
    expect(started.stdout).toContain('started');

    const firstPid = Number((await readFile(path.join(appDir, '.leominal', 'leominal.pid'), 'utf8')).trim());
    expect(firstPid).toBeGreaterThan(0);

    const status = await runCtl(appDir, ['status']);
    expect(status.status).toBe(0);
    expect(status.stdout).toContain(`running pid=${firstPid}`);

    const duplicate = await runCtl(appDir, ['start']);
    expect(duplicate.status).toBe(0);
    expect(duplicate.stdout).toContain('already running');

    const restarted = await runCtl(appDir, ['restart']);
    expect(restarted.status).toBe(0);
    expect(restarted.stdout).toContain('restarted');

    const secondPid = Number((await readFile(path.join(appDir, '.leominal', 'leominal.pid'), 'utf8')).trim());
    expect(secondPid).toBeGreaterThan(0);
    expect(secondPid).not.toBe(firstPid);

    const stopped = await runCtl(appDir, ['stop']);
    expect(stopped.status).toBe(0);
    expect(stopped.stdout).toContain('stopped');

    const stoppedAgain = await runCtl(appDir, ['status']);
    expect(stoppedAgain.status).toBe(3);
    expect(stoppedAgain.stdout).toContain('stopped');
  });

  it('doctor fails when required runtime files are missing', async () => {
    const appDir = await mkdtemp(path.join(os.tmpdir(), 'leominalctl-missing-'));
    await writeFile(path.join(appDir, '.env'), 'LEOMINAL_HOST=127.0.0.1\nLEOMINAL_PORT=3107\n', 'utf8');

    const result = await runCtl(appDir, ['doctor']);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('dist/server/index.js');
  });

  it('rebuilds node-pty from source during deploy before restart', async () => {
    const appDir = await createFakeApp();
    await writeFile(path.join(appDir, 'package-lock.json'), '{}\n', 'utf8');
    const fakeNpm = path.join(appDir, 'fake-npm');
    const npmLog = path.join(appDir, 'npm.log');
    await writeFile(
      fakeNpm,
      `#!/usr/bin/env bash
echo "$*" >> "${npmLog}"
exit 0
`,
      'utf8'
    );
    await chmod(fakeNpm, 0o755);

    const result = await runCtl(appDir, ['deploy'], { LEOMINAL_NPM_BIN: fakeNpm });
    await runCtl(appDir, ['stop']);

    expect(result.status).toBe(0);
    const log = await readFile(npmLog, 'utf8');
    expect(log).toContain('run typecheck');
    expect(log).toContain('rebuild node-pty --build-from-source');
  });

  it('restarts through a loaded LaunchAgent when it controls this app', async () => {
    const appDir = await createFakeApp();
    await writeFile(path.join(appDir, 'package-lock.json'), '{}\n', 'utf8');
    const fakeNpm = path.join(appDir, 'fake-npm');
    await writeFile(fakeNpm, '#!/usr/bin/env bash\nexit 0\n', 'utf8');
    await chmod(fakeNpm, 0o755);

    const fakeBin = path.join(appDir, 'fake-bin');
    await mkdir(fakeBin);
    const launchctlLog = path.join(appDir, 'launchctl.log');
    const fakeLaunchctl = path.join(fakeBin, 'launchctl');
    await writeFile(
      fakeLaunchctl,
      `#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> "${launchctlLog}"
if [[ "\${1:-}" == "print" ]]; then
  cat <<EOF
gui/501/com.leominal.local = {
  state = not running
  working directory = ${appDir}
}
EOF
  exit 0
fi
if [[ "\${1:-}" == "kickstart" ]]; then
  cd "${appDir}"
  nohup node dist/server/index.js >> .leominal/leominal.log 2>&1 &
  echo "$!" > .leominal/leominal.pid
  chmod 600 .leominal/leominal.pid
  exit 0
fi
exit 1
`,
      'utf8'
    );
    await chmod(fakeLaunchctl, 0o755);

    const pathWithFakeLaunchctl = `${fakeBin}:${process.env.PATH ?? ''}`;

    const result = await runCtl(appDir, ['deploy'], {
      LEOMINAL_NPM_BIN: fakeNpm,
      PATH: pathWithFakeLaunchctl
    });
    await runCtl(appDir, ['stop'], { PATH: pathWithFakeLaunchctl });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('via launchd');
    const launchctlCalls = await readFile(launchctlLog, 'utf8');
    expect(launchctlCalls).toContain('kickstart -k gui/');
  });
});

async function createFakeApp(): Promise<string> {
  const appDir = await mkdtemp(path.join(os.tmpdir(), 'leominalctl-'));
  const port = await freePort();
  await mkdir(path.join(appDir, 'dist', 'server'), { recursive: true });
  await mkdir(path.join(appDir, '.leominal'), { recursive: true });
  await writeFile(
    path.join(appDir, '.env'),
    [
      'LEOMINAL_HOST=127.0.0.1',
      `LEOMINAL_PORT=${port}`,
      'LEOMINAL_SESSION_SECRET=test-session-secret-that-is-long-enough',
      'LEOMINAL_ALLOWED_ORIGINS=http://127.0.0.1:' + port,
      'LEOMINAL_PID_PATH=.leominal/leominal.pid',
      'LEOMINAL_LOG_PATH=.leominal/leominal.log',
      'LEOMINAL_HEALTH_TIMEOUT_SECONDS=5',
      ''
    ].join('\n'),
    'utf8'
  );
  await writeFile(
    path.join(appDir, 'dist', 'server', 'index.js'),
    `
import http from 'node:http';
const host = process.env.LEOMINAL_HOST || '127.0.0.1';
const port = Number(process.env.LEOMINAL_PORT || '3107');
const server = http.createServer((request, response) => {
  if (request.url === '/api/auth/session') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ passwordSet: false, authenticated: false, expiresAt: null }));
    return;
  }
  response.writeHead(200, { 'content-type': 'text/plain' });
  response.end('ok');
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
server.listen(port, host);
`,
    'utf8'
  );
  return appDir;
}

function runCtl(
  appDir: string,
  args: string[],
  extraEnv: Record<string, string> = {}
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('bash', [controlScript, ...args], {
      cwd: appDir,
      env: {
        ...process.env,
        LEOMINAL_APP_DIR: appDir,
        LEOMINALCTL_COLOR: '0',
        ...extraEnv
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}

async function freePort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  if (!address || typeof address === 'string') {
    throw new Error('Failed to allocate port');
  }
  return address.port;
}
