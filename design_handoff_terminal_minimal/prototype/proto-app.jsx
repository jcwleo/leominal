/* Leominal Minimal prototype — main app
 * Sidebar (collapsible) + tabs + pane tree with drag-resize + tweaks
 */

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#5eead4",
  "promptStyle": "arrow",
  "density": "regular",
  "font": "JetBrains Mono",
  "showStatus": true,
  "sidebarSide": "left"
} /*EDITMODE-END*/;

const ACCENT_OPTIONS = ['#5eead4', '#22d3ee', '#a5f3b8', '#fcd34d', '#f0abfc'];
const FONT_OPTIONS = ['JetBrains Mono', 'SF Mono', 'Menlo', 'Berkeley Mono'];

/* Helper to make terminal lines for fresh panes — reuses the TERM_LINES_* globals */
function makeLines(kind = 'dev') {
  if (kind === 'dev') return window.TERM_LINES_A;
  if (kind === 'git') return window.TERM_LINES_B;
  if (kind === 'test') return window.TERM_LINES_C;
  return [{ kind: 'prompt', dir: '~/code/leominal', branch: 'main', cmd: '', cursor: true }];
}

/* Initial workspace state */
function initialState() {
  return {
    workspaces: [
    {
      id: 'ws-leominal',
      name: 'leominal',
      cwd: '~/code/leominal',
      tabs: [
      {
        id: 'tab-dev',
        title: 'dev-server',
        activePaneId: 'p1',
        root: {
          type: 'split', dir: 'h', ratio: 0.58,
          children: [
          { type: 'pane', id: 'p1', cwd: '~/code/leominal', branch: 'main', state: 'running', lines: makeLines('dev') },
          {
            type: 'split', dir: 'v', ratio: 0.55,
            children: [
            { type: 'pane', id: 'p2', cwd: '~/code/leominal', branch: 'feat/ui', state: 'idle', lines: makeLines('git') },
            { type: 'pane', id: 'p3', cwd: '~/code/leominal', branch: 'main', state: 'idle', lines: makeLines('test') }]

          }]

        }
      },
      {
        id: 'tab-scratch',
        title: 'scratch',
        activePaneId: 'p4',
        root: { type: 'pane', id: 'p4', cwd: '~/code/leominal', branch: 'main', state: 'idle', lines: makeLines('test') }
      },
      {
        id: 'tab-logs',
        title: 'logs',
        activePaneId: 'p5',
        root: { type: 'pane', id: 'p5', cwd: '~/code/leominal', branch: 'main', state: 'running', lines: makeLines('dev') }
      }],

      activeTabId: 'tab-dev'
    },
    {
      id: 'ws-graphite',
      name: 'graphite-api',
      cwd: '~/work/graphite',
      tabs: [{ id: 'tab-g1', title: 'server', activePaneId: 'g1', root: { type: 'pane', id: 'g1', cwd: '~/work/graphite', branch: 'main', state: 'idle', lines: makeLines('dev') } }],
      activeTabId: 'tab-g1'
    },
    {
      id: 'ws-infra',
      name: 'infra',
      cwd: '~/ops/infra',
      tabs: [{ id: 'tab-i1', title: 'deploy', activePaneId: 'i1', root: { type: 'pane', id: 'i1', cwd: '~/ops/infra', branch: 'main', state: 'idle', lines: makeLines('git') } }],
      activeTabId: 'tab-i1'
    },
    {
      id: 'ws-sandbox',
      name: 'sandbox',
      cwd: '~/scratch',
      tabs: [{ id: 'tab-s1', title: 'play', activePaneId: 's1', root: { type: 'pane', id: 's1', cwd: '~/scratch', branch: '—', state: 'idle', lines: makeLines('test') } }],
      activeTabId: 'tab-s1'
    }],

    activeWorkspaceId: 'ws-leominal'
  };
}

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [state, setState] = useState(initialState);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 760);
  const [authView, setAuthView] = useState('workspace'); // 'setup' | 'login' | 'workspace'

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 760);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const ws = state.workspaces.find((w) => w.id === state.activeWorkspaceId) || state.workspaces[0];
  const tab = ws.tabs.find((tt) => tt.id === ws.activeTabId) || ws.tabs[0];

  /* mutators */
  function patchWorkspace(wsId, fn) {
    setState((s) => ({
      ...s,
      workspaces: s.workspaces.map((w) => w.id === wsId ? fn(w) : w)
    }));
  }
  function patchTab(wsId, tabId, fn) {
    patchWorkspace(wsId, (w) => ({
      ...w,
      tabs: w.tabs.map((tt) => tt.id === tabId ? fn(tt) : tt)
    }));
  }

  function selectWorkspace(id) {
    setState((s) => ({ ...s, activeWorkspaceId: id }));
    setMobileSidebarOpen(false);
  }
  function selectTab(id) {patchWorkspace(ws.id, (w) => ({ ...w, activeTabId: id }));}
  function newTab() {
    const id = `tab-${Date.now().toString(36)}`;
    const paneId = `p-${id}`;
    const newT = {
      id, title: 'shell',
      activePaneId: paneId,
      root: { type: 'pane', id: paneId, cwd: ws.cwd, branch: 'main', state: 'idle', lines: makeLines('blank') }
    };
    patchWorkspace(ws.id, (w) => ({ ...w, tabs: [...w.tabs, newT], activeTabId: id }));
  }
  function closeTab(id) {
    patchWorkspace(ws.id, (w) => {
      const remaining = w.tabs.filter((tt) => tt.id !== id);
      if (remaining.length === 0) return w; // don't close last tab
      return { ...w, tabs: remaining, activeTabId: w.activeTabId === id ? remaining[0].id : w.activeTabId };
    });
  }
  function newWorkspace() {
    const id = `ws-${Date.now().toString(36)}`;
    const tabId = `tab-${id}`;
    const paneId = `p-${id}`;
    const wsNum = state.workspaces.length + 1;
    const newWs = {
      id, name: `workspace ${wsNum}`, cwd: '~',
      tabs: [{ id: tabId, title: 'shell', activePaneId: paneId,
        root: { type: 'pane', id: paneId, cwd: '~', branch: 'main', state: 'idle', lines: makeLines('blank') } }],
      activeTabId: tabId,
    };
    setState((s) => ({ ...s, workspaces: [...s.workspaces, newWs], activeWorkspaceId: id }));
  }
  function closeWorkspace(id) {
    setState((s) => {
      if (s.workspaces.length <= 1) return s;
      const remaining = s.workspaces.filter((w) => w.id !== id);
      const nextActive = s.activeWorkspaceId === id ? remaining[0].id : s.activeWorkspaceId;
      return { ...s, workspaces: remaining, activeWorkspaceId: nextActive };
    });
  }
  function renameWorkspace(id, title) {
    const t = title.trim();
    if (!t) return;
    patchWorkspace(id, (w) => ({ ...w, name: t }));
  }
  function renameTab(id, title) {
    const t = title.trim();
    if (!t) return;
    patchTab(ws.id, id, (tt) => ({ ...tt, title: t }));
  }
  function selectPane(id) {patchTab(ws.id, tab.id, (tt) => ({ ...tt, activePaneId: id }));}
  function updateRatio(path, ratio) {
    patchTab(ws.id, tab.id, (tt) => ({ ...tt, root: setRatioAtPath(tt.root, path, ratio) }));
  }

  function splitPane(dir) {
    // Split the currently active pane in the active tab in the given direction.
    patchTab(ws.id, tab.id, (tt) => {
      const newId = `p-${Date.now().toString(36)}`;
      const replace = (node) => {
        if (node.type === 'pane') {
          if (node.id !== tt.activePaneId) return node;
          return {
            type: 'split', dir, ratio: 0.5,
            children: [
            node,
            { type: 'pane', id: newId, cwd: node.cwd, branch: node.branch, state: 'idle', lines: makeLines('blank') }]

          };
        }
        return { ...node, children: [replace(node.children[0]), replace(node.children[1])] };
      };
      return { ...tt, root: replace(tt.root), activePaneId: newId };
    });
  }

  function closePane(paneId) {
    patchTab(ws.id, tab.id, (tt) => {
      // Walk tree, removing leaf with given id. If split becomes single, collapse.
      const remove = (node) => {
        if (node.type === 'pane') return node.id === paneId ? null : node;
        const a = remove(node.children[0]);
        const b = remove(node.children[1]);
        if (a === null && b === null) return null;
        if (a === null) return b;
        if (b === null) return a;
        return { ...node, children: [a, b] };
      };
      const next = remove(tt.root);
      if (!next) return tt; // refuse to leave empty
      const panes = collectPanes(next);
      const nextActive = tt.activePaneId === paneId ? panes[0].id : tt.activePaneId;
      return { ...tt, root: next, activePaneId: nextActive };
    });
  }

  /* Apply tweaks via CSS vars */  const density = t.density === 'compact' ? { fs: 11.5, lh: 1.45, pad: 9 } :
  t.density === 'spacious' ? { fs: 13.5, lh: 1.7, pad: 16 } :
  { fs: 12.5, lh: 1.55, pad: 12 };

  const rootStyle = {
    '--accent': t.accent,
    '--accent-soft': hexAlpha(t.accent, 0.10),
    '--accent-glow': hexAlpha(t.accent, 0.55),
    '--mono': `'${t.font}', 'JetBrains Mono', ui-monospace, monospace`,
    '--term-fs': `${density.fs}px`,
    '--term-lh': density.lh,
    '--term-pad': `${density.pad}px ${density.pad + 4}px`
  };

  if (authView !== 'workspace') {
    return (
      <AuthScreen
        view={authView}
        rootStyle={rootStyle}
        onSwitchView={setAuthView}
        onAuthed={() => setAuthView('workspace')}
        tweak={t}
        setTweak={setTweak}
      />
    );
  }

  return (
    <div
      className={`mn-shell ${sidebarCollapsed ? 'is-collapsed' : ''} ${mobileSidebarOpen ? 'is-mobile-open' : ''} side-${t.sidebarSide}`}
      style={rootStyle}
      data-mobile={isMobile}>
      
      <Sidebar
        state={state}
        ws={ws}
        collapsed={sidebarCollapsed}
        onCollapse={() => setSidebarCollapsed((v) => !v)}
        onSelect={selectWorkspace}
        onRename={renameWorkspace}
        onNew={newWorkspace}
        onClose={closeWorkspace}
        onLogout={() => setAuthView('login')}
        onCloseMobile={() => setMobileSidebarOpen(false)}
        isMobile={isMobile} />
      
      {mobileSidebarOpen && <div className="mn-scrim" onClick={() => setMobileSidebarOpen(false)} />}

      <section className="mn-main">
        <TopBar
          ws={ws}
          tab={tab}
          onSelectTab={selectTab}
          onNewTab={newTab}
          onCloseTab={closeTab}
          onRenameTab={renameTab}
          onSplitH={() => splitPane('h')}
          onSplitV={() => splitPane('v')}
          onToggleSidebar={() => isMobile ? setMobileSidebarOpen(true) : setSidebarCollapsed((v) => !v)}
          isMobile={isMobile} />
        

        <div className="mn-pane-area">
          <PaneTree
            node={tab.root}
            activePaneId={tab.activePaneId}
            paneCount={collectPanes(tab.root).length}
            onSelectPane={selectPane}
            onClosePane={closePane}
            onUpdateRatio={updateRatio}
            promptStyle={t.promptStyle}
            accent={t.accent} />
          
        </div>

        {t.showStatus && <StatusBar ws={ws} tab={tab} accent={t.accent} />}
      </section>

      <TweaksPanel title="Tweaks" noDeckControls>
        <TweakSection label="Color">
          <TweakColor label="Accent" value={t.accent} options={ACCENT_OPTIONS} onChange={(v) => setTweak('accent', v)} />
        </TweakSection>
        <TweakSection label="Typography">
          <TweakSelect label="Font" value={t.font} options={FONT_OPTIONS} onChange={(v) => setTweak('font', v)} />
          <TweakRadio label="Density" value={t.density} options={['compact', 'regular', 'spacious']} onChange={(v) => setTweak('density', v)} />
        </TweakSection>
        <TweakSection label="Behaviour">
          <TweakSelect label="Prompt style" value={t.promptStyle} options={['simple', 'arrow', 'powerline']} onChange={(v) => setTweak('promptStyle', v)} />
          <TweakRadio label="Sidebar" value={t.sidebarSide} options={['left', 'right']} onChange={(v) => setTweak('sidebarSide', v)} />
          <TweakToggle label="Status bar" value={t.showStatus} onChange={(v) => setTweak('showStatus', v)} />
        </TweakSection>
      </TweaksPanel>
    </div>);

}

