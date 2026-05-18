/* Auth screen — Minimal style. Matches the redesigned workspace tokens. */

const { useState: useStateAuth, useEffect: useEffectAuth } = React;

function AuthScreen({ view, rootStyle, onSwitchView, onAuthed, tweak, setTweak }) {
  return (
    <div className="mn-auth-shell" style={rootStyle}>
      <div className="mn-auth-bg" aria-hidden="true">
        <div className="mn-auth-grid" />
        <div className="mn-auth-glow" />
      </div>

      <main className="mn-auth-card">
        <header className="mn-auth-head">
          <div className="mn-auth-brand">
            <Icon.Lion size={26} />
            <div>
              <div className="mn-auth-eyebrow">LEOMINAL</div>
              <div className="mn-auth-host">local · 127.0.0.1:3107</div>
            </div>
          </div>
          <div className="mn-auth-tabs">
            <button
              className={view === 'login' ? 'active' : ''}
              onClick={() => onSwitchView('login')}
              type="button"
            >
              unlock
            </button>
            <button
              className={view === 'setup' ? 'active' : ''}
              onClick={() => onSwitchView('setup')}
              type="button"
            >
              set password
            </button>
          </div>
        </header>

        {view === 'login' ? (
          <LoginForm onAuthed={onAuthed} />
        ) : (
          <SetupForm onAuthed={onAuthed} />
        )}

        <footer className="mn-auth-foot">
          <span>last attempt — never</span>
          <span className="mn-sep">·</span>
          <span>cookies same-origin</span>
          <span className="mn-sep">·</span>
          <span style={{ color: 'var(--accent)' }}>● server reachable</span>
        </footer>
      </main>

      <TweaksPanel title="Tweaks" noDeckControls>
        <TweakSection label="Color">
          <TweakColor label="Accent" value={tweak.accent} options={ACCENT_OPTIONS} onChange={(v) => setTweak('accent', v)} />
        </TweakSection>
        <TweakSection label="Typography">
          <TweakSelect label="Font" value={tweak.font} options={FONT_OPTIONS} onChange={(v) => setTweak('font', v)} />
        </TweakSection>
      </TweaksPanel>
    </div>
  );
}

function LoginForm({ onAuthed }) {
  const [password, setPassword] = useStateAuth('');
  const [busy, setBusy] = useStateAuth(false);
  const [error, setError] = useStateAuth(null);

  function submit(e) {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    setError(null);
    setTimeout(() => {
      setBusy(false);
      if (password === 'wrong') {
        setError('Invalid password.');
      } else {
        onAuthed();
      }
    }, 350);
  }

  return (
    <form className="mn-auth-form" onSubmit={submit}>
      <div className="mn-auth-prompt">
        <span className="mn-auth-promptmark">$</span>
        <span>unlock <em>~/.leominal</em></span>
      </div>

      <label className="mn-auth-field">
        <span>password</span>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => { setPassword(e.target.value); setError(null); }}
          placeholder="••••••••"
          autoComplete="current-password"
        />
      </label>

      {error && <div className="mn-auth-error">! {error}</div>}

      <div className="mn-auth-actions">
        <button type="submit" className="mn-auth-primary" disabled={busy || !password}>
          {busy ? <span className="mn-spin">◜</span> : '↵'} unlock
        </button>
        <button type="button" className="mn-auth-secondary">refresh</button>
      </div>

      <p className="mn-auth-hint">
        <kbd>tab</kbd> to switch to <em>set password</em> on first run.
      </p>
    </form>
  );
}

function SetupForm({ onAuthed }) {
  const [pw1, setPw1] = useStateAuth('');
  const [pw2, setPw2] = useStateAuth('');
  const [error, setError] = useStateAuth(null);

  const strength = pwStrength(pw1);
  const tooShort = pw1.length > 0 && pw1.length < 8;
  const mismatch = pw2.length > 0 && pw1 !== pw2;

  function submit(e) {
    e.preventDefault();
    if (tooShort) { setError('At least 8 characters.'); return; }
    if (mismatch)  { setError('Passwords do not match.'); return; }
    onAuthed();
  }

  return (
    <form className="mn-auth-form" onSubmit={submit}>
      <div className="mn-auth-prompt">
        <span className="mn-auth-promptmark">$</span>
        <span>init <em>~/.leominal/state.json</em></span>
      </div>

      <label className="mn-auth-field">
        <span>password</span>
        <input
          type="password"
          autoFocus
          value={pw1}
          minLength={8}
          onChange={(e) => { setPw1(e.target.value); setError(null); }}
          placeholder="at least 8 characters"
        />
      </label>

      <div className="mn-auth-strength" aria-hidden="true">
        {[0,1,2,3].map(i => (
          <span key={i} className={i < strength ? `on s${strength}` : ''} />
        ))}
        <small>{['—','weak','okay','strong','great'][strength]}</small>
      </div>

      <label className="mn-auth-field">
        <span>confirm</span>
        <input
          type="password"
          value={pw2}
          minLength={8}
          onChange={(e) => { setPw2(e.target.value); setError(null); }}
          placeholder="repeat password"
        />
      </label>

      {error && <div className="mn-auth-error">! {error}</div>}

      <div className="mn-auth-actions">
        <button
          type="submit"
          className="mn-auth-primary"
          disabled={pw1.length < 8 || pw1 !== pw2}
        >
          ↵ set password
        </button>
      </div>

      <p className="mn-auth-hint">
        stored as a scrypt hash in your local state file. there's no recovery — delete state.json to reset.
      </p>
    </form>
  );
}

function pwStrength(p) {
  if (!p) return 0;
  let s = 0;
  if (p.length >= 8) s++;
  if (p.length >= 12) s++;
  if (/[A-Z]/.test(p) && /[a-z]/.test(p) && /\d/.test(p)) s++;
  if (/[^A-Za-z0-9]/.test(p)) s++;
  return Math.min(4, s);
}

Object.assign(window, { AuthScreen });
