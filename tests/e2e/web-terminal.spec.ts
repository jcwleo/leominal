import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { Secret, TOTP } from 'otpauth';
import WebSocket from 'ws';
import type {
  FileCreateResponse,
  FileDeletePreviewResponse,
  FileListResponse,
  FileReadResponse,
  FileRootResponse,
  ServerTerminalMessage,
  UploadManifest,
  UploadResponse
} from '../../src/shared/protocol.js';
import type { AuthLoginResponse, TerminalSummary } from '../../src/shared/types.js';

const e2ePort = Number(process.env.LEOMINAL_E2E_PORT ?? process.env.LEOMINAL_PORT ?? '3117');
const baseUrl = `http://127.0.0.1:${e2ePort}`;
const e2ePassword = 'leominal-e2e-password';
const execFile = promisify(execFileCallback);
let e2eTotpSecret: string | null = null;

test.describe.configure({ mode: 'serial' });

test('browser UI sets the initial password, creates split panes, refreshes, and closes a split pane', async ({ page }) => {
  await page.goto('/');

  await page.getByLabel('Password', { exact: true }).fill(e2ePassword);
  await page.getByLabel('Confirm password').fill(e2ePassword);
  await page.getByRole('button', { name: 'Set password' }).click();

  await waitForWorkspace(page);
  await expect(page.locator('.xterm-container').first()).toBeVisible();
  await expectTerminalToFillWorkspace(page);

  const mobileKeyBar = page.locator('.mobile-terminal-key-bar').first();
  await expect(mobileKeyBar).toHaveCSS('display', 'none');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(mobileKeyBar).toBeVisible();
  await expect(mobileKeyBar.getByRole('button', { name: 'Arm Control modifier' })).toBeVisible();
  await expect(mobileKeyBar.getByRole('button', { name: /command/i })).toHaveCount(0);
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--leominal-keyboard-inset-bottom', '320px');
    document.documentElement.setAttribute('data-leominal-keyboard-visible', 'true');
  });
  await expect(mobileKeyBar).toHaveCSS('position', 'fixed');
  await expect(mobileKeyBar).toHaveCSS('bottom', '324px');
  await page.evaluate(() => {
    document.documentElement.style.removeProperty('--leominal-keyboard-inset-bottom');
    document.documentElement.removeAttribute('data-leominal-keyboard-visible');
  });
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.getByRole('button', { name: 'Split right' }).click();
  await expect(page.getByRole('navigation', { name: 'Terminal tabs' }).getByText('2 panes')).toBeVisible();

  await page.reload();
  await waitForWorkspace(page);
  await expect(page.getByRole('navigation', { name: 'Terminal tabs' }).getByText('2 panes')).toBeVisible();

  const terminalTabs = page.getByRole('navigation', { name: 'Terminal tabs' });
  await expect(terminalTabs.getByRole('button', { name: /^Close (?!pane)/ })).toHaveCount(0);
  await page.getByRole('button', { name: /^Close pane / }).first().click();
  await expect(terminalTabs.getByText('1 pane')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Close pane / })).toHaveCount(0);
});

test('browser UI unlocks with the stored password on a returning visit', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('heading', { name: 'Unlock terminal' }).waitFor();
  await page.getByLabel('Password', { exact: true }).fill(e2ePassword);
  await page.getByRole('button', { name: 'Unlock' }).click();

  await waitForWorkspace(page);
});

test('authenticates with the stored password, opens a PTY, reconnects, splits, and closes terminals', async ({ request }) => {
  await authenticateRequest(request);

  const create = await request.post('/api/terminals', {
    headers: { origin: baseUrl },
    data: { cols: 80, rows: 24 }
  });
  expect(create.status()).toBe(201);
  const terminal = ((await create.json()) as { terminal: TerminalSummary }).terminal;
  expect(terminal.status).toBe('running');

  const cookieHeader = await cookiesForWebSocket(request);
  const firstSocket = await connectTerminal(terminal.id, cookieHeader);
  const snapshot = await nextTerminalMessage(firstSocket);
  expect(snapshot.type).toBe('snapshot');

  const splitCwd = await realpath('/tmp');
  await runTerminalCommand(firstSocket, terminal.id, `cd ${shellQuote(splitCwd)}`, 'leominal-e2e');
  firstSocket.close();

  const reconnected = await connectTerminal(terminal.id, cookieHeader);
  const replay = await nextTerminalMessage(reconnected);
  expect(replay.type).toBe('snapshot');
  expect(replay.output.join('')).toContain('leominal-e2e');
  reconnected.close();

  const split = await request.post('/api/terminals', {
    headers: { origin: baseUrl },
    data: { parentTerminalId: terminal.id, cols: 80, rows: 24 }
  });
  expect(split.status()).toBe(201);
  const splitTerminal = ((await split.json()) as { terminal: TerminalSummary }).terminal;
  expect(splitTerminal.cwd).toBe(splitCwd);

  expect((await request.delete(`/api/terminals/${terminal.id}`, { headers: { origin: baseUrl } })).status()).toBe(204);
  if (terminal.pid) {
    await expectProcessGone(terminal.pid);
  }
  expect((await request.delete(`/api/terminals/${splitTerminal.id}`, { headers: { origin: baseUrl } })).status()).toBe(204);
  if (splitTerminal.pid) {
    await expectProcessGone(splitTerminal.pid);
  }
});

