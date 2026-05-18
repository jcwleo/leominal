/* Variant C — "Minimal Mono": text-first, almost no chrome */

function VariantMinimal({ mobile = false }) {
  const accent = '#5eead4';

  if (mobile) return <VariantMinimalMobile accent={accent} />;

  return (
    <div className="mn-shell">
      <style>{minimalCss}</style>

      <aside className="mn-sidebar">
        <div className="mn-brand">
          <Icon.Lion size={18} />
          <span>leominal</span>
          <button className="mn-collapse" title="Collapse"><Icon.ChevronLeft /></button>
        </div>

        <div className="mn-ws-head">
          <span>workspaces</span>
          <button className="mn-ghost" title="New workspace"><Icon.Plus size={12} /></button>
        </div>

        <div className="mn-ws-list">
          {[
            { name: 'leominal', cwd: '~/code/leominal', tabs: 3, active: true },
            { name: 'graphite-api', cwd: '~/work/graphite', tabs: 2 },
            { name: 'infra', cwd: '~/ops/infra', tabs: 1 },
            { name: 'sandbox', cwd: '~/scratch', tabs: 1 },
          ].map((ws, i) => (
            <button key={i} className={`mn-ws ${ws.active ? 'active' : ''}`}>
              <div className="mn-ws-name">{ws.name}</div>
              <div className="mn-ws-meta">
                <span className="mn-ws-cwd">{ws.cwd}</span>
                <span className="mn-ws-tabs">{ws.tabs}</span>
              </div>
            </button>
          ))}
        </div>

        <div className="mn-foot">
          <span>session · 11h left</span>
          <button>logout</button>
        </div>
      </aside>

      <section className="mn-main">
        <div className="mn-top">
          <div className="mn-tabs">
            {[
              { title: 'dev-server', panes: 2, active: true },
              { title: 'git', panes: 1 },
              { title: 'tests', panes: 2 },
            ].map((t, i) => (
              <button key={i} className={`mn-tab ${t.active ? 'active' : ''}`}>
                <span>{t.title}</span>
                <small>{t.panes}</small>
              </button>
            ))}
            <button className="mn-tab mn-tab-add" title="New tab">+</button>
          </div>

          <div className="mn-actions">
            <button title="Split right"><Icon.SplitRight size={14} /></button>
            <button title="Split down"><Icon.SplitDown size={14} /></button>
            <span className="mn-act-sep" />
            <button title="Close pane" className="danger"><Icon.X size={13} /></button>
          </div>
        </div>

        <div className="mn-panes">
          <div className="mn-pane active">
            <div className="mn-pane-head">
              <span className="mn-dot" style={{ background: accent }} />
              <span>~/code/leominal</span>
              <span className="mn-pane-sep">·</span>
              <span>main</span>
              <span className="mn-pane-spacer" />
              <span className="mn-pane-state">running</span>
            </div>
            <div className="mn-term">
              <TermLines lines={TERM_LINES_A} promptStyle="simple" accent={accent} />
            </div>
          </div>

          <div className="mn-divider mn-divider-v" />

          <div className="mn-pane">
            <div className="mn-pane-head">
              <span className="mn-dot" />
              <span>~/code/leominal</span>
              <span className="mn-pane-sep">·</span>
              <span>feat/ui</span>
              <span className="mn-pane-spacer" />
              <span className="mn-pane-state idle">idle</span>
            </div>
            <div className="mn-term">
              <TermLines lines={TERM_LINES_C} promptStyle="simple" accent={accent} />
            </div>
          </div>
        </div>

        <div className="mn-status">
          <span>~/code/leominal</span>
          <span className="mn-sep">·</span>
          <span>main</span>
          <span className="mn-sep">·</span>
          <span>zsh 5.9</span>
          <span className="mn-status-spacer" />
          <span>3 tabs · 5 panes</span>
          <span className="mn-sep">·</span>
          <span style={{ color: accent }}>● connected</span>
        </div>
      </section>
    </div>
  );
}

