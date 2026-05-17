import React from 'react';
import type { LayoutNode, TerminalId, TerminalSummary } from '../../shared/types.js';
import { XtermPane } from './XtermPane.js';

interface SplitPaneProps {
  node: LayoutNode;
  terminals: Record<TerminalId, TerminalSummary>;
  activeTerminalId: TerminalId;
  onSelect: (terminalId: TerminalId) => void;
  onExit: (terminalId: TerminalId, exitCode: number | null) => void;
  onSnapshot: (terminal: TerminalSummary) => void;
}

export function SplitPane({ node, terminals, activeTerminalId, onSelect, onExit, onSnapshot }: SplitPaneProps) {
  if (node.type === 'pane') {
    const terminal = terminals[node.terminalId];
    if (!terminal) {
      return <div className="missing-pane">Terminal unavailable</div>;
    }
    return (
      <XtermPane
        terminal={terminal}
        active={node.terminalId === activeTerminalId}
        onSelect={() => onSelect(node.terminalId)}
        onExit={(exitCode) => onExit(node.terminalId, exitCode)}
        onSnapshot={onSnapshot}
      />
    );
  }

  return (
    <div className="split-pane" data-direction={node.direction}>
      <SplitPane
        node={node.first}
        terminals={terminals}
        activeTerminalId={activeTerminalId}
        onSelect={onSelect}
        onExit={onExit}
        onSnapshot={onSnapshot}
      />
      <div className="split-divider" />
      <SplitPane
        node={node.second}
        terminals={terminals}
        activeTerminalId={activeTerminalId}
        onSelect={onSelect}
        onExit={onExit}
        onSnapshot={onSnapshot}
      />
    </div>
  );
}