test('uploads files into the live PTY cwd without overwriting collisions', async ({ request }) => {
  await authenticateRequest(request);
  const uploadRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'leominal-e2e-upload-')));
  await writeFile(path.join(uploadRoot, 'note.txt'), 'existing');

  const create = await request.post('/api/terminals', {
    headers: { origin: baseUrl },
    data: { cols: 80, rows: 24 }
  });
  expect(create.status()).toBe(201);
  const terminal = ((await create.json()) as { terminal: TerminalSummary }).terminal;
  const cookieHeader = await cookiesForWebSocket(request);
  const socket = await connectTerminal(terminal.id, cookieHeader);
  const snapshot = await nextTerminalMessage(socket);
  expect(snapshot.type).toBe('snapshot');

  await runTerminalCommand(socket, terminal.id, `cd ${shellQuote(uploadRoot)}`, 'leominal-upload-cwd');

  const manifest: UploadManifest = {
    terminalId: terminal.id,
    entries: [{ fieldName: 'file0', relativePath: 'note.txt', size: 8 }]
  };
  const upload = await request.post('/api/uploads', {
    headers: { origin: baseUrl },
    multipart: {
      manifest: JSON.stringify(manifest),
      file0: {
        name: 'note.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('uploaded')
      }
    }
  });

  expect(upload.status()).toBe(200);
  expect((await upload.json()) as UploadResponse).toEqual({
    destinationCwd: uploadRoot,
    uploaded: 1,
    failed: 0,
    results: [{ relativePath: 'note.txt', savedRelativePath: 'note 2.txt', status: 'uploaded', size: 8 }]
  });
  expect(await readFile(path.join(uploadRoot, 'note.txt'), 'utf8')).toBe('existing');
  expect(await readFile(path.join(uploadRoot, 'note 2.txt'), 'utf8')).toBe('uploaded');

  socket.close();
  expect((await request.delete(`/api/terminals/${terminal.id}`, { headers: { origin: baseUrl } })).status()).toBe(204);
  if (terminal.pid) {
    await expectProcessGone(terminal.pid);
  }
});

