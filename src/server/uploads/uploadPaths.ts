import { access } from 'node:fs/promises';
import path from 'node:path';
import type { UploadManifestEntry } from '../../shared/protocol.js';

export interface UploadPathFailure {
  fieldName: string;
  relativePath: string;
  error: 'unsafe_relative_path';
}

export interface UploadTarget {
  fieldName: string;
  relativePath: string;
  savedRelativePath: string;
  absolutePath: string;
  size: number;
}

export interface UploadTargetPlan {
  targets: UploadTarget[];
  failures: UploadPathFailure[];
}

interface SafeEntry {
  entry: UploadManifestEntry;
  segments: string[];
}

export async function planUploadTargets(destinationCwd: string, entries: UploadManifestEntry[]): Promise<UploadTargetPlan> {
  const root = path.resolve(destinationCwd);
  const reserved = new Set<string>();
  const topLevelFolders = new Map<string, string>();
  const targets: UploadTarget[] = [];
  const failures: UploadPathFailure[] = [];

  for (const entry of entries) {
    const safe = safeEntry(entry);
    if (!safe) {
      failures.push({ fieldName: entry.fieldName, relativePath: entry.relativePath, error: 'unsafe_relative_path' });
      continue;
    }

    if (safe.segments.length === 1) {
      const savedRelativePath = await allocateFileRelativePath(root, [], safe.segments[0]!, reserved);
      targets.push(targetFor(root, safe, savedRelativePath));
      continue;
    }

    const originalTopLevel = safe.segments[0]!;
    let savedTopLevel = topLevelFolders.get(originalTopLevel);
    if (!savedTopLevel) {
      savedTopLevel = await allocateFolderName(root, originalTopLevel, reserved);
      topLevelFolders.set(originalTopLevel, savedTopLevel);
    }

    const parentSegments = [savedTopLevel, ...safe.segments.slice(1, -1)];
    const fileName = safe.segments.at(-1)!;
    const savedRelativePath = await allocateFileRelativePath(root, parentSegments, fileName, reserved);
    targets.push(targetFor(root, safe, savedRelativePath));
  }

  return { targets, failures };
}

function safeEntry(entry: UploadManifestEntry): SafeEntry | null {
  const segments = safeRelativeSegments(entry.relativePath);
  if (!segments || !isFiniteNonNegativeInteger(entry.size) || !entry.fieldName.trim()) {
    return null;
  }
  return { entry, segments };
}

function safeRelativeSegments(relativePath: string): string[] | null {
  if (typeof relativePath !== 'string' || relativePath.length === 0 || relativePath.includes('\0') || relativePath.includes('\\')) {
    return null;
  }
  if (path.posix.isAbsolute(relativePath) || /^[A-Za-z]:/.test(relativePath)) {
    return null;
  }
  const segments = relativePath.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return null;
  }
  return segments;
}

async function allocateFolderName(root: string, name: string, reserved: Set<string>): Promise<string> {
  let index = 1;
  while (true) {
    const candidate = index === 1 ? name : `${name} ${index}`;
    const absolutePath = resolveContained(root, [candidate]);
    if (!reserved.has(absolutePath) && !(await exists(absolutePath))) {
      reserved.add(absolutePath);
      return candidate;
    }
    index += 1;
  }
}

async function allocateFileRelativePath(root: string, parentSegments: string[], fileName: string, reserved: Set<string>): Promise<string> {
  let index = 1;
  while (true) {
    const candidateName = index === 1 ? fileName : suffixedFileName(fileName, index);
    const candidateSegments = [...parentSegments, candidateName];
    const absolutePath = resolveContained(root, candidateSegments);
    if (!reserved.has(absolutePath) && !(await exists(absolutePath))) {
      reserved.add(absolutePath);
      return candidateSegments.join('/');
    }
    index += 1;
  }
}

function targetFor(root: string, safe: SafeEntry, savedRelativePath: string): UploadTarget {
  const absolutePath = resolveContained(root, savedRelativePath.split('/'));
  return {
    fieldName: safe.entry.fieldName,
    relativePath: safe.entry.relativePath,
    savedRelativePath,
    absolutePath,
    size: safe.entry.size
  };
}

function resolveContained(root: string, segments: string[]): string {
  const resolved = path.resolve(root, ...segments);
  const relative = path.relative(root, resolved);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('unsafe_relative_path');
  }
  return resolved;
}

function suffixedFileName(fileName: string, index: number): string {
  if (fileName.startsWith('.') && fileName.indexOf('.', 1) === -1) {
    return `${fileName} ${index}`;
  }
  const extension = path.extname(fileName);
  const base = extension ? fileName.slice(0, -extension.length) : fileName;
  return `${base} ${index}${extension}`;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isFiniteNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