/* ---------------- Sidebar ---------------- */

function Sidebar({ state, ws, collapsed, onCollapse, onSelect, onRename, onNew, onClose, onLogout, onCloseMobile, isMobile }) {
  const [editing, setEditing] = useState(null); // { id, draft }
  const inputRef = useRef(null);
  const cancelledRef = useRef(false);

  useEffect(() => { if (editing) { inputRef.current?.focus(); inputRef.current?.select(); } }, [editing?.id]);

  function begin(w) { cancelledRef.current = false; setEditing({ id: w.id, draft: w.name }); }
  function commit() {
    if (!editing) return;
    if (cancelledRef.current) { cancelledRef.current = false; setEditing(null); return; }
    onRename(editing.id, editing.draft);
    setEditing(null);
  }
  return (
    <aside className="mn-sidebar" aria-label="Workspaces">
      <div className="mn-brand">
        <Icon.Lion size={18} />
        {!collapsed && <span className="mn-brand-name">leominal</span>}
        {isMobile ?
          <button className="mn-collapse" onClick={onCloseMobile} title="Close" aria-label="Close">
            <Icon.X size={14} />
          </button>
        :
          <button className="mn-collapse" onClick={onCollapse} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {collapsed ? <Icon.ChevronRight /> : <Icon.ChevronLeft />}
          </button>
        }
      </div>

      {!collapsed &&
      <div className="mn-ws-head">
          <span>workspaces</span>
          <button className="mn-ghost" onClick={onNew} title="New workspace" aria-label="New workspace"><Icon.Plus size={12} /></button>
        </div>
      }

      <div className="mn-ws-list">
        {state.workspaces.map((w) => {
          const active = w.id === ws.id;
          const isEditing = editing?.id === w.id && !collapsed;
          if (isEditing) {
            return (
              <div key={w.id} className="mn-ws-row is-editing">
                <form
                  className={`mn-ws is-editing ${active ? 'active' : ''}`}
                  onSubmit={(e) => { e.preventDefault(); commit(); }}
                >
                  <input
                    ref={inputRef}
                    className="mn-ws-input"
                    aria-label={`Rename workspace ${w.name}`}
                    value={editing.draft}
                    onChange={(e) => setEditing({ id: w.id, draft: e.target.value })}
                    onBlur={commit}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); commit(); }
                      else if (e.key === 'Escape') { e.preventDefault(); cancelledRef.current = true; setEditing(null); }
                    }}
                  />
                  <div className="mn-ws-meta">
                    <span className="mn-ws-cwd">{w.cwd}</span>
                    <span className="mn-ws-tabs">{w.tabs.length}</span>
                  </div>
                </form>
              </div>
            );
          }
          return (
            <div key={w.id} className="mn-ws-row">
              <button
                className={`mn-ws ${active ? 'active' : ''}`}
                onClick={() => onSelect(w.id)}
                onDoubleClick={(e) => { if (!collapsed) { e.preventDefault(); begin(w); } }}
                title={collapsed ? w.name : `${w.name} — double-click to rename`}>
                
                {collapsed ?
                <span className="mn-ws-letter">{w.name[0].toUpperCase()}</span> :

                <React.Fragment>
                    <div className="mn-ws-name">{w.name}</div>
                    <div className="mn-ws-meta">
                      <span className="mn-ws-cwd">{w.cwd}</span>
                      <span className="mn-ws-tabs">{w.tabs.length}</span>
                    </div>
                  </React.Fragment>
                }
              </button>
              {!collapsed && state.workspaces.length > 1 && (
                <button
                  className="mn-ws-x"
                  onClick={(e) => { e.stopPropagation(); onClose(w.id); }}
                  title={`Close ${w.name}`}
                  aria-label={`Close ${w.name}`}
                >
                  <Icon.X size={10} />
                </button>
              )}
            </div>
          );

        })}
      </div>

      {!collapsed &&
      <div className="mn-foot">
          <span>session · 11h left</span>
          <button onClick={onLogout}>logout</button>
        </div>
      }
    </aside>);

}

