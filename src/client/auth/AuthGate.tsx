import React, { type FormEvent, useEffect, useMemo, useState } from 'react';
import type { AuthSessionStatus } from '../../shared/types.js';
import { createApiClient, type ApiClient } from '../api/client.js';
import { LeominalMark } from '../terminal/LeominalMark.js';
import { TerminalWorkspace } from '../terminal/TerminalWorkspace.js';

interface AuthGateProps {
  api?: ApiClient;
}

type AuthView = 'loading' | 'setup' | 'login' | 'workspace';

export function AuthGate({ api: providedApi }: AuthGateProps) {
  const api = useMemo(() => providedApi ?? createApiClient(), [providedApi]);
  const [session, setSession] = useState<AuthSessionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getSession()
      .then((nextSession) => {
        if (!cancelled) {
          setSession(nextSession);
          setError(null);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(errorMessage(caught));
          setSession(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const view = resolveView(session);

  async function refreshSession() {
    const nextSession = await api.getSession();
    setSession(nextSession);
    setError(null);
  }

  async function retrySession() {
    setError(null);
    setSession(null);
    try {
      await refreshSession();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  if (view === 'workspace') {
    return (
      <TerminalWorkspace
        api={api}
        sessionExpiresAt={session?.expiresAt ?? null}
        onLogout={async () => {
          const nextSession = await api.logout();
          setSession(nextSession);
        }}
      />
    );
  }

  return (
    <main className="auth-screen">
      <div className="auth-background" aria-hidden="true">
        <div className="auth-grid" />
        <div className="auth-glow" />
      </div>
      <section className="auth-panel" aria-busy={view === 'loading'}>
        <header className="auth-header">
          <div className="auth-brand">
            <LeominalMark size={26} />
            <div>
              <p className="eyebrow">Leominal</p>
              <p className="auth-host">local terminal</p>
            </div>
          </div>
          <h1>{view === 'setup' ? 'Set password' : view === 'login' ? 'Unlock terminal' : 'Terminal'}</h1>
        </header>
        {error ? <p className="form-error">{error}</p> : null}
        {view === 'loading' ? <p className="muted">Checking session...</p> : null}
        {view === 'loading' && error ? (
          <button type="button" className="secondary-button" onClick={() => void retrySession()}>
            Retry
          </button>
        ) : null}
        {view === 'setup' ? <SetupPasswordForm api={api} onSession={setSession} /> : null}
        {view === 'login' ? <LoginForm api={api} onSession={setSession} onRefresh={refreshSession} /> : null}
      </section>
    </main>
  );
}

function SetupPasswordForm({ api, onSession }: { api: ApiClient; onSession: (session: AuthSessionStatus) => void }) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (password !== confirmation) {
        setError('Passwords do not match');
        return;
      }
      onSession(await api.setupPassword({ password }));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label>
        Password
        <input autoFocus value={password} onChange={(event) => setPassword(event.currentTarget.value)} type="password" minLength={8} required />
      </label>
      <label>
        Confirm password
        <input value={confirmation} onChange={(event) => setConfirmation(event.currentTarget.value)} type="password" minLength={8} required />
      </label>
      {error ? <p className="form-error">{error}</p> : null}
      <button type="submit" disabled={submitting || password.length < 8 || confirmation.length < 8}>
        Set password
      </button>
    </form>
  );
}

function LoginForm({
  api,
  onSession,
  onRefresh
}: {
  api: ApiClient;
  onSession: (session: AuthSessionStatus) => void;
  onRefresh: () => Promise<void>;
}) {
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      onSession(await api.login({ password }));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label>
        Password
        <input
          autoFocus
          type="password"
          value={password}
          onChange={(event) => setPassword(event.currentTarget.value)}
          required
        />
      </label>
      {error ? <p className="form-error">{error}</p> : null}
      <div className="button-row">
        <button type="submit" disabled={submitting || password.length === 0}>
          Unlock
        </button>
        <button type="button" className="secondary-button" onClick={() => void onRefresh()} disabled={submitting}>
          Refresh
        </button>
      </div>
    </form>
  );
}

function resolveView(session: AuthSessionStatus | null): AuthView {
  if (!session) {
    return 'loading';
  }
  if (!session.passwordSet) {
    return 'setup';
  }
  return session.authenticated ? 'workspace' : 'login';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed';
}
