/**
 * Call bridge: tells the laptop (laptop-notifier → Aerie) when a WhatsApp call rings on the
 * linked account, and lets the laptop decline it.
 *
 * Baileys only sees call *signalling* (offer / reject / accept / timeout / terminate). It cannot
 * answer a call or carry its audio, so the laptop gets a caller card and a Decline button; answering
 * stays on the phone.
 *
 * Channels (override with env):
 *   CALL_EVENT_CHANNEL  bot → laptop   default "laptop:call"
 *   CALL_CMD_CHANNEL    laptop → bot   default "laptop:call:cmd"
 *
 * Safety: a decline command is only honoured for a call this process saw ring in the last
 * CALL_CACHE_MS, and the call's `from` is taken from our own cache, never from the command.
 */
import { normalizeJid } from "../../security/rbac";

export const CALL_EVENT_CHANNEL = process.env.CALL_EVENT_CHANNEL || "laptop:call";
export const CALL_CMD_CHANNEL = process.env.CALL_CMD_CHANNEL || "laptop:call:cmd";
/** A ringing call is forgotten after this long even if no end event arrives. */
export const CALL_CACHE_MS = 2 * 60 * 1000;

/** The subset of Baileys' WACallEvent we use. */
export interface RawCall {
  id: string;
  chatId?: string;
  from: string;
  callerPn?: string;
  date?: Date | number;
  status: string;
  isVideo?: boolean;
  isGroup?: boolean;
  groupJid?: string;
  offline?: boolean;
}

export interface CallOfferEvent {
  type: "offer";
  id: string;
  name: string;
  number: string;
  isVideo: boolean;
  isGroup: boolean;
  timestamp: number;
}

export interface CallEndEvent {
  type: "end";
  id: string;
  /** reject | accept | timeout | terminate — why the ring stopped. */
  reason: string;
  timestamp: number;
}

export type CallEvent = CallOfferEvent | CallEndEvent;

export interface CallCommand {
  type: "reject";
  id: string;
}

/** Statuses that mean the call is no longer ringing. */
const END_STATUSES = new Set(["reject", "accept", "timeout", "terminate"]);

/** "+919876543210" from a phone JID ("919876543210@s.whatsapp.net"), else "" (e.g. a LID). */
export function numberFromJid(jid: string | undefined | null): string {
  if (!jid) return "";
  const m = /^(\d{6,15})(?::\d+)?@s\.whatsapp\.net$/.exec(jid);
  return m ? `+${m[1]}` : "";
}

/** First saved/known name for any of the JIDs, in order. */
export function pickName(candidates: Array<string | null | undefined>, names: Record<string, string | null | undefined>): string {
  for (const c of candidates) {
    if (!c) continue;
    const n = names[c];
    if (n && n.trim()) return n.trim();
  }
  return "";
}

/** Build the event for the laptop, or null for a call status we ignore (ringing, relay latency, ...). */
export function toCallEvent(call: RawCall, name: string, now = Date.now()): CallEvent | null {
  if (call.status === "offer") {
    const number = numberFromJid(call.callerPn) || numberFromJid(call.from);
    return {
      type: "offer",
      id: call.id,
      name: name || number || "Unknown caller",
      number,
      isVideo: !!call.isVideo,
      isGroup: !!call.isGroup,
      timestamp: now,
    };
  }
  if (END_STATUSES.has(call.status)) {
    return { type: "end", id: call.id, reason: call.status, timestamp: now };
  }
  return null;
}

/** Parse a laptop command. Anything that is not exactly a reject for a string id is dropped. */
export function parseCommand(raw: string): CallCommand | null {
  try {
    const v = JSON.parse(raw);
    if (v && v.type === "reject" && typeof v.id === "string" && v.id.length > 0 && v.id.length < 200) {
      return { type: "reject", id: v.id };
    }
  } catch {
    /* not JSON */
  }
  return null;
}

