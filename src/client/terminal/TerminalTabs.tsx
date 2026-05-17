import React, { useEffect, useRef, useState } from 'react';
import type { TerminalId, TerminalSummary, TerminalTabLayout } from '../../shared/types.js';
import { listTabTerminalIds } from './terminalReducer.js';

interface TerminalTabsProps {
  tabs: TerminalTabLayout[];
  activeTabId: string | null;
  terminals: Record<TerminalId, TerminalSummary>;
  onSelectTab: (tabId: string) => void;
  onCreateTab: () => void;
  onToggleWorkspaces: () => void;
  onCloseTerminals: (terminalIds: TerminalId[]) => void;
  onSplitVertical: () => void;
  onSplitHorizontal: () => void;
  onCloseActivePane: () => void;
  onRenameTab: (tabId: string, title: string) => void;
  activePaneAvailable: boolean;
}

export function TerminalTabs({
  tabs,
  activeTabId,
  terminals,
  onSelectTab,
  onCreateTab,
  onToggleWorkspaces,
  onCloseTerminals,
  onSplitVertical,
  onSplitHorizontal,
  onCloseActivePane,
  onRenameTab,
  activePaneAvailable
}: TerminalTabsProps) {
  const [editingTab, setEditingTab] = useState<{ tabId: string; title: string } | null>(null);
  const editInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    editInputRef.current?.focus();
    editInputRef.current?.select();
  }, [editingTab?.tabId]);

  function beginRename(tabId: string, title: string) {
    setEditingTab({ tabId, title });
  }

  function commitRename() {
    if (!editingTab) {
      return;
    }
    const title = editingTab.title.trim();
    if (title) {
      onRenameTab(editingTab.tabId, title);
    }
    setEditingTab(null);
  }

  function renderPaneActions() {
    return (
      <div className="terminal-pane-actions" aria-label="Pane actions">
        <button
          type="button"
          className="pane-action-button"
          aria-label="Split right"
          title="Split right"
          onClick={onSplitVertical}
          disabled={!activePaneAvailable}
        >
          <span className="split-icon split-icon-right" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="pane-action-button"
          aria-label="Split down"
          title="Split down"
          onClick={onSplitHorizontal}
          disabled={!activePaneAvailable}
        >
          <span className="split-icon split-icon-down" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="pane-action-button"
          aria-label="Close pane"
          title="Close pane"
          onClick={onCloseActivePane}
          disabled={!activePaneAvailable}
        >
          <span className="close-pane-icon" aria-hidden="true">
            x
          </span>
        </button>
      </div>
    );
  }

  return (
    <nav className="terminal-tabs" aria-label="Terminal tabs">
      <button type="button" className="mobile-menu-button" aria-label="Toggle workspaces" title="Workspaces" onClick={onToggleWorkspaces}>
        <span className="hamburger-lines" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </button>
      <div className="terminal-tab-list">
        {tabs.map((tab) => {
          const terminalIds = listTabTerminalIds(tab);
          const activeTerminal = terminals[tab.activeTerminalId];
          const title = tab.title || activeTerminal?.title || tab.activeTerminalId;
          const active = tab.id === activeTabId;
          const editing = editingTab?.tabId === tab.id;
          const showPaneActions = active && activePaneAvailable;
          return (
            <React.Fragment key={tab.id}>
              <div className="terminal-tab" data-active={active} data-pane-actions={showPaneActions}>
                {editing ? (
                  <form
                    className="terminal-tab-editor"
                    onSubmit={(event) => {
                      event.preventDefault();
                      commitRename();
                    }}
                  >
                    <input
                      ref={editInputRef}
                      aria-label={`Rename ${title}`}
                      value={editingTab.title}
                      onBlur={commitRename}
                      onChange={(event) => setEditingTab({ tabId: tab.id, title: event.target.value })}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          commitRename();
                          return;
                        }
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          setEditingTab(null);
                        }
                      }}
                    />
                  </form>
                ) : (
                  <button
                    type="button"
                    className="terminal-tab-select"
                    aria-label={`Select ${title}`}
                    title={title}
                    onClick={() => onSelectTab(tab.id)}
                    onDoubleClick={(event) => {
                      event.preventDefault();
                      beginRename(tab.id, title);
                    }}
                  >
                    <span>{title}</span>
                    <small>{terminalIds.length} pane{terminalIds.length === 1 ? '' : 's'}</small>
                  </button>
                )}
                {!showPaneActions ? (
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Close ${title}`}
                    title={`Close ${title}`}
                    onClick={() => onCloseTerminals(terminalIds)}
                  >
                    x
                  </button>
                ) : null}
                {showPaneActions ? renderPaneActions() : null}
              </div>
            </React.Fragment>
          );
        })}
      </div>
      <button type="button" className="tab-add-button" aria-label="New tab" title="New tab" onClick={onCreateTab}>
        +
      </button>
    </nav>
  );
}
