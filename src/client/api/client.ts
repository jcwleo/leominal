import type {
  CreateTerminalRequest,
  PasswordRequest,
  TerminalLayoutResponse,
  TerminalListResponse,
  TerminalResponse,
  UpdateTerminalLayoutRequest,
} from '../../shared/protocol.js';
import type { AuthSessionStatus, TerminalId } from '../../shared/types.js';

type FetchLike = typeof fetch;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiClient {
  getSession(): Promise<AuthSessionStatus>;
  setupPassword(request: PasswordRequest): Promise<AuthSessionStatus>;
  login(request: PasswordRequest): Promise<AuthSessionStatus>;
  logout(): Promise<AuthSessionStatus>;
  listTerminals(): Promise<TerminalListResponse>;
  getTerminalLayout(): Promise<TerminalLayoutResponse>;
  saveTerminalLayout(request: UpdateTerminalLayoutRequest): Promise<TerminalLayoutResponse>;
  createTerminal(request?: CreateTerminalRequest): Promise<TerminalResponse>;
  closeTerminal(terminalId: TerminalId): Promise<void>;
}

export function createApiClient(fetcher: FetchLike = fetch): ApiClient {
  return {
    getSession: () => requestJson<AuthSessionStatus>(fetcher, '/api/auth/session'),
    setupPassword: (request) => requestJson<AuthSessionStatus>(fetcher, '/api/auth/password', jsonInit('POST', request)),
    login: (request) => requestJson<AuthSessionStatus>(fetcher, '/api/auth/login', jsonInit('POST', request)),
    logout: () => requestJson<AuthSessionStatus>(fetcher, '/api/auth/logout', { method: 'POST', credentials: 'same-origin' }),
    listTerminals: () => requestJson<TerminalListResponse>(fetcher, '/api/terminals'),
    getTerminalLayout: () => requestJson<TerminalLayoutResponse>(fetcher, '/api/terminal-layout'),
    saveTerminalLayout: (request) => requestJson<TerminalLayoutResponse>(fetcher, '/api/terminal-layout', jsonInit('PUT', request)),
    createTerminal: (request = {}) => requestJson<TerminalResponse>(fetcher, '/api/terminals', jsonInit('POST', request)),
    closeTerminal: async (terminalId) => {
      await requestNoContent(fetcher, `/api/terminals/${encodeURIComponent(terminalId)}`, {
        method: 'DELETE',
        credentials: 'same-origin'
      });
    }
  };
}

export function createTerminalWebSocketUrl(terminalId: TerminalId, locationHref = window.location.href): string {
  const url = new URL(locationHref);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `/api/terminals/${encodeURIComponent(terminalId)}/ws`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

function jsonInit(method: 'POST' | 'PUT' | 'PATCH', body: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body)
  };
}

async function requestJson<T>(fetcher: FetchLike, url: string, init?: RequestInit): Promise<T> {
  const response = await fetcher(url, init ?? { credentials: 'same-origin' });
  await assertOk(response);
  return (await response.json()) as T;
}

async function requestNoContent(fetcher: FetchLike, url: string, init: RequestInit): Promise<void> {
  const response = await fetcher(url, init);
  await assertOk(response);
}

async function assertOk(response: Response): Promise<void> {
  if (response.ok) {
    return;
  }

  let message = response.statusText || `HTTP ${response.status}`;
  try {
    const body = (await response.json()) as { error?: unknown; message?: unknown };
    const bodyMessage = typeof body.error === 'string' ? body.error : body.message;
    if (typeof bodyMessage === 'string' && bodyMessage.trim()) {
      message = bodyMessage;
    }
  } catch {
    // Keep the status text when the response is not JSON.
  }
  throw new ApiError(response.status, message);
}
