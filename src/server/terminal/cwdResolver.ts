import { execFile as execFileCallback } from 'node:child_process';
import { readlink as fsReadlink } from 'node:fs/promises';
import os from 'node:os';
import { promisify } from 'node:util';

const execFilePromise = promisify(execFileCallback);

export interface ResolveProcessCwdOptions {
  platform?: NodeJS.Platform;
  readlink?: (path: string) => Promise<string>;
  execFile?: (file: string, args: string[]) => Promise<{ stdout: string }>;
}

export async function resolveProcessCwd(pid: number, options: ResolveProcessCwdOptions = {}): Promise<string | null> {
  const platform = options.platform ?? os.platform();
  if (platform === 'linux') {
    return resolveLinuxProcessCwd(pid, options.readlink ?? fsReadlink);
  }
  if (platform === 'darwin') {
    return resolveDarwinProcessCwd(pid, options.execFile ?? execFilePromise);
  }
  return null;
}

async function resolveLinuxProcessCwd(pid: number, readlink: (path: string) => Promise<string>): Promise<string | null> {
  try {
    return await readlink(`/proc/${pid}/cwd`);
  } catch {
    return null;
  }
}

async function resolveDarwinProcessCwd(
  pid: number,
  execFile: (file: string, args: string[]) => Promise<{ stdout: string }>
): Promise<string | null> {
  try {
    const { stdout } = await execFile('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']);
    const cwdLine = stdout
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.startsWith('n') && line.length > 1);
    return cwdLine ? cwdLine.slice(1) : null;
  } catch {
    return null;
  }
}
