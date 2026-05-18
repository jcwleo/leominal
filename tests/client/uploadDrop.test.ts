// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { collectUploadDrop, UploadDropError } from '../../src/client/terminal/uploadDrop.js';

describe('collectUploadDrop', () => {
  it('collects dropped files with their file names as relative paths', async () => {
    const alpha = new File(['alpha'], 'alpha.txt', { type: 'text/plain' });
    const beta = new File(['beta'], 'beta.txt', { type: 'text/plain' });

    await expect(collectUploadDrop(dataTransferWithFiles([alpha, beta]))).resolves.toEqual([
      { relativePath: 'alpha.txt', file: alpha },
      { relativePath: 'beta.txt', file: beta }
    ]);
  });

  it('traverses dropped folders and preserves the top-level folder path', async () => {
    const env = new File(['DATABASE_URL=postgres://local'], '.env');
    const readme = new File(['# app'], 'README.md', { type: 'text/markdown' });
    const transfer = dataTransferWithEntries([
      directoryEntry('project', [fileEntry('.env', env), directoryEntry('docs', [fileEntry('README.md', readme)])])
    ]);

    await expect(collectUploadDrop(transfer)).resolves.toEqual([
      { relativePath: 'project/.env', file: env },
      { relativePath: 'project/docs/README.md', file: readme }
    ]);
  });

  it('fails clearly when a dropped folder cannot be traversed by the browser', async () => {
    const transfer = {
      items: [
        {
          kind: 'file',
          type: '',
          getAsFile: () => null
        }
      ],
      files: []
    } as unknown as DataTransfer;

    await expect(collectUploadDrop(transfer)).rejects.toMatchObject(
      new UploadDropError('Folder upload is not supported by this browser.')
    );
  });
});

function dataTransferWithFiles(files: File[]): DataTransfer {
  return {
    items: [],
    files: fileList(files)
  } as unknown as DataTransfer;
}

function dataTransferWithEntries(entries: MockEntry[]): DataTransfer {
  return {
    items: entries.map((entry) => ({
      kind: 'file',
      type: '',
      getAsFile: () => null,
      webkitGetAsEntry: () => entry
    })),
    files: []
  } as unknown as DataTransfer;
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

interface MockFileEntry {
  isFile: true;
  isDirectory: false;
  name: string;
  fullPath: string;
  file(callback: (file: File) => void, errorCallback: (error: DOMException) => void): void;
}

interface MockDirectoryEntry {
  isFile: false;
  isDirectory: true;
  name: string;
  fullPath: string;
  createReader(): {
    readEntries(callback: (entries: MockEntry[]) => void, errorCallback: (error: DOMException) => void): void;
  };
}

type MockEntry = MockFileEntry | MockDirectoryEntry;

function fileEntry(name: string, file: File): MockFileEntry {
  return {
    isFile: true,
    isDirectory: false,
    name,
    fullPath: `/${name}`,
    file: vi.fn((callback) => callback(file))
  };
}

function directoryEntry(name: string, children: MockEntry[]): MockDirectoryEntry {
  return {
    isFile: false,
    isDirectory: true,
    name,
    fullPath: `/${name}`,
    createReader: () => {
      let read = false;
      return {
        readEntries: vi.fn((callback) => {
          if (read) {
            callback([]);
            return;
          }
          read = true;
          callback(children);
        })
      };
    }
  };
}
