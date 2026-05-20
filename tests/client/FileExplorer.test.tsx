// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  FileCreateRequest,
  FileCreateResponse,
  FileDeletePreviewRequest,
  FileDeletePreviewResponse,
  FileDeleteRequest,
  FileDeleteResponse,
  FileEntry,
  FileListRequest,
  FileListResponse,
  FileOpenRequest,
  FileMoveRequest,
  FileMoveResponse,
  FileReadRequest,
  FileReadResponse,
  FileRootRequest,
  FileRootResponse,
  FileVersion,
  FileWriteRequest,
  FileWriteResponse
} from '../../src/shared/protocol.js';
import type { ApiClient } from '../../src/client/api/client.js';
import { FileExplorer } from '../../src/client/files/FileExplorer.js';

const version: FileVersion = { size: 12, mtimeMs: 1_779_000_000_000, ino: 7 };

function entry(overrides: Partial<FileEntry> & Pick<FileEntry, 'name' | 'path' | 'kind'>): FileEntry {
  return {
    size: null,
    mtime: '2026-05-20T00:00:00.000Z',
    editable: false,
    previewKind: 'none',
    ...overrides
  };
}

function createFileApi() {
  const lists = new Map<string, FileEntry[]>([
    [
      '',
      [
        entry({ name: 'docs', path: 'docs', kind: 'directory' }),
        entry({ name: 'notes.txt', path: 'notes.txt', kind: 'file', size: 12, editable: true }),
        entry({ name: 'README.md', path: 'README.md', kind: 'file', size: 22, editable: true }),
        entry({ name: 'diagram.png', path: 'diagram.png', kind: 'file', size: 33, previewKind: 'image' }),
        entry({ name: 'archive.zip', path: 'archive.zip', kind: 'file', size: 44 })
      ]
    ],
    ['docs', [entry({ name: 'guide.md', path: 'docs/guide.md', kind: 'file', size: 18, editable: true })]]
  ]);
  const reads = new Map<string, FileReadResponse>([
    ['notes.txt', { path: 'notes.txt', content: 'hello\n', language: 'text', version }],
    ['README.md', { path: 'README.md', content: '# Title\n\n- [x] done\n', language: 'markdown', version }],
    ['docs/guide.md', { path: 'docs/guide.md', content: '# Guide\n', language: 'markdown', version }]
  ]);
  const createdEntry = entry({ name: 'todo.txt', path: 'todo.txt', kind: 'file', size: 0, editable: true });
  const movedEntry = entry({ name: 'notes-renamed.txt', path: 'notes-renamed.txt', kind: 'file', size: 12, editable: true });
  const api = {
    createFileRoot: vi.fn(async (request: FileRootRequest): Promise<FileRootResponse> => fileRoot(request.terminalId)),
    listFiles: vi.fn(async (request: FileListRequest): Promise<FileListResponse> => ({
      rootPath: rootPathFromToken(request.rootToken),
      path: request.path,
      entries: lists.get(request.path) ?? []
    })),
    readFile: vi.fn(async (request: FileReadRequest): Promise<FileReadResponse> => {
      const response = reads.get(request.path);
      if (!response) {
        throw new Error(`Missing read fixture for ${request.path}`);
      }
      return response;
    }),
    writeFile: vi.fn(async (request: FileWriteRequest): Promise<FileWriteResponse> => ({
      path: request.path,
      version: { ...request.expectedVersion, size: request.content.length, mtimeMs: request.expectedVersion.mtimeMs + 1 }
    })),
    createFileEntry: vi.fn(async (_request: FileCreateRequest): Promise<FileCreateResponse> => ({ entry: createdEntry })),
    moveFileEntry: vi.fn(async (_request: FileMoveRequest): Promise<FileMoveResponse> => ({ entry: movedEntry })),
    previewDeleteFileEntry: vi.fn(async (request: FileDeletePreviewRequest): Promise<FileDeletePreviewResponse> => ({
      path: request.path,
      kind: 'file',
      descendantCount: 0,
      previewToken: 'delete-token'
    })),
	    deleteFileEntry: vi.fn(async (request: FileDeleteRequest): Promise<FileDeleteResponse> => ({ path: request.path, deleted: true })),
	    previewFile: vi.fn(async () => new Blob(['png'], { type: 'image/png' }))
	  } as unknown as ApiClient;

	  return { api, lists };
	}

function renderExplorer(
  api: ApiClient,
  onOpenFile = vi.fn(async (_request: FileOpenRequest): Promise<void> => undefined)
) {
  const rendered = render(<FileExplorer api={api} activeTerminalId="term-alpha" onOpenFile={onOpenFile} />);
  return { ...rendered, onOpenFile };
}

