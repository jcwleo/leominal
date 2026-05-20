import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { FileReadResponse } from '../../shared/protocol.js';
import { ApiError, type ApiClient } from '../api/client.js';

export interface TextEditorPaneModel {
  id: string;
  title: string;
  rootToken: string;
  path: string;
  read: FileReadResponse;
}

interface TextEditorPaneProps {
  api: ApiClient;
  editor: TextEditorPaneModel;
  canClose: boolean;
  onClose: () => void;
}

type SaveStatus = 'idle' | 'saving' | 'saved';
type EditorMode = 'edit' | 'preview';

export function TextEditorPane({ api, editor, canClose, onClose }: TextEditorPaneProps) {
  const [read, setRead] = useState(editor.read);
  const [draft, setDraft] = useState(editor.read.content);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [mode, setMode] = useState<EditorMode>('edit');
  const editorRef = useRef(editor);
  const readRef = useRef(editor.read);
  const draftRef = useRef(editor.read.content);
  const savingRef = useRef(false);
  const mountedRef = useRef(false);
  const saveGenerationRef = useRef(0);
  const canSave = draft !== read.content && status !== 'saving' && !conflict;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      saveGenerationRef.current += 1;
    };
  }, []);

  useEffect(() => {
    saveGenerationRef.current += 1;
    savingRef.current = false;
    editorRef.current = editor;
    readRef.current = editor.read;
    draftRef.current = editor.read.content;
    setRead(editor.read);
    setDraft(editor.read.content);
    setStatus('idle');
    setError(null);
    setConflict(false);
    setMode('edit');
  }, [editor.id, editor.read]);

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  useEffect(() => {
    readRef.current = read;
  }, [read]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    if (draft === read.content || conflict) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (!savingRef.current && draftRef.current !== readRef.current.content) {
        void saveLatest();
      }
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [draft === read.content, conflict, editor.id]);

  async function saveLatest() {
    if (savingRef.current) {
      return;
    }
    const savingDraft = draftRef.current;
    const savingRead = readRef.current;
    if (savingDraft === savingRead.content) {
      return;
    }
    const savingEditor = editorRef.current;
    const saveGeneration = saveGenerationRef.current;
    savingRef.current = true;
    setStatus('saving');
    setError(null);
    setConflict(false);
    try {
      const response = await api.writeFile({
        rootToken: savingEditor.rootToken,
        path: savingEditor.path,
        content: savingDraft,
        expectedVersion: savingRead.version
      });
      if (!mountedRef.current || saveGeneration !== saveGenerationRef.current) {
        return;
      }
      const savedRead = {
        ...savingRead,
        content: savingDraft,
        version: response.version
      };
      readRef.current = savedRead;
      setRead(savedRead);
      setStatus(draftRef.current === savingDraft ? 'saved' : 'idle');
    } catch (caught) {
      if (!mountedRef.current || saveGeneration !== saveGenerationRef.current) {
        return;
      }
      if (caught instanceof ApiError && caught.status === 409) {
        setConflict(true);
        setStatus('idle');
        return;
      }
      setError(errorMessage(caught));
      setStatus('idle');
    } finally {
      if (saveGeneration === saveGenerationRef.current) {
        savingRef.current = false;
      }
    }
  }

  const statusLabel = status === 'saving' ? 'saving' : status === 'saved' ? 'saved' : read.language;
  const markdown = read.language === 'markdown';
  const previewing = markdown && mode === 'preview';

  return (
    <section className="editor-pane" aria-label={`Editor pane ${editor.title}`}>
      <header className="editor-pane-header">
        <span className="terminal-pane-dot" aria-hidden="true" />
        <strong>{editor.title}</strong>
        <span className="terminal-pane-spacer" />
        <span className="terminal-pane-state">{statusLabel}</span>
        <button type="button" aria-label={`Save ${editor.title}`} disabled={!canSave} onClick={() => void saveLatest()}>
          Save
        </button>
        {markdown ? (
          <button
            type="button"
            aria-label={`${previewing ? 'Edit' : 'Preview'} ${editor.title}`}
            onClick={() => setMode((current) => (current === 'preview' ? 'edit' : 'preview'))}
          >
            {previewing ? 'Edit' : 'Preview'}
          </button>
        ) : null}
        {canClose ? (
          <button type="button" className="terminal-pane-close" aria-label={`Close editor ${editor.title}`} onClick={onClose}>
            x
          </button>
        ) : null}
      </header>
      {error ? (
        <div className="editor-pane-alert" role="alert">
          {error}
        </div>
      ) : null}
      {conflict ? (
        <div className="editor-pane-alert" role="alert">
          File changed on disk.
        </div>
      ) : null}
      {previewing ? (
        <div className="editor-markdown-preview" aria-label={`Markdown preview for ${editor.title}`}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft}</ReactMarkdown>
        </div>
      ) : (
        <textarea
          className="editor-pane-textarea"
          aria-label={`Editor for ${editor.title}`}
          spellCheck={false}
          value={draft}
          onChange={(event) => {
            const nextDraft = event.target.value;
            draftRef.current = nextDraft;
            setDraft(nextDraft);
            setStatus('idle');
            setError(null);
            setConflict(false);
          }}
        />
      )}
    </section>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed';
}
