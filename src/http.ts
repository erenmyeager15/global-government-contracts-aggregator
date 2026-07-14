const RETRYABLE_STATUSES = new Set([408, 425, 429]);
const SENSITIVE_QUERY_KEYS = new Set(['api_key', 'apikey', 'key', 'token', 'access_token']);
const MAX_RETRY_AFTER_MS = 30_000;
const lastRequestStartedAt = new Map<string, number>();

export interface RequestPolicy {
  timeoutMs: number;
  maxAttempts: number;
  minIntervalMs: number;
}
export interface HttpDependencies {
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
}

export type JsonFetcher = <T>(
  url: string,
  init?: RequestInit,
  policy?: Partial<RequestPolicy>,
) => Promise<T>;

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function sanitizeUrl(value: string): string {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) url.searchParams.set(key, '[redacted]');
    }
    return url.toString();
  } catch {
    return '<invalid URL>';
  }
}

function secretsFromUrl(value: string): string[] {
  try {
    const url = new URL(value);
    return [...url.searchParams.entries()]
      .filter(([key]) => SENSITIVE_QUERY_KEYS.has(key.toLowerCase()))
      .map(([, secret]) => secret)
      .filter(Boolean);
  } catch {
    return [];
  }
}

function scrubSecrets(value: string, secrets: string[]): string {
  let result = value;
  for (const secret of secrets) result = result.split(secret).join('[redacted]');
  return result;
}

function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUSES.has(status) || status >= 500;
}

function retryAfterMilliseconds(value: string | null, now: number): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return null;
  return Math.min(Math.max(timestamp - now, 0), MAX_RETRY_AFTER_MS);
}

async function paceRequest(
  host: string,
  minimumIntervalMs: number,
  now: () => number,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<void> {
  if (minimumIntervalMs <= 0) return;
  const previous = lastRequestStartedAt.get(host) ?? 0;
  const wait = previous + minimumIntervalMs - now();
  if (wait > 0) await sleep(wait);
  lastRequestStartedAt.set(host, now());
}

export async function fetchJson<T>(
  url: string,
  init: RequestInit = {},
  policy: Partial<RequestPolicy> = {},
  dependencies: HttpDependencies = {},
): Promise<T> {
  const safeUrl = sanitizeUrl(url);
  const secrets = secretsFromUrl(url);
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const sleep = dependencies.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const now = dependencies.now ?? Date.now;
  const resolvedPolicy: RequestPolicy = {
    timeoutMs: policy.timeoutMs ?? 20_000,
    maxAttempts: policy.maxAttempts ?? 3,
    minIntervalMs: policy.minIntervalMs ?? 0,
  };
  if (!Number.isInteger(resolvedPolicy.maxAttempts) || resolvedPolicy.maxAttempts < 1 || resolvedPolicy.maxAttempts > 5) {
    throw new Error('maxAttempts must be an integer from 1 to 5.');
  }

  const host = new URL(url).hostname.toLowerCase();
  let lastError: HttpError | null = null;

  for (let attempt = 1; attempt <= resolvedPolicy.maxAttempts; attempt += 1) {
    await paceRequest(host, resolvedPolicy.minIntervalMs, now, sleep);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), resolvedPolicy.timeoutMs);
    try {
      const headers = new Headers(init.headers);
      if (!headers.has('accept')) headers.set('accept', 'application/json');
      if (!headers.has('user-agent')) {
        headers.set('user-agent', 'Apify-Global-Government-Contracts/1.0');
      }
      const response = await fetchImpl(url, { ...init, headers, signal: controller.signal });
      const body = await response.text();
      if (!response.ok) {
        const retryable = isRetryableStatus(response.status);
        const detail = scrubSecrets(body.slice(0, 300).replace(/\s+/g, ' ').trim(), secrets);
        const error = new HttpError(
          `Official API request failed (${response.status}) for ${safeUrl}${detail ? `: ${detail}` : ''}`,
          response.status,
          retryable,
        );
        if (!retryable || attempt === resolvedPolicy.maxAttempts) throw error;
        lastError = error;
        const retryAfter = retryAfterMilliseconds(response.headers.get('retry-after'), now());
        await sleep(retryAfter ?? Math.min(500 * (2 ** (attempt - 1)), 4000));
        continue;
      }

      if (!body.trim()) throw new HttpError(`Official API returned an empty response for ${safeUrl}.`, response.status, false);
      try {
        return JSON.parse(body) as T;
      } catch {
        throw new HttpError(`Official API returned invalid JSON for ${safeUrl}.`, response.status, false);
      }
    } catch (error) {
      const normalized = error instanceof HttpError
        ? error
        : new HttpError(
          `${error instanceof Error && error.name === 'AbortError' ? 'Request timed out' : 'Network request failed'} for ${safeUrl}: ${scrubSecrets(error instanceof Error ? error.message : String(error), secrets)}`,
          null,
          true,
        );
      if (!normalized.retryable || attempt === resolvedPolicy.maxAttempts) throw normalized;
      lastError = normalized;
      await sleep(Math.min(500 * (2 ** (attempt - 1)), 4000));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError ?? new HttpError(`Official API request failed for ${safeUrl}.`, null, false);
}
