/* Shared SVG icons + sample terminal content for all Leominal variants */

const Icon = {
  Plus: ({ size = 14 }) =>
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>,

  X: ({ size = 12 }) =>
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>,

  SplitRight: ({ size = 14 }) =>
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 2.5v11" stroke="currentColor" strokeWidth="1.2" />
      <rect x="8.5" y="3" width="5" height="10" fill="currentColor" opacity="0.25" />
    </svg>,

  SplitDown: ({ size = 14 }) =>
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2 8h12" stroke="currentColor" strokeWidth="1.2" />
      <rect x="3" y="8.5" width="10" height="5" fill="currentColor" opacity="0.25" />
    </svg>,

  Menu: ({ size = 16 }) =>
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M3 5h10M3 8h10M3 11h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>,

  ChevronLeft: ({ size = 14 }) =>
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M10 3l-5 5 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>,

  ChevronRight: ({ size = 14 }) =>
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>,

  Terminal: ({ size = 14 }) =>
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M3 5l3 3-3 3M8 11h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>,

  Folder: ({ size = 14 }) =>
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M2 5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5z" stroke="currentColor" strokeWidth="1.2" />
    </svg>,

  Dot: ({ size = 8, color = 'currentColor' }) =>
  <svg width={size} height={size} viewBox="0 0 8 8"><circle cx="4" cy="4" r="3" fill={color} /></svg>,

  Lion: ({ size = 22 }) =>
  // tiny lion-ish mark distilled from app icon — mane chevrons + > prompt
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <defs>
        <radialGradient id="lionGlow" cx="0.5" cy="0.5" r="0.6">
          <stop offset="0" stopColor="#5eead4" stopOpacity="0.6" />
          <stop offset="1" stopColor="#5eead4" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="16" cy="16" r="14" fill="url(#lionGlow)" />
      <path d="M6 10l4 2-1 4 3 1-1 3 5-1 5 1-1-3 3-1-1-4 4-2-5 1-2-3-3 2-3-2-2 3-5-1z" fill="#0b1418" stroke="#5eead4" strokeWidth="0.9" strokeLinejoin="round" />
      <path d="M11 15l2 2-2 2M15 19h4" stroke="#5eead4" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>,

  Branch: ({ size = 12 }) =>
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <circle cx="4" cy="3.5" r="1.5" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="4" cy="12.5" r="1.5" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="12" cy="6.5" r="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4 5v6M4 9c0-2 2-3 4-3h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>,

  Grip: ({ size = 14, vertical = false }) =>
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      {vertical ?
    <g fill="currentColor">
          <circle cx="6" cy="6" r="1" />
          <circle cx="10" cy="6" r="1" />
          <circle cx="6" cy="10" r="1" />
          <circle cx="10" cy="10" r="1" />
        </g> :

    <g fill="currentColor">
          <circle cx="6" cy="6" r="1" />
          <circle cx="10" cy="6" r="1" />
          <circle cx="6" cy="10" r="1" />
          <circle cx="10" cy="10" r="1" />
        </g>
    }
    </svg>

};

/* Sample terminal lines — realistic dev output */
const TERM_LINES_A = [
{ kind: 'prompt', dir: '~/code/leominal', branch: 'main', cmd: 'npm run dev' },
{ kind: 'out', t: '> leominal@0.4.1 dev', dim: true },
{ kind: 'out', t: '> vite --host 127.0.0.1 --port 3107', dim: true },
{ kind: 'blank' },
{ kind: 'out', t: '  VITE v5.4.0  ready in 412 ms', color: '#a7f3d0' },
{ kind: 'blank' },
{ kind: 'out', t: '  ➜  Local:   http://127.0.0.1:3107/' },
{ kind: 'out', t: '  ➜  Network: use --host to expose' },
{ kind: 'out', t: '  ➜  press h + enter to show help', dim: true },
{ kind: 'blank' },
{ kind: 'out', t: '14:22:01  [pty] spawn /bin/zsh pid=48213', dim: true },
{ kind: 'out', t: '14:22:01  [ws]  connect session=4f1c.. ip=127.0.0.1' },
{ kind: 'out', t: '14:22:03  [auth] gate=ok user=local' },
{ kind: 'prompt', dir: '~/code/leominal', branch: 'main', cmd: '', cursor: true }];


