/* Variant A — "Warp" style: refined, soft, premium. Cyan/teal accent. */

function VariantWarp({ collapsedSidebar = false, mobile = false }) {
  const accent = '#5eead4'; // teal-300
  const accentDim = '#0d9488';

  if (mobile) return <VariantWarpMobile accent={accent} />;

  return (
    <div className={`warp-shell ${collapsedSidebar ? 'is-collapsed' : ''}`}>
      <style>{warpCss}</style>

      {/* Sidebar */}
      <aside className="warp-sidebar">
        <div className="warp-sidebar-brand">
          <div className="brand-mark"><Icon.Lion size={22} /></div>
          {!collapsedSidebar && (
            <div className="brand-text">
              <div className="brand-name">leominal</div>
              <div className="brand-sub">local · 127.0.0.1</div>
            </div>
          )}
          <button className="sidebar-toggle" title={collapsedSidebar ? 'Expand' : 'Collapse'}>
            {collapsedSidebar ? <Icon.ChevronRight /> : <Icon.ChevronLeft />}
          </button>
        </div>

        {!collapsedSidebar && (
          <div className="warp-sec-head">
            <span>WORKSPACES</span>
            <button className="warp-icon-btn" title="New workspace"><Icon.Plus /></button>
          </div>
        )}

        <div className="warp-ws-list">
          {[
            { name: 'leominal', sub: '~/code/leominal', tabs: 3, panes: 5, active: true },
            { name: 'graphite-api', sub: '~/work/graphite', tabs: 2, panes: 2 },
            { name: 'infra', sub: '~/ops/infra', tabs: 1, panes: 1 },
            { name: 'sandbox', sub: '~/scratch', tabs: 1, panes: 1 },
          ].map((ws, i) => (
            <button key={i} className={`warp-ws ${ws.active ? 'active' : ''}`}>
              <span className="warp-ws-dot" style={{ background: ws.active ? accent : '#374151' }} />
              {!collapsedSidebar && (
                <div className="warp-ws-body">
                  <div className="warp-ws-row">
                    <span className="warp-ws-name">{ws.name}</span>
                    <span className="warp-ws-meta">{ws.tabs}·{ws.panes}</span>
                  </div>
                  <div className="warp-ws-sub">{ws.sub}</div>
                </div>
              )}
            </button>
          ))}
        </div>

        {!collapsedSidebar && (
          <div className="warp-sidebar-footer">
            <div className="warp-session">
              <span className="dot" style={{ background: '#34d399' }} />
              <span>session · 11h left</span>
            </div>
            <button className="warp-text-btn">Logout</button>
          </div>
        )}
      </aside>

      {/* Main */}
      <section className="warp-main">
        {/* Tab bar */}
        <div className="warp-tabs">
          <div className="warp-tab-list">
            {[
              { title: 'dev server', panes: 2, active: true },
              { title: 'git · feat/ui', panes: 1 },
              { title: 'tests', panes: 2 },
            ].map((t, i) => (
              <div key={i} className={`warp-tab ${t.active ? 'active' : ''}`}>
                <span className="warp-tab-dot" style={{ background: t.active ? accent : '#475569' }} />
                <span className="warp-tab-title">{t.title}</span>
                <span className="warp-tab-meta">{t.panes}</span>
                <button className="warp-tab-x" title="Close"><Icon.X size={10} /></button>
              </div>
            ))}
            <button className="warp-tab-add" title="New tab"><Icon.Plus size={13} /></button>
          </div>

          <div className="warp-tab-actions">
            <button className="warp-action" title="Split right"><Icon.SplitRight /></button>
            <button className="warp-action" title="Split down"><Icon.SplitDown /></button>
            <span className="warp-action-sep" />
            <button className="warp-action danger" title="Close pane"><Icon.X size={13} /></button>
          </div>
        </div>

        {/* Pane area: vertical split with grab handle */}
        <div className="warp-panes">
          <div className="warp-pane active">
            <div className="warp-pane-bar">
              <span className="pane-id">pty · 48213</span>
              <span className="pane-cwd">~/code/leominal</span>
              <span className="pane-spacer" />
              <span className="pane-badge ok">RUN</span>
            </div>
            <div className="warp-term">
              <TermLines lines={TERM_LINES_A} promptStyle="arrow" accent={accent} />
            </div>
          </div>

          <div className="warp-divider warp-divider-v">
            <div className="warp-handle"><span /><span /></div>
          </div>

          <div className="warp-pane">
            <div className="warp-pane-bar">
              <span className="pane-id">pty · 48227</span>
              <span className="pane-cwd">~/code/leominal</span>
              <span className="pane-spacer" />
              <span className="pane-badge idle">IDLE</span>
            </div>
            <div className="warp-term">
              <TermLines lines={TERM_LINES_B} promptStyle="arrow" accent={accent} />
            </div>
          </div>
        </div>

        {/* Status bar */}
        <div className="warp-status">
          <span className="st-grp"><Icon.Branch /> main</span>
          <span className="st-sep" />
          <span className="st-grp"><Icon.Folder size={12} /> ~/code/leominal</span>
          <span className="st-sep" />
          <span className="st-grp">zsh · 5.9</span>
          <span className="st-grp st-right">
            <span className="dot" style={{ background: '#34d399' }} /> ws · 12ms
          </span>
        </div>
      </section>
    </div>
  );
}

