import { randomUUID } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
  unlink,
  type FileHandle
} from 'node:fs/promises';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import type { AppConfig } from '../config.js';
import type {
  FileDeletePreviewResponse,
  FileDeleteResponse,
  FileEntry,
  FileEntryKind,
  FileListResponse,
  FilePreviewKind,
  FileReadResponse,
  FileVersion,
  FileWriteResponse
} from '../../shared/protocol.js';
import {
  FileDeletePreviewTokenError,
  signFileDeletePreviewToken,
  verifyFileDeletePreviewToken
} from './rootToken.js';

export type FileExplorerConfig = Pick<AppConfig, 'sessionSecret' | 'fileListMaxEntries' | 'fileTextMaxBytes' | 'filePreviewMaxBytes'>;

export interface FilePreviewResult {
  absolutePath: string;
  contentType: string;
  size: number;
  stream: NodeJS.ReadableStream;
}

interface ResolvedPath {
  rootPath: string;
  relativePath: string;
  absolutePath: string;
  segments: string[];
}

interface ExistingResolvedPath extends ResolvedPath {
  stat: Stats;
}

interface DeleteTarget {
  absolutePath: string;
  path: string;
  kind: FileEntryKind;
  descendantCount: number;
  entryVersion: FileVersion;
}

export class FileExplorerError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string
  ) {
    super(code);
  }
}

export class FileExplorerService {
  constructor(private readonly config: FileExplorerConfig) {}

  async resolveRootPath(rootPath: string): Promise<string> {
    try {
      const resolved = await realpath(rootPath);
      const stat = await lstat(resolved);
      if (!stat.isDirectory()) {
        throw new FileExplorerError(409, 'root_unavailable');
      }
      return resolved;
    } catch (error) {
      if (error instanceof FileExplorerError) {
        throw error;
      }
      throw new FileExplorerError(409, 'root_unavailable');
    }
  }

  async list(rootPath: string, requestPath: string): Promise<FileListResponse> {
    const resolved = await this.resolveExistingPath(rootPath, requestPath);
    if (!resolved.stat.isDirectory()) {
      throw new FileExplorerError(400, 'not_a_directory');
    }
    await assertStablePath(resolved.absolutePath, resolved.stat);

    const names = await readdir(resolved.absolutePath);
    await assertStablePath(resolved.absolutePath, resolved.stat);
    if (names.length > this.config.fileListMaxEntries) {
      throw new FileExplorerError(413, 'too_many_entries');
    }

    const entries = await Promise.all(
      names.map((name) => this.entryForPath(joinRelativePath(resolved.relativePath, name), path.join(resolved.absolutePath, name)))
    );
    entries.sort((left, right) => left.name.localeCompare(right.name));
    return {
      rootPath: resolved.rootPath,
      path: resolved.relativePath,
      entries
    };
  }

  async readText(rootPath: string, requestPath: string): Promise<FileReadResponse> {
    const resolved = await this.resolveExistingPath(rootPath, requestPath);
    const handle = await this.openNoFollow(resolved.absolutePath, constants.O_RDONLY, 'path_not_found');
    try {
      const stat = await handle.stat();
      assertSameVersion(stat, resolved.stat);
      if (!stat.isFile()) {
        throw new FileExplorerError(400, 'not_a_file');
      }
      if (stat.size > this.config.fileTextMaxBytes) {
        throw new FileExplorerError(413, 'file_too_large');
      }
      const content = decodeTextFile(await handle.readFile());
      return {
        path: resolved.relativePath,
        content,
        language: languageForPath(resolved.relativePath),
        version: versionFromStats(stat)
      };
    } finally {
      await handle.close().catch(() => undefined);
    }
  }

