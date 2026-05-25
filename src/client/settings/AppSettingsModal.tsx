import React, { type FormEvent, useEffect, useRef, useState } from 'react';
import type { AppSettingsResponse, TotpEnrollmentResponse } from '../../shared/protocol.js';
import type { ApiClient } from '../api/client.js';

interface AppSettingsModalProps {
  api: ApiClient;
  onClose: () => void;
}

type SettingsSectionId = 'security';

const settingsSections: Array<{ id: SettingsSectionId; label: string }> = [{ id: 'security', label: 'Security' }];

export function AppSettingsModal({ api, onClose }: AppSettingsModalProps) {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('security');
  const [settings, setSettings] = useState<AppSettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<Element | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement;
    closeButtonRef.current?.focus();
    return () => {
      const previousFocus = previousFocusRef.current;
      if (previousFocus instanceof HTMLElement && document.contains(previousFocus)) {
        previousFocus.focus();
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getSettings()
      .then((nextSettings) => {
        if (!cancelled) {
          setSettings(nextSettings);
          setError(null);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(errorMessage(caught));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [api]);

  return (
    <div
      className="settings-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        ref={dialogRef}
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-settings-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            onClose();
            return;
          }
          if (event.key === 'Tab') {
            trapDialogFocus(event, dialogRef.current);
          }
        }}
      >
        <header className="settings-modal-header">
          <h2 id="app-settings-title">Settings</h2>
          <button ref={closeButtonRef} type="button" className="icon-button" aria-label="Close settings" title="Close settings" onClick={onClose}>
            x
          </button>
        </header>

        <div className="settings-modal-body">
          <nav className="settings-section-tabs" role="tablist" aria-label="Settings sections">
            {settingsSections.map((section) => (
              <button
                key={section.id}
                id={`settings-tab-${section.id}`}
                type="button"
                role="tab"
                aria-controls={`settings-panel-${section.id}`}
                aria-selected={activeSection === section.id}
                onClick={() => setActiveSection(section.id)}
              >
                {section.label}
              </button>
            ))}
          </nav>

          <div className="settings-panel-shell">
            {error ? <p className="form-error">{error}</p> : null}
            {activeSection === 'security' ? (
              <SecuritySettingsPanel
                api={api}
                loading={loading}
                settings={settings}
                onSettingsChange={(nextSettings) => setSettings(nextSettings)}
              />
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}

function SecuritySettingsPanel({
  api,
  loading,
  settings,
  onSettingsChange
}: {
  api: ApiClient;
  loading: boolean;
  settings: AppSettingsResponse | null;
  onSettingsChange: (settings: AppSettingsResponse) => void;
}) {
  const [enrollment, setEnrollment] = useState<TotpEnrollmentResponse | null>(null);
  const [verificationCode, setVerificationCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const twoFactorEnabled = settings?.security.twoFactorEnabled ?? false;

  async function startEnrollment() {
    setSubmitting(true);
    setError(null);
    try {
      setEnrollment(await api.startTotpEnrollment());
      setVerificationCode('');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enrollment) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.confirmTotpEnrollment({ enrollmentId: enrollment.enrollmentId, code: verificationCode });
      onSettingsChange({ security: { twoFactorEnabled: true } });
      setEnrollment(null);
      setVerificationCode('');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section
      id="settings-panel-security"
      className="settings-panel"
      role="tabpanel"
      aria-labelledby="settings-tab-security"
      aria-busy={loading}
    >
      <header className="settings-panel-header">
        <h3>Security</h3>
        {twoFactorEnabled ? <span className="settings-status">2FA enabled</span> : null}
      </header>

      <section className="settings-control">
        <div className="settings-control-summary">
          <strong>Two-factor authentication</strong>
          <span>{twoFactorEnabled ? 'Enabled' : 'Password only'}</span>
        </div>

        {!twoFactorEnabled && !enrollment ? (
          <button type="button" className="primary-settings-button" onClick={() => void startEnrollment()} disabled={loading || submitting}>
            Enable 2FA
          </button>
        ) : null}

        {enrollment ? (
          <form className="settings-totp-form" onSubmit={confirmEnrollment}>
            <img src={enrollment.qrCodeDataUrl} alt="Authenticator setup QR code" />
            <label>
              Manual setup key
              <input value={enrollment.manualKey} readOnly />
            </label>
            <label>
              Verification code
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                value={verificationCode}
                onChange={(event) => setVerificationCode(event.currentTarget.value)}
                required
              />
            </label>
            <button type="submit" className="primary-settings-button" disabled={submitting || verificationCode.trim().length === 0}>
              Verify
            </button>
          </form>
        ) : null}

        {error ? <p className="form-error">{error}</p> : null}
      </section>
    </section>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed';
}

function trapDialogFocus(event: React.KeyboardEvent, dialog: HTMLElement | null): void {
  if (!dialog) {
    return;
  }
  const focusable = Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => element.offsetParent !== null || element === document.activeElement);
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) {
    return;
  }
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
    return;
  }
  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
