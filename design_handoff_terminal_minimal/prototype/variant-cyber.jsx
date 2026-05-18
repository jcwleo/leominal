/* Variant B — "Cyber/Command Center": sharper, neon teal, monospace-forward */

function VariantCyber({ mobile = false }) {
  const accent = '#22d3ee'; // cyan-400

  if (mobile) return <VariantCyberMobile accent={accent} />;

  return (
    <div className="cy-shell">
      <style>{cyberCss}</style>

      <aside className="cy-sidebar">
        <div className="cy-brand">
          <Icon.Lion size={26} />
          <div className="cy-brand-text">
            <div className="cy-brand-name">LEOMINAL</div>
            <div className="cy-brand-sub">v0.4.1 · 127.0.0.1:3107</div>
          </div>
          <button className="cy-collapse" title="Collapse"><Icon.ChevronLeft /></button>
        </div>

        <div className="cy-sec">
          <span className="cy-sec-label">// WORKSPACES</span>
          <button className="cy-sec-add"><Icon.Plus size={11} /> NEW</button>
        </div>

        <div className="cy-ws-list">
          {[
            { idx: '01', name: 'leominal', sub: 'feat/ui', cwd: '~/code/leominal', tabs: 3, panes: 5, active: true },
            { idx: '02', name: 'graphite-api', sub: 'main', cwd: '~/work/graphite', tabs: 2, panes: 2 },
            { idx: '03', name: 'infra', sub: 'main', cwd: '~/ops/infra', tabs: 1, panes: 1 },
            { idx: '04', name: 'sandbox', sub: '—', cwd: '~/scratch', tabs: 1, panes: 1 },
          ].map((ws, i) => (
            <button key={i} className={`cy-ws ${ws.active ? 'active' : ''}`}>
              <span className="cy-ws-idx">{ws.idx}</span>
              <div className="cy-ws-body">
                <div className="cy-ws-name">{ws.name}</div>
                <div className="cy-ws-cwd">{ws.cwd}</div>
              </div>
              <div className="cy-ws-stats">
                <span>{ws.tabs}T</span>
                <span>{ws.panes}P</span>
              </div>
            </button>
          ))}
        </div>

        <div className="cy-sidebar-footer">
          <div className="cy-meter">
            <div className="cy-meter-label">SESSION</div>
            <div className="cy-meter-bar"><span style={{ width: '68%' }} /></div>
            <div className="cy-meter-val">11h 24m</div>
          </div>
          <button className="cy-logout">⏻ LOGOUT</button>
        </div>
      </aside>

      <section className="cy-main">
        {/* Top bar: tabs + actions */}
        <div className="cy-topbar">
          <div className="cy-tabs">
            {[
              { title: 'dev-server', branch: 'main', panes: 2, active: true },
              { title: 'git-status', branch: 'feat/ui', panes: 1 },
              { title: 'vitest', branch: 'main', panes: 2 },
            ].map((t, i) => (
              <div key={i} className={`cy-tab ${t.active ? 'active' : ''}`}>
                <span className="cy-tab-accent" />
                <div className="cy-tab-body">
                  <span className="cy-tab-title">{t.title}</span>
                  <span className="cy-tab-meta">⎇ {t.branch} · {t.panes}p</span>
                </div>
                <button className="cy-tab-x"><Icon.X size={10} /></button>
              </div>
            ))}
            <button className="cy-tab-add" title="New tab"><Icon.Plus size={14} /></button>
          </div>

          <div className="cy-actions">
            <button className="cy-action" title="Split right">
              <Icon.SplitRight size={14} /><span>⌘D</span>
            </button>
            <button className="cy-action" title="Split down">
              <Icon.SplitDown size={14} /><span>⌘⇧D</span>
            </button>
            <button className="cy-action danger" title="Close">
              <Icon.X size={14} /><span>⌘W</span>
            </button>
          </div>
        </div>

        {/* Panes */}
        <div className="cy-pane-area">
          <div className="cy-pane active">
            <div className="cy-pane-head">
              <span className="cy-pane-tag">PANE 01</span>
              <span className="cy-pane-cwd">~/code/leominal</span>
              <span className="cy-pane-pid">pty 48213 · zsh</span>
              <span className="cy-pane-spacer" />
              <span className="cy-pane-state ok"><span className="cy-blink" /> RUNNING</span>
            </div>
            <div className="cy-term">
              <TermLines lines={TERM_LINES_A} promptStyle="powerline" accent={accent} />
            </div>
          </div>

          <div className="cy-divider cy-divider-v">
            <div className="cy-handle">
              <span /><span /><span /><span />
            </div>
          </div>

          <div className="cy-pane">
            <div className="cy-pane-head">
              <span className="cy-pane-tag">PANE 02</span>
              <span className="cy-pane-cwd">~/code/leominal</span>
              <span className="cy-pane-pid">pty 48227 · zsh</span>
              <span className="cy-pane-spacer" />
              <span className="cy-pane-state idle">IDLE</span>
            </div>
            <div className="cy-term">
              <TermLines lines={TERM_LINES_B} promptStyle="powerline" accent={accent} />
            </div>
          </div>
        </div>

        {/* Status bar with powerline cells */}
        <div className="cy-status">
          <div className="cy-cell cy-cell-host">
            <span className="cy-led" /> 127.0.0.1
          </div>
          <PowerSep from="#0a1620" to="#0a1014" />
          <div className="cy-cell">⎇ main</div>
          <PowerSep from="#0a1014" to="transparent" />
          <div className="cy-cell">~/code/leominal</div>
          <div className="cy-cell-spacer" />
          <PowerSep from="transparent" to="#0a1014" reverse />
          <div className="cy-cell">zsh 5.9</div>
          <PowerSep from="#0a1014" to="#0a1620" reverse />
          <div className="cy-cell">ws · 12ms</div>
          <PowerSep from="#0a1620" to="#142a30" reverse />
          <div className="cy-cell cy-cell-time">14:22:47</div>
        </div>
      </section>
    </div>
  );
}

