import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { planUploadTargets } from '../../src/server/uploads/uploadPaths.js';

describe('upload path planning', () => {
  it('rejects unsafe relative paths instead of resolving outside the cwd', async () => {
    const root = await tempUploadRoot();

    const plan = await planUploadTargets(root, [
      { fieldName: 'file-1', relativePath: '../secrets.txt', size: 1 },
      { fieldName: 'file-2', relativePath: '/tmp/secrets.txt', size: 1 },
      { fieldName: 'file-3', relativePath: 'C:/Users/secrets.txt', size: 1 },
      { fieldName: 'file-4', relativePath: 'C:secrets.txt', size: 1 },
      { fieldName: 'file-5', relativePath: 'safe.txt', size: 1 }
    ]);

    expect(plan.failures).toEqual([
      { fieldName: 'file-1', relativePath: '../secrets.txt', error: 'unsafe_relative_path' },
      { fieldName: 'file-2', relativePath: '/tmp/secrets.txt', error: 'unsafe_relative_path' },
      { fieldName: 'file-3', relativePath: 'C:/Users/secrets.txt', error: 'unsafe_relative_path' },
      { fieldName: 'file-4', relativePath: 'C:secrets.txt', error: 'unsafe_relative_path' }
    ]);
    expect(plan.targets.map((target) => target.savedRelativePath)).toEqual(['safe.txt']);
    expect(plan.targets[0]!.absolutePath).toBe(path.join(root, 'safe.txt'));
  });

  it('allocates collision-free loose file names without overwriting existing files', async () => {
    const root = await tempUploadRoot();
    await writeFile(path.join(root, 'report.txt'), 'existing');

    const plan = await planUploadTargets(root, [
      { fieldName: 'file-1', relativePath: 'report.txt', size: 1 },
      { fieldName: 'file-2', relativePath: 'report.txt', size: 1 },
      { fieldName: 'file-3', relativePath: '.env', size: 1 },
      { fieldName: 'file-4', relativePath: '.env', size: 1 }
    ]);

    expect(plan.failures).toEqual([]);
    expect(plan.targets.map((target) => target.savedRelativePath)).toEqual(['report 2.txt', 'report 3.txt', '.env', '.env 2']);
    expect(plan.targets.every((target) => target.absolutePath.startsWith(`${root}${path.sep}`))).toBe(true);
  });

  it('preserves dropped folder contents under a renamed top-level folder when needed', async () => {
    const root = await tempUploadRoot();
    await mkdir(path.join(root, 'project'));

    const plan = await planUploadTargets(root, [
      { fieldName: 'file-1', relativePath: 'project/src/index.ts', size: 1 },
      { fieldName: 'file-2', relativePath: 'project/README.md', size: 1 }
    ]);

    expect(plan.failures).toEqual([]);
    expect(plan.targets.map((target) => target.savedRelativePath)).toEqual(['project 2/src/index.ts', 'project 2/README.md']);
    expect(plan.targets.map((target) => target.absolutePath)).toEqual([
      path.join(root, 'project 2', 'src', 'index.ts'),
      path.join(root, 'project 2', 'README.md')
    ]);
  });
});

async function tempUploadRoot(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'leominal-upload-paths-'));
}
