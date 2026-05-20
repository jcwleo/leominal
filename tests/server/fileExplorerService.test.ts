import { access, mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../src/server/config.js';
import { FileExplorerService } from '../../src/server/files/fileExplorerService.js';

describe('file explorer service', () => {
  it('lists root entries without following symlinks', async () => {
    const root = await tempRoot();
    const outside = await tempRoot();
    await writeFile(path.join(root, 'README.md'), '# hello');
    await mkdir(path.join(root, 'src'));
    await symlink(outside, path.join(root, 'outside-link'));

    const response = await service().list(root, '');

    expect(response.rootPath).toBe(await realpath(root));
    expect(response.path).toBe('');
    expect(response.entries).toEqual([
      expect.objectContaining({ name: 'outside-link', path: 'outside-link', kind: 'symlink', editable: false, previewKind: 'none' }),
      expect.objectContaining({ name: 'README.md', path: 'README.md', kind: 'file', editable: true, previewKind: 'none' }),
      expect.objectContaining({ name: 'src', path: 'src', kind: 'directory', editable: false, previewKind: 'none' })
    ]);
  });

  it.each(['../escape.txt', '/tmp/escape.txt', 'nested\\escape.txt', 'bad\0name.txt', 'C:/escape.txt'])(
    'rejects unsafe relative paths: %s',
    async (unsafePath) => {
      await expect(service().list(await tempRoot(), unsafePath)).rejects.toMatchObject({
        statusCode: 400,
        code: 'invalid_file_path'
      });
    }
  );

  it('rejects reads through symlinks', async () => {
    const root = await tempRoot();
    const outside = await tempRoot();
    await writeFile(path.join(outside, 'secret.txt'), 'secret');
    await symlink(outside, path.join(root, 'outside-link'));

    await expect(service().readText(root, 'outside-link/secret.txt')).rejects.toMatchObject({
      statusCode: 400,
      code: 'symlink_not_allowed'
    });
  });

  it('reads and writes text files with stale version conflicts', async () => {
    const root = await tempRoot();
    await writeFile(path.join(root, 'README.md'), '# old');
    const explorer = service();

    const read = await explorer.readText(root, 'README.md');
    const written = await explorer.writeText(root, 'README.md', '# newer', read.version);

    expect(read).toEqual({
      path: 'README.md',
      content: '# old',
      language: 'markdown',
      version: expect.objectContaining({ size: 5 })
    });
    expect(written).toEqual({
      path: 'README.md',
      version: expect.objectContaining({ size: 7 })
    });
    expect(await readFile(path.join(root, 'README.md'), 'utf8')).toBe('# newer');
    await expect(explorer.writeText(root, 'README.md', '# stale', read.version)).rejects.toMatchObject({
      statusCode: 409,
      code: 'file_version_conflict'
    });
  });

  it('rejects binary or invalid UTF-8 files as unsupported text', async () => {
    const root = await tempRoot();
    await writeFile(path.join(root, 'binary.txt'), Buffer.from([0x68, 0x00, 0x69]));
    await writeFile(path.join(root, 'invalid.txt'), Buffer.from([0xff, 0xfe]));
    const explorer = service();

    await expect(explorer.readText(root, 'binary.txt')).rejects.toMatchObject({
      statusCode: 415,
      code: 'unsupported_text_file'
    });
    await expect(explorer.readText(root, 'invalid.txt')).rejects.toMatchObject({
      statusCode: 415,
      code: 'unsupported_text_file'
    });
  });

  it('only marks likely text files editable in directory listings', async () => {
    const root = await tempRoot();
    await writeFile(path.join(root, 'archive.zip'), Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    await writeFile(path.join(root, 'package.json'), '{"name":"fixture"}');
    await writeFile(path.join(root, 'Dockerfile'), 'FROM node:24\n');

    const response = await service().list(root, '');

    expect(response.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'archive.zip', kind: 'file', editable: false, previewKind: 'none' }),
        expect.objectContaining({ name: 'package.json', kind: 'file', editable: true, previewKind: 'none' }),
        expect.objectContaining({ name: 'Dockerfile', kind: 'file', editable: true, previewKind: 'none' })
      ])
    );
  });

  it('creates a file entry under an existing parent directory', async () => {
    const root = await tempRoot();
    await mkdir(path.join(root, 'notes'));

    const entry = await service().createEntry(root, 'notes/todo.txt', 'file');

    expect(entry).toEqual(expect.objectContaining({ name: 'todo.txt', path: 'notes/todo.txt', kind: 'file', editable: true }));
    expect(await readFile(path.join(root, 'notes', 'todo.txt'), 'utf8')).toBe('');
  });

  it('moves a file entry within the root', async () => {
    const root = await tempRoot();
    await mkdir(path.join(root, 'docs'));
    await writeFile(path.join(root, 'todo.txt'), 'todo');

    const entry = await service().moveEntry(root, 'todo.txt', 'docs/todo.txt');

    expect(entry).toEqual(expect.objectContaining({ name: 'todo.txt', path: 'docs/todo.txt', kind: 'file' }));
    await expect(access(path.join(root, 'todo.txt'))).rejects.toThrow();
    expect(await readFile(path.join(root, 'docs', 'todo.txt'), 'utf8')).toBe('todo');
  });

  it('does not overwrite an existing destination when moving entries', async () => {
    const root = await tempRoot();
    await writeFile(path.join(root, 'source.txt'), 'source');
    await writeFile(path.join(root, 'target.txt'), 'target');

    await expect(service().moveEntry(root, 'source.txt', 'target.txt')).rejects.toMatchObject({
      statusCode: 409,
      code: 'target_exists'
    });
    expect(await readFile(path.join(root, 'source.txt'), 'utf8')).toBe('source');
    expect(await readFile(path.join(root, 'target.txt'), 'utf8')).toBe('target');
  });

  it('requires a matching preview token before deletion', async () => {
    const root = await tempRoot();
    await mkdir(path.join(root, 'docs'));
    await writeFile(path.join(root, 'docs', 'todo.txt'), 'todo');
    const explorer = service();
    const rootToken = 'signed-root-token';

    const preview = await explorer.previewDelete(root, 'docs', rootToken);

    expect(preview).toEqual({
      path: 'docs',
      kind: 'directory',
      descendantCount: 1,
      previewToken: expect.any(String)
    });
    await expect(explorer.deleteEntry(root, 'docs', 'wrong-preview-token', rootToken)).rejects.toMatchObject({
      statusCode: 409,
      code: 'invalid_delete_preview_token'
    });

    await expect(explorer.deleteEntry(root, 'docs', preview.previewToken, rootToken)).resolves.toEqual({ path: 'docs', deleted: true });
    await expect(access(path.join(root, 'docs'))).rejects.toThrow();
  });

  it('rejects stale delete preview tokens when the target is replaced', async () => {
    const root = await tempRoot();
    const target = path.join(root, 'todo.txt');
    await writeFile(target, 'first target');
    const explorer = service();
    const rootToken = 'signed-root-token';

    const preview = await explorer.previewDelete(root, 'todo.txt', rootToken);
    await writeFile(target, 'replacement target');

    await expect(explorer.deleteEntry(root, 'todo.txt', preview.previewToken, rootToken)).rejects.toMatchObject({
      statusCode: 409,
      code: 'invalid_delete_preview_token'
    });
    expect(await readFile(target, 'utf8')).toBe('replacement target');
  });
});

function service(overrides: Partial<AppConfig> = {}): FileExplorerService {
  return new FileExplorerService({
    sessionSecret: 'file-explorer-service-secret',
    fileListMaxEntries: 2000,
    fileTextMaxBytes: 1_048_576,
    filePreviewMaxBytes: 52_428_800,
    ...overrides
  });
}

async function tempRoot(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'leominal-file-service-'));
}
