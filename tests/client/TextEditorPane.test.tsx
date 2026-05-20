// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileWriteRequest, FileWriteResponse, FileVersion } from '../../src/shared/protocol.js';
import type { ApiClient } from '../../src/client/api/client.js';
import { TextEditorPane } from '../../src/client/files/TextEditorPane.js';

const version: FileVersion = { size: 6, mtimeMs: 1_779_000_000_000, ino: 7 };

describe('TextEditorPane', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('saves edited content through the file API', async () => {
    const api = {
      writeFile: vi.fn(async (request: FileWriteRequest): Promise<FileWriteResponse> => ({
        path: request.path,
        version: { ...request.expectedVersion, size: request.content.length, mtimeMs: request.expectedVersion.mtimeMs + 1 }
      }))
    } as unknown as ApiClient;

    render(
      <TextEditorPane
        api={api}
        editor={{
          id: 'editor-notes',
          title: 'notes.txt',
          rootToken: 'root-alpha',
          path: 'notes.txt',
          read: { path: 'notes.txt', content: 'hello\n', language: 'text', version }
        }}
        canClose
        onClose={() => undefined}
      />
    );

    fireEvent.change(screen.getByLabelText('Editor for notes.txt'), { target: { value: 'hello world\n' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save notes.txt' }));

    await waitFor(() => {
      expect(api.writeFile).toHaveBeenCalledWith({
        rootToken: 'root-alpha',
        path: 'notes.txt',
        content: 'hello world\n',
        expectedVersion: version
      });
    });
    expect(screen.getByText('saved')).toBeVisible();
  });

  it('autosaves edited content after one second', async () => {
    vi.useFakeTimers();
    const api = {
      writeFile: vi.fn(async (request: FileWriteRequest): Promise<FileWriteResponse> => ({
        path: request.path,
        version: { ...request.expectedVersion, size: request.content.length, mtimeMs: request.expectedVersion.mtimeMs + 1 }
      }))
    } as unknown as ApiClient;

    render(
      <TextEditorPane
        api={api}
        editor={{
          id: 'editor-notes',
          title: 'notes.txt',
          rootToken: 'root-alpha',
          path: 'notes.txt',
          read: { path: 'notes.txt', content: 'hello\n', language: 'text', version }
        }}
        canClose
        onClose={() => undefined}
      />
    );

    fireEvent.change(screen.getByLabelText('Editor for notes.txt'), { target: { value: 'hello autosave\n' } });

    await act(async () => {
      vi.advanceTimersByTime(999);
    });
    expect(api.writeFile).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });

    expect(api.writeFile).toHaveBeenCalledWith({
      rootToken: 'root-alpha',
      path: 'notes.txt',
      content: 'hello autosave\n',
      expectedVersion: version
    });
  });

  it('shows a markdown preview for markdown documents from the editor toolbar', () => {
    const api = {
      writeFile: vi.fn()
    } as unknown as ApiClient;

    render(
      <TextEditorPane
        api={api}
        editor={{
          id: 'editor-readme',
          title: 'README.md',
          rootToken: 'root-alpha',
          path: 'README.md',
          read: {
            path: 'README.md',
            content: '# Title\n\n- [x] done\n',
            language: 'markdown',
            version
          }
        }}
        canClose
        onClose={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Preview README.md' }));

    expect(screen.getByLabelText('Markdown preview for README.md')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Title' })).toBeVisible();
    expect(screen.queryByLabelText('Editor for README.md')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit README.md' }));

    expect(screen.getByLabelText('Editor for README.md')).toHaveValue('# Title\n\n- [x] done\n');
  });
});
