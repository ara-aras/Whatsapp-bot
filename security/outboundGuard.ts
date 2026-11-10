/**
 * Outbound send caps: per recipient and account-wide, per minute.
 *
 * WhatsApp's spam detection is per account, so these caps are the main guard
 * against a runaway loop getting the number banned. They must keep working
 * when Redis is down: the counters fall back to this process's memory instead
 * of letting every send through.
 */
export const OUTGOING_PER_JID_PER_MIN = 5;

export function outgoingGlobalPerMin(): number {
  return Number(process.env.OUTGOING_GLOBAL_PER_MIN) || 15;
}

export type OutboundDenial = "per_recipient" | "global";

export interface OutboundVerdict {
  /** null when the send may go ahead. */
  denied: OutboundDenial | null;
  count: number;
  limit: number;
  /** Which counter store answered. */
  source: "redis" | "memory";
}

const memCounts = new Map<string, number>();
let memMinute = -1;

/** In-memory counters, one bucket per minute. Exported for tests. */
export function checkOutboundMemory(to: string, now = Date.now()): OutboundVerdict {
  const minute = Math.floor(now / 60000);
  if (minute !== memMinute) {
    memCounts.clear();
    memMinute = minute;
  }
  const perJid = (memCounts.get(`jid:${to}`) || 0) + 1;
  memCounts.set(`jid:${to}`, perJid);
  if (perJid > OUTGOING_PER_JID_PER_MIN) {
    return { denied: "per_recipient", count: perJid, limit: OUTGOING_PER_JID_PER_MIN, source: "memory" };
  }
  const globalLimit = outgoingGlobalPerMin();
  const global = (memCounts.get("global") || 0) + 1;
  memCounts.set("global", global);
  if (global > globalLimit) {
    return { denied: "global", count: global, limit: globalLimit, source: "memory" };
  }
  return { denied: null, count: global, limit: globalLimit, source: "memory" };
}

export function resetOutboundMemory(): void {
  memCounts.clear();
  memMinute = -1;
}

export async function checkOutbound(to: string, now = Date.now()): Promise<OutboundVerdict> {
  try {
    const { redis } = await import("../storage/redisClient");
    const minute = Math.floor(now / 60000);

    // Per-recipient cap first: cheap, and catches a flood aimed at one JID.
    const jidKey = `outgoing:${to}:${minute}`;
    const perJid = await redis.incr(jidKey);
    if (perJid === 1) await redis.expire(jidKey, 120);
    if (perJid > OUTGOING_PER_JID_PER_MIN) {
      return { denied: "per_recipient", count: perJid, limit: OUTGOING_PER_JID_PER_MIN, source: "redis" };
    }

    // Account-level cap across ALL recipients this minute.
    const globalLimit = outgoingGlobalPerMin();
    const globalKey = `outgoing:global:${minute}`;
    const global = await redis.incr(globalKey);
    if (global === 1) await redis.expire(globalKey, 120);
    if (global > globalLimit) {
      return { denied: "global", count: global, limit: globalLimit, source: "redis" };
    }
    return { denied: null, count: global, limit: globalLimit, source: "redis" };
  } catch {
    // Redis unavailable: keep enforcing with local counters rather than
    // sending unmetered.
    return checkOutboundMemory(to, now);
  }
}