describe('FileExplorer', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:preview-url'),
      revokeObjectURL: vi.fn()
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('requests the active terminal root and lists root entries', async () => {
    const { api } = createFileApi();

    renderExplorer(api);

    expect(await screen.findByText('/workspace/term-alpha')).toBeVisible();
    expect(api.createFileRoot).toHaveBeenCalledWith({ terminalId: 'term-alpha' });
    expect(api.listFiles).toHaveBeenCalledWith({ rootToken: 'root-alpha', path: '' });
    expect(screen.getByRole('button', { name: 'Open folder docs' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Open file notes.txt' })).toBeVisible();
  });

  it('expands and collapses directories without leaving the root tree', async () => {
    const { api } = createFileApi();

    renderExplorer(api);

    const docs = await screen.findByRole('button', { name: 'Open folder docs' });
    fireEvent.click(docs);

    await waitFor(() => expect(api.listFiles).toHaveBeenLastCalledWith({ rootToken: 'root-alpha', path: 'docs' }));
    expect(screen.getByText('/workspace/term-alpha/docs')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Open file guide.md' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Open file notes.txt' })).toBeVisible();

    fireEvent.click(docs);

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Open file guide.md' })).not.toBeInTheDocument());
  });

  it('expands directories inline as a tree without hiding sibling root entries', async () => {
    const { api } = createFileApi();

    renderExplorer(api);

    const docs = await screen.findByRole('button', { name: 'Open folder docs' });
    fireEvent.click(docs);

    await waitFor(() => expect(api.listFiles).toHaveBeenLastCalledWith({ rootToken: 'root-alpha', path: 'docs' }));
    expect(docs).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Open file guide.md' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Open file notes.txt' })).toBeVisible();
  });

  it('previews a text file on click and opens it in a pane only on double click', async () => {
    const { api } = createFileApi();
    const { onOpenFile } = renderExplorer(api);

    const notes = await screen.findByRole('button', { name: 'Open file notes.txt' });
    fireEvent.click(notes);

    expect(await screen.findByLabelText('Preview for notes.txt')).toHaveTextContent('hello');
    expect(screen.queryByLabelText('Editor for notes.txt')).not.toBeInTheDocument();
    expect(onOpenFile).not.toHaveBeenCalled();

    fireEvent.doubleClick(notes);

    await waitFor(() => expect(onOpenFile).toHaveBeenCalledWith({ rootToken: 'root-alpha', path: 'notes.txt' }));
    expect(screen.queryByLabelText('Editor for notes.txt')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Preview for notes.txt')).toHaveTextContent('hello');
  });

  it('opens the selected text file in a pane when pressing Enter', async () => {
    const { api } = createFileApi();
    const { onOpenFile } = renderExplorer(api);

    const notes = await screen.findByRole('button', { name: 'Open file notes.txt' });
    fireEvent.click(notes);
    await screen.findByLabelText('Preview for notes.txt');

    fireEvent.keyDown(notes, { key: 'Enter' });

    await waitFor(() => expect(onOpenFile).toHaveBeenCalledWith({ rootToken: 'root-alpha', path: 'notes.txt' }));
    expect(screen.queryByLabelText('Editor for notes.txt')).not.toBeInTheDocument();
  });

  it('previews markdown on click and opens it in a pane after explicit open', async () => {
    const { api } = createFileApi();
    const { onOpenFile } = renderExplorer(api);

    const readme = await screen.findByRole('button', { name: 'Open file README.md' });
    fireEvent.click(readme);

    expect(await screen.findByRole('heading', { name: 'Title' })).toBeVisible();
    expect(screen.queryByLabelText('Editor for README.md')).not.toBeInTheDocument();

    fireEvent.doubleClick(readme);

    await waitFor(() => expect(onOpenFile).toHaveBeenCalledWith({ rootToken: 'root-alpha', path: 'README.md' }));
    expect(screen.queryByLabelText('Editor for README.md')).not.toBeInTheDocument();
  });

  it('ignores stale read responses from an older file selection', async () => {
    const { api } = createFileApi();
    let resolveNotes: (response: FileReadResponse) => void = () => undefined;
    vi.mocked(api.readFile).mockImplementation(async (request) => {
      if (request.path === 'notes.txt') {
        return new Promise<FileReadResponse>((resolve) => {
          resolveNotes = resolve;
        });
      }
      return {
        path: 'README.md',
        content: '# Fresh\n',
        language: 'markdown',
        version
      };
    });

    renderExplorer(api);

    fireEvent.click(await screen.findByRole('button', { name: 'Open file notes.txt' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open file README.md' }));

    expect(await screen.findByRole('heading', { name: 'Fresh' })).toBeVisible();
    resolveNotes({ path: 'notes.txt', content: 'late notes\n', language: 'text', version });
    await waitFor(() => expect(screen.queryByLabelText('Editor for notes.txt')).not.toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Fresh' })).toBeVisible();
  });

  it('does not create preview object URLs after unmounting during a preview request', async () => {
    const { api } = createFileApi();
    let resolvePreview: (blob: Blob) => void = () => undefined;
    vi.mocked(api.previewFile).mockImplementationOnce(
      async () =>
        new Promise<Blob>((resolve) => {
          resolvePreview = resolve;
        })
    );
    const { unmount } = renderExplorer(api);

    fireEvent.click(await screen.findByRole('button', { name: 'Open file diagram.png' }));
    unmount();
    resolvePreview(new Blob(['png'], { type: 'image/png' }));

    await waitFor(() => expect(URL.createObjectURL).not.toHaveBeenCalled());
  });

  it('disables unsupported files', async () => {
    const { api } = createFileApi();

    renderExplorer(api);

    expect(await screen.findByRole('button', { name: 'Open file archive.zip' })).toBeDisabled();
  });

  it('requests preview blobs for previewable files', async () => {
    const { api } = createFileApi();

    renderExplorer(api);

    fireEvent.click(await screen.findByRole('button', { name: 'Open file diagram.png' }));

    await waitFor(() => expect(api.previewFile).toHaveBeenCalledWith({ rootToken: 'root-alpha', path: 'diagram.png' }));
    expect(screen.getByRole('img', { name: 'diagram.png' })).toHaveAttribute('src', 'blob:preview-url');
  });

  it('creates files from the toolbar', async () => {
    const { api } = createFileApi();
    vi.spyOn(window, 'prompt').mockReturnValue('todo.txt');

    renderExplorer(api);

    fireEvent.click(await screen.findByRole('button', { name: 'New file' }));

    await waitFor(() => {
      expect(api.createFileEntry).toHaveBeenCalledWith({ rootToken: 'root-alpha', path: 'todo.txt', kind: 'file' });
    });
    expect(api.listFiles).toHaveBeenLastCalledWith({ rootToken: 'root-alpha', path: '' });
  });

  it('creates directories from the toolbar', async () => {
    const { api } = createFileApi();
    vi.spyOn(window, 'prompt').mockReturnValue('drafts');

    renderExplorer(api);

    fireEvent.click(await screen.findByRole('button', { name: 'New folder' }));

    await waitFor(() => {
      expect(api.createFileEntry).toHaveBeenCalledWith({ rootToken: 'root-alpha', path: 'drafts', kind: 'directory' });
    });
  });

  it('moves the selected entry after prompting for a destination', async () => {
    const { api } = createFileApi();
    vi.spyOn(window, 'prompt').mockReturnValue('notes-renamed.txt');

    renderExplorer(api);

    fireEvent.click(await screen.findByRole('button', { name: 'Open file notes.txt' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Move selected entry' }));

    await waitFor(() => {
      expect(api.moveFileEntry).toHaveBeenCalledWith({
        rootToken: 'root-alpha',
        sourcePath: 'notes.txt',
        destinationPath: 'notes-renamed.txt'
      });
    });
  });

  it('deletes the selected entry after preview confirmation', async () => {
    const { api } = createFileApi();
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderExplorer(api);

    fireEvent.click(await screen.findByRole('button', { name: 'Open file notes.txt' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete selected entry' }));

    await waitFor(() => expect(api.previewDeleteFileEntry).toHaveBeenCalledWith({ rootToken: 'root-alpha', path: 'notes.txt' }));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('notes.txt'));
    expect(api.deleteFileEntry).toHaveBeenCalledWith({ rootToken: 'root-alpha', path: 'notes.txt', previewToken: 'delete-token' });
  });

  it('refreshes by minting a new root from the current active pane cwd', async () => {
    const { api } = createFileApi();
    vi.mocked(api.createFileRoot)
      .mockResolvedValueOnce({
        rootToken: 'root-alpha-1',
        terminalId: 'term-alpha',
        rootPath: '/workspace/term-alpha',
        issuedAt: '2026-05-20T00:00:00.000Z'
      })
      .mockResolvedValueOnce({
        rootToken: 'root-alpha-2',
        terminalId: 'term-alpha',
        rootPath: '/workspace/term-alpha-next',
        issuedAt: '2026-05-20T00:00:01.000Z'
      });

    renderExplorer(api);

    await screen.findByText('/workspace/term-alpha');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh files' }));

    await waitFor(() => expect(api.createFileRoot).toHaveBeenCalledTimes(2));
    expect(api.listFiles).toHaveBeenLastCalledWith({ rootToken: 'root-alpha-2', path: '' });
    expect(await screen.findByText('/workspace/term-alpha-next')).toBeVisible();
  });
});

function fileRoot(terminalId: string): FileRootResponse {
  const suffix = terminalId.replace(/^term-/, '');
  return {
    rootToken: `root-${suffix}`,
    terminalId,
    rootPath: `/workspace/${terminalId}`,
    issuedAt: '2026-05-20T00:00:00.000Z'
  };
}

function rootPathFromToken(rootToken: string): string {
  const suffix = rootToken.replace(/^root-/, '').replace(/-\d+$/, '');
  return rootToken.endsWith('-2') ? `/workspace/term-${suffix}-next` : `/workspace/term-${suffix}`;
}
