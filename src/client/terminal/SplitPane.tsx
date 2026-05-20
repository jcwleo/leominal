import React from 'react';
import type { LayoutNode, TerminalId, TerminalSummary } from '../../shared/types.js';
import type { ApiClient } from '../api/client.js';
import { TextEditorPane, type TextEditorPaneModel } from '../files/TextEditorPane.js';
import { XtermPane } from './XtermPane.js';

interface SplitPaneProps {
  node: LayoutNode;
  terminals: Record<TerminalId, TerminalSummary>;
  editors: Record<string, TextEditorPaneModel>;
  api: ApiClient;
  activeTerminalId: TerminalId;
  refreshCwdOnEnter?: boolean;
  path?: number[];
  totalPanes?: number;
  onSelect: (terminalId: TerminalId) => void;
  onClose: (terminalId: TerminalId) => void;
  onResize: (path: number[], ratio: number) => void;
  onExit: (terminalId: TerminalId, exitCode: number | null) => void;
  onSnapshot: (terminal: TerminalSummary) => void;
  onCloseEditor: (editorId: string) => void;
}

export function SplitPane({
  node,
  terminals,
  editors,
  api,
  activeTerminalId,
  refreshCwdOnEnter = false,
  path = [],
  totalPanes,
  onSelect,
  onClose,
  onResize,
  onExit,
  onSnapshot,
  onCloseEditor
}: SplitPaneProps) {
  const paneCount = totalPanes ?? countPanes(node);

  if (node.type === 'pane') {
    const terminal = terminals[node.terminalId];
    if (!terminal) {
      return <div className="missing-pane">Terminal unavailable</div>;
    }
    return (
      <XtermPane
        terminal={terminal}
        active={node.terminalId === activeTerminalId}
        canClose={paneCount > 1}
        refreshCwdOnEnter={refreshCwdOnEnter && node.terminalId === activeTerminalId}
        onSelect={() => onSelect(node.terminalId)}
        onClose={() => onClose(node.terminalId)}
        onExit={(exitCode) => onExit(node.terminalId, exitCode)}
        onSnapshot={onSnapshot}
      />
    );
  }

  if (node.type === 'editor') {
    const editor = editors[node.editorId];
    if (!editor) {
      return <div className="missing-pane">Editor unavailable</div>;
    }
    return <TextEditorPane api={api} editor={editor} canClose={paneCount > 1} onClose={() => onCloseEditor(node.editorId)} />;
  }

  const firstSize = `${node.ratio * 100}%`;
  const secondSize = `${(1 - node.ratio) * 100}%`;
  const gridTemplate =
    node.direction === 'vertical'
      ? { gridTemplateColumns: `${firstSize} 1px ${secondSize}` }
      : { gridTemplateRows: `${firstSize} 1px ${secondSize}` };

  return (
    <div className="split-pane" data-direction={node.direction} style={gridTemplate}>
      <div className="split-cell">
        <SplitPane
          node={node.first}
          terminals={terminals}
          editors={editors}
          api={api}
          activeTerminalId={activeTerminalId}
          refreshCwdOnEnter={refreshCwdOnEnter}
          path={[...path, 0]}
          totalPanes={paneCount}
          onSelect={onSelect}
          onClose={onClose}
          onResize={onResize}
          onExit={onExit}
          onSnapshot={onSnapshot}
          onCloseEditor={onCloseEditor}
        />
      </div>
      <SplitDivider direction={node.direction} path={path} onResize={onResize} />
      <div className="split-cell">
        <SplitPane
          node={node.second}
          terminals={terminals}
          editors={editors}
          api={api}
          activeTerminalId={activeTerminalId}
          refreshCwdOnEnter={refreshCwdOnEnter}
          path={[...path, 1]}
          totalPanes={paneCount}
          onSelect={onSelect}
          onClose={onClose}
          onResize={onResize}
          onExit={onExit}
          onSnapshot={onSnapshot}
          onCloseEditor={onCloseEditor}
        />
      </div>
    </div>
  );
}

function SplitDivider({
  direction,
  path,
  onResize
}: {
  direction: 'horizontal' | 'vertical';
  path: number[];
  onResize: (path: number[], ratio: number) => void;
}) {
  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();

    const target = event.currentTarget;
    target.setPointerCapture?.(event.pointerId);
    target.classList.add('is-dragging');
    document.body.style.cursor = direction === 'vertical' ? 'col-resize' : 'row-resize';

    const splitElement = target.parentElement;
    if (!splitElement) {
      return;
    }
    const rect = splitElement.getBoundingClientRect();

    function handlePointerMove(pointerEvent: PointerEvent) {
      const rawRatio =
        direction === 'vertical'
          ? (pointerEvent.clientX - rect.left) / rect.width
          : (pointerEvent.clientY - rect.top) / rect.height;
      onResize(path, Math.min(0.9, Math.max(0.1, rawRatio)));
    }

    function handlePointerUp() {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      target.classList.remove('is-dragging');
      document.body.style.cursor = '';
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  }

  return (
    <div
      aria-label="Resize panes"
      aria-orientation={direction === 'vertical' ? 'vertical' : 'horizontal'}
      className="split-divider"
      data-direction={direction}
      onPointerDown={handlePointerDown}
      role="separator"
    >
      <span className="split-divider-handle" aria-hidden="true" />
    </div>
  );
}

function countPanes(node: LayoutNode): number {
  if (node.type === 'pane' || node.type === 'editor') {
    return 1;
  }
  return countPanes(node.first) + countPanes(node.second);
}
