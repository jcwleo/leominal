import { access, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { UploadManifest } from '../../src/shared/protocol.js';
import { createUploadSession, UploadRequestError } from '../../src/server/uploads/uploadService.js';

describe('upload service', () => {
  it('streams uploaded files into the destination cwd and returns only relative saved paths', async () => {
    const root = await tempUploadRoot();
    const session = await createUploadSession({
      destinationCwd: root,
      limits: uploadLimits(),
      manifest: {
        terminalId: 'terminal-1',
        entries: [{ fieldName: 'file-1', relativePath: 'notes.txt', size: 5 }]
      }
    });

    await session.writeFile('file-1', Readable.from(['hello']));
    const response = await session.finish();

    expect(await readFile(path.join(root, 'notes.txt'), 'utf8')).toBe('hello');
    expect(response).toEqual({
      destinationCwd: root,
      uploaded: 1,
      failed: 0,
      results: [{ relativePath: 'notes.txt', savedRelativePath: 'notes.txt', status: 'uploaded', size: 5 }]
    });
    expect(JSON.stringify(response.results)).not.toContain(root);
  });

  it('keeps successful files when other manifest entries fail validation or never arrive', async () => {
    const root = await tempUploadRoot();
    const manifest: UploadManifest = {
      terminalId: 'terminal-1',
      entries: [
        { fieldName: 'file-1', relativePath: 'ok.txt', size: 2 },
        { fieldName: 'file-2', relativePath: '../escape.txt', size: 2 },
        { fieldName: 'file-3', relativePath: 'missing.txt', size: 2 }
      ]
    };
    const session = await createUploadSession({ destinationCwd: root, limits: uploadLimits(), manifest });

    await session.writeFile('file-1', Readable.from(['ok']));
    const response = await session.finish();

    expect(await readFile(path.join(root, 'ok.txt'), 'utf8')).toBe('ok');
    await expect(access(path.join(root, 'escape.txt'))).rejects.toThrow();
    await expect(access(path.join(root, 'missing.txt'))).rejects.toThrow();
    expect(response).toEqual({
      destinationCwd: root,
      uploaded: 1,
      failed: 2,
      results: [
        { relativePath: 'ok.txt', savedRelativePath: 'ok.txt', status: 'uploaded', size: 2 },
        { relativePath: '../escape.txt', status: 'failed', error: 'unsafe_relative_path' },
        { relativePath: 'missing.txt', status: 'failed', error: 'missing_file' }
      ]
    });
  });

  it('removes partially written files after a stream write failure', async () => {
    const root = await tempUploadRoot();
    const session = await createUploadSession({
      destinationCwd: root,
      limits: uploadLimits(),
      manifest: {
        terminalId: 'terminal-1',
        entries: [{ fieldName: 'file-1', relativePath: 'broken.txt', size: 7 }]
      }
    });

    await session.writeFile('file-1', failingStream('partial'));
    const response = await session.finish();

    await expect(access(path.join(root, 'broken.txt'))).rejects.toThrow();
    expect(response).toEqual({
      destinationCwd: root,
      uploaded: 0,
      failed: 1,
      results: [{ relativePath: 'broken.txt', savedRelativePath: 'broken.txt', status: 'failed', error: 'write_failed' }]
    });
  });

  it('does not delete a file that appears after planning but before the no-overwrite write', async () => {
    const root = await tempUploadRoot();
    const session = await createUploadSession({
      destinationCwd: root,
      limits: uploadLimits(),
      manifest: {
        terminalId: 'terminal-1',
        entries: [{ fieldName: 'file-1', relativePath: 'race.txt', size: 6 }]
      }
    });
    await writeFile(path.join(root, 'race.txt'), 'winner');

    await session.writeFile('file-1', Readable.from(['loser']));
    const response = await session.finish();

    expect(await readFile(path.join(root, 'race.txt'), 'utf8')).toBe('winner');
    expect(response).toEqual({
      destinationCwd: root,
      uploaded: 0,
      failed: 1,
      results: [{ relativePath: 'race.txt', savedRelativePath: 'race.txt', status: 'failed', error: 'target_exists' }]
    });
  });

  it('rejects writes through symlinked parent directories created after planning', async () => {
    const root = await tempUploadRoot();
    const outside = await tempUploadRoot();
    const session = await createUploadSession({
      destinationCwd: root,
      limits: uploadLimits(),
      manifest: {
        terminalId: 'terminal-1',
        entries: [{ fieldName: 'file-1', relativePath: 'project/outside/escape.txt', size: 6 }]
      }
    });
    await mkdir(path.join(root, 'project'));
    await symlink(outside, path.join(root, 'project', 'outside'));

    await session.writeFile('file-1', Readable.from(['escape']));
    const response = await session.finish();

    await expect(access(path.join(outside, 'escape.txt'))).rejects.toThrow();
    expect(response).toEqual({
      destinationCwd: root,
      uploaded: 0,
      failed: 1,
      results: [
        {
          relativePath: 'project/outside/escape.txt',
          savedRelativePath: 'project/outside/escape.txt',
          status: 'failed',
          error: 'unsafe_parent_path'
        }
      ]
    });
  });

  it('rejects duplicate manifest field names before writing any files', async () => {
    const root = await tempUploadRoot();
    await expect(
      createUploadSession({
        destinationCwd: root,
        limits: uploadLimits(),
        manifest: {
          terminalId: 'terminal-1',
          entries: [
            { fieldName: 'file-1', relativePath: 'first.txt', size: 5 },
            { fieldName: 'file-1', relativePath: 'second.txt', size: 6 }
          ]
        }
      })
    ).rejects.toEqual(new UploadRequestError(400, 'duplicate_upload_field'));
  });

  it('aborts only files created by the current upload session', async () => {
    const root = await tempUploadRoot();
    await writeFile(path.join(root, 'existing.txt'), 'existing');
    const session = await createUploadSession({
      destinationCwd: root,
      limits: uploadLimits(),
      manifest: {
        terminalId: 'terminal-1',
        entries: [{ fieldName: 'file-1', relativePath: 'created.txt', size: 7 }]
      }
    });

    await session.writeFile('file-1', Readable.from(['created']));
    await session.abort();

    await expect(access(path.join(root, 'created.txt'))).rejects.toThrow();
    expect(await readFile(path.join(root, 'existing.txt'), 'utf8')).toBe('existing');
  });
});

function uploadLimits() {
  return {
    uploadMaxFiles: 1024,
    uploadMaxFileBytes: 536_870_912,
    uploadMaxBatchBytes: 2_147_483_648
  };
}

async function tempUploadRoot(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'leominal-upload-service-'));
}

function failingStream(chunk: string): Readable {
  let sent = false;
  return new Readable({
    read() {
      if (sent) {
        return;
      }
      sent = true;
      this.push(chunk);
      this.destroy(new Error('stream failed'));
    }
  });
}
