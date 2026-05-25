# Security Policy

## Supported Use

Leominal is supported as a single-owner personal web terminal for localhost, private machines, private VPNs, SSH tunnels, or HTTPS reverse proxies with a real access boundary.

Leominal is not currently supported as:

- a public internet shell service
- a hosted multi-user product
- a shared team terminal
- a replacement for SSO, OAuth, RBAC, or hardened bastion access

If you expose Leominal outside localhost or a private network, put it behind HTTPS and a separate access-control layer before relying on it.

## Reporting Vulnerabilities

Do not post exploit details, host access details, secrets, or proof-of-compromise material in a public issue.

Preferred reporting path:

1. Use GitHub private vulnerability reporting if it is enabled for the repository.
2. If private reporting is not enabled, open a minimal public issue asking for a private contact path. Do not include sensitive details in that issue.

Please include:

- affected version or commit
- deployment shape, such as localhost, VPN, or reverse proxy
- reproduction steps
- expected impact
- whether real host shell access, session cookies, stored state, or PTY lifecycle is involved

## Security Boundary

Leominal opens a real shell on the host account running the server. A vulnerability can therefore affect the host machine, not only the browser UI.

The intended defense-in-depth layers are:

- bind to `127.0.0.1` by default
- keep remote access behind VPN, SSH tunnel, or reverse proxy access control
- enable optional authenticator-app 2FA in Settings for browser password logins
- use HTTPS with `LEOMINAL_COOKIE_SECURE=true` when remote
- set precise `LEOMINAL_ALLOWED_ORIGINS`
- keep `.env`, `.leominal/`, logs, and state files out of source control

2FA enrollment is stored in the same local state file as the password hash and layout data. Losing the authenticator requires resetting the local state file; this resets the password and disables 2FA until it is enrolled again.

## Out Of Scope For Current Reports

The following are known product limitations unless they bypass the documented boundary:

- no multi-user roles
- no public internet hardening
- no terminal recovery after Node server restart
- no container isolation for spawned shells
