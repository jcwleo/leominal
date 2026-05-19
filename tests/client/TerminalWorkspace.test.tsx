// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CreateTerminalRequest,
  PasswordRequest,
  TerminalLayoutResponse,
  TerminalListResponse,
  TerminalResponse,
  UpdateTerminalLayoutRequest
} from '../../src/shared/protocol.js';
import type { AuthSessionStatus, TerminalId, TerminalLayoutState, TerminalSummary } from '../../src/shared/types.js';
import { ApiError } from '../../src/client/api/client.js';
import type { ApiClient } from '../../src/client/api/client.js';

const uploadFilesMock = vi.hoisted(() => vi.fn());

vi.mock('../../src/client/api/uploadClient.js', () => ({
  uploadFiles: uploadFilesMock
}));

vi.mock('../../src/client/terminal/SplitPane.js', () => ({
  SplitPane: ({ onClose, onResize }: { onClose?: (terminalId: string) => void; onResize?: (path: number[], ratio: number) => void }) => (
    <div data-testid="split-pane">
      terminal canvas
      <button type="button" onClick={() => onClose?.('term-alpha')}>
        Close pane term-alpha
      </button>
      <button type="button" onClick={() => onResize?.([], 0.7)}>
        Resize panes
      </button>
    </div>
  )
}));

import { TerminalWorkspace } from '../../src/client/terminal/TerminalWorkspace.js';

function terminal(id: string, title = 'Bash'): TerminalSummary {
  return {
    id,
    title,
    cwd: `/workspace/${id}`,
    pid: 100,
    cols: 80,
    rows: 24,
    createdAt: '2026-05-17T00:00:00.000Z',
    updatedAt: '2026-05-17T00:00:00.000Z',
    status: 'running',
    exitCode: null
  };
}

function createApi(initialTerminals: TerminalSummary[] = [terminal('term-alpha', 'Alpha')]): ApiClient {
  const state: {
    terminals: TerminalSummary[];
    nextId: number;
    layoutResponse: TerminalLayoutResponse;
  } = {
    terminals: [...initialTerminals],
    nextId: 1,
    layoutResponse: { layout: null, revision: 0, updatedAt: null }
  };

  return {
    getSession: vi.fn<() => Promise<AuthSessionStatus>>(),
    setupPassword: vi.fn<(request: PasswordRequest) => Promise<AuthSessionStatus>>(),
    login: vi.fn<(request: PasswordRequest) => Promise<AuthSessionStatus>>(),
    logout: vi.fn<() => Promise<AuthSessionStatus>>(),
    listTerminals: vi.fn(async (): Promise<TerminalListResponse> => ({ terminals: [...state.terminals] })),
    getTerminalLayout: vi.fn(async (): Promise<TerminalLayoutResponse> => state.layoutResponse),
    saveTerminalLayout: vi.fn(async (request: UpdateTerminalLayoutRequest): Promise<TerminalLayoutResponse> => {
      state.layoutResponse = {
        layout: request.layout,
        revision: state.layoutResponse.revision + 1,
        updatedAt: '2026-05-17T00:00:00.000Z'
      };
      return state.layoutResponse;
    }),
    createTerminal: vi.fn(async (_request?: CreateTerminalRequest): Promise<TerminalResponse> => {
      const created = terminal(`term-created-${state.nextId}`, `Created ${state.nextId}`);
      state.nextId += 1;
      state.terminals.push(created);
      return { terminal: created };
    }),
    closeTerminal: vi.fn(async (terminalId: TerminalId): Promise<void> => {
      state.terminals = state.terminals.filter((candidate) => candidate.id !== terminalId);
    })
  };
}

function serverLayout(layout: TerminalLayoutState | null, revision = 3): TerminalLayoutResponse {
  return {
    layout,
    revision,
    updatedAt: layout ? '2026-05-17T00:00:00.000Z' : null
  };
}

