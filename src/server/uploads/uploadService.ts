import { mkdir, open, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { AppConfig } from '../config.js';
import type { UploadManifest, UploadManifestEntry, UploadResponse, UploadResultEntry } from '../../shared/protocol.js';
import { planUploadTargets, type UploadTarget } from './uploadPaths.js';

export type UploadLimits = Pick<AppConfig, 'uploadMaxFiles' | 'uploadMaxFileBytes' | 'uploadMaxBatchBytes'>;

export interface CreateUploadSessionOptions {
  destinationCwd: string;
  limits: UploadLimits;
  manifest: UploadManifest;
}

export class UploadRequestError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string
  ) {
    super(code);
  }
}

export interface UploadSession {
  writeFile(fieldName: string, stream: Readable): Promise<void>;
  finish(): Promise<UploadResponse>;
  abort(): Promise<void>;
}

export async function createUploadSession(options: CreateUploadSessionOptions): Promise<UploadSession> {
  validateManifest(options.manifest, options.limits);
  const pathPlan = await planUploadTargets(options.destinationCwd, options.manifest.entries);
  return new StreamingUploadSession(options.destinationCwd, options.manifest.entries, options.limits, pathPlan.targets, pathPlan.failures);
}

export function parseUploadManifest(value: unknown): UploadManifest | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const manifest = value as Partial<UploadManifest>;
  if (typeof manifest.terminalId !== 'string' || !manifest.terminalId.trim() || !Array.isArray(manifest.entries)) {
    return null;
  }
  const entries: UploadManifestEntry[] = [];
  for (const entry of manifest.entries) {
    if (!entry || typeof entry !== 'object') {
      return null;
    }
    const candidate = entry as Partial<UploadManifestEntry>;
    const fieldName = candidate.fieldName;
    const relativePath = candidate.relativePath;
    const size = candidate.size;
    if (
      typeof fieldName !== 'string' ||
      typeof relativePath !== 'string' ||
      typeof size !== 'number' ||
      !Number.isSafeInteger(size) ||
      size < 0
    ) {
      return null;
    }
    entries.push({
      fieldName,
      relativePath,
      size
    });
  }
  return { terminalId: manifest.terminalId, entries };
}

class StreamingUploadSession implements UploadSession {
  private readonly targetsByField = new Map<string, UploadTarget>();
  private readonly failuresByField = new Map<string, UploadResultEntry>();
  private readonly resultsByField = new Map<string, UploadResultEntry>();
  private readonly createdFiles = new Set<string>();
  private actualBatchBytes = 0;

  constructor(
    private readonly destinationCwd: string,
    private readonly entries: UploadManifestEntry[],
    private readonly limits: UploadLimits,
    targets: UploadTarget[],
    failures: Array<{ fieldName: string; relativePath: string; error: string }>
  ) {
    for (const target of targets) {
      if (target.size > limits.uploadMaxFileBytes) {
        this.failuresByField.set(target.fieldName, {
          relativePath: target.relativePath,
          status: 'failed',
          error: 'file_too_large'
        });
      } else {
        this.targetsByField.set(target.fieldName, target);
      }
    }
    for (const failure of failures) {
      this.failuresByField.set(failure.fieldName, {
        relativePath: failure.relativePath,
        status: 'failed',
        error: failure.error
      });
    }
  }