/** Calls seen ringing, so a decline can be matched to a real, recent call. */
export class RingingCalls {
  private calls = new Map<string, { from: string; at: number }>();
  constructor(private ttlMs = CALL_CACHE_MS) {}

  add(id: string, from: string, now = Date.now()): void {
    this.calls.set(id, { from, at: now });
    this.prune(now);
  }
  remove(id: string): void {
    this.calls.delete(id);
  }
  /** The caller JID for a call that is still ringing, else null. */
  from(id: string, now = Date.now()): string | null {
    const c = this.calls.get(id);
    if (!c) return null;
    if (now - c.at > this.ttlMs) {
      this.calls.delete(id);
      return null;
    }
    return c.from;
  }
  private prune(now: number): void {
    for (const [id, c] of this.calls) if (now - c.at > this.ttlMs) this.calls.delete(id);
  }
}

// ---------------------------------------------------------------------------
// Wiring (needs Baileys + Redis; not unit-tested, the helpers above are)
// ---------------------------------------------------------------------------

const ringing = new RingingCalls();
let currentSock: any = null;
let subscribed = false;

async function lookupName(call: RawCall): Promise<string> {
  try {
    const { redis } = await import("../../storage/redisClient");
    const keys = [call.callerPn, call.from, call.chatId].map((j) => (j ? normalizeJid(j) : null));
    const present = keys.filter((k): k is string => !!k);
    if (present.length === 0) return "";
    const values = await redis.hmget("contact_names", ...present);
    const map: Record<string, string | null> = {};
    present.forEach((k, i) => (map[k] = values[i]));
    return pickName(present, map);
  } catch {
    return "";
  }
}

async function publish(event: CallEvent): Promise<void> {
  try {
    const { redis } = await import("../../storage/redisClient");
    await redis.publish(CALL_EVENT_CHANNEL, JSON.stringify(event));
  } catch (err) {
    console.warn("[callBridge] publish failed:", err instanceof Error ? err.message : err);
  }
}

async function startCommandListener(): Promise<void> {
  if (subscribed) return;
  subscribed = true;
  try {
    const { redis } = await import("../../storage/redisClient");
    const sub = redis.duplicate();
    sub.on("error", () => {});
    await sub.subscribe(CALL_CMD_CHANNEL);
    sub.on("message", async (_channel: string, raw: string) => {
      const cmd = parseCommand(raw);
      if (!cmd) return;
      const from = ringing.from(cmd.id);
      if (!from || !currentSock) return; // unknown or stale call: never reject something we did not see ring
      try {
        await currentSock.rejectCall(cmd.id, from);
        ringing.remove(cmd.id);
        console.log(`[callBridge] declined call ${cmd.id.slice(0, 6)}… on request from the laptop`);
      } catch (err) {
        console.warn("[callBridge] reject failed:", err instanceof Error ? err.message : err);
      }
    });
  } catch (err) {
    subscribed = false;
    console.warn("[callBridge] command listener failed:", err instanceof Error ? err.message : err);
  }
}

/** Hook the call bridge to a (new) socket. Safe to call again after every reconnect. */
export function registerCallBridge(sock: any): void {
  if ((process.env.CALL_BRIDGE_ENABLED ?? "true").toLowerCase() === "false") return;
  currentSock = sock;
  sock.ev.on("call", async (calls: RawCall[]) => {
    for (const call of calls ?? []) {
      try {
        // An offer replayed from the offline queue is history, not a ringing phone.
        if (call.status === "offer" && call.offline) continue;
        const name = call.status === "offer" ? await lookupName(call) : "";
        const event = toCallEvent(call, name);
        if (!event) continue;
        if (event.type === "offer") ringing.add(call.id, call.from);
        else ringing.remove(call.id);
        await publish(event);
      } catch (err) {
        console.warn("[callBridge] call event failed:", err instanceof Error ? err.message : err);
      }
    }
  });
  if ((process.env.CALL_DECLINE_ENABLED ?? "true").toLowerCase() !== "false") void startCommandListener();
}
