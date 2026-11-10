/**
 * Failed-auth throttle shared by /admin/api/* and /api/v1/*.
 *
 * Both surfaces accept ADMIN_TOKEN, so they must share one lockout: otherwise
 * the stricter one is bypassed by guessing against the other.
 *
 * Client identity: X-Forwarded-For is attacker-controlled unless a proxy we
 * trust wrote it. TRUST_PROXY_HOPS says how many trusted proxies sit in front
 * of this process (0 = none, use the socket address). With N hops the client
 * address is the Nth entry from the RIGHT of the header, because each trusted
 * proxy appends the address it saw; anything further left was supplied by the
 * client and can be forged to dodge the lockout.
 */
import type http from "http";

const MAX_FAILS = 10;
const BLOCK_MS = 15 * 60 * 1000;
/** A failure streak is forgotten after this long without another failure. */
const FAIL_WINDOW_MS = 15 * 60 * 1000;
/** Hard bound so a flood of distinct addresses cannot grow the map forever. */
const MAX_TRACKED = 5000;

interface Entry {
  count: number;
  blockedUntil: number;
  lastFailAt: number;
}

const failedAttempts = new Map<string, Entry>();

export function clientIp(req: http.IncomingMessage): string {
  const remote = req.socket?.remoteAddress || "unknown";
  const hops = Number(process.env.TRUST_PROXY_HOPS || 0);
  if (!(hops > 0)) return remote;

  const raw = req.headers?.["x-forwarded-for"];
  const header = Array.isArray(raw) ? raw.join(",") : raw || "";
  const parts = header
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  return parts[parts.length - hops] || remote;
}

function prune(now: number): void {
  for (const [ip, e] of failedAttempts) {
    if (e.blockedUntil <= now && now - e.lastFailAt > FAIL_WINDOW_MS) {
      failedAttempts.delete(ip);
    }
  }
  // Still over the bound (an active flood): drop the oldest entries. Map
  // iteration is insertion-ordered, so the first keys are the oldest.
  for (const ip of failedAttempts.keys()) {
    if (failedAttempts.size <= MAX_TRACKED) break;
    failedAttempts.delete(ip);
  }
}

export function isBlocked(ip: string, now = Date.now()): boolean {
  const e = failedAttempts.get(ip);
  return !!e && e.blockedUntil > now;
}

export function recordAuthFailure(ip: string, now = Date.now()): void {
  const prev = failedAttempts.get(ip);
  const fresh = !prev || now - prev.lastFailAt > FAIL_WINDOW_MS;
  const next: Entry = {
    count: fresh ? 1 : prev!.count + 1,
    blockedUntil: 0,
    lastFailAt: now,
  };
  if (next.count >= MAX_FAILS) next.blockedUntil = now + BLOCK_MS;
  // Re-insert so the entry moves to the "newest" end of the map.
  failedAttempts.delete(ip);
  failedAttempts.set(ip, next);
  if (failedAttempts.size > MAX_TRACKED) prune(now);
}

export function recordAuthSuccess(ip: string): void {
  failedAttempts.delete(ip);
}

/** Test hook. */
export function resetAuthThrottle(): void {
  failedAttempts.clear();
}

export function trackedAddressCount(): number {
  return failedAttempts.size;
}