const TERM_LINES_B = [
{ kind: 'prompt', dir: '~/code/leominal', branch: 'feat/ui', cmd: 'git status' },
{ kind: 'out', t: 'On branch feat/ui' },
{ kind: 'out', t: "Your branch is ahead of 'origin/feat/ui' by 2 commits." },
{ kind: 'blank' },
{ kind: 'out', t: 'Changes not staged for commit:', color: '#fcd34d' },
{ kind: 'out', t: '  modified:   src/client/styles.css', color: '#f87171' },
{ kind: 'out', t: '  modified:   src/client/terminal/TerminalTabs.tsx', color: '#f87171' },
{ kind: 'blank' },
{ kind: 'out', t: 'Untracked files:', color: '#fcd34d' },
{ kind: 'out', t: '  src/client/terminal/tokens.css', color: '#f87171' },
{ kind: 'blank' },
{ kind: 'prompt', dir: '~/code/leominal', branch: 'feat/ui', cmd: '', cursor: true }];


const TERM_LINES_C = [
{ kind: 'prompt', dir: '~/code/leominal', branch: 'main', cmd: 'pnpm test --watch' },
{ kind: 'blank' },
{ kind: 'out', t: ' PASS  src/shared/layoutState.test.ts', color: '#a7f3d0' },
{ kind: 'out', t: ' PASS  src/server/terminal/TerminalManager.test.ts', color: '#a7f3d0' },
{ kind: 'out', t: ' PASS  src/client/terminal/terminalReducer.test.ts', color: '#a7f3d0' },
{ kind: 'blank' },
{ kind: 'out', t: 'Test Files  3 passed (3)', dim: true },
{ kind: 'out', t: '     Tests  47 passed (47)', dim: true },
{ kind: 'out', t: '  Duration  812ms', dim: true },
{ kind: 'blank' },
{ kind: 'out', t: ' watching for file changes...', color: '#5eead4' }];


/* Render a list of terminal lines with a prompt format chooser */
function TermLines({ lines, promptStyle = 'arrow', accent = '#5eead4' }) {
  return (
    <div className="t-stream">
      {lines.map((ln, i) => {
        if (ln.kind === 'blank') return <div key={i} className="t-line">&nbsp;</div>;
        if (ln.kind === 'prompt') {
          return (
            <div key={i} className="t-line">
              <Prompt style={promptStyle} dir={ln.dir} branch={ln.branch} accent={accent} />
              <span className="t-cmd">{ln.cmd}</span>
              {ln.cursor ? <span className="t-cursor" style={{ background: accent }} /> : null}
            </div>);

        }
        return (
          <div key={i} className="t-line" style={{ color: ln.color || (ln.dim ? '#6b7280' : '#c8d2dd') }}>
            {ln.t}
          </div>);

      })}
    </div>);

}

function Prompt({ style, dir, branch, accent }) {
  if (style === 'arrow') {
    return (
      <span className="t-prompt">
        <span style={{ color: accent }}>➜</span>{' '}
        <span style={{ color: '#67e8f9' }}>{dir}</span>{' '}
        <span style={{ color: '#a78bfa' }}>git:({branch})</span>{' '}
      </span>);

  }
  if (style === 'powerline') {
    return (
      <span className="t-prompt t-prompt-pl">
        <span className="pl-seg pl-dir" style={{ background: accent, color: '#062423' }}>{dir}</span>
        <span className="pl-sep" style={{ color: accent, background: '#1c2a31' }}>{'\uE0B0'}</span>
        <span className="pl-seg pl-branch" style={{ background: '#1c2a31', color: '#a7f3d0' }}>⎇ {branch}</span>
        <span className="pl-sep" style={{ color: '#1c2a31', background: 'transparent' }}>{'\uE0B0'}</span>
        {' '}
      </span>);

  }
  // simple
  return (
    <span className="t-prompt">
      <span style={{ color: '#94a3b8' }}>{dir}</span>{' '}
      <span style={{ color: accent }}>$</span>{' '}
    </span>);

}

Object.assign(window, { Icon, Prompt, TermLines, TERM_LINES_A, TERM_LINES_B, TERM_LINES_C });