  async resolveFileForTerminalOpen(rootPath: string, requestPath: string): Promise<{ path: string; absolutePath: string }> {
    const resolved = await this.resolveExistingPath(rootPath, requestPath);
    const handle = await this.openNoFollow(resolved.absolutePath, constants.O_RDONLY, 'path_not_found');
    try {
      const stat = await handle.stat();
      assertSameVersion(stat, resolved.stat);
      if (!stat.isFile()) {
        throw new FileExplorerError(400, 'not_a_file');
      }
      return {
        path: resolved.relativePath,
        absolutePath: resolved.absolutePath
      };
    } finally {
      await handle.close().catch(() => undefined);
    }
  }

  async writeText(rootPath: string, requestPath: string, content: string, expectedVersion: FileVersion): Promise<FileWriteResponse> {
    if (Buffer.byteLength(content, 'utf8') > this.config.fileTextMaxBytes) {
      throw new FileExplorerError(413, 'file_too_large');
    }
    const resolved = await this.resolveExistingPath(rootPath, requestPath);
    const handle = await this.openNoFollow(resolved.absolutePath, constants.O_WRONLY, 'path_not_found');
    let tempPath: string | null = null;
    try {
      const current = await handle.stat();
      assertSameVersion(current, resolved.stat);
      if (!current.isFile()) {
        throw new FileExplorerError(400, 'not_a_file');
      }
      if (!sameVersion(versionFromStats(current), expectedVersion)) {
        throw new FileExplorerError(409, 'file_version_conflict');
      }
      tempPath = path.join(path.dirname(resolved.absolutePath), `.${path.basename(resolved.absolutePath)}.leominal-${randomUUID()}.tmp`);
      const tempHandle = await open(tempPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollowFlag());
      try {
        await tempHandle.writeFile(content, 'utf8');
      } finally {
        await tempHandle.close().catch(() => undefined);
      }
      const latest = await handle.stat();
      if (!sameVersion(versionFromStats(latest), expectedVersion)) {
        throw new FileExplorerError(409, 'file_version_conflict');
      }
      await rename(tempPath, resolved.absolutePath);
      tempPath = null;
    } finally {
      await handle.close().catch(() => undefined);
      if (tempPath) {
        await unlink(tempPath).catch(() => undefined);
      }
    }
    const next = await lstat(resolved.absolutePath);
    return {
      path: resolved.relativePath,
      version: versionFromStats(next)
    };
  }

  async createEntry(rootPath: string, requestPath: string, kind: 'file' | 'directory'): Promise<FileEntry> {
    const resolved = await this.resolveNewPath(rootPath, requestPath);
    if (kind === 'directory') {
      try {
        await mkdir(resolved.absolutePath);
      } catch (error) {
        if (isNodeErrorWithCode(error, 'EEXIST')) {
          throw new FileExplorerError(409, 'target_exists');
        }
        throw error;
      }
    } else {
      let handle: FileHandle | null = null;
      try {
        handle = await open(resolved.absolutePath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollowFlag());
      } catch (error) {
        if (isNodeErrorWithCode(error, 'EEXIST')) {
          throw new FileExplorerError(409, 'target_exists');
        }
        throw error;
      } finally {
        await handle?.close().catch(() => undefined);
      }
    }
    return this.entryForPath(resolved.relativePath, resolved.absolutePath);
  }

  async moveEntry(rootPath: string, sourcePath: string, destinationPath: string): Promise<FileEntry> {
    const source = await this.resolveExistingPath(rootPath, sourcePath);
    const destination = await this.resolveNewPath(rootPath, destinationPath);
    const sourceStat = source.stat;
    await assertStablePath(source.absolutePath, sourceStat);
    try {
      if (sourceStat.isFile()) {
        await copyFile(source.absolutePath, destination.absolutePath, constants.COPYFILE_EXCL);
        const latestSourceStat = await lstat(source.absolutePath);
        if (!sameVersion(versionFromStats(latestSourceStat), versionFromStats(sourceStat))) {
          await unlink(destination.absolutePath).catch(() => undefined);
          throw new FileExplorerError(409, 'file_version_conflict');
        }
        await unlink(source.absolutePath);
      } else {
        if (sourceStat.isDirectory()) {
          await this.countDescendants(source.absolutePath);
        }
        await rename(source.absolutePath, destination.absolutePath);
      }
    } catch (error) {
      if (isNodeErrorWithCode(error, 'EEXIST')) {
        throw new FileExplorerError(409, 'target_exists');
      }
      throw error;
    }
    return this.entryForPath(destination.relativePath, destination.absolutePath);
  }