  async writeFile(fieldName: string, stream: Readable): Promise<void> {
    if (this.resultsByField.has(fieldName)) {
      await drain(stream);
      return;
    }
    const target = this.targetsByField.get(fieldName);
    if (!target || this.failuresByField.has(fieldName)) {
      await drain(stream);
      return;
    }

    const parentDir = path.dirname(target.absolutePath);
    await mkdir(parentDir, { recursive: true });
    if (!(await isContainedRealPath(this.destinationCwd, parentDir))) {
      await drain(stream);
      this.resultsByField.set(fieldName, {
        relativePath: target.relativePath,
        savedRelativePath: target.savedRelativePath,
        status: 'failed',
        error: 'unsafe_parent_path'
      });
      return;
    }

    const counter = this.createLimitCounter();
    let createdPath: string | null = null;
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    try {
      handle = await open(target.absolutePath, 'wx');
      createdPath = target.absolutePath;
      await pipeline(stream, counter, handle.createWriteStream());
      this.createdFiles.add(target.absolutePath);
      this.resultsByField.set(fieldName, {
        relativePath: target.relativePath,
        savedRelativePath: target.savedRelativePath,
        status: 'uploaded',
        size: counter.bytesRead
      });
    } catch (error) {
      if (!createdPath) {
        await drain(stream).catch(() => undefined);
      }
      await handle?.close().catch(() => undefined);
      if (createdPath) {
        await unlink(createdPath).catch(() => undefined);
      }
      this.resultsByField.set(fieldName, {
        relativePath: target.relativePath,
        savedRelativePath: target.savedRelativePath,
        status: 'failed',
        error: uploadWriteErrorCode(error)
      });
    }
  }

  async abort(): Promise<void> {
    const createdFiles = Array.from(this.createdFiles);
    this.createdFiles.clear();
    await Promise.all(createdFiles.map((filePath) => unlink(filePath).catch(() => undefined)));
  }

  async finish(): Promise<UploadResponse> {
    const results = this.entries.map((entry): UploadResultEntry => {
      const result = this.resultsByField.get(entry.fieldName);
      if (result) {
        return result;
      }
      const failure = this.failuresByField.get(entry.fieldName);
      if (failure) {
        return failure;
      }
      return {
        relativePath: entry.relativePath,
        status: 'failed',
        error: 'missing_file'
      };
    });
    const uploaded = results.filter((result) => result.status === 'uploaded').length;
    return {
      destinationCwd: this.destinationCwd,
      uploaded,
      failed: results.length - uploaded,
      results
    };
  }

  private createLimitCounter(): Transform & { bytesRead: number } {
    const limits = this.limits;
    const session = this;
    const counter = new Transform({
      transform(chunk: Buffer | string, _encoding, callback) {
        const chunkBytes = typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
        counter.bytesRead += chunkBytes;
        session.actualBatchBytes += chunkBytes;
        if (counter.bytesRead > limits.uploadMaxFileBytes) {
          callback(new UploadRequestError(413, 'file_too_large'));
          return;
        }
        if (session.actualBatchBytes > limits.uploadMaxBatchBytes) {
          callback(new UploadRequestError(413, 'batch_too_large'));
          return;
        }
        callback(null, chunk);
      }
    }) as Transform & { bytesRead: number };
    counter.bytesRead = 0;
    return counter;
  }
}

function validateManifest(manifest: UploadManifest, limits: UploadLimits): void {
  if (manifest.entries.length > limits.uploadMaxFiles) {
    throw new UploadRequestError(413, 'too_many_files');
  }
  const fieldNames = new Set<string>();
  for (const entry of manifest.entries) {
    if (fieldNames.has(entry.fieldName)) {
      throw new UploadRequestError(400, 'duplicate_upload_field');
    }
    fieldNames.add(entry.fieldName);
  }
  const batchBytes = manifest.entries.reduce((total, entry) => total + entry.size, 0);
  if (batchBytes > limits.uploadMaxBatchBytes) {
    throw new UploadRequestError(413, 'batch_too_large');
  }
}

async function drain(stream: Readable): Promise<void> {
  for await (const _chunk of stream) {
    // Consume the stream so multipart parsing can continue.
  }
}

function uploadWriteErrorCode(error: unknown): string {
  if (isNodeErrorWithCode(error, 'EEXIST')) {
    return 'target_exists';
  }
  return error instanceof UploadRequestError ? error.code : 'write_failed';
}

async function isContainedRealPath(root: string, candidate: string): Promise<boolean> {
  try {
    const [rootRealPath, candidateRealPath] = await Promise.all([realpath(root), realpath(candidate)]);
    const relative = path.relative(rootRealPath, candidateRealPath);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  } catch {
    return false;
  }
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === code;
}
