import React from 'react';
import type { UploadResponse, UploadResultEntry } from '../../shared/protocol.js';

export type UploadToastModel =
  | {
      id: number;
      status: 'queued';
      fileCount: number;
      message?: string;
    }
  | {
      id: number;
      status: 'uploading';
      fileCount: number;
      loaded: number;
      total: number | null;
      percent: number | null;
    }
  | {
      id: number;
      status: 'success' | 'partial' | 'failed';
      fileCount: number;
      message?: string;
      response?: UploadResponse;
    };

interface UploadToastProps {
  toast: UploadToastModel | null;
  onDismiss: () => void;
}

export function UploadToast({ toast, onDismiss }: UploadToastProps) {
  if (!toast) {
    return null;
  }

  const role = toast.status === 'failed' || toast.status === 'partial' ? 'alert' : 'status';
  const response = 'response' in toast ? toast.response : undefined;

  return (
    <aside className={`upload-toast upload-toast-${toast.status}`} role={role} aria-live={role === 'alert' ? 'assertive' : 'polite'}>
      <header className="upload-toast-header">
        <strong>{toastTitle(toast)}</strong>
        <button type="button" aria-label="Dismiss upload status" onClick={onDismiss}>
          x
        </button>
      </header>
      <div className="upload-toast-body">
        {toast.status === 'queued' ? <p>{toast.message ?? 'Preparing upload...'}</p> : null}
        {toast.status === 'uploading' ? <UploadProgressLine toast={toast} /> : null}
        {response && 'message' in toast && toast.message ? <p className="upload-toast-muted">{toast.message}</p> : null}
        {response ? <UploadResponseSummary response={response} /> : null}
        {toast.status === 'failed' && !response && toast.message ? <p>{toast.message}</p> : null}
      </div>
    </aside>
  );
}

function UploadProgressLine({ toast }: { toast: Extract<UploadToastModel, { status: 'uploading' }> }) {
  const progressLabel = toast.percent === null ? formatBytes(toast.loaded) : `${toast.percent}%`;
  return (
    <>
      <div className="upload-progress-row">
        <span>{toast.fileCount} file{toast.fileCount === 1 ? '' : 's'}</span>
        <span>{progressLabel}</span>
      </div>
      <div className="upload-progress-track" aria-hidden="true">
        <span style={{ width: toast.percent === null ? '100%' : `${toast.percent}%` }} />
      </div>
    </>
  );
}

function UploadResponseSummary({ response }: { response: UploadResponse }) {
  const failedResults = response.results.filter((result) => result.status === 'failed');
  const uploadedResults = response.results.filter((result) => result.status === 'uploaded');
  const visibleResults = [...failedResults, ...uploadedResults].slice(0, 5);
  return (
    <>
      <p className="upload-toast-destination">{response.destinationCwd}</p>
      {visibleResults.length > 0 ? (
        <ul className="upload-result-list">
          {visibleResults.map((result, index) => (
            <UploadResultRow key={`${result.relativePath}-${index}`} result={result} />
          ))}
        </ul>
      ) : null}
      {response.results.length > visibleResults.length ? (
        <p className="upload-toast-muted">+{response.results.length - visibleResults.length} more</p>
      ) : null}
    </>
  );
}

function UploadResultRow({ result }: { result: UploadResultEntry }) {
  const displayPath = result.savedRelativePath ?? result.relativePath;
  return (
    <li data-status={result.status}>
      <span className="upload-result-path">{displayPath}</span>
      {result.status === 'failed' && result.error ? <span className="upload-result-error">{result.error}</span> : null}
    </li>
  );
}

function toastTitle(toast: UploadToastModel): string {
  if (toast.status === 'queued') {
    return 'Preparing upload';
  }
  if (toast.status === 'uploading') {
    return `Uploading ${toast.fileCount} file${toast.fileCount === 1 ? '' : 's'}`;
  }
  if (toast.status === 'success') {
    const uploaded = toast.response?.uploaded ?? toast.fileCount;
    return `Uploaded ${uploaded} file${uploaded === 1 ? '' : 's'}`;
  }
  if (toast.status === 'partial') {
    const uploaded = toast.response?.uploaded ?? 0;
    const total = (toast.response?.uploaded ?? 0) + (toast.response?.failed ?? 0) || toast.fileCount;
    return `Uploaded ${uploaded} of ${total} files`;
  }
  return 'Upload failed';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}