  async previewDelete(rootPath: string, requestPath: string, rootToken: string): Promise<FileDeletePreviewResponse> {
    const target = await this.inspectDeleteTarget(rootPath, requestPath);
    const previewToken = signFileDeletePreviewToken(this.config, {
      rootToken,
      path: target.path,
      kind: target.kind,
      descendantCount: target.descendantCount,
      entryVersion: target.entryVersion
    });
    return {
      path: target.path,
      kind: target.kind,
      descendantCount: target.descendantCount,
      previewToken
    };
  }

  async deleteEntry(rootPath: string, requestPath: string, previewToken: string, rootToken: string): Promise<FileDeleteResponse> {
    const target = await this.inspectDeleteTarget(rootPath, requestPath);
    try {
      verifyFileDeletePreviewToken(this.config, previewToken, rootToken, {
        path: target.path,
        kind: target.kind,
        descendantCount: target.descendantCount,
        entryVersion: target.entryVersion
      });
    } catch (error) {
      if (error instanceof FileDeletePreviewTokenError) {
        throw new FileExplorerError(409, error.code);
      }
      throw error;
    }

    await rm(target.absolutePath, { recursive: target.kind === 'directory' });
    return { path: target.path, deleted: true };
  }

  async previewFile(rootPath: string, requestPath: string): Promise<FilePreviewResult> {
    const resolved = await this.resolveExistingPath(rootPath, requestPath);
    const handle = await this.openNoFollow(resolved.absolutePath, constants.O_RDONLY, 'path_not_found');
    try {
      const stat = await handle.stat();
      assertSameVersion(stat, resolved.stat);
      if (!stat.isFile()) {
        throw new FileExplorerError(400, 'not_a_file');
      }
      if (stat.size > this.config.filePreviewMaxBytes) {
        throw new FileExplorerError(413, 'file_too_large');
      }
      const contentType = contentTypeForPath(resolved.relativePath);
      if (!contentType) {
        throw new FileExplorerError(415, 'unsupported_preview');
      }
      const stream = handle.createReadStream();
      return {
        absolutePath: resolved.absolutePath,
        contentType,
        size: stat.size,
        stream
      };
    } catch (error) {
      await handle.close().catch(() => undefined);
      throw error;
    }
  }

  private async resolveExistingPath(rootPath: string, requestPath: string): Promise<ExistingResolvedPath> {
    const root = await this.resolveRootPath(rootPath);
    const relativePath = normalizeRelativePath(requestPath);
    const segments = relativePath ? relativePath.split('/') : [];
    const absolutePath = path.resolve(root, ...segments);
    assertContained(root, absolutePath);
    await this.assertNoSymlinkSegments(root, segments, false);
    const stat = await lstat(absolutePath);
    if (stat.isSymbolicLink()) {
      throw new FileExplorerError(400, 'symlink_not_allowed');
    }
    assertContained(root, await realpath(absolutePath));
    return { rootPath: root, relativePath, absolutePath, segments, stat };
  }

  private async resolveNewPath(rootPath: string, requestPath: string): Promise<ResolvedPath> {
    const root = await this.resolveRootPath(rootPath);
    const relativePath = normalizeRelativePath(requestPath);
    if (!relativePath) {
      throw new FileExplorerError(400, 'invalid_file_path');
    }
    const segments = relativePath.split('/');
    const absolutePath = path.resolve(root, ...segments);
    assertContained(root, absolutePath);
    await this.assertNoSymlinkSegments(root, segments, true);
    assertContained(root, await realpath(path.dirname(absolutePath)));
    return { rootPath: root, relativePath, absolutePath, segments };
  }