function VariantMinimalMobile({ accent }) {
  return (
    <div className="mn-shell mn-mobile">
      <style>{minimalCss}</style>
      <header className="mn-m-top">
        <button className="mn-m-icon"><Icon.Menu /></button>
        <div className="mn-m-title">
          <span className="mn-m-title-name">dev-server</span>
          <span className="mn-m-title-sub">~/code/leominal · main</span>
        </div>
        <button className="mn-m-icon"><Icon.Plus /></button>
      </header>

      <div className="mn-m-tabs">
        {['dev-server', 'git', 'tests'].map((t, i) => (
          <button key={i} className={`mn-m-tab ${i === 0 ? 'active' : ''}`}>{t}</button>
        ))}
      </div>

      <div className="mn-panes mn-m-panes">
        <div className="mn-pane active">
          <div className="mn-pane-head">
            <span className="mn-dot" style={{ background: accent }} />
            <span>~/code/leominal</span>
            <span className="mn-pane-spacer" />
            <span className="mn-pane-state">running</span>
          </div>
          <div className="mn-term">
            <TermLines lines={TERM_LINES_A.slice(0, 10)} promptStyle="simple" accent={accent} />
          </div>
        </div>
      </div>

      <nav className="mn-m-actions">
        <button><Icon.SplitRight size={15} /> split →</button>
        <button><Icon.SplitDown size={15} /> split ↓</button>
        <button className="danger"><Icon.X size={14} /> close</button>
      </nav>
    </div>
  );
}

