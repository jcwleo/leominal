import type { TerminalId, TerminalLayoutState, TerminalSummary } from './types.js';

export interface PasswordRequest {
  password: string;
}

export interface CreateTerminalRequest {
  parentTerminalId?: TerminalId;
  cwd?: string;
  cols?: number;
  rows?: number;
}

export interface TerminalListResponse {
  terminals: TerminalSummary[];
}

export interface TerminalResponse {
  terminal: TerminalSummary;
}

export interface TerminalLayoutResponse {
  layout: TerminalLayoutState | null;
  revision: number;
  updatedAt: string | null;
}

export interface UpdateTerminalLayoutRequest {
  layout: TerminalLayoutState;
  baseRevision?: number;
}

export interface UploadManifestEntry {
  fieldName: string;
  relativePath: string;
  size: number;
}

export interface UploadManifest {
  terminalId: TerminalId;
  entries: UploadManifestEntry[];
}

export interface UploadResultEntry {
  relativePath: string;
  savedRelativePath?: string;
  status: 'uploaded' | 'failed';
  size?: number;
  error?: string;
}

export interface UploadResponse {
  destinationCwd: string;
  uploaded: number;
  failed: number;
  results: UploadResultEntry[];
}

export interface FileRootRequest {
  terminalId: TerminalId;
}

export interface FileRootResponse {
  rootToken: string;
  terminalId: TerminalId;
  rootPath: string;
  issuedAt: string;
}

export interface FilePathRequest {
  rootToken: string;
  path: string;
}

export type FileEntryKind = 'file' | 'directory' | 'symlink' | 'other';
export type FilePreviewKind = 'image' | 'pdf' | 'none';

export interface FileEntry {
  name: string;
  path: string;
  kind: FileEntryKind;
  size: number | null;
  mtime: string | null;
  editable: boolean;
  previewKind: FilePreviewKind;
}

export interface FileListRequest extends FilePathRequest {}

export interface FileListResponse {
  rootPath: string;
  path: string;
  entries: FileEntry[];
}

export interface FileVersion {
  size: number;
  mtimeMs: number;
  ino?: number;
}

export interface FileReadRequest extends FilePathRequest {}

export interface FileReadResponse {
  path: string;
  content: string;
  language: 'text' | 'markdown';
  version: FileVersion;
}

export interface FileWriteRequest extends FilePathRequest {
  content: string;
  expectedVersion: FileVersion;
}

export interface FileWriteResponse {
  path: string;
  version: FileVersion;
}

export interface FileOpenResponse {
  opened: true;
}

export interface FileOpenRequest extends FilePathRequest {
  terminalId?: TerminalId;
}

export interface FileCreateRequest extends FilePathRequest {
  kind: 'file' | 'directory';
}

export interface FileCreateResponse {
  entry: FileEntry;
}

export interface FileMoveRequest {
  rootToken: string;
  sourcePath: string;
  destinationPath: string;
}

export interface FileMoveResponse {
  entry: FileEntry;
}

export interface FileDeletePreviewRequest extends FilePathRequest {}

export interface FileDeletePreviewResponse {
  path: string;
  kind: FileEntryKind;
  descendantCount: number;
  previewToken: string;
}

export interface FileDeleteRequest extends FilePathRequest {
  previewToken: string;
}

export interface FileDeleteResponse {
  path: string;
  deleted: true;
}

export type ClientTerminalMessage =
  | { type: 'input'; terminalId: TerminalId; data: string }
  | { type: 'refresh_cwd'; terminalId: TerminalId }
  | { type: 'resize'; terminalId: TerminalId; cols: number; rows: number }
  | { type: 'ping'; nonce: string };

export type ServerTerminalMessage =
  | { type: 'snapshot'; terminal: TerminalSummary; output: string[] }
  | { type: 'output'; terminalId: TerminalId; data: string }
  | { type: 'terminal_updated'; terminal: TerminalSummary }
  | { type: 'exit'; terminalId: TerminalId; exitCode: number | null }
  | { type: 'error'; message: string }
  | { type: 'pong'; nonce: string };

export function parseClientTerminalMessage(raw: string): ClientTerminalMessage | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    const message = parsed as Partial<ClientTerminalMessage>;
    if (message.type === 'input' && typeof message.terminalId === 'string' && typeof message.data === 'string') {
      return message as ClientTerminalMessage;
    }
    if (message.type === 'refresh_cwd' && typeof message.terminalId === 'string') {
      return message as ClientTerminalMessage;
    }
    if (
      message.type === 'resize' &&
      typeof message.terminalId === 'string' &&
      Number.isInteger(message.cols) &&
      Number.isInteger(message.rows)
    ) {
      return message as ClientTerminalMessage;
    }
    if (message.type === 'ping' && typeof message.nonce === 'string') {
      return message as ClientTerminalMessage;
    }
    return null;
  } catch {
    return null;
  }
}