test('file explorer API is scoped to the active PTY cwd and blocks stale or escaping writes', async ({ request }) => {
  await authenticateRequest(request);
  const fileRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'leominal-e2e-files-')));
  await writeFile(path.join(fileRoot, 'README.md'), '# old\n');

  const create = await request.post('/api/terminals', {
    headers: { origin: baseUrl },
    data: { cols: 80, rows: 24 }
  });
  expect(create.status()).toBe(201);
  const terminal = ((await create.json()) as { terminal: TerminalSummary }).terminal;
  const cookieHeader = await cookiesForWebSocket(request);
  const socket = await connectTerminal(terminal.id, cookieHeader);
  const snapshot = await nextTerminalMessage(socket);
  expect(snapshot.type).toBe('snapshot');

  await runTerminalCommand(socket, terminal.id, `cd ${shellQuote(fileRoot)}`, 'leominal-files-cwd');

  const rootResponse = await request.post('/api/files/root', {
    headers: { origin: baseUrl },
    data: { terminalId: terminal.id }
  });
  expect(rootResponse.status()).toBe(200);
  const rootBody = (await rootResponse.json()) as FileRootResponse;
  expect(rootBody.rootPath).toBe(fileRoot);

  const listResponse = await filePost(request, '/api/files/list', { rootToken: rootBody.rootToken, path: '' });
  expect(listResponse.status()).toBe(200);
  expect(((await listResponse.json()) as FileListResponse).entries).toEqual(
    expect.arrayContaining([expect.objectContaining({ name: 'README.md', path: 'README.md', kind: 'file', editable: true })])
  );

  const createDirectory = await filePost(request, '/api/files/create', { rootToken: rootBody.rootToken, path: 'notes', kind: 'directory' });
  expect(createDirectory.status()).toBe(200);
  const createFile = await filePost(request, '/api/files/create', { rootToken: rootBody.rootToken, path: 'notes/todo.txt', kind: 'file' });
  expect(createFile.status()).toBe(200);
  expect(((await createFile.json()) as FileCreateResponse).entry).toEqual(
    expect.objectContaining({ path: 'notes/todo.txt', kind: 'file', editable: true })
  );

  const readResponse = await filePost(request, '/api/files/read', { rootToken: rootBody.rootToken, path: 'README.md' });
  expect(readResponse.status()).toBe(200);
  const readBody = (await readResponse.json()) as FileReadResponse;
  expect(readBody.content).toBe('# old\n');
  expect(readBody.language).toBe('markdown');

  const writeResponse = await filePost(request, '/api/files/write', {
    rootToken: rootBody.rootToken,
    path: 'README.md',
    content: '# newer\n',
    expectedVersion: readBody.version
  });
  expect(writeResponse.status()).toBe(200);
  expect(await readFile(path.join(fileRoot, 'README.md'), 'utf8')).toBe('# newer\n');

  await writeFile(path.join(fileRoot, 'README.md'), '# changed outside leominal\n');
  const staleWrite = await filePost(request, '/api/files/write', {
    rootToken: rootBody.rootToken,
    path: 'README.md',
    content: '# stale\n',
    expectedVersion: readBody.version
  });
  expect(staleWrite.status()).toBe(409);
  expect(await readFile(path.join(fileRoot, 'README.md'), 'utf8')).toBe('# changed outside leominal\n');

  const moveResponse = await filePost(request, '/api/files/move', {
    rootToken: rootBody.rootToken,
    sourcePath: 'notes/todo.txt',
    destinationPath: 'notes/done.txt'
  });
  expect(moveResponse.status()).toBe(200);
  const deletePreview = await filePost(request, '/api/files/delete-preview', { rootToken: rootBody.rootToken, path: 'notes/done.txt' });
  expect(deletePreview.status()).toBe(200);
  const deleteResponse = await filePost(request, '/api/files/delete', {
    rootToken: rootBody.rootToken,
    path: 'notes/done.txt',
    previewToken: ((await deletePreview.json()) as FileDeletePreviewResponse).previewToken
  });
  expect(deleteResponse.status()).toBe(200);

  const unsafePath = await filePost(request, '/api/files/read', { rootToken: rootBody.rootToken, path: '../escape.txt' });
  expect(unsafePath.status()).toBe(400);

  socket.close();
  expect((await request.delete(`/api/terminals/${terminal.id}`, { headers: { origin: baseUrl } })).status()).toBe(204);
  if (terminal.pid) {
    await expectProcessGone(terminal.pid);
  }
});

test('settings modal enrolls TOTP and requires password plus code on the next login', async ({ page }) => {
  await page.goto('/');
  await unlockPageWithPassword(page);
  await waitForWorkspace(page);

  const manualKey = await enrollTotpFromSettings(page);
  e2eTotpSecret = manualKey;

  await page.getByRole('button', { name: 'logout' }).click();
  await page.getByRole('heading', { name: 'Unlock terminal' }).waitFor();
  await page.getByLabel('Password', { exact: true }).fill(e2ePassword);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByRole('heading', { name: 'Verify code' }).waitFor();
  await page.getByLabel('Verification code').fill(generateTotpCode(manualKey));
  await page.getByRole('button', { name: 'Verify' }).click();

  await waitForWorkspace(page);
});

async function authenticateRequest(request: APIRequestContext): Promise<void> {
  const session = await request.get('/api/auth/session');
  expect(session.ok()).toBe(true);
  const status = (await session.json()) as { passwordSet: boolean };
  const route = status.passwordSet ? '/api/auth/login' : '/api/auth/password';
  const response = await request.post(route, {
    headers: { origin: baseUrl },
    data: { password: e2ePassword }
  });
  expect(response.ok()).toBe(true);
  const authResponse = (await response.json()) as AuthLoginResponse;
  if (authResponse.twoFactorRequired) {
    if (!e2eTotpSecret) {
      throw new Error('TOTP is enabled, but the e2e TOTP secret is not available.');
    }
    const verifyResponse = await request.post('/api/auth/totp/verify', {
      headers: { origin: baseUrl },
      data: { code: generateTotpCode(e2eTotpSecret) }
    });
    expect(verifyResponse.ok()).toBe(true);
  }
}

async function unlockPageWithPassword(page: Page): Promise<void> {
  await page.getByRole('heading', { name: 'Unlock terminal' }).waitFor();
  await page.getByLabel('Password', { exact: true }).fill(e2ePassword);
  await page.getByRole('button', { name: 'Unlock' }).click();
}

async function enrollTotpFromSettings(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog.getByRole('tab', { name: 'Security' })).toBeVisible();
  await expect(dialog.getByText('Two-factor authentication')).toBeVisible();
  await dialog.getByRole('button', { name: 'Enable 2FA' }).click();
  const manualKey = await dialog.getByLabel('Manual setup key').inputValue();
  await dialog.getByLabel('Verification code').fill(generateTotpCode(manualKey));
  await dialog.getByRole('button', { name: 'Verify' }).click();
  await expect(dialog.getByText('2FA enabled')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close settings' }).click();
  return manualKey;
}