  private async assertNoSymlinkSegments(root: string, segments: string[], allowMissingFinal: boolean): Promise<void> {
    let current = root;
    for (let index = 0; index < segments.length; index += 1) {
      current = path.join(current, segments[index]!);
      let stat: Stats;
      try {
        stat = await lstat(current);
      } catch (error) {
        if (allowMissingFinal && index === segments.length - 1 && isNodeErrorWithCode(error, 'ENOENT')) {
          return;
        }
        throw new FileExplorerError(404, 'path_not_found');
      }

      if (stat.isSymbolicLink()) {
        throw new FileExplorerError(400, 'symlink_not_allowed');
      }
      if (index < segments.length - 1 && !stat.isDirectory()) {
        throw new FileExplorerError(400, 'not_a_directory');
      }
      if (allowMissingFinal && index === segments.length - 1) {
        throw new FileExplorerError(409, 'target_exists');
      }
    }
  }

  private async entryForPath(relativePath: string, absolutePath: string): Promise<FileEntry> {
    const stat = await lstat(absolutePath);
    const kind = kindFromStats(stat);
    return {
      name: path.basename(absolutePath),
      path: relativePath,
      kind,
      size: stat.isFile() ? stat.size : null,
      mtime: stat.mtime.toISOString(),
      editable: stat.isFile() && stat.size <= this.config.fileTextMaxBytes && isLikelyTextPath(relativePath),
      previewKind: stat.isFile() ? previewKindForPath(relativePath) : 'none'
    };
  }

  private async inspectDeleteTarget(rootPath: string, requestPath: string): Promise<DeleteTarget> {
    const resolved = await this.resolveExistingPath(rootPath, requestPath);
    const stat = resolved.stat;
    await assertStablePath(resolved.absolutePath, stat);
    const kind = kindFromStats(stat);
    const descendantCount = stat.isDirectory() ? await this.countDescendants(resolved.absolutePath) : 0;
    return {
      absolutePath: resolved.absolutePath,
      path: resolved.relativePath,
      kind,
      descendantCount,
      entryVersion: versionFromStats(stat)
    };
  }

  private async countDescendants(absolutePath: string): Promise<number> {
    const names = await readdir(absolutePath);
    let count = 0;
    for (const name of names) {
      const childPath = path.join(absolutePath, name);
      const stat = await lstat(childPath);
      if (stat.isSymbolicLink()) {
        throw new FileExplorerError(400, 'symlink_not_allowed');
      }
      count += 1;
      if (stat.isDirectory()) {
        count += await this.countDescendants(childPath);
      }
    }
    return count;
  }

  private async openNoFollow(absolutePath: string, flags: number, missingCode: string): Promise<FileHandle> {
    try {
      return await open(absolutePath, flags | noFollowFlag());
    } catch (error) {
      if (isNodeErrorWithCode(error, 'ELOOP')) {
        throw new FileExplorerError(400, 'symlink_not_allowed');
      }
      if (isNodeErrorWithCode(error, 'ENOENT')) {
        throw new FileExplorerError(404, missingCode);
      }
      throw error;
    }
  }
}

function normalizeRelativePath(requestPath: string): string {
  if (typeof requestPath !== 'string') {
    throw new FileExplorerError(400, 'invalid_file_path');
  }
  if (requestPath === '' || requestPath === '.') {
    return '';
  }
  if (requestPath.includes('\0') || requestPath.includes('\\') || path.posix.isAbsolute(requestPath) || /^[A-Za-z]:/.test(requestPath)) {
    throw new FileExplorerError(400, 'invalid_file_path');
  }
  const segments = requestPath.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new FileExplorerError(400, 'invalid_file_path');
  }
  return segments.join('/');
}