function PowerSep({ from, to, reverse }) {
  return (
    <svg width="10" height="22" viewBox="0 0 10 22" style={{ display: 'block', flex: '0 0 auto' }}>
      <rect width="10" height="22" fill={from} />
      {reverse ? (
        <path d="M0 0 L10 0 L10 22 L0 22 L10 11 Z" fill={to} />
      ) : (
        <path d="M0 0 L10 11 L0 22 Z" fill={to} />
      )}
    </svg>
  );
}

function VariantCyberMobile({ accent }) {
  return (
    <div className="cy-shell cy-mobile">
      <style>{cyberCss}</style>
      <header className="cy-m-top">
        <button className="cy-m-icon"><Icon.Menu /></button>
        <div className="cy-m-title">
          <span className="cy-m-eyebrow">// LEOMINAL · dev-server</span>
          <span className="cy-m-sub">⎇ main · ~/code/leominal</span>
        </div>
        <button className="cy-m-icon"><Icon.Plus /></button>
      </header>

      <div className="cy-m-tabs">
        {[
          { title: '01 · dev', active: true },
          { title: '02 · git' },
          { title: '03 · test' },
        ].map((t, i) => (
          <div key={i} className={`cy-m-tab ${t.active ? 'active' : ''}`}>
            <span>{t.title}</span>
          </div>
        ))}
      </div>

      <div className="cy-pane-area cy-m-panes">
        <div className="cy-pane active">
          <div className="cy-pane-head">
            <span className="cy-pane-tag">PANE 01</span>
            <span className="cy-pane-spacer" />
            <span className="cy-pane-state ok"><span className="cy-blink" /> RUN</span>
          </div>
          <div className="cy-term">
            <TermLines lines={TERM_LINES_A.slice(0, 9)} promptStyle="powerline" accent={accent} />
          </div>
        </div>
      </div>

      <nav className="cy-m-actions">
        <button><Icon.SplitRight size={16} /><span>SPLIT →</span></button>
        <button><Icon.SplitDown size={16} /><span>SPLIT ↓</span></button>
        <button className="danger"><Icon.X size={16} /><span>CLOSE</span></button>
      </nav>
    </div>
  );
}

