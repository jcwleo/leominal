import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { execFile as execFileCallback } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { promisify } from 'node:util';
import WebSocket from 'ws';
import type { ServerTerminalMessage } from '../../src/shared/protocol.js';
import type { TerminalSummary } from '../../src/shared/types.js';

const e2ePort = Number(process.env.LEOMINAL_E2E_PORT ?? process.env.LEOMINAL_PORT ?? '3117');
const baseUrl = `http://127.0.0.1:${e2ePort}`;
const e2ePassword = 'leominal-e2e-password';
const execFile = promisify(execFileCallback);

test.describe.configure({ mode: 'serial' });

test('browser UI sets the initial password, creates split panes, refreshes, and closes active panes', async ({ page }) => {
  await page.goto('/');

  await page.getByLabel('Password', { exact: true }).fill(e2ePassword);
  await page.getByLabel('Confirm password').fill(e2ePassword);
  await page.getByRole('button', { name: 'Set password' }).click();

  await page.getByRole('button', { name: 'New tab' }).waitFor();
  await expect(page.locator('.xterm-container').first()).toBeVisible();
  await expectTerminalToFillWorkspace(page);
  await page.getByRole('button', { name: 'Split right' }).click();
  await expect(page.getByRole('navigation', { name: 'Terminal tabs' }).getByText('2 panes')).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: 'New tab' }).waitFor();
  await expect(page.getByRole('navigation', { name: 'Terminal tabs' }).getByText('2 panes')).toBeVisible();

  const terminalTabs = page.getByRole('navigation', { name: 'Terminal tabs' });
  await expect(terminalTabs.getByRole('button', { name: /^Close (?!pane)/ })).toHaveCount(0);
  await terminalTabs.getByRole('button', { name: 'Close pane' }).click();
  await expect(terminalTabs.getByText('1 pane')).toBeVisible();
  await terminalTabs.getByRole('button', { name: 'Close pane' }).click();
  await expect(page.getByText('No terminal is open.')).toBeVisible();
});

test('browser UI unlocks with the stored password on a returning visit', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('heading', { name: 'Unlock terminal' }).waitFor();
  await page.getByLabel('Password', { exact: true }).fill(e2ePassword);
  await page.getByRole('button', { name: 'Unlock' }).click();

  await page.getByRole('button', { name: 'New tab' }).waitFor();
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
  firstSocket.send(JSON.stringify({ type: 'input', terminalId: terminal.id, data: `cd ${splitCwd} && printf leominal-e2e\\\\n\r` }));
  await waitForOutput(firstSocket, 'leominal-e2e');
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
}

async function expectTerminalToFillWorkspace(page: Page): Promise<void> {
  await expect.poll(async () => {
    return page.evaluate(() => {
      const workspaceBody = document.querySelector('.workspace-body')?.getBoundingClientRect();
      const terminalPane = document.querySelector('.terminal-pane')?.getBoundingClientRect();
      const xtermContainer = document.querySelector('.xterm-container')?.getBoundingClientRect();
      if (!workspaceBody || !terminalPane || !xtermContainer) {
        return null;
      }
      return {
        bodyHeight: Math.round(workspaceBody.height),
        paneHeight: Math.round(terminalPane.height),
        containerHeight: Math.round(xtermContainer.height)
      };
    });
  }).toEqual(expect.objectContaining({
    bodyHeight: expect.any(Number),
    paneHeight: expect.any(Number),
    containerHeight: expect.any(Number)
  }));

  const sizes = await page.evaluate(() => {
    const workspaceBody = document.querySelector('.workspace-body')?.getBoundingClientRect();
    const terminalPane = document.querySelector('.terminal-pane')?.getBoundingClientRect();
    const xtermContainer = document.querySelector('.xterm-container')?.getBoundingClientRect();
    return {
      bodyHeight: workspaceBody?.height ?? 0,
      paneHeight: terminalPane?.height ?? 0,
      containerHeight: xtermContainer?.height ?? 0
    };
  });

  expect(Math.abs(sizes.bodyHeight - sizes.paneHeight)).toBeLessThanOrEqual(2);
  expect(sizes.containerHeight).toBeGreaterThan(sizes.bodyHeight - 10);
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

function nextTerminalMessage(socket: WebSocket): Promise<ServerTerminalMessage> {
  return new Promise((resolve, reject) => {
    socket.once('message', (data) => resolve(JSON.parse(data.toString()) as ServerTerminalMessage));
    socket.once('error', reject);
  });
}

async function waitForOutput(socket: WebSocket, needle: string): Promise<void> {
  let output = '';
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const message = await nextTerminalMessage(socket);
    if (message.type === 'output') {
      output += message.data;
      if (output.includes(needle)) {
        return;
      }
    }
    if (message.type === 'error') {
      throw new Error(message.message);
    }
  }
  throw new Error(`Timed out waiting for terminal output: ${needle}`);
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
