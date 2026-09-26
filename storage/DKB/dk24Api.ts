import { createHash } from "node:crypto";

// Shared client for the dk24.org public API (/api/v1/*).
// The API allows 60 req/min per IP (per serverless instance) and sends no
// ETag/Last-Modified, so callers fetch the full payload and compare hashes.

const FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_BACKOFF_MS = 60_000;

// Per-path "don't call before" timestamps, set when the API answers 429.
const backoffUntil = new Map<string, number>();

export class Dk24RateLimitedError extends Error {
  constructor(
    public readonly path: string,
    public readonly retryAt: number,
  ) {
    super(`dk24 API rate limited on ${path} until ${new Date(retryAt).toISOString()}`);
    this.name = "Dk24RateLimitedError";
  }
}

export function dk24BaseUrl(): string {
  return (process.env.DK24_API_BASE_URL || "https://dk24.org").replace(/\/$/, "");
}

export async function fetchDk24Json<T>(path: string): Promise<T> {
  const until = backoffUntil.get(path) ?? 0;
  if (Date.now() < until) {
    throw new Dk24RateLimitedError(path, until);
  }

  const url = `${dk24BaseUrl()}${path}`;
  console.log(`📡 Fetching from dk24 API: ${url}`);

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (res.status === 429) {
    const retryAfterSec = Number(res.headers.get("retry-after"));
    const waitMs =
      Number.isFinite(retryAfterSec) && retryAfterSec > 0
        ? retryAfterSec * 1000
        : DEFAULT_BACKOFF_MS;
    const retryAt = Date.now() + waitMs;
    backoffUntil.set(path, retryAt);
    throw new Dk24RateLimitedError(path, retryAt);
  }
  if (!res.ok) {
    throw new Error(`dk24 API ${path} responded with status: ${res.status}`);
  }

  backoffUntil.delete(path);
  return (await res.json()) as T;
}

// Order-independent hash of a list of records keyed by `id`, so a reordered
// but otherwise identical payload does not count as a change.
export function contentHash(items: Array<{ id?: unknown }>): string {
  const sorted = [...items].sort((a, b) =>
    String(a.id ?? "").localeCompare(String(b.id ?? "")),
  );
  return createHash("sha256").update(stableStringify(sorted)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .filter((k) => obj[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Test-only: clear 429 back-off state. */
export function _resetDk24Backoff(): void {
  backoffUntil.clear();
}