function VariantWarpMobile({ accent }) {
  return (
    <div className="warp-shell warp-mobile">
      <style>{warpCss}</style>
      <header className="warp-m-top">
        <button className="warp-m-icon-btn"><Icon.Menu /></button>
        <div className="warp-m-title">
          <span className="warp-m-eyebrow">leominal · dev server</span>
          <span className="warp-m-sub">~/code/leominal</span>
        </div>
        <button className="warp-m-icon-btn"><Icon.Plus /></button>
      </header>

      <div className="warp-m-tabs">
        {[
          { title: 'dev', active: true },
          { title: 'git' },
          { title: 'tests' },
        ].map((t, i) => (
          <div key={i} className={`warp-m-tab ${t.active ? 'active' : ''}`}>
            <span className="warp-tab-dot" style={{ background: t.active ? accent : '#475569' }} />
            <span>{t.title}</span>
          </div>
        ))}
      </div>

      <div className="warp-panes warp-m-panes">
        <div className="warp-pane active">
          <div className="warp-pane-bar">
            <span className="pane-id">pty · 48213</span>
            <span className="pane-spacer" />
            <span className="pane-badge ok">RUN</span>
          </div>
          <div className="warp-term">
            <TermLines lines={TERM_LINES_A.slice(0, 9)} promptStyle="arrow" accent={accent} />
          </div>
        </div>
      </div>

      <nav className="warp-m-actions">
        <button><Icon.SplitRight /><span>Split →</span></button>
        <button><Icon.SplitDown /><span>Split ↓</span></button>
        <button className="danger"><Icon.X size={14} /><span>Close</span></button>
      </nav>
    </div>
  );
}