function assertContained(rootPath: string, absolutePath: string): void {
  const relative = path.relative(rootPath, absolutePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new FileExplorerError(400, 'invalid_file_path');
  }
}

function joinRelativePath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

function kindFromStats(stat: Stats): FileEntryKind {
  if (stat.isSymbolicLink()) {
    return 'symlink';
  }
  if (stat.isDirectory()) {
    return 'directory';
  }
  if (stat.isFile()) {
    return 'file';
  }
  return 'other';
}

function previewKindForPath(filePath: string): FilePreviewKind {
  const contentType = contentTypeForPath(filePath);
  if (!contentType) {
    return 'none';
  }
  return contentType === 'application/pdf' ? 'pdf' : 'image';
}

function contentTypeForPath(filePath: string): string | null {
  switch (path.extname(filePath).toLowerCase()) {
    case '.apng':
      return 'image/apng';
    case '.avif':
      return 'image/avif';
    case '.gif':
      return 'image/gif';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.svg':
      return 'image/svg+xml';
    case '.webp':
      return 'image/webp';
    case '.pdf':
      return 'application/pdf';
    default:
      return null;
  }
}

function languageForPath(filePath: string): 'text' | 'markdown' {
  const extension = path.extname(filePath).toLowerCase();
  return extension === '.md' || extension === '.markdown' ? 'markdown' : 'text';
}

function isLikelyTextPath(filePath: string): boolean {
  const name = path.basename(filePath).toLowerCase();
  if (
    [
      '.env',
      '.env.example',
      '.gitignore',
      '.npmrc',
      '.nvmrc',
      '.prettierrc',
      '.eslintignore',
      '.dockerignore',
      'dockerfile',
      'makefile',
      'license',
      'readme',
      'changelog'
    ].includes(name)
  ) {
    return true;
  }

  switch (path.extname(name)) {
    case '.bash':
    case '.c':
    case '.conf':
    case '.cpp':
    case '.cs':
    case '.css':
    case '.csv':
    case '.cts':
    case '.dockerfile':
    case '.env':
    case '.go':
    case '.graphql':
    case '.h':
    case '.hpp':
    case '.html':
    case '.ini':
    case '.java':
    case '.js':
    case '.json':
    case '.jsx':
    case '.kt':
    case '.log':
    case '.lua':
    case '.mjs':
    case '.md':
    case '.mdx':
    case '.mts':
    case '.php':
    case '.pl':
    case '.properties':
    case '.py':
    case '.rb':
    case '.rs':
    case '.sh':
    case '.sql':
    case '.swift':
    case '.toml':
    case '.ts':
    case '.tsx':
    case '.txt':
    case '.vue':
    case '.xml':
    case '.yaml':
    case '.yml':
    case '.zsh':
      return true;
    default:
      return false;
  }
}

function versionFromStats(stat: Stats): FileVersion {
  return {
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ino: stat.ino
  };
}

function sameVersion(left: FileVersion, right: FileVersion): boolean {
  return left.size === right.size && left.mtimeMs === right.mtimeMs && (right.ino === undefined || left.ino === right.ino);
}

async function assertStablePath(absolutePath: string, expected: Stats): Promise<void> {
  assertSameVersion(await lstat(absolutePath), expected);
}

function assertSameVersion(actual: Stats, expected: Stats): void {
  if (!sameVersion(versionFromStats(actual), versionFromStats(expected))) {
    throw new FileExplorerError(409, 'file_version_conflict');
  }
}

function decodeTextFile(content: Buffer): string {
  if (content.includes(0)) {
    throw new FileExplorerError(415, 'unsupported_text_file');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(content);
  } catch {
    throw new FileExplorerError(415, 'unsupported_text_file');
  }
}

function noFollowFlag(): number {
  return constants.O_NOFOLLOW ?? 0;
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === code;
}
