import type { AccessTokenResponse, FieldError, ProblemDetails } from '@shiftora/shared';

/** An API error, decoded from the server's RFC 7807 problem response. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fieldErrors: FieldError[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The part of the browser's Web Locks API we use (navigator.locks). */
export interface LockManagerLike {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

export interface ApiClientOptions {
  /** e.g. "/api/v1" (Vite proxies /api to the API in development). */
  baseUrl: string;
  fetch?: typeof fetch;
  /** Cross-tab lock; without it, refreshes are still single-flight within the tab. */
  locks?: LockManagerLike;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  body?: unknown;
  /** Sent as X-Org-Id: the organisation the request acts on. */
  orgId?: string;
  /** Extra headers, e.g. `Idempotency-Key` on clock-in. Never used for auth. */
  headers?: Record<string, string>;
}

const REFRESH_LOCK = 'shiftora-auth-refresh';

/**
 * Talks to the Shiftora API.
 *
 * - The access token lives only in memory (never localStorage), so a script injected into
 *   the page can't read it from storage. The refresh token is an HttpOnly cookie the browser
 *   sends to /api/v1/auth/* by itself.
 * - On a 401 the client refreshes once and retries the request.
 * - Refreshing is single-flight: concurrent 401s in one tab share one refresh, and tabs take
 *   turns through a Web Lock. Two tabs presenting the same refresh token at once would look
 *   like token theft to the server, which would end the session (reuse detection).
 */
export class ApiClient {
  private accessToken: string | null = null;

  /** The current access token, for the realtime handshake. Never persisted, like the token. */
  get token(): string | null {
    return this.accessToken;
  }
  private refreshInFlight: Promise<boolean> | null = null;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ApiClientOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  setAccessToken(token: string | null): void {
    this.accessToken = token;
  }

  get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('GET', path, options);
  }

  post<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('POST', path, options);
  }

  put<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('PUT', path, options);
  }

  patch<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('PATCH', path, options);
  }

  delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('DELETE', path, options);
  }

  async request<T>(method: Method, path: string, options: RequestOptions = {}): Promise<T> {
    let res = await this.send(method, path, options);
    // Auth endpoints answer 401 for wrong passwords etc.; never refresh-and-retry those.
    if (res.status === 401 && !path.startsWith('/auth/') && (await this.refresh())) {
      res = await this.send(method, path, options);
    }
    if (!res.ok) throw await toApiError(res);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /** Gets a new access token from the refresh cookie. False if the session has ended. */
  refresh(): Promise<boolean> {
    this.refreshInFlight ??= this.refreshOnce().finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  private async refreshOnce(): Promise<boolean> {
    const run = async (): Promise<boolean> => {
      // If another tab refreshed while we waited for the lock, the browser already holds
      // the rotated cookie, so this request presents the new token: a normal rotation.
      const res = await this.fetchImpl(`${this.options.baseUrl}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        this.accessToken = null;
        return false;
      }
      this.accessToken = ((await res.json()) as AccessTokenResponse).accessToken;
      return true;
    };
    return this.options.locks ? this.options.locks.request(REFRESH_LOCK, run) : run();
  }

  private send(
    method: Method,
    path: string,
    { body, orgId, headers: extra }: RequestOptions,
  ): Promise<Response> {
    const headers: Record<string, string> = { ...extra };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.accessToken) headers.authorization = `Bearer ${this.accessToken}`;
    if (orgId) headers['x-org-id'] = orgId;
    return this.fetchImpl(`${this.options.baseUrl}${path}`, {
      method,
      headers,
      credentials: 'include',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  try {
    const problem = (await res.json()) as Partial<ProblemDetails>;
    return new ApiError(
      res.status,
      problem.code ?? `http_${res.status}`,
      problem.detail ?? res.statusText,
      problem.errors ?? [],
    );
  } catch {
    return new ApiError(res.status, `http_${res.status}`, res.statusText || 'Request failed');
  }
}
