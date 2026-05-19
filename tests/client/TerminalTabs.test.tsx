// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TerminalSummary, TerminalTabLayout } from '../../src/shared/types.js';
import { TerminalTabs } from '../../src/client/terminal/TerminalTabs.js';

function terminal(id: string, title = id): TerminalSummary {
  return {
    id,
    title,
    cwd: `/workspace/${id}`,
    pid: 100,
    cols: 80,
    rows: 24,
    createdAt: '2026-05-17T00:00:00.000Z',
    updatedAt: '2026-05-17T00:00:00.000Z',
    status: 'running',
    exitCode: null
  };
}

describe('TerminalTabs', () => {
  afterEach(cleanup);

  it('closes every pane in an inactive split tab from the tab close affordance', async () => {
    const onCloseTerminals = vi.fn();
    const splitTab: TerminalTabLayout = {
      id: 'tab-alpha',
      title: 'Alpha',
      activeTerminalId: 'term-right',
      root: {
        type: 'split',
        direction: 'vertical',
        ratio: 0.5,
        first: { type: 'pane', terminalId: 'term-left' },
        second: { type: 'pane', terminalId: 'term-right' }
      }
    };
    const activeTab: TerminalTabLayout = {
      id: 'tab-beta',
      title: 'Beta',
      activeTerminalId: 'term-beta',
      root: { type: 'pane', terminalId: 'term-beta' }
    };

    render(
      <TerminalTabs
        tabs={[splitTab, activeTab]}
        activeTabId="tab-beta"
        terminals={{
          'term-left': terminal('term-left', 'Left'),
          'term-right': terminal('term-right', 'Right'),
          'term-beta': terminal('term-beta', 'Beta')
        }}
        onSelectTab={() => undefined}
        onCreateTab={() => undefined}
        onToggleWorkspaces={() => undefined}
        onCloseTerminals={onCloseTerminals}
        onSplitVertical={() => undefined}
        onSplitHorizontal={() => undefined}
        onRenameTab={() => undefined}
        activePaneAvailable
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Close Alpha' }));

    expect(onCloseTerminals).toHaveBeenCalledWith(['term-left', 'term-right']);
  });

  it('keeps tab close separate from pane actions on the active tab', () => {
    const onCloseTerminals = vi.fn();
    const tab: TerminalTabLayout = {
      id: 'tab-alpha',
      title: 'Alpha',
      activeTerminalId: 'term-alpha',
      root: { type: 'pane', terminalId: 'term-alpha' }
    };
    const secondTab: TerminalTabLayout = {
      id: 'tab-beta',
      title: 'Beta',
      activeTerminalId: 'term-beta',
      root: { type: 'pane', terminalId: 'term-beta' }
    };

    render(
      <TerminalTabs
        tabs={[tab, secondTab]}
        activeTabId="tab-alpha"
        terminals={{ 'term-alpha': terminal('term-alpha', 'Alpha'), 'term-beta': terminal('term-beta', 'Beta') }}
        onSelectTab={() => undefined}
        onCreateTab={() => undefined}
        onToggleWorkspaces={() => undefined}
        onCloseTerminals={onCloseTerminals}
        onSplitVertical={() => undefined}
        onSplitHorizontal={() => undefined}
        onRenameTab={() => undefined}
        activePaneAvailable
      />
    );

    expect(screen.getByRole('button', { name: 'Close Alpha' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Close pane' })).toBeNull();
    expect(onCloseTerminals).not.toHaveBeenCalled();
  });

  it('exposes a tab bar add affordance', () => {
    const onCreateTab = vi.fn();
    const tab: TerminalTabLayout = {
      id: 'tab-alpha',
      title: 'Alpha',
      activeTerminalId: 'term-alpha',
      root: { type: 'pane', terminalId: 'term-alpha' }
    };

    render(
      <TerminalTabs
        tabs={[tab]}
        activeTabId="tab-alpha"
        terminals={{ 'term-alpha': terminal('term-alpha', 'Alpha') }}
        onSelectTab={() => undefined}
        onCreateTab={onCreateTab}
        onToggleWorkspaces={() => undefined}
        onCloseTerminals={() => undefined}
        onSplitVertical={() => undefined}
        onSplitHorizontal={() => undefined}
        onRenameTab={() => undefined}
        activePaneAvailable
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'New tab' }));

    expect(onCreateTab).toHaveBeenCalledOnce();
  });

  it('exposes a mobile workspace menu affordance', () => {
    const onToggleWorkspaces = vi.fn();
    const tab: TerminalTabLayout = {
      id: 'tab-alpha',
      title: 'Alpha',
      activeTerminalId: 'term-alpha',
      root: { type: 'pane', terminalId: 'term-alpha' }
    };

    render(
      <TerminalTabs
        tabs={[tab]}
        activeTabId="tab-alpha"
        terminals={{ 'term-alpha': terminal('term-alpha', 'Alpha') }}
        onSelectTab={() => undefined}
        onCreateTab={() => undefined}
        onToggleWorkspaces={onToggleWorkspaces}
        onCloseTerminals={() => undefined}
        onSplitVertical={() => undefined}
        onSplitHorizontal={() => undefined}
        onRenameTab={() => undefined}
        activePaneAvailable
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Toggle workspaces' }));

    expect(onToggleWorkspaces).toHaveBeenCalledOnce();
  });

  it('exposes compact active-pane actions in the tab bar', () => {
    const onSplitVertical = vi.fn();
    const onSplitHorizontal = vi.fn();
    const tab: TerminalTabLayout = {
      id: 'tab-alpha',
      title: 'Alpha',
      activeTerminalId: 'term-alpha',
      root: { type: 'pane', terminalId: 'term-alpha' }
    };

    render(
      <TerminalTabs
        tabs={[tab]}
        activeTabId="tab-alpha"
        terminals={{ 'term-alpha': terminal('term-alpha', 'Alpha') }}
        onSelectTab={() => undefined}
        onCreateTab={() => undefined}
        onToggleWorkspaces={() => undefined}
        onCloseTerminals={() => undefined}
        onSplitVertical={onSplitVertical}
        onSplitHorizontal={onSplitHorizontal}
        onRenameTab={() => undefined}
        activePaneAvailable
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Split right' }));
    fireEvent.click(screen.getByRole('button', { name: 'Split down' }));

    expect(onSplitVertical).toHaveBeenCalledOnce();
    expect(onSplitHorizontal).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Split right' })).toHaveAttribute('title', 'Split right - Ctrl+Option+Shift+Right');
    expect(screen.getByRole('button', { name: 'Split down' })).toHaveAttribute('title', 'Split down - Ctrl+Option+Shift+Down');
    expect(screen.queryByRole('button', { name: 'Close pane' })).toBeNull();
  });

  it('places pane split actions at the top bar edge', () => {
    const tabs: TerminalTabLayout[] = [
      {
        id: 'tab-alpha',
        title: 'Alpha',
        activeTerminalId: 'term-alpha',
        root: { type: 'pane', terminalId: 'term-alpha' }
      },
      {
        id: 'tab-beta',
        title: 'Beta',
        activeTerminalId: 'term-beta',
        root: { type: 'pane', terminalId: 'term-beta' }
      }
    ];

    render(
      <TerminalTabs
        tabs={tabs}
        activeTabId="tab-alpha"
        terminals={{
          'term-alpha': terminal('term-alpha', 'Alpha'),
          'term-beta': terminal('term-beta', 'Beta')
        }}
        onSelectTab={() => undefined}
        onCreateTab={() => undefined}
        onToggleWorkspaces={() => undefined}
        onCloseTerminals={() => undefined}
        onSplitVertical={() => undefined}
        onSplitHorizontal={() => undefined}
        onRenameTab={() => undefined}
        activePaneAvailable
      />
    );

    const tabsInDom = document.querySelectorAll('.terminal-tab');

    expect(tabsInDom).toHaveLength(2);
    expect(document.querySelector('.terminal-tabs > .terminal-pane-actions')).not.toBeNull();
    expect(document.querySelector('.terminal-tab[data-active="true"]')?.querySelector('.terminal-pane-actions')).toBeNull();
  });

  it('hides active-pane actions when there is no active pane', () => {
    render(
      <TerminalTabs
        tabs={[]}
        activeTabId={null}
        terminals={{}}
        onSelectTab={() => undefined}
        onCreateTab={() => undefined}
        onToggleWorkspaces={() => undefined}
        onCloseTerminals={() => undefined}
        onSplitVertical={() => undefined}
        onSplitHorizontal={() => undefined}
        onRenameTab={() => undefined}
        activePaneAvailable={false}
      />
    );

    expect(screen.queryByRole('button', { name: 'Split right' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Split down' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close pane' })).toBeNull();
  });

  it('renames a tab from the tab title', () => {
    const onRenameTab = vi.fn();
    const tab: TerminalTabLayout = {
      id: 'tab-alpha',
      title: 'Alpha',
      activeTerminalId: 'term-alpha',
      root: { type: 'pane', terminalId: 'term-alpha' }
    };

    render(
      <TerminalTabs
        tabs={[tab]}
        activeTabId="tab-alpha"
        terminals={{ 'term-alpha': terminal('term-alpha', 'Alpha') }}
        onSelectTab={() => undefined}
        onCreateTab={() => undefined}
        onToggleWorkspaces={() => undefined}
        onCloseTerminals={() => undefined}
        onSplitVertical={() => undefined}
        onSplitHorizontal={() => undefined}
        onRenameTab={onRenameTab}
        activePaneAvailable
      />
    );

    fireEvent.doubleClick(screen.getByRole('button', { name: 'Select Alpha' }));
    const input = screen.getByLabelText('Rename Alpha');
    fireEvent.change(input, { target: { value: 'Ops shell' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onRenameTab).toHaveBeenCalledWith('tab-alpha', 'Ops shell');
  });

  it('cancels tab rename on escape', () => {
    const onRenameTab = vi.fn();
    const tab: TerminalTabLayout = {
      id: 'tab-alpha',
      title: 'Alpha',
      activeTerminalId: 'term-alpha',
      root: { type: 'pane', terminalId: 'term-alpha' }
    };

    render(
      <TerminalTabs
        tabs={[tab]}
        activeTabId="tab-alpha"
        terminals={{ 'term-alpha': terminal('term-alpha', 'Alpha') }}
        onSelectTab={() => undefined}
        onCreateTab={() => undefined}
        onToggleWorkspaces={() => undefined}
        onCloseTerminals={() => undefined}
        onSplitVertical={() => undefined}
        onSplitHorizontal={() => undefined}
        onRenameTab={onRenameTab}
        activePaneAvailable
      />
    );

    fireEvent.doubleClick(screen.getByRole('button', { name: 'Select Alpha' }));
    fireEvent.keyDown(screen.getByLabelText('Rename Alpha'), { key: 'Escape' });

    expect(onRenameTab).not.toHaveBeenCalled();
  });
});