/* ---------------- Top bar ---------------- */

function TopBar({ ws, tab, onSelectTab, onNewTab, onCloseTab, onRenameTab, onSplitH, onSplitV, onToggleSidebar, isMobile }) {
  const [editing, setEditing] = useState(null); // { id, draft }
  const inputRef = useRef(null);
  const cancelledRef = useRef(false);

  useEffect(() => { if (editing) { inputRef.current?.focus(); inputRef.current?.select(); } }, [editing?.id]);

  function begin(tt) { cancelledRef.current = false; setEditing({ id: tt.id, draft: tt.title }); }
  function commit() {
    if (!editing) return;
    if (cancelledRef.current) { cancelledRef.current = false; setEditing(null); return; }
    onRenameTab(editing.id, editing.draft);
    setEditing(null);
  }

  return (
    <div className="mn-top">
      <button className="mn-top-menu" onClick={onToggleSidebar} title="Toggle workspaces" aria-label="Toggle workspaces">
        <Icon.Menu />
      </button>

      <div className="mn-tabs">
        {ws.tabs.map((tt) => {
          const active = tt.id === tab.id;
          const panes = collectPanes(tt.root).length;
          const isEditing = editing?.id === tt.id;
          return (
            <div key={tt.id} className={`mn-tab ${active ? 'active' : ''}`}>
              {isEditing ? (
                <form
                  className="mn-tab-editor"
                  onSubmit={(e) => { e.preventDefault(); commit(); }}
                >
                  <input
                    ref={inputRef}
                    aria-label={`Rename tab ${tt.title}`}
                    value={editing.draft}
                    onChange={(e) => setEditing({ id: tt.id, draft: e.target.value })}
                    onBlur={commit}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); commit(); }
                      else if (e.key === 'Escape') { e.preventDefault(); cancelledRef.current = true; setEditing(null); }
                    }}
                  />
                  <small>{panes}</small>
                </form>
              ) : (
                <button
                  className="mn-tab-select"
                  onClick={() => onSelectTab(tt.id)}
                  onDoubleClick={(e) => { e.preventDefault(); begin(tt); }}
                  title={`${tt.title} — double-click to rename`}
                >
                  <span>{tt.title}</span>
                  <small>{panes}</small>
                </button>
              )}
              {ws.tabs.length > 1 && !isEditing &&
              <button className="mn-tab-x" onClick={() => onCloseTab(tt.id)} title={`Close ${tt.title}`} aria-label={`Close ${tt.title}`}>
                  <Icon.X size={9} />
                </button>
              }
            </div>);

        })}
        <button className="mn-tab-add" onClick={onNewTab} title="New tab" aria-label="New tab">
          <Icon.Plus size={13} />
        </button>
      </div>

      <div className="mn-actions">
        <button onClick={onSplitH} title="Split right (⌘D)" aria-label="Split right"><Icon.SplitRight size={14} /></button>
        <button onClick={onSplitV} title="Split down (⌘⇧D)" aria-label="Split down"><Icon.SplitDown size={14} /></button>
      </div>
    </div>);

}

/* ---------------- Status bar ---------------- */

function StatusBar({ ws, tab, accent }) {
  const panes = collectPanes(tab.root).length;
  const active = collectPanes(tab.root).find((p) => p.id === tab.activePaneId) || collectPanes(tab.root)[0];
  return (
    <div className="mn-status">
      <span>{active?.cwd}</span>
      <span className="mn-sep">·</span>
      <span>{active?.branch}</span>
      <span className="mn-sep">·</span>
      <span>zsh 5.9</span>
      <span className="mn-status-spacer" />
      <span>{ws.tabs.length} tab · {panes} pane</span>
      <span className="mn-sep">·</span>
      <span style={{ color: accent }}>● connected</span>
    </div>);

}

/* Convert #rrggbb to rgba with alpha */
function hexAlpha(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  const r = n >> 16 & 255,g = n >> 8 & 255,b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}

Object.assign(window, { App });