function splitLayout(): TerminalLayoutState {
  return {
    activeWorkspaceId: 'workspace-default',
    workspaces: [
      {
        id: 'workspace-default',
        title: 'Leominal',
        activeTabId: 'tab-ops',
        tabs: [
          {
            id: 'tab-ops',
            title: 'Ops',
            activeTerminalId: 'term-beta',
            root: {
              type: 'split',
              direction: 'vertical',
              ratio: 0.5,
              first: { type: 'pane', terminalId: 'term-alpha' },
              second: { type: 'pane', terminalId: 'term-beta' }
            }
          }
        ]
      }
    ]
  };
}

describe('TerminalWorkspace', () => {
  afterEach(cleanup);

  beforeEach(() => {
    const storage = memoryStorage();
    Object.defineProperty(window, 'localStorage', {
      value: storage,
      configurable: true
    });
    Object.defineProperty(globalThis, 'localStorage', {
      value: storage,
      configurable: true
    });
    uploadFilesMock.mockReset();
    uploadFilesMock.mockResolvedValue({
      destinationCwd: '/workspace/term-alpha',
      uploaded: 1,
      failed: 0,
      results: [{ relativePath: 'notes.txt', savedRelativePath: 'notes.txt', status: 'uploaded', size: 5 }]
    });
  });

  it('renders a cmux-style shell around the active terminal', async () => {
    const api = createApi();

    render(<TerminalWorkspace api={api} />);

    const workspaces = await screen.findByRole('navigation', { name: 'Workspaces' });
    expect(workspaces).toBeVisible();
    expect(screen.getByText('workspaces')).toBeVisible();
    expect(within(workspaces).getByText('Leominal')).toBeVisible();
    const tabs = screen.getByRole('navigation', { name: 'Terminal tabs' });
    expect(tabs).toBeVisible();
    expect(screen.getByRole('button', { name: 'New tab' })).toBeVisible();
    expect(within(tabs).getByRole('button', { name: 'Split right' })).toBeVisible();
    expect(within(tabs).getByRole('button', { name: 'Split down' })).toBeVisible();
    expect(within(tabs).queryByRole('button', { name: 'Close pane' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Close pane term-alpha' })).toBeVisible();
    expect(screen.queryByRole('toolbar', { name: 'Workspace actions' })).toBeNull();
    expect(screen.queryByText('1 pane(s)')).toBeNull();
    expect(screen.getByTestId('split-pane')).toBeVisible();
  });

  it('collapses the workspace sidebar and disables rename while collapsed', async () => {
    const api = createApi();

    render(<TerminalWorkspace api={api} />);

    const shell = await screen.findByRole('main');
    const workspaces = screen.getByRole('navigation', { name: 'Workspaces' });

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));

    expect(shell).toHaveAttribute('data-collapsed', 'true');
    fireEvent.doubleClick(within(workspaces).getByRole('button', { name: 'Select workspace Leominal' }));
    expect(within(workspaces).queryByLabelText('Rename workspace Leominal')).toBeNull();
  });

  it('renders session expiry next to logout in the sidebar footer', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-05-17T00:00:00.000Z').getTime());
    const api = createApi();

    try {
      render(<TerminalWorkspace api={api} sessionExpiresAt="2026-05-17T11:10:00.000Z" />);

      await screen.findByRole('navigation', { name: 'Workspaces' });

      expect(screen.getByText('session · 11h left')).toBeVisible();
      expect(screen.getByRole('button', { name: 'logout' })).toBeVisible();
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('reloads the app from the status bar reload button', async () => {
    const api = createApi();
    const onReload = vi.fn();

    render(<TerminalWorkspace api={api} onReload={onReload} />);

    await screen.findByRole('navigation', { name: 'Workspaces' });
    fireEvent.click(screen.getByRole('button', { name: 'Reload app' }));

    expect(onReload).toHaveBeenCalledOnce();
  });

  it('creates a terminal from the top tab bar add button', async () => {
    const api = createApi();

    render(<TerminalWorkspace api={api} />);

    const tabs = await screen.findByRole('navigation', { name: 'Terminal tabs' });
    fireEvent.click(within(tabs).getByRole('button', { name: 'New tab' }));

    expect(api.createTerminal).toHaveBeenCalledTimes(1);
  });

  it('creates workspaces from the left rail and shows only that workspace tab set', async () => {
    const api = createApi();

    render(<TerminalWorkspace api={api} />);

    const workspaces = await screen.findByRole('navigation', { name: 'Workspaces' });
    const tabs = screen.getByRole('navigation', { name: 'Terminal tabs' });
    expect(within(tabs).getByText('Alpha')).toBeVisible();

    fireEvent.click(within(workspaces).getByRole('button', { name: 'New workspace' }));
    fireEvent.click(within(workspaces).getByRole('button', { name: /^Workspace 2/ }));

    expect(screen.getByText('No terminal is open.')).toBeVisible();
    expect(within(tabs).queryByText('Alpha')).toBeNull();
    expect(api.createTerminal).not.toHaveBeenCalled();

    fireEvent.click(within(tabs).getByRole('button', { name: 'New tab' }));

    expect(await within(tabs).findByText('Created 1')).toBeVisible();
    expect(within(tabs).queryByText('Alpha')).toBeNull();

    fireEvent.click(within(workspaces).getByRole('button', { name: /^Leominal/ }));

    expect(within(tabs).getByText('Alpha')).toBeVisible();
    expect(within(tabs).queryByText('Created 1')).toBeNull();
  });

  it('renames a workspace from the left rail', async () => {
    const api = createApi();

    render(<TerminalWorkspace api={api} />);

    const workspaces = await screen.findByRole('navigation', { name: 'Workspaces' });
    fireEvent.doubleClick(within(workspaces).getByRole('button', { name: /^Leominal/ }));
    const input = within(workspaces).getByLabelText('Rename workspace Leominal');
    fireEvent.change(input, { target: { value: 'Ops' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(within(workspaces).getByText('Ops')).toBeVisible();
  });

  it('cancels workspace rename on escape', async () => {
    const api = createApi();

    render(<TerminalWorkspace api={api} />);

    const workspaces = await screen.findByRole('navigation', { name: 'Workspaces' });
    fireEvent.doubleClick(within(workspaces).getByRole('button', { name: /^Leominal/ }));
    const input = within(workspaces).getByLabelText('Rename workspace Leominal');
    fireEvent.change(input, { target: { value: 'Ops' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(within(workspaces).getByText('Leominal')).toBeVisible();
    expect(within(workspaces).queryByText('Ops')).toBeNull();
  });

  it('closes workspaces from the left rail and closes their terminals', async () => {
    const api = createApi();

    render(<TerminalWorkspace api={api} />);

    const workspaces = await screen.findByRole('navigation', { name: 'Workspaces' });
    const tabs = screen.getByRole('navigation', { name: 'Terminal tabs' });

    fireEvent.click(within(workspaces).getByRole('button', { name: 'New workspace' }));
    fireEvent.click(within(workspaces).getByRole('button', { name: /^Workspace 2/ }));
    fireEvent.click(within(tabs).getByRole('button', { name: 'New tab' }));

    expect(await within(tabs).findByText('Created 1')).toBeVisible();

    fireEvent.click(within(workspaces).getByRole('button', { name: 'Close Workspace 2' }));

    await waitFor(() => expect(api.closeTerminal).toHaveBeenCalledWith('term-created-1'));
    expect(within(workspaces).queryByText('Workspace 2')).toBeNull();
    expect(within(tabs).getByText('Alpha')).toBeVisible();
  });

  it('still closes a workspace when one of its terminals is already gone on the server', async () => {
    const api = createApi();
    vi.mocked(api.closeTerminal).mockRejectedValueOnce(new ApiError(404, 'terminal_not_found'));

    render(<TerminalWorkspace api={api} />);

    const workspaces = await screen.findByRole('navigation', { name: 'Workspaces' });
    const tabs = screen.getByRole('navigation', { name: 'Terminal tabs' });

    fireEvent.click(within(workspaces).getByRole('button', { name: 'New workspace' }));
    fireEvent.click(within(workspaces).getByRole('button', { name: /^Workspace 2/ }));
    fireEvent.click(within(tabs).getByRole('button', { name: 'New tab' }));

    expect(await within(tabs).findByText('Created 1')).toBeVisible();

    fireEvent.click(within(workspaces).getByRole('button', { name: 'Close Workspace 2' }));

    await waitFor(() => expect(within(workspaces).queryByText('Workspace 2')).toBeNull());
    expect(within(tabs).getByText('Alpha')).toBeVisible();
    expect(screen.queryByText('terminal_not_found')).toBeNull();
  });

  it('hydrates terminal tabs from the server layout before falling back to inferred tabs', async () => {
    const api = createApi([terminal('term-alpha', 'Alpha'), terminal('term-beta', 'Beta')]);
    vi.mocked(api.getTerminalLayout).mockResolvedValue(serverLayout(splitLayout(), 4));

    render(<TerminalWorkspace api={api} />);

    const tabs = await screen.findByRole('navigation', { name: 'Terminal tabs' });
    const serverTab = within(tabs).getByRole('button', { name: 'Select Ops' });

    expect(serverTab).toHaveTextContent('2 panes');
    expect(within(tabs).queryByRole('button', { name: 'Select Alpha' })).toBeNull();
    expect(within(tabs).queryByRole('button', { name: 'Select Beta' })).toBeNull();
    expect(api.saveTerminalLayout).not.toHaveBeenCalled();
  });

  it('selects panes from keyboard shortcuts without bubbling handled key events', async () => {
    const api = createApi([terminal('term-alpha', 'Alpha'), terminal('term-beta', 'Beta')]);
    vi.mocked(api.getTerminalLayout).mockResolvedValue(serverLayout(splitLayout(), 4));
    const bubbled = vi.fn();
    document.addEventListener('keydown', bubbled);

    try {
      render(<TerminalWorkspace api={api} />);

      const shell = await screen.findByRole('main');
      expect(screen.getByText('Beta')).toBeVisible();

      const paneNumber = new KeyboardEvent('keydown', {
        key: '1',
        metaKey: true,
        bubbles: true,
        cancelable: true
      });
      shell.dispatchEvent(paneNumber);

      await waitFor(() => expect(screen.getByText('Alpha')).toBeVisible());
      expect(paneNumber.defaultPrevented).toBe(true);
      expect(bubbled).not.toHaveBeenCalled();

      fireEvent.keyDown(shell, { key: ']', metaKey: true });
      await waitFor(() => expect(screen.getByText('Beta')).toBeVisible());

      fireEvent.keyDown(shell, { key: 'ArrowLeft', metaKey: true, altKey: true });
      await waitFor(() => expect(screen.getByText('Alpha')).toBeVisible());

      fireEvent.keyDown(shell, { key: '2', metaKey: true, altKey: true });
      await waitFor(() => expect(screen.getByText('Beta')).toBeVisible());

      fireEvent.keyDown(shell, { key: '9', metaKey: true });
      expect(screen.getByText('Beta')).toBeVisible();
    } finally {
      document.removeEventListener('keydown', bubbled);
    }
  });

  it('does not handle shortcut-like keys from editable or composing targets', async () => {
    const api = createApi([terminal('term-alpha', 'Alpha'), terminal('term-beta', 'Beta')]);
    vi.mocked(api.getTerminalLayout).mockResolvedValue(serverLayout(splitLayout(), 4));
    const bubbled = vi.fn();
    document.addEventListener('keydown', bubbled);

    try {
      render(<TerminalWorkspace api={api} />);

      const shell = await screen.findByRole('main');
      expect(screen.getByText('Beta')).toBeVisible();

      const editable = document.createElement('div');
      editable.setAttribute('contenteditable', 'plaintext-only');
      shell.append(editable);

      const editableEvent = new KeyboardEvent('keydown', {
        key: '1',
        metaKey: true,
        bubbles: true,
        cancelable: true
      });
      editable.dispatchEvent(editableEvent);

      expect(editableEvent.defaultPrevented).toBe(false);
      expect(bubbled).toHaveBeenCalledTimes(1);
      expect(screen.getByText('Beta')).toBeVisible();

      const processEvent = new KeyboardEvent('keydown', {
        key: 'Process',
        metaKey: true,
        bubbles: true,
        cancelable: true
      });
      shell.dispatchEvent(processEvent);

      expect(processEvent.defaultPrevented).toBe(false);
      expect(bubbled).toHaveBeenCalledTimes(2);
      expect(screen.getByText('Beta')).toBeVisible();

      const composingEvent = new KeyboardEvent('keydown', {
        key: '1',
        metaKey: true,
        bubbles: true,
        cancelable: true,
        isComposing: true
      });
      shell.dispatchEvent(composingEvent);

      expect(composingEvent.defaultPrevented).toBe(false);
      expect(bubbled).toHaveBeenCalledTimes(3);
      expect(screen.getByText('Beta')).toBeVisible();
    } finally {
      document.removeEventListener('keydown', bubbled);
    }
  });

  it('selects workspaces from ctrl number shortcuts', async () => {
    const api = createApi();

    render(<TerminalWorkspace api={api} />);

    const shell = await screen.findByRole('main');
    const workspaces = screen.getByRole('navigation', { name: 'Workspaces' });
    const tabs = screen.getByRole('navigation', { name: 'Terminal tabs' });

    fireEvent.click(within(workspaces).getByRole('button', { name: 'New workspace' }));
    fireEvent.click(within(workspaces).getByRole('button', { name: /^Workspace 2/ }));
    expect(screen.getByText('No terminal is open.')).toBeVisible();

    fireEvent.keyDown(shell, { key: '1', ctrlKey: true });

    await waitFor(() => expect(within(tabs).getByText('Alpha')).toBeVisible());
    expect(within(workspaces).getByRole('button', { name: /^Leominal/ })).toHaveAttribute('aria-current', 'page');

    fireEvent.keyDown(shell, { key: '9', ctrlKey: true });
    expect(within(workspaces).getByRole('button', { name: /^Leominal/ })).toHaveAttribute('aria-current', 'page');
  });

  it('migrates a saved local workspace layout when the server has no layout yet', async () => {
    const api = createApi([terminal('term-alpha', 'Alpha'), terminal('term-beta', 'Beta')]);
    vi.mocked(api.getTerminalLayout).mockResolvedValue(serverLayout(null, 0));
    const localLayout = splitLayout();
    localStorage.setItem('leominal.terminalWorkspaces.v2', JSON.stringify(localLayout));

    render(<TerminalWorkspace api={api} />);

    const tabs = await screen.findByRole('navigation', { name: 'Terminal tabs' });
    expect(within(tabs).getByRole('button', { name: 'Select Ops' })).toHaveTextContent('2 panes');
    await waitFor(() => {
      expect(api.saveTerminalLayout).toHaveBeenCalledWith({ layout: localLayout, baseRevision: 0 });
    });
  });

  it('does not persist the inferred fallback layout on first mount', async () => {
    const api = createApi([terminal('term-alpha', 'Alpha'), terminal('term-beta', 'Beta')]);
    vi.mocked(api.getTerminalLayout).mockResolvedValue(serverLayout(null, 0));

    render(<TerminalWorkspace api={api} />);

    const tabs = await screen.findByRole('navigation', { name: 'Terminal tabs' });
    expect(within(tabs).getByRole('button', { name: 'Select Alpha' })).toBeVisible();
    expect(within(tabs).getByRole('button', { name: 'Select Beta' })).toBeVisible();
    expect(api.saveTerminalLayout).not.toHaveBeenCalled();
    expect(localStorage.getItem('leominal.terminalWorkspaces.v2')).toBeNull();
  });

  it('saves explicit layout changes to the server after hydration', async () => {
    const api = createApi([terminal('term-alpha', 'Alpha')]);
    vi.mocked(api.getTerminalLayout).mockResolvedValue(serverLayout(null, 6));

    render(<TerminalWorkspace api={api} />);

    const workspaces = await screen.findByRole('navigation', { name: 'Workspaces' });
    fireEvent.click(within(workspaces).getByRole('button', { name: 'New workspace' }));

    await waitFor(() => {
      expect(api.saveTerminalLayout).toHaveBeenCalledWith({
        layout: expect.objectContaining({
          activeWorkspaceId: expect.stringMatching(/^workspace-/),
          workspaces: expect.arrayContaining([
            expect.objectContaining({ id: 'workspace-default' }),
            expect.objectContaining({ title: 'Workspace 2' })
          ])
        }),
        baseRevision: 6
      });
    });
    expect(localStorage.getItem('leominal.terminalWorkspaces.v2')).toContain('Workspace 2');
  });

  it('adopts the server layout instead of overwriting after a stale revision conflict', async () => {
    const api = createApi([terminal('term-alpha', 'Alpha'), terminal('term-beta', 'Beta')]);
    vi.mocked(api.getTerminalLayout)
      .mockResolvedValueOnce(serverLayout(null, 6))
      .mockResolvedValueOnce(serverLayout(splitLayout(), 7));
    vi.mocked(api.saveTerminalLayout).mockRejectedValueOnce(new ApiError(409, 'stale_terminal_layout_revision'));

    render(<TerminalWorkspace api={api} />);

    const workspaces = await screen.findByRole('navigation', { name: 'Workspaces' });
    fireEvent.click(within(workspaces).getByRole('button', { name: 'New workspace' }));

    await waitFor(() => {
      expect(api.getTerminalLayout).toHaveBeenCalledTimes(2);
    });

    const tabs = screen.getByRole('navigation', { name: 'Terminal tabs' });
    expect(api.saveTerminalLayout).toHaveBeenCalledTimes(1);
    expect(within(tabs).getByRole('button', { name: 'Select Ops' })).toHaveTextContent('2 panes');
    expect(localStorage.getItem('leominal.terminalWorkspaces.v2')).toContain('"tab-ops"');
  });

  it('flushes a pending debounced layout save when unmounted', async () => {
    const api = createApi([terminal('term-alpha', 'Alpha')]);
    vi.mocked(api.getTerminalLayout).mockResolvedValue(serverLayout(null, 6));
    const rendered = render(<TerminalWorkspace api={api} />);

    const workspaces = await screen.findByRole('navigation', { name: 'Workspaces' });
    fireEvent.click(within(workspaces).getByRole('button', { name: 'New workspace' }));
    rendered.unmount();

    await waitFor(() => {
      expect(api.saveTerminalLayout).toHaveBeenCalledWith({
        layout: expect.objectContaining({
          workspaces: expect.arrayContaining([expect.objectContaining({ title: 'Workspace 2' })])
        }),
        baseRevision: 6
      });
    });
    expect(localStorage.getItem('leominal.terminalWorkspaces.v2')).toContain('Workspace 2');
  });

  it('does not mark failed server saves as persisted so the same layout can retry', async () => {
    const api = createApi([terminal('term-alpha', 'Alpha')]);
    vi.mocked(api.getTerminalLayout).mockResolvedValue(serverLayout(null, 6));
    vi.mocked(api.saveTerminalLayout)
      .mockRejectedValueOnce(new ApiError(500, 'temporary_failure'))
      .mockResolvedValueOnce(serverLayout(null, 7));

    render(<TerminalWorkspace api={api} />);

    const workspaces = await screen.findByRole('navigation', { name: 'Workspaces' });
    fireEvent.click(within(workspaces).getByRole('button', { name: 'New workspace' }));

    await waitFor(() => expect(api.saveTerminalLayout).toHaveBeenCalledTimes(1));
    fireEvent.click(within(workspaces).getByRole('button', { name: /^Workspace 2/ }));

    await waitFor(() => expect(api.saveTerminalLayout).toHaveBeenCalledTimes(2));
  });

  it('shows a popup failure when files are dropped without an active pane', async () => {
    const api = createApi([terminal('term-alpha', 'Alpha')]);

    render(<TerminalWorkspace api={api} />);

    const workspaces = await screen.findByRole('navigation', { name: 'Workspaces' });
    fireEvent.click(within(workspaces).getByRole('button', { name: 'New workspace' }));
    fireEvent.click(within(workspaces).getByRole('button', { name: /^Workspace 2/ }));

    fireEvent.drop(screen.getByRole('main'), dropFiles([new File(['hello'], 'notes.txt')]));

    expect(await screen.findByRole('alert')).toHaveTextContent('No active running terminal');
    expect(uploadFilesMock).not.toHaveBeenCalled();
  });

  it('uploads dropped files to the active running terminal captured at drop time', async () => {
    const api = createApi([terminal('term-alpha', 'Alpha')]);
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });

    render(<TerminalWorkspace api={api} />);

    await screen.findByTestId('split-pane');
    fireEvent.drop(screen.getByRole('main'), dropFiles([file]));

    await waitFor(() => {
      expect(uploadFilesMock).toHaveBeenCalledWith(
        expect.objectContaining({
          terminalId: 'term-alpha',
          files: [{ relativePath: 'notes.txt', file }]
        })
      );
    });
  });

  it('renders upload progress and partial results in the popup', async () => {
    const api = createApi([terminal('term-alpha', 'Alpha')]);
    let resolveUpload: ((value: unknown) => void) | null = null;
    uploadFilesMock.mockImplementation(({ onProgress }: { onProgress?: (progress: { loaded: number; total: number; percent: number }) => void }) => {
      onProgress?.({ loaded: 5, total: 10, percent: 50 });
      return new Promise((resolve) => {
        resolveUpload = resolve;
      });
    });

    render(<TerminalWorkspace api={api} />);

    await screen.findByTestId('split-pane');
    fireEvent.drop(screen.getByRole('main'), dropFiles([new File(['hello'], 'notes.txt')]));

    expect(await screen.findByRole('status')).toHaveTextContent('50%');

    const finishUpload = resolveUpload as ((value: unknown) => void) | null;
    if (!finishUpload) {
      throw new Error('Upload promise was not started.');
    }
    finishUpload({
      destinationCwd: '/workspace/term-alpha',
      uploaded: 1,
      failed: 1,
      results: [
        { relativePath: 'notes.txt', savedRelativePath: 'notes 2.txt', status: 'uploaded', size: 5 },
        { relativePath: 'private.txt', status: 'failed', error: 'permission denied' }
      ]
    });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Uploaded 1 of 2 files');
    });
    expect(screen.getByRole('alert')).toHaveTextContent('/workspace/term-alpha');
    expect(screen.getByText('notes 2.txt')).toBeVisible();
    expect(screen.getByText('private.txt')).toBeVisible();
    expect(screen.getAllByText('permission denied').length).toBeGreaterThan(0);
  });

  it('prioritizes failed upload results even when they are after the first five entries', async () => {
    const api = createApi([terminal('term-alpha', 'Alpha')]);
    uploadFilesMock.mockResolvedValueOnce({
      destinationCwd: '/workspace/term-alpha',
      uploaded: 5,
      failed: 1,
      results: [
        { relativePath: 'ok-1.txt', savedRelativePath: 'ok-1.txt', status: 'uploaded', size: 1 },
        { relativePath: 'ok-2.txt', savedRelativePath: 'ok-2.txt', status: 'uploaded', size: 1 },
        { relativePath: 'ok-3.txt', savedRelativePath: 'ok-3.txt', status: 'uploaded', size: 1 },
        { relativePath: 'ok-4.txt', savedRelativePath: 'ok-4.txt', status: 'uploaded', size: 1 },
        { relativePath: 'ok-5.txt', savedRelativePath: 'ok-5.txt', status: 'uploaded', size: 1 },
        { relativePath: 'blocked.txt', status: 'failed', error: 'permission denied' }
      ]
    });

    render(<TerminalWorkspace api={api} />);

    await screen.findByTestId('split-pane');
    fireEvent.drop(screen.getByRole('main'), dropFiles([new File(['hello'], 'notes.txt')]));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Uploaded 5 of 6 files');
    });
    expect(screen.getByRole('alert')).toHaveTextContent('permission denied');
    expect(screen.getByText('blocked.txt')).toBeVisible();
  });
});

function dropFiles(files: File[]): { dataTransfer: DataTransfer } {
  return {
    dataTransfer: {
      types: ['Files'],
      items: [],
      files: fileList(files)
    } as unknown as DataTransfer
  };
}

function fileList(files: File[]): FileList {
  return {
    length: files.length,
    item: (index: number) => files[index] ?? null,
    [Symbol.iterator]: function* () {
      yield* files;
    }
  } as FileList;
}

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    }
  };
}
