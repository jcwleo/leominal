import { describe, expect, it, vi } from 'vitest';
import { resolveProcessCwd } from '../../src/server/terminal/cwdResolver.js';

describe('resolveProcessCwd', () => {
  it('resolves cwd from /proc on Linux', async () => {
    const readlink = vi.fn(async (target: string) => {
      expect(target).toBe('/proc/123/cwd');
      return '/workspace/current';
    });

    await expect(resolveProcessCwd(123, { platform: 'linux', readlink })).resolves.toBe('/workspace/current');
  });

  it('returns null when Linux /proc cwd lookup fails', async () => {
    const readlink = vi.fn(async () => {
      throw new Error('missing process');
    });

    await expect(resolveProcessCwd(123, { platform: 'linux', readlink })).resolves.toBeNull();
  });

  it('resolves cwd from lsof on macOS', async () => {
    const execFile = vi.fn(async (file: string, args: string[]) => {
      expect(file).toBe('lsof');
      expect(args).toEqual(['-a', '-p', '456', '-d', 'cwd', '-Fn']);
      return { stdout: 'p456\nn/Users/me/project\n' };
    });

    await expect(resolveProcessCwd(456, { platform: 'darwin', execFile })).resolves.toBe('/Users/me/project');
  });

  it('returns null when macOS lsof does not produce a cwd path', async () => {
    const execFile = vi.fn(async () => ({ stdout: 'p456\n' }));

    await expect(resolveProcessCwd(456, { platform: 'darwin', execFile })).resolves.toBeNull();
  });

  it('returns null on unsupported platforms', async () => {
    await expect(resolveProcessCwd(789, { platform: 'win32' })).resolves.toBeNull();
  });
});
