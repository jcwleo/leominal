import type { UploadResponse } from '../../shared/protocol.js';
import type { TerminalId } from '../../shared/types.js';

export interface UploadFile {
  relativePath: string;
  file: File;
}

export interface UploadProgress {
  loaded: number;
  total: number | null;
  percent: number | null;
}

export interface UploadFilesOptions {
  terminalId: TerminalId;
  files: UploadFile[];
  onProgress?: (progress: UploadProgress) => void;
  createXhr?: () => XMLHttpRequest;
}

export class UploadClientError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'UploadClientError';
  }
}

export function uploadFiles(options: UploadFilesOptions): Promise<UploadResponse> {
  const xhr = options.createXhr?.() ?? new XMLHttpRequest();
  const formData = new FormData();
  const entries = options.files.map((entry, index) => ({
    fieldName: `file${index}`,
    relativePath: entry.relativePath,
    size: entry.file.size
  }));

  formData.append('manifest', JSON.stringify({ terminalId: options.terminalId, entries }));
  for (const [index, entry] of options.files.entries()) {
    formData.append(`file${index}`, entry.file);
  }

  return new Promise<UploadResponse>((resolve, reject) => {
    xhr.open('POST', '/api/uploads');
    xhr.withCredentials = true;

    xhr.upload.onprogress = (event) => {
      if (!options.onProgress) {
        return;
      }
      if (event.lengthComputable && event.total > 0) {
        options.onProgress({
          loaded: event.loaded,
          total: event.total,
          percent: Math.round((event.loaded / event.total) * 100)
        });
        return;
      }
      options.onProgress({ loaded: event.loaded, total: null, percent: null });
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as UploadResponse);
        } catch {
          reject(new UploadClientError(xhr.status, 'Invalid upload response.'));
        }
        return;
      }
      reject(new UploadClientError(xhr.status, parseErrorMessage(xhr.responseText, xhr.statusText || `HTTP ${xhr.status}`)));
    };
    xhr.onerror = () => reject(new UploadClientError(0, 'Upload failed.'));
    xhr.onabort = () => reject(new UploadClientError(0, 'Upload aborted.'));
    xhr.ontimeout = () => reject(new UploadClientError(0, 'Upload timed out.'));

    xhr.send(formData);
  });
}

function parseErrorMessage(responseText: string, fallback: string): string {
  try {
    const body = JSON.parse(responseText) as { error?: unknown; message?: unknown };
    const message = typeof body.error === 'string' ? body.error : body.message;
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  } catch {
    // Keep the transport status text when the body is not JSON.
  }
  return fallback;
}
