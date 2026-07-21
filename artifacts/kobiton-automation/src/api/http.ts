/**
 * One thin fetch wrapper for the Kobiton v1 REST API: attaches Basic auth,
 * parses JSON, and maps HTTP status codes to typed errors. Debug logging (URL +
 * method + status only — never the Authorization header or key) is gated on the
 * `debug` flag / `KOBITON_DEBUG` env var.
 */
import type { KobitonAuth } from './auth';

const DEFAULT_BASE_URL = 'https://api.kobiton.com';

export type KobitonErrorKind =
  | 'unauthorized' // 401
  | 'forbidden' // 403
  | 'not-found' // 404
  | 'rate-limited' // 429
  | 'server' // 5xx
  | 'unknown'; // anything else non-2xx

function kindForStatus(status: number): KobitonErrorKind {
  switch (status) {
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'not-found';
    case 429:
      return 'rate-limited';
    default:
      return status >= 500 ? 'server' : 'unknown';
  }
}

/** Error carrying the HTTP status, a coarse {@link KobitonErrorKind}, and the parsed body. */
export class KobitonApiError extends Error {
  readonly status: number;
  readonly kind: KobitonErrorKind;
  readonly body: unknown;

  constructor(status: number, statusText: string, method: string, url: string, body: unknown) {
    const kind = kindForStatus(status);
    super(`Kobiton API ${method} ${url} failed: ${status} ${statusText} (${kind})`);
    this.name = 'KobitonApiError';
    this.status = status;
    this.kind = kind;
    this.body = body;
  }
}

export interface HttpClientOptions {
  auth: KobitonAuth;
  /** Overrides the base URL; falls back to `KOBITON_API_URL` then api.kobiton.com. */
  baseUrl?: string;
  /** Inject a fetch implementation (tests). Defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Log method/url/status to stderr. Never logs credentials. */
  debug?: boolean;
}

export type QueryValue = string | number | boolean | undefined | null;

export interface RequestOptions {
  query?: Record<string, QueryValue>;
  /** JSON-serialised as the request body for non-GET verbs. */
  body?: unknown;
}

export class KobitonHttpClient {
  private readonly auth: KobitonAuth;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly debug: boolean;

  constructor(opts: HttpClientOptions) {
    this.auth = opts.auth;
    this.baseUrl = (opts.baseUrl ?? process.env.KOBITON_API_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.debug = opts.debug ?? Boolean(process.env.KOBITON_DEBUG);
  }

  private buildUrl(path: string, query?: Record<string, QueryValue>): string {
    const url = new URL(path.startsWith('/') ? path : `/${path}`, `${this.baseUrl}/`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  async request<T = unknown>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const url = this.buildUrl(path, opts.query);
    const headers: Record<string, string> = {
      Authorization: this.auth.authorizationHeader,
      Accept: 'application/json',
    };
    const init: RequestInit = { method, headers };
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }

    if (this.debug) console.error(`[kobiton] → ${method} ${url}`);
    const res = await this.fetchImpl(url, init);
    if (this.debug) console.error(`[kobiton] ← ${res.status} ${res.statusText} ${method} ${url}`);

    const text = await res.text();
    const parsed: unknown = text ? safeJsonParse(text) : undefined;

    if (!res.ok) {
      throw new KobitonApiError(res.status, res.statusText, method, url, parsed ?? text);
    }
    return parsed as T;
  }

  get<T = unknown>(path: string, query?: Record<string, QueryValue>): Promise<T> {
    return this.request<T>('GET', path, { query });
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
