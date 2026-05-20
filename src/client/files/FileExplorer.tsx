import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { FileEntry, FileListResponse, FileOpenRequest, FilePreviewKind, FileReadResponse } from '../../shared/protocol.js';
import type { TerminalId } from '../../shared/types.js';
import type { ApiClient } from '../api/client.js';

interface FileExplorerProps {
  api: ApiClient;
  activeTerminalId: TerminalId | null;
  onOpenFile: (request: FileOpenRequest) => Promise<void>;
}

type FileDetail =
  | { type: 'empty' }
  | { type: 'text-preview'; file: FileEntry; read: FileReadResponse }
  | { type: 'preview'; file: FileEntry; previewKind: Exclude<FilePreviewKind, 'none'>; url: string };

type FileStatus = 'idle' | 'loading';

export function FileExplorer({ api, activeTerminalId, onOpenFile }: FileExplorerProps) {
  const [root, setRoot] = useState<{ rootToken: string; rootPath: string } | null>(null);
  const [currentPath, setCurrentPath] = useState('');
  const [entriesByPath, setEntriesByPath] = useState<Record<string, FileEntry[]>>({});
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(() => new Set());
  const [selectedEntry, setSelectedEntry] = useState<FileEntry | null>(null);
  const [detail, setDetail] = useState<FileDetail>({ type: 'empty' });
  const [status, setStatus] = useState<FileStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const loadedTerminalIdRef = useRef<TerminalId | null>(null);
  const mountedRef = useRef(false);
  const requestIdRef = useRef(0);

  const displayPath = root ? [root.rootPath, currentPath].filter(Boolean).join('/') : '';
  const selectedEntryPath = selectedEntry?.path ?? null;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
      clearPreviewUrl();
    };
  }, []);

  useEffect(() => {
    if (activeTerminalId === loadedTerminalIdRef.current) {
      return;
    }
    void loadTerminalRoot(activeTerminalId);
  }, [activeTerminalId, api]);

  async function loadTerminalRoot(terminalId: TerminalId | null) {
    const requestId = beginRequest();
    loadedTerminalIdRef.current = terminalId;
    clearPreviewUrl();
    setRoot(null);
    setCurrentPath('');
    setEntriesByPath({});
    setExpandedDirectories(new Set());
    setSelectedEntry(null);
    setDetail({ type: 'empty' });
    setError(null);

    if (!terminalId) {
      setStatus('idle');
      return;
    }

    setStatus('loading');
    try {
      const nextRoot = await api.createFileRoot({ terminalId });
      if (!isCurrentRequest(requestId)) {
        return;
      }
      setRoot({ rootToken: nextRoot.rootToken, rootPath: nextRoot.rootPath });
      const listed = await api.listFiles({ rootToken: nextRoot.rootToken, path: '' });
      if (!isCurrentRequest(requestId)) {
        return;
      }
      applyList(listed);
      setStatus('idle');
    } catch (caught) {
      if (isCurrentRequest(requestId)) {
        setError(errorMessage(caught));
        setStatus('idle');
      }
    }
  }

  async function refreshDirectory(path = currentPath, nextRoot = root) {
    if (!nextRoot) {
      return;
    }
    const requestId = beginRequest();
    setStatus('loading');
    setError(null);
    try {
      const listed = await api.listFiles({ rootToken: nextRoot.rootToken, path });
      if (!isCurrentRequest(requestId)) {
        return;
      }
      applyList(listed);
      setStatus('idle');
    } catch (caught) {
      if (isCurrentRequest(requestId)) {
        setError(errorMessage(caught));
        setStatus('idle');
      }
    }
  }

  async function refreshActiveRoot() {
    await loadTerminalRoot(activeTerminalId);
  }

  function applyList(listed: FileListResponse) {
    setEntriesByPath((current) => ({
      ...current,
      [listed.path]: sortEntries(listed.entries)
    }));
  }

  async function selectEntry(file: FileEntry) {
    if (!canSelectEntry(file) || !root) {
      return;
    }

    setSelectedEntry(file);
    setError(null);

    if (file.kind === 'directory') {
      setCurrentPath(file.path);
      clearDetail();
      await toggleDirectory(file);
      return;
    }

    setCurrentPath(parentPath(file.path));

    if (file.editable) {
      await previewTextFile(file);
      return;
    }

    if (file.previewKind !== 'none') {
      await openPreviewFile(file, file.previewKind);
    }
  }

  async function activateEntry(file: FileEntry) {
    if (!canSelectEntry(file) || !root) {
      return;
    }

    setSelectedEntry(file);
    setError(null);

    if (file.kind === 'directory') {
      setCurrentPath(file.path);
      clearDetail();
      await toggleDirectory(file);
      return;
    }

    setCurrentPath(parentPath(file.path));

    if (file.editable) {
      await openFileInPane(file);
      return;
    }

    if (file.previewKind !== 'none') {
      await openPreviewFile(file, file.previewKind);
    }
  }

  async function toggleDirectory(file: FileEntry) {
    if (expandedDirectories.has(file.path)) {
      setExpandedDirectories((current) => {
        const next = new Set(current);
        next.delete(file.path);
        return next;
      });
      return;
    }

    setExpandedDirectories((current) => new Set(current).add(file.path));
    await refreshDirectory(file.path);
  }

  function handleEntryKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, file: FileEntry) {
    if (event.key !== 'Enter') {
      return;
    }
    event.preventDefault();
    void activateEntry(file);
  }

  async function previewTextFile(file: FileEntry) {
    if (!root) {
      return;
    }

    const requestId = beginRequest();
    setStatus('loading');
    clearPreviewUrl();
    try {
      const read = await api.readFile({ rootToken: root.rootToken, path: file.path });
      if (!isCurrentRequest(requestId)) {
        return;
      }
      setDetail({ type: 'text-preview', file, read });
      setStatus('idle');
    } catch (caught) {
      if (isCurrentRequest(requestId)) {
        setError(errorMessage(caught));
        setStatus('idle');
      }
    }
  }

  async function openFileInPane(file: FileEntry) {
    if (!root) {
      return;
    }

    const requestId = beginRequest();
    setStatus('loading');
    try {
      await onOpenFile({ rootToken: root.rootToken, path: file.path });
      if (isCurrentRequest(requestId)) {
        setStatus('idle');
      }
    } catch (caught) {
      if (isCurrentRequest(requestId)) {
        setError(errorMessage(caught));
        setStatus('idle');
      }
    }
  }

  async function openPreviewFile(file: FileEntry, previewKind: Exclude<FilePreviewKind, 'none'>) {
    if (!root) {
      return;
    }

    const requestId = beginRequest();
    setStatus('loading');
    clearPreviewUrl();
    try {
      const blob = await api.previewFile({ rootToken: root.rootToken, path: file.path });
      if (!isCurrentRequest(requestId)) {
        return;
      }
      const url = URL.createObjectURL(blob);
      if (!isCurrentRequest(requestId)) {
        URL.revokeObjectURL(url);
        return;
      }
      previewUrlRef.current = url;
      setDetail({ type: 'preview', file, previewKind, url });
      setStatus('idle');
    } catch (caught) {
      if (isCurrentRequest(requestId)) {
        setError(errorMessage(caught));
        setStatus('idle');
      }
    }
  }

  async function createEntry(kind: 'file' | 'directory') {
    if (!root) {
      return;
    }
    const label = kind === 'file' ? 'New file' : 'New folder';
    const value = window.prompt(label, '');
    const directoryPath = selectedEntry ? (selectedEntry.kind === 'directory' ? selectedEntry.path : parentPath(selectedEntry.path)) : currentPath;
    const targetPath = normalizePromptPath(value, directoryPath);
    if (!targetPath) {
      return;
    }
    setError(null);
    try {
      const response = await api.createFileEntry({ rootToken: root.rootToken, path: targetPath, kind });
      setSelectedEntry(response.entry);
      await refreshDirectory(directoryPath);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function moveSelectedEntry() {
    if (!root || !selectedEntry) {
      return;
    }
    const value = window.prompt('Move selected entry', selectedEntry.path);
    const destinationPath = normalizePromptPath(value, '');
    if (!destinationPath || destinationPath === selectedEntry.path) {
      return;
    }
    const sourceParentPath = parentPath(selectedEntry.path);
    const destinationParentPath = parentPath(destinationPath);
    setError(null);
    try {
      const response = await api.moveFileEntry({
        rootToken: root.rootToken,
        sourcePath: selectedEntry.path,
        destinationPath
      });
      setSelectedEntry(response.entry);
      setCurrentPath(response.entry.kind === 'directory' ? response.entry.path : parentPath(response.entry.path));
      clearDetail();
      await refreshDirectory(sourceParentPath);
      if (destinationParentPath !== sourceParentPath) {
        await refreshDirectory(destinationParentPath);
      }
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function deleteSelectedEntry() {
    if (!root || !selectedEntry) {
      return;
    }
    const deletedPath = selectedEntry.path;
    const deletedParentPath = parentPath(deletedPath);
    setError(null);
    try {
      const preview = await api.previewDeleteFileEntry({ rootToken: root.rootToken, path: selectedEntry.path });
      const descendants = preview.descendantCount > 0 ? ` and ${preview.descendantCount} nested item${preview.descendantCount === 1 ? '' : 's'}` : '';
      if (!window.confirm(`Delete ${preview.path}${descendants}?`)) {
        return;
      }
      await api.deleteFileEntry({ rootToken: root.rootToken, path: selectedEntry.path, previewToken: preview.previewToken });
      setSelectedEntry(null);
      setCurrentPath(deletedParentPath);
      setExpandedDirectories((current) => {
        const next = new Set(current);
        for (const path of current) {
          if (path === deletedPath || path.startsWith(`${deletedPath}/`)) {
            next.delete(path);
          }
        }
        return next;
      });
      clearDetail();
      await refreshDirectory(deletedParentPath);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  function clearDetail() {
    requestIdRef.current += 1;
    clearPreviewUrl();
    setDetail({ type: 'empty' });
  }

  function clearPreviewUrl() {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
  }

  function beginRequest(): number {
    requestIdRef.current += 1;
    return requestIdRef.current;
  }

  function isCurrentRequest(requestId: number): boolean {
    return mountedRef.current && requestId === requestIdRef.current;
  }

  function renderTreeEntry(file: FileEntry, depth: number): React.ReactNode {
    const selectable = canSelectEntry(file);
    const expanded = file.kind === 'directory' && expandedDirectories.has(file.path);
    const children = entriesByPath[file.path] ?? [];
    const style = { '--file-tree-depth': depth } as React.CSSProperties;

    return (
      <React.Fragment key={file.path}>
        <button
          type="button"
          className="file-entry-button"
          data-kind={file.kind}
          data-expanded={expanded}
          data-active={selectedEntryPath === file.path}
          disabled={!selectable}
          style={style}
          aria-expanded={file.kind === 'directory' ? expanded : undefined}
          aria-label={`${file.kind === 'directory' ? 'Open folder' : 'Open file'} ${file.name}`}
          title={file.kind === 'directory' ? 'Expand or collapse folder' : 'Click to preview. Double-click or press Enter to open.'}
          onClick={() => void selectEntry(file)}
          onDoubleClick={() => void activateEntry(file)}
          onKeyDown={(event) => handleEntryKeyDown(event, file)}
        >
          <span className="file-entry-disclosure" aria-hidden="true">
            {file.kind === 'directory' ? (expanded ? '▾' : '▸') : ''}
          </span>
          <span className="file-entry-name">{file.name}</span>
          <small>{entryBadge(file)}</small>
        </button>
        {expanded ? (
          <div className="file-tree-children" role="group">
            {children.map((child) => renderTreeEntry(child, depth + 1))}
          </div>
        ) : null}
      </React.Fragment>
    );
  }

  const rootEntries = entriesByPath[''] ?? [];

  return (
    <section className="file-explorer" aria-label="Files" aria-busy={status === 'loading'}>
      <header className="file-explorer-header">
        <div className="file-explorer-path" title={displayPath}>
          {displayPath || 'No active pane'}
        </div>
        <div className="file-explorer-toolbar" aria-label="File actions">
          <button type="button" aria-label="Refresh files" title="Refresh" disabled={!activeTerminalId} onClick={() => void refreshActiveRoot()}>
            ↻
          </button>
          <button type="button" aria-label="New file" title="New file" disabled={!root} onClick={() => void createEntry('file')}>
            +
          </button>
          <button type="button" aria-label="New folder" title="New folder" disabled={!root} onClick={() => void createEntry('directory')}>
            ▣
          </button>
        </div>
      </header>

      {error ? (
        <div className="file-explorer-alert" role="alert">
          {error}
        </div>
      ) : null}

      <div className="file-explorer-layout">
        <div className="file-tree" aria-label={displayPath ? `Files in ${displayPath}` : 'Files'}>
          {rootEntries.map((file) => renderTreeEntry(file, 0))}
        </div>

        <section className="file-detail" aria-label="File detail">
          <div className="file-detail-header">
            <strong>{selectedEntry?.name ?? 'detail'}</strong>
            <div className="file-detail-actions">
              <button type="button" aria-label="Move selected entry" disabled={!selectedEntry} onClick={() => void moveSelectedEntry()}>
                Move
              </button>
              <button type="button" aria-label="Delete selected entry" disabled={!selectedEntry} onClick={() => void deleteSelectedEntry()}>
                Delete
              </button>
            </div>
          </div>

          {status === 'loading' ? <div className="file-detail-empty">loading</div> : null}

          {detail.type === 'empty' && status !== 'loading' ? <div className="file-detail-empty">No file selected</div> : null}

          {detail.type === 'preview' ? (
            <div className="file-preview-frame">
              {detail.previewKind === 'image' ? <img src={detail.url} alt={detail.file.name} /> : null}
              {detail.previewKind === 'pdf' ? <iframe src={detail.url} title={detail.file.name} /> : null}
            </div>
          ) : null}

          {detail.type === 'text-preview' && detail.read.language === 'markdown' ? (
            <div className="file-markdown-preview" aria-label={`Preview for ${detail.file.name}`}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{detail.read.content}</ReactMarkdown>
            </div>
          ) : null}

          {detail.type === 'text-preview' && detail.read.language === 'text' ? (
            <pre className="file-text-preview" aria-label={`Preview for ${detail.file.name}`}>
              {detail.read.content}
            </pre>
          ) : null}

        </section>
      </div>
    </section>
  );
}

function canSelectEntry(entry: FileEntry): boolean {
  return entry.kind === 'directory' || entry.editable || entry.previewKind !== 'none';
}

function entryBadge(entry: FileEntry): string {
  if (entry.kind === 'directory') {
    return 'dir';
  }
  if (entry.editable) {
    return 'edit';
  }
  if (entry.previewKind !== 'none') {
    return entry.previewKind;
  }
  return 'unsupported';
}

function sortEntries(entries: FileEntry[]): FileEntry[] {
  return [...entries].sort((left, right) => {
    if (left.kind === 'directory' && right.kind !== 'directory') {
      return -1;
    }
    if (left.kind !== 'directory' && right.kind === 'directory') {
      return 1;
    }
    return left.name.localeCompare(right.name);
  });
}

function parentPath(path: string): string {
  const parts = path.split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
}

function normalizePromptPath(value: string | null, currentPath: string): string | null {
  if (value === null) {
    return null;
  }
  const normalized = value.trim().replace(/^\/+/, '').replace(/\/{2,}/g, '/').replace(/\/$/, '');
  if (!normalized) {
    return null;
  }
  if (!currentPath || normalized.includes('/')) {
    return normalized;
  }
  return `${currentPath}/${normalized}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed';
}