async function waitForWorkspace(page: Page): Promise<void> {
  const terminalTabs = page.getByRole('navigation', { name: 'Terminal tabs' });
  await terminalTabs.getByRole('button', { name: 'New tab' }).waitFor();
}

async function filePost(request: APIRequestContext, url: string, data: unknown) {
  return request.post(url, {
    headers: { origin: baseUrl },
    data
  });
}

async function expectTerminalToFillWorkspace(page: Page): Promise<void> {
  await expect.poll(async () => {
    return page.evaluate(() => {
      const workspaceBody = document.querySelector('.workspace-body')?.getBoundingClientRect();
      const terminalPane = document.querySelector('.terminal-pane')?.getBoundingClientRect();
      const terminalHeader = document.querySelector('.terminal-pane-header')?.getBoundingClientRect();
      const xtermContainer = document.querySelector('.xterm-container')?.getBoundingClientRect();
      if (!workspaceBody || !terminalPane || !terminalHeader || !xtermContainer) {
        return null;
      }
      return {
        bodyHeight: Math.round(workspaceBody.height),
        paneHeight: Math.round(terminalPane.height),
        headerHeight: Math.round(terminalHeader.height),
        containerHeight: Math.round(xtermContainer.height)
      };
    });
  }).toEqual(expect.objectContaining({
    bodyHeight: expect.any(Number),
    paneHeight: expect.any(Number),
    headerHeight: expect.any(Number),
    containerHeight: expect.any(Number)
  }));

  const sizes = await page.evaluate(() => {
    const workspaceBody = document.querySelector('.workspace-body')?.getBoundingClientRect();
    const terminalPane = document.querySelector('.terminal-pane')?.getBoundingClientRect();
    const terminalHeader = document.querySelector('.terminal-pane-header')?.getBoundingClientRect();
    const xtermContainer = document.querySelector('.xterm-container')?.getBoundingClientRect();
    return {
      bodyHeight: workspaceBody?.height ?? 0,
      paneHeight: terminalPane?.height ?? 0,
      headerHeight: terminalHeader?.height ?? 0,
      containerHeight: xtermContainer?.height ?? 0
    };
  });

  expect(Math.abs(sizes.bodyHeight - sizes.paneHeight)).toBeLessThanOrEqual(2);
  expect(sizes.containerHeight).toBeGreaterThan(sizes.paneHeight - sizes.headerHeight - 10);
}

async function cookiesForWebSocket(request: APIRequestContext): Promise<string> {
  const state = await request.storageState();
  return state.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}

async function connectTerminal(terminalId: string, cookieHeader: string): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${e2ePort}/api/terminals/${terminalId}/ws`, {
    headers: {
      cookie: cookieHeader,
      origin: baseUrl
    }
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
    socket.once('close', (code, reason) => {
      reject(new Error(`WebSocket closed before open: ${code} ${reason.toString()}`));
    });
  });
  return socket;
}

async function runTerminalCommand(socket: WebSocket, terminalId: string, command: string, marker: string): Promise<void> {
  const output = waitForOutput(socket, marker);
  socket.send(
    JSON.stringify({
      type: 'input',
      terminalId,
      data: `${command} && printf '${octalEscape(marker)}\\n'\r`
    })
  );
  await output;
}

function nextTerminalMessage(socket: WebSocket): Promise<ServerTerminalMessage> {
  return new Promise((resolve, reject) => {
    socket.once('message', (data) => resolve(JSON.parse(data.toString()) as ServerTerminalMessage));
    socket.once('error', reject);
  });
}

async function waitForOutput(socket: WebSocket, needle: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for terminal output: ${needle}`));
    }, 10_000);
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off('message', onMessage);
      socket.off('error', onError);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onMessage = (data: WebSocket.RawData) => {
      const message = JSON.parse(data.toString()) as ServerTerminalMessage;
      if (message.type === 'output') {
        output += message.data;
        if (output.includes(needle)) {
          cleanup();
          resolve();
        }
      }
      if (message.type === 'error') {
        cleanup();
        reject(new Error(message.message));
      }
    };
    socket.on('message', onMessage);
    socket.on('error', onError);
  });
}

async function expectProcessGone(pid: number): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const { stdout } = await execFile('ps', ['-p', String(pid), '-o', 'command=']);
      if (!stdout.includes('/bin/sh')) {
        return;
      }
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Process ${pid} was still present after terminal close`);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function octalEscape(value: string): string {
  return [...Buffer.from(value, 'utf8')].map((byte) => `\\${byte.toString(8).padStart(3, '0')}`).join('');
}

function generateTotpCode(secret: string): string {
  return new TOTP({
    issuer: 'Leominal',
    label: 'Leominal',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret)
  }).generate();
}