const warpCss = `
.warp-shell {
  --bg: #0b0f13;
  --bg-2: #0f151b;
  --bg-3: #131a22;
  --bg-pane: #0c1217;
  --line: #1c252e;
  --line-2: #28333d;
  --fg: #e6edf3;
  --fg-2: #93a4b3;
  --fg-3: #5a6573;
  --accent: #5eead4;
  --accent-soft: rgba(94, 234, 212, 0.12);
  --danger: #f87171;
  display: grid;
  grid-template-columns: 244px minmax(0, 1fr);
  width: 100%;
  height: 100%;
  background: var(--bg);
  color: var(--fg);
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  font-size: 13px;
  overflow: hidden;
}
.warp-shell.is-collapsed { grid-template-columns: 64px minmax(0, 1fr); }

.warp-sidebar {
  display: grid;
  grid-template-rows: auto auto 1fr auto;
  min-width: 0;
  background: #080c10;
  border-right: 1px solid var(--line);
}
.warp-sidebar-brand {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 10px;
  padding: 14px 12px;
  border-bottom: 1px solid var(--line);
}
.brand-mark {
  width: 32px; height: 32px;
  display: grid; place-items: center;
  background: radial-gradient(circle at 50% 40%, rgba(94,234,212,.18), transparent 70%);
  border-radius: 8px;
}
.brand-name { font-weight: 600; letter-spacing: 0.01em; font-size: 13px; }
.brand-sub { font-size: 11px; color: var(--fg-3); margin-top: 1px; font-feature-settings: 'tnum'; }
.sidebar-toggle {
  width: 26px; height: 26px; border-radius: 6px;
  background: transparent; border: 1px solid transparent;
  color: var(--fg-2); display: grid; place-items: center; cursor: pointer;
}
.sidebar-toggle:hover { background: var(--bg-2); border-color: var(--line); color: var(--fg); }
.is-collapsed .brand-text { display: none; }
.is-collapsed .warp-sidebar-brand { grid-template-columns: 1fr auto; padding: 14px 8px; }

.warp-sec-head {
  display: flex; justify-content: space-between; align-items: center;
  padding: 14px 14px 8px;
  font-size: 10px; font-weight: 700; letter-spacing: 0.14em;
  color: var(--fg-3); text-transform: uppercase;
}
.warp-icon-btn {
  width: 22px; height: 22px; border-radius: 5px;
  background: transparent; border: 1px solid var(--line);
  color: var(--fg-2); display: grid; place-items: center; cursor: pointer;
}
.warp-icon-btn:hover { background: var(--bg-2); color: var(--fg); border-color: var(--line-2); }

.warp-ws-list { display: flex; flex-direction: column; gap: 2px; padding: 4px 8px; min-height: 0; overflow: auto; }
.warp-ws {
  display: grid; grid-template-columns: 10px 1fr; gap: 10px;
  align-items: center; padding: 8px 10px; border: 1px solid transparent;
  background: transparent; color: var(--fg-2); border-radius: 7px;
  text-align: left; cursor: pointer;
}
.warp-ws:hover { background: var(--bg-2); color: var(--fg); }
.warp-ws.active {
  background: linear-gradient(180deg, rgba(94,234,212,0.10), rgba(94,234,212,0.04));
  border-color: rgba(94,234,212,0.22);
  color: var(--fg);
}
.warp-ws-dot { width: 6px; height: 6px; border-radius: 50%; box-shadow: 0 0 0 2px rgba(255,255,255,0.02); }
.warp-ws.active .warp-ws-dot { box-shadow: 0 0 8px rgba(94,234,212,0.7); }
.warp-ws-body { min-width: 0; }
.warp-ws-row { display: flex; justify-content: space-between; align-items: baseline; gap: 6px; }
.warp-ws-name { font-weight: 600; font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.warp-ws-meta { font-size: 10px; color: var(--fg-3); font-feature-settings: 'tnum'; }
.warp-ws-sub { font-size: 10.5px; color: var(--fg-3); margin-top: 1px; font-family: 'JetBrains Mono', ui-monospace, monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.is-collapsed .warp-ws-body { display: none; }
.is-collapsed .warp-ws { grid-template-columns: 1fr; justify-items: center; padding: 10px 0; }
.is-collapsed .warp-sec-head { display: none; }

.warp-sidebar-footer {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 12px; border-top: 1px solid var(--line);
  font-size: 11px; color: var(--fg-3);
}
.warp-session { display: flex; gap: 6px; align-items: center; }
.warp-session .dot { width: 6px; height: 6px; border-radius: 50%; }
.warp-text-btn {
  background: transparent; border: 1px solid var(--line);
  color: var(--fg-2); padding: 4px 10px; font-size: 11px; border-radius: 5px; cursor: pointer;
}
.warp-text-btn:hover { color: var(--fg); border-color: var(--line-2); background: var(--bg-2); }

.warp-main { display: grid; grid-template-rows: 40px 1fr 26px; min-width: 0; min-height: 0; background: var(--bg); }

.warp-tabs {
  display: flex; align-items: stretch; padding: 0 8px;
  background: linear-gradient(180deg, #0a0e12 0%, #0c1217 100%);
  border-bottom: 1px solid var(--line);
  gap: 4px;
}
.warp-tab-list { display: flex; gap: 4px; align-items: end; padding-top: 6px; min-width: 0; overflow: hidden; flex: 1 1 auto; }
.warp-tab {
  display: flex; align-items: center; gap: 8px; padding: 0 10px;
  height: 30px; min-width: 0;
  background: transparent; border: 1px solid transparent;
  border-bottom: none;
  border-top-left-radius: 7px; border-top-right-radius: 7px;
  color: var(--fg-2); font-size: 12px; cursor: pointer;
}
.warp-tab:hover { color: var(--fg); background: var(--bg-2); }
.warp-tab.active {
  background: var(--bg-pane);
  border-color: var(--line);
  color: var(--fg);
  position: relative;
}
.warp-tab.active::after {
  content: ''; position: absolute; left: 0; right: 0; bottom: -1px; height: 2px; background: var(--bg-pane);
}
.warp-tab-dot { width: 6px; height: 6px; border-radius: 50%; flex: 0 0 auto; }
.warp-tab.active .warp-tab-dot { box-shadow: 0 0 8px rgba(94,234,212,0.6); }
.warp-tab-title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px; }
.warp-tab-meta { font-size: 10px; color: var(--fg-3); background: var(--bg-3); padding: 1px 5px; border-radius: 4px; font-feature-settings: 'tnum'; }
.warp-tab-x {
  width: 16px; height: 16px; border-radius: 4px;
  background: transparent; border: none; color: var(--fg-3);
  display: grid; place-items: center; cursor: pointer; margin-left: 2px;
}
.warp-tab-x:hover { background: var(--bg-3); color: var(--fg); }
.warp-tab-add {
  width: 26px; height: 26px; border-radius: 6px;
  background: transparent; border: 1px dashed var(--line-2);
  color: var(--fg-2); display: grid; place-items: center; align-self: end; margin-bottom: 2px; cursor: pointer;
}
.warp-tab-add:hover { background: var(--bg-2); color: var(--accent); border-color: var(--accent); }

.warp-tab-actions { display: flex; align-items: center; gap: 2px; padding: 4px 0; align-self: center; }
.warp-action {
  width: 28px; height: 28px; border-radius: 6px;
  background: transparent; border: 1px solid transparent;
  color: var(--fg-2); display: grid; place-items: center; cursor: pointer;
}
.warp-action:hover { background: var(--bg-2); border-color: var(--line); color: var(--fg); }
.warp-action.danger:hover { color: var(--danger); border-color: rgba(248,113,113,0.3); }
.warp-action-sep { width: 1px; height: 16px; background: var(--line); margin: 0 4px; }

.warp-panes {
  display: grid; grid-template-columns: 1fr 6px 1fr;
  min-width: 0; min-height: 0; padding: 8px; gap: 0;
  background: var(--bg);
}
.warp-pane {
  display: grid; grid-template-rows: 28px 1fr;
  min-width: 0; min-height: 0;
  background: var(--bg-pane);
  border: 1px solid var(--line);
  border-radius: 10px; overflow: hidden;
  transition: border-color .15s;
}
.warp-pane.active {
  border-color: rgba(94,234,212,0.55);
  box-shadow: 0 0 0 1px rgba(94,234,212,0.15), 0 8px 28px -16px rgba(94,234,212,0.5);
}
.warp-pane-bar {
  display: flex; align-items: center; gap: 10px;
  padding: 0 12px; border-bottom: 1px solid var(--line);
  font-size: 10.5px; color: var(--fg-3); font-family: 'JetBrains Mono', ui-monospace, monospace;
  background: rgba(255,255,255,0.015);
}
.pane-id { color: var(--fg-2); }
.pane-cwd { color: var(--fg-3); }
.pane-spacer { flex: 1; }
.pane-badge { font-size: 9px; letter-spacing: 0.1em; padding: 1px 6px; border-radius: 3px; font-family: 'Inter', sans-serif; font-weight: 700; }
.pane-badge.ok { background: rgba(52,211,153,0.12); color: #34d399; border: 1px solid rgba(52,211,153,0.25); }
.pane-badge.idle { background: rgba(148,163,184,0.10); color: #94a3b8; border: 1px solid rgba(148,163,184,0.18); }

.warp-term {
  padding: 12px 14px;
  font-family: 'JetBrains Mono', 'MesloLGS NF', ui-monospace, monospace;
  font-size: 12.5px; line-height: 1.55;
  color: #c8d2dd;
  overflow: hidden;
}

.warp-divider { display: grid; place-items: center; cursor: col-resize; position: relative; }
.warp-divider-v::before {
  content: ''; position: absolute; top: 8px; bottom: 8px; left: 50%; width: 1px;
  background: var(--line); transform: translateX(-0.5px);
}
.warp-handle {
  width: 4px; height: 36px; display: flex; flex-direction: column; gap: 2px; align-items: center; justify-content: center;
  background: var(--bg-3); border: 1px solid var(--line-2); border-radius: 4px;
  position: relative; z-index: 1;
}
.warp-handle:hover { border-color: var(--accent); background: rgba(94,234,212,0.06); }
.warp-handle span { width: 2px; height: 2px; border-radius: 50%; background: var(--fg-3); }
.warp-handle:hover span { background: var(--accent); }

.t-stream { white-space: pre; }
.t-line { white-space: pre; min-height: 1.55em; }
.t-cursor {
  display: inline-block; width: 7px; height: 1em; vertical-align: -2px; margin-left: 2px;
  animation: blink 1.05s steps(2, end) infinite;
}
@keyframes blink { 50% { opacity: 0; } }
.t-prompt-pl { font-family: 'JetBrains Mono', ui-monospace, monospace; }
.pl-seg { padding: 0 6px; }

.warp-status {
  display: flex; align-items: center; gap: 10px;
  padding: 0 12px; border-top: 1px solid var(--line);
  font-size: 10.5px; color: var(--fg-3);
  background: #080c10;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}
.st-grp { display: inline-flex; align-items: center; gap: 5px; }
.st-grp svg { color: var(--fg-3); }
.st-sep { width: 1px; height: 10px; background: var(--line-2); }
.st-right { margin-left: auto; }
.st-right .dot { width: 5px; height: 5px; border-radius: 50%; }

/* Mobile */
.warp-mobile { display: flex; flex-direction: column; height: 100%; }
.warp-m-top {
  display: grid; grid-template-columns: 40px 1fr 40px; align-items: center;
  height: 52px; padding: 0 10px; gap: 6px;
  border-bottom: 1px solid var(--line); background: #080c10;
}
.warp-m-icon-btn {
  width: 38px; height: 38px; border-radius: 9px;
  background: var(--bg-2); border: 1px solid var(--line);
  color: var(--fg); display: grid; place-items: center;
}
.warp-m-title { text-align: center; min-width: 0; }
.warp-m-eyebrow { display: block; font-size: 12.5px; font-weight: 600; }
.warp-m-sub { display: block; font-size: 10.5px; color: var(--fg-3); font-family: 'JetBrains Mono', monospace; }
.warp-m-tabs { display: flex; gap: 6px; padding: 8px 10px; overflow: auto; border-bottom: 1px solid var(--line); background: #0a0e12; }
.warp-m-tab { display: flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 999px; background: var(--bg-2); border: 1px solid var(--line); color: var(--fg-2); font-size: 12px; }
.warp-m-tab.active { background: var(--accent-soft); border-color: rgba(94,234,212,0.3); color: var(--fg); }
.warp-m-panes { grid-template-columns: 1fr !important; padding: 8px 8px 0 !important; }
.warp-m-actions {
  display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px;
  padding: 8px 8px calc(8px + env(safe-area-inset-bottom, 0px));
  background: #080c10; border-top: 1px solid var(--line);
}
.warp-m-actions button {
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  height: 50px; border-radius: 10px;
  background: var(--bg-2); border: 1px solid var(--line); color: var(--fg);
  font-size: 11px; cursor: pointer;
}
.warp-m-actions button.danger { color: var(--danger); border-color: rgba(248,113,113,0.25); background: rgba(248,113,113,0.06); }
`;

Object.assign(window, { VariantWarp });