const cyberCss = `
.cy-shell {
  --bg: #06090c;
  --bg-2: #0a1014;
  --bg-3: #0e171c;
  --bg-pane: #07101a;
  --line: #16252e;
  --line-2: #24414d;
  --fg: #d8e6ef;
  --fg-2: #7a93a4;
  --fg-3: #4a5d6a;
  --accent: #22d3ee;
  --accent-2: #67e8f9;
  --danger: #fb7185;
  display: grid;
  grid-template-columns: 256px minmax(0, 1fr);
  width: 100%; height: 100%;
  background: var(--bg);
  color: var(--fg);
  font-family: 'JetBrains Mono', 'MesloLGS NF', ui-monospace, 'SF Mono', monospace;
  font-size: 12.5px;
  overflow: hidden;
}

.cy-sidebar {
  display: grid; grid-template-rows: auto auto 1fr auto;
  background: linear-gradient(180deg, #04070a, #060a0e);
  border-right: 1px solid var(--line);
  min-width: 0;
}
.cy-brand {
  display: grid; grid-template-columns: auto 1fr auto;
  gap: 10px; align-items: center;
  padding: 14px 14px 12px;
  border-bottom: 1px solid var(--line);
  position: relative;
}
.cy-brand::after {
  content: ''; position: absolute; left: 14px; right: 14px; bottom: -1px; height: 1px;
  background: linear-gradient(90deg, transparent, var(--accent), transparent); opacity: .35;
}
.cy-brand-text { min-width: 0; }
.cy-brand-name {
  font-size: 13px; font-weight: 700; letter-spacing: 0.14em; color: var(--fg);
}
.cy-brand-sub { font-size: 10px; color: var(--fg-3); margin-top: 2px; letter-spacing: 0.04em; }
.cy-collapse {
  width: 24px; height: 24px; border-radius: 4px;
  background: transparent; border: 1px solid var(--line);
  color: var(--fg-2); display: grid; place-items: center; cursor: pointer;
}

.cy-sec {
  display: flex; justify-content: space-between; align-items: center;
  padding: 12px 14px 6px;
}
.cy-sec-label {
  font-size: 10px; color: var(--accent); letter-spacing: 0.18em; opacity: .8;
}
.cy-sec-add {
  display: inline-flex; gap: 4px; align-items: center;
  font-size: 10px; letter-spacing: 0.14em;
  background: transparent; border: 1px solid var(--line-2);
  color: var(--accent); padding: 3px 7px 3px 5px; cursor: pointer; border-radius: 2px;
}
.cy-sec-add:hover { background: rgba(34,211,238,0.08); }

.cy-ws-list { display: flex; flex-direction: column; gap: 1px; padding: 0 8px; overflow: auto; min-height: 0; }
.cy-ws {
  display: grid; grid-template-columns: auto 1fr auto;
  gap: 10px; align-items: center; padding: 10px 10px;
  background: transparent; border: 1px solid transparent;
  color: var(--fg-2); text-align: left; cursor: pointer;
  border-left: 2px solid transparent;
}
.cy-ws:hover { background: var(--bg-2); color: var(--fg); }
.cy-ws.active {
  background: linear-gradient(90deg, rgba(34,211,238,0.10), transparent 80%);
  border-left-color: var(--accent);
  color: var(--fg);
}
.cy-ws-idx {
  font-size: 11px; color: var(--fg-3); font-weight: 700;
  width: 18px; text-align: center;
}
.cy-ws.active .cy-ws-idx { color: var(--accent); text-shadow: 0 0 6px rgba(34,211,238,0.5); }
.cy-ws-body { min-width: 0; }
.cy-ws-name { font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cy-ws-cwd { font-size: 10px; color: var(--fg-3); margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cy-ws-stats { display: flex; gap: 4px; font-size: 9.5px; color: var(--fg-3); }
.cy-ws-stats span { padding: 1px 4px; background: var(--bg-3); border-radius: 2px; }
.cy-ws.active .cy-ws-stats span { background: rgba(34,211,238,0.12); color: var(--accent); }

.cy-sidebar-footer {
  padding: 12px 14px; border-top: 1px solid var(--line);
  display: grid; gap: 8px;
}
.cy-meter { display: grid; grid-template-columns: auto 1fr auto; gap: 6px; align-items: center; }
.cy-meter-label { font-size: 9.5px; color: var(--fg-3); letter-spacing: 0.18em; }
.cy-meter-bar { height: 4px; background: var(--bg-3); border-radius: 2px; overflow: hidden; }
.cy-meter-bar span { display: block; height: 100%; background: linear-gradient(90deg, var(--accent), var(--accent-2)); }
.cy-meter-val { font-size: 10px; color: var(--fg); font-variant-numeric: tabular-nums; }
.cy-logout {
  background: transparent; border: 1px solid var(--line-2); color: var(--fg-2);
  padding: 6px 8px; font-family: inherit; font-size: 10.5px; letter-spacing: 0.16em;
  cursor: pointer; border-radius: 2px;
}
.cy-logout:hover { border-color: var(--danger); color: var(--danger); }

.cy-main { display: grid; grid-template-rows: 44px 1fr 22px; min-width: 0; min-height: 0; }

.cy-topbar {
  display: grid; grid-template-columns: 1fr auto;
  background: #050a0d; border-bottom: 1px solid var(--line);
  align-items: stretch; min-width: 0;
}
.cy-tabs { display: flex; min-width: 0; overflow: hidden; }
.cy-tab {
  display: grid; grid-template-columns: 3px 1fr auto;
  align-items: center; min-width: 0;
  background: transparent;
  border-right: 1px solid var(--line);
  color: var(--fg-2); cursor: pointer;
  position: relative;
}
.cy-tab:hover { background: var(--bg-2); color: var(--fg); }
.cy-tab.active {
  background: var(--bg-pane); color: var(--fg);
}
.cy-tab-accent { background: var(--line); height: 100%; }
.cy-tab.active .cy-tab-accent { background: var(--accent); box-shadow: 0 0 8px var(--accent); }
.cy-tab-body { padding: 4px 12px; min-width: 0; }
.cy-tab-title { display: block; font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px; }
.cy-tab-meta { display: block; font-size: 9.5px; color: var(--fg-3); margin-top: 1px; letter-spacing: 0.02em; }
.cy-tab.active .cy-tab-meta { color: var(--accent); opacity: 0.8; }
.cy-tab-x {
  width: 18px; height: 18px; margin-right: 8px; border-radius: 3px;
  background: transparent; border: none; color: var(--fg-3);
  display: grid; place-items: center; cursor: pointer;
}
.cy-tab-x:hover { background: var(--bg-3); color: var(--fg); }
.cy-tab-add {
  width: 36px; background: transparent; border: none; border-right: 1px solid var(--line);
  color: var(--fg-2); display: grid; place-items: center; cursor: pointer;
}
.cy-tab-add:hover { background: var(--bg-2); color: var(--accent); }

.cy-actions { display: flex; align-items: center; gap: 4px; padding: 0 8px; border-left: 1px solid var(--line); }
.cy-action {
  display: inline-flex; align-items: center; gap: 6px;
  height: 28px; padding: 0 8px; border-radius: 4px;
  background: transparent; border: 1px solid var(--line);
  color: var(--fg-2); font-family: inherit; font-size: 10.5px; cursor: pointer;
}
.cy-action span { font-size: 9.5px; color: var(--fg-3); letter-spacing: 0.04em; }
.cy-action:hover { color: var(--fg); border-color: var(--line-2); background: var(--bg-2); }
.cy-action.danger:hover { color: var(--danger); border-color: rgba(251,113,133,0.4); }

.cy-pane-area {
  display: grid; grid-template-columns: 1fr 8px 1fr;
  min-width: 0; min-height: 0; background: #04080b;
}
.cy-pane {
  display: grid; grid-template-rows: 26px 1fr;
  min-width: 0; min-height: 0;
  background: var(--bg-pane);
  border: 1px solid var(--line);
  margin: 0;
  position: relative;
}
.cy-pane.active {
  border-color: var(--accent);
  box-shadow: inset 0 0 0 1px rgba(34,211,238,0.15), 0 0 20px -8px rgba(34,211,238,0.55);
}
.cy-pane-head {
  display: flex; align-items: center; gap: 10px;
  padding: 0 10px;
  font-size: 9.5px; letter-spacing: 0.1em;
  background: linear-gradient(180deg, rgba(34,211,238,0.04), transparent);
  border-bottom: 1px solid var(--line);
  color: var(--fg-3);
}
.cy-pane.active .cy-pane-head { background: linear-gradient(180deg, rgba(34,211,238,0.08), transparent); }
.cy-pane-tag { color: var(--fg-2); font-weight: 700; }
.cy-pane.active .cy-pane-tag { color: var(--accent); }
.cy-pane-cwd { color: var(--fg-3); }
.cy-pane-pid { color: var(--fg-3); }
.cy-pane-spacer { flex: 1; }
.cy-pane-state { display: inline-flex; align-items: center; gap: 5px; font-weight: 700; }
.cy-pane-state.ok { color: #34d399; }
.cy-pane-state.idle { color: var(--fg-3); }
.cy-blink { width: 6px; height: 6px; border-radius: 50%; background: #34d399; box-shadow: 0 0 6px #34d399; animation: cyblink 1.4s ease-in-out infinite; }
@keyframes cyblink { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }

.cy-term {
  padding: 12px 14px;
  font-family: 'JetBrains Mono', 'MesloLGS NF', ui-monospace, monospace;
  font-size: 12.5px; line-height: 1.55;
  color: #c8d2dd;
  overflow: hidden;
}
.t-stream { white-space: pre; }
.t-line { white-space: pre; min-height: 1.55em; }
.t-cursor { display: inline-block; width: 7px; height: 1em; vertical-align: -2px; margin-left: 2px; animation: blink 1.05s steps(2, end) infinite; }

.cy-divider { display: grid; place-items: center; cursor: col-resize; position: relative; background: #04080b; }
.cy-divider::before {
  content: ''; position: absolute; inset: 0;
  background: linear-gradient(90deg, transparent, var(--line) 40%, var(--line) 60%, transparent);
  opacity: 0.6;
}
.cy-handle {
  position: relative; z-index: 1;
  width: 6px; height: 44px;
  display: grid; grid-template-rows: repeat(4, 1fr); gap: 3px;
  align-items: stretch; justify-content: center;
  background: var(--bg-3); border: 1px solid var(--line-2); border-radius: 2px;
  padding: 4px 1px;
}
.cy-handle:hover { border-color: var(--accent); box-shadow: 0 0 12px rgba(34,211,238,0.35); }
.cy-handle span { background: var(--fg-3); border-radius: 1px; }
.cy-handle:hover span { background: var(--accent); }

.cy-status {
  display: flex; align-items: stretch; height: 22px;
  background: #142a30; color: var(--fg);
  font-size: 10px; letter-spacing: 0.06em;
  font-family: 'JetBrains Mono', monospace;
}
.cy-cell { display: inline-flex; align-items: center; padding: 0 8px; }
.cy-cell-host { background: #142a30; color: var(--accent); font-weight: 700; }
.cy-cell-time { background: #142a30; color: var(--fg); padding-right: 14px; }
.cy-cell:nth-child(3) { background: #0a1620; color: var(--fg); }
.cy-cell:nth-child(5) { background: #0a1014; color: var(--fg-2); }
.cy-cell:nth-child(9) { background: #0a1014; color: var(--fg-2); }
.cy-cell:nth-child(11) { background: #0a1620; color: var(--fg); }
.cy-led { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 6px var(--accent); margin-right: 6px; }
.cy-cell-spacer { flex: 1; background: #04080b; }

/* Mobile */
.cy-mobile { display: flex; flex-direction: column; height: 100%; }
.cy-m-top {
  display: grid; grid-template-columns: 44px 1fr 44px;
  align-items: center; height: 52px; padding: 0 8px;
  border-bottom: 1px solid var(--line); background: #04070a;
}
.cy-m-icon {
  width: 40px; height: 40px;
  background: transparent; border: 1px solid var(--line);
  color: var(--fg); border-radius: 2px;
  display: grid; place-items: center;
}
.cy-m-title { text-align: center; min-width: 0; }
.cy-m-eyebrow { display: block; font-size: 11px; letter-spacing: 0.1em; color: var(--accent); font-weight: 700; }
.cy-m-sub { display: block; font-size: 10px; color: var(--fg-3); margin-top: 2px; }
.cy-m-tabs { display: flex; gap: 4px; padding: 8px; overflow: auto; background: #050a0d; border-bottom: 1px solid var(--line); }
.cy-m-tab { padding: 7px 12px; border: 1px solid var(--line); color: var(--fg-2); font-size: 11px; letter-spacing: 0.08em; }
.cy-m-tab.active { color: var(--accent); border-color: var(--accent); background: rgba(34,211,238,0.06); }
.cy-m-panes { grid-template-columns: 1fr !important; flex: 1; }
.cy-m-actions {
  display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4px;
  padding: 8px 8px calc(8px + env(safe-area-inset-bottom, 0px));
  background: #04070a; border-top: 1px solid var(--line);
}
.cy-m-actions button {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
  height: 54px;
  background: transparent; border: 1px solid var(--line-2); color: var(--fg);
  font-family: inherit; font-size: 10px; letter-spacing: 0.12em; cursor: pointer;
}
.cy-m-actions button:hover { background: rgba(34,211,238,0.06); color: var(--accent); border-color: var(--accent); }
.cy-m-actions button.danger { border-color: rgba(251,113,133,0.35); color: var(--danger); }
`;

Object.assign(window, { VariantCyber });