const minimalCss = `
.mn-shell {
  --bg: #0a0d10;
  --bg-2: #0d1216;
  --line: #1a2128;
  --fg: #e2e8ee;
  --fg-2: #8896a3;
  --fg-3: #54616d;
  --accent: #5eead4;
  --danger: #f87171;
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  width: 100%; height: 100%;
  background: var(--bg); color: var(--fg);
  font-family: 'JetBrains Mono', ui-monospace, 'SF Mono', monospace;
  font-size: 12px; overflow: hidden;
}

.mn-sidebar {
  display: grid; grid-template-rows: auto auto 1fr auto;
  border-right: 1px solid var(--line);
  background: #08090b;
}
.mn-brand {
  display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 10px;
  padding: 16px 16px 14px;
}
.mn-brand span { font-size: 13px; font-weight: 600; letter-spacing: 0.02em; }
.mn-collapse {
  width: 22px; height: 22px; background: transparent; border: none;
  color: var(--fg-3); display: grid; place-items: center; cursor: pointer;
}
.mn-collapse:hover { color: var(--fg); }

.mn-ws-head {
  display: flex; justify-content: space-between; align-items: center;
  padding: 4px 16px 8px;
  font-size: 10.5px; color: var(--fg-3); letter-spacing: 0.06em;
}
.mn-ghost { background: transparent; border: none; color: var(--fg-3); cursor: pointer; display: grid; place-items: center; width: 18px; height: 18px; }
.mn-ghost:hover { color: var(--accent); }

.mn-ws-list { display: flex; flex-direction: column; min-height: 0; overflow: auto; padding-bottom: 8px; }
.mn-ws {
  display: grid; gap: 2px;
  padding: 7px 16px 7px 14px;
  background: transparent; border: none;
  color: var(--fg-2); text-align: left; cursor: pointer;
  border-left: 2px solid transparent;
}
.mn-ws:hover { color: var(--fg); }
.mn-ws.active {
  color: var(--fg);
  border-left-color: var(--accent);
}
.mn-ws-name { font-size: 12.5px; font-weight: 500; }
.mn-ws.active .mn-ws-name { font-weight: 600; }
.mn-ws-meta { display: flex; justify-content: space-between; font-size: 10.5px; color: var(--fg-3); gap: 8px; }
.mn-ws-cwd { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mn-ws-tabs { flex: 0 0 auto; }

.mn-foot {
  display: flex; justify-content: space-between; align-items: center;
  padding: 12px 16px; border-top: 1px solid var(--line);
  font-size: 10.5px; color: var(--fg-3);
}
.mn-foot button { background: transparent; border: none; color: var(--fg-2); cursor: pointer; font-family: inherit; font-size: 10.5px; padding: 0; }
.mn-foot button:hover { color: var(--fg); }

.mn-main { display: grid; grid-template-rows: 38px 1fr 22px; min-width: 0; min-height: 0; }

.mn-top {
  display: grid; grid-template-columns: 1fr auto;
  align-items: stretch; gap: 8px;
  border-bottom: 1px solid var(--line); padding: 0 12px;
  background: var(--bg);
}
.mn-tabs { display: flex; align-items: stretch; gap: 0; min-width: 0; overflow: hidden; }
.mn-tab {
  display: flex; align-items: center; gap: 8px;
  padding: 0 14px; min-width: 0;
  background: transparent; border: none;
  color: var(--fg-2); font-family: inherit; font-size: 12px; cursor: pointer;
  position: relative;
}
.mn-tab:hover { color: var(--fg); }
.mn-tab small { font-size: 10px; color: var(--fg-3); }
.mn-tab.active {
  color: var(--fg);
}
.mn-tab.active::after {
  content: ''; position: absolute; bottom: -1px; left: 14px; right: 14px; height: 2px;
  background: var(--accent); box-shadow: 0 0 10px rgba(94,234,212,0.6);
}
.mn-tab.active small { color: var(--accent); }
.mn-tab-add { color: var(--fg-3); padding: 0 12px; font-size: 16px; }
.mn-tab-add:hover { color: var(--accent); }

.mn-actions { display: flex; align-items: center; gap: 2px; }
.mn-actions button {
  width: 28px; height: 28px; border-radius: 5px;
  background: transparent; border: 1px solid transparent;
  color: var(--fg-2); display: grid; place-items: center; cursor: pointer;
}
.mn-actions button:hover { color: var(--fg); border-color: var(--line); background: var(--bg-2); }
.mn-actions button.danger:hover { color: var(--danger); border-color: rgba(248,113,113,0.3); }
.mn-act-sep { width: 1px; height: 14px; background: var(--line); margin: 0 4px; }

.mn-panes {
  display: grid; grid-template-columns: 1fr 1px 1fr;
  min-width: 0; min-height: 0;
}
.mn-pane {
  display: grid; grid-template-rows: 26px 1fr;
  min-width: 0; min-height: 0;
  position: relative;
}
.mn-pane.active {
  background: linear-gradient(180deg, rgba(94,234,212,0.025), transparent 30%);
}
.mn-pane.active::before {
  content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 2px;
  background: var(--accent); box-shadow: 0 0 12px rgba(94,234,212,0.5);
}
.mn-pane-head {
  display: flex; align-items: center; gap: 6px;
  padding: 0 12px;
  font-size: 10.5px; color: var(--fg-3);
  border-bottom: 1px solid var(--line);
}
.mn-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--fg-3); flex: 0 0 auto; }
.mn-pane.active .mn-dot { box-shadow: 0 0 6px var(--accent); }
.mn-pane-sep { opacity: 0.5; }
.mn-pane-spacer { flex: 1; }
.mn-pane-state { color: #34d399; }
.mn-pane-state.idle { color: var(--fg-3); }
.mn-term {
  padding: 12px 16px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12.5px; line-height: 1.55;
  color: #c8d2dd;
  overflow: hidden;
}

.mn-divider { background: var(--line); cursor: col-resize; transition: background .15s; position: relative; }
.mn-divider:hover { background: var(--accent); }
.mn-divider::after {
  content: ''; position: absolute; top: 50%; left: 50%; width: 14px; height: 30px;
  transform: translate(-50%, -50%); border-radius: 3px;
}
.mn-divider:hover::after { background: rgba(94,234,212,0.06); }

.t-stream { white-space: pre; }
.t-line { white-space: pre; min-height: 1.55em; }
.t-cursor { display: inline-block; width: 7px; height: 1em; vertical-align: -2px; margin-left: 2px; animation: blink 1.05s steps(2, end) infinite; }

.mn-status {
  display: flex; align-items: center; gap: 8px;
  padding: 0 16px; border-top: 1px solid var(--line);
  font-size: 10.5px; color: var(--fg-3);
  background: #08090b;
}
.mn-sep { opacity: 0.45; }
.mn-status-spacer { flex: 1; }

/* Mobile */
.mn-mobile { display: flex; flex-direction: column; height: 100%; }
.mn-m-top {
  display: grid; grid-template-columns: 40px 1fr 40px; align-items: center;
  height: 52px; padding: 0 12px;
  border-bottom: 1px solid var(--line);
}
.mn-m-icon { width: 36px; height: 36px; background: transparent; border: 1px solid var(--line); color: var(--fg); border-radius: 6px; display: grid; place-items: center; }
.mn-m-title { text-align: center; }
.mn-m-title-name { display: block; font-size: 13px; font-weight: 600; }
.mn-m-title-sub { display: block; font-size: 10.5px; color: var(--fg-3); margin-top: 2px; }
.mn-m-tabs { display: flex; gap: 4px; padding: 8px 12px; border-bottom: 1px solid var(--line); overflow: auto; }
.mn-m-tab { padding: 7px 14px; background: transparent; border: none; color: var(--fg-2); font-family: inherit; font-size: 12px; cursor: pointer; border-bottom: 2px solid transparent; }
.mn-m-tab.active { color: var(--fg); border-bottom-color: var(--accent); }
.mn-m-panes { grid-template-columns: 1fr !important; flex: 1; }
.mn-m-actions {
  display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0;
  border-top: 1px solid var(--line);
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
.mn-m-actions button {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 52px; background: transparent; border: none; border-right: 1px solid var(--line);
  color: var(--fg); font-family: inherit; font-size: 12px; cursor: pointer;
}
.mn-m-actions button:last-child { border-right: none; }
.mn-m-actions button.danger { color: var(--danger); }
`;

Object.assign(window, { VariantMinimal });
