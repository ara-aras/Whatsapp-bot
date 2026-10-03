/**
 * Admin JSON API behind /admin/api/* (ADMIN_TOKEN only).
 *
 * Everything the WhatsApp `!` admin commands can do to allowlists is exposed
 * here too, so routine admin work stops costing outbound WhatsApp messages
 * (each of which counts toward the account's spam heuristics). The chat
 * commands keep working — both paths mutate the same allowlist singletons
 * and the same Postgres rows.
 *
 * Collaborators are injected via `configureAdminApi` so this stays testable
 * without Baileys or Postgres, and so bot.ts remains the only file that
 * touches the live socket.
 */
import http from "http";
import QRCode from "qrcode";
import { getBotStatus, isHealthy } from "./botStatus";
import { getLastModelCheck } from "../../ai/modelCheck";
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  type ApiKeyRole,
} from "../../storage/core/apiKeyRepository";

export interface AllowEntry {
  id: number;
  jid: string;
  botNumber: number;
  level?: number;
  enabled: boolean;
  name?: string | null;
  size?: number | null;
  lastActive?: number | null;
}

export interface DiscoveredGroup {
  jid: string;
  subject: string;
  size: number;
  allowlisted: boolean;
}

export interface AdminDeps {
  relink: () => Promise<void>;
  restart: () => void;
  groups: {
    list: () => AllowEntry[];
    add: (jid: string, botNumber: number, level?: number) => Promise<boolean>;
    remove: (id: number) => Promise<boolean>;
    setBot: (id: number, botNumber: number, level?: number) => Promise<boolean>;
    setLevel?: (id: number, level: number) => Promise<boolean>;
    setEnabled: (id: number, enabled: boolean) => Promise<boolean>;
  };
  chats: {
    list: () => AllowEntry[];
    add: (jid: string, botNumber: number, level?: number) => Promise<boolean>;
    remove: (id: number) => Promise<boolean>;
    setBot: (id: number, botNumber: number, level?: number) => Promise<boolean>;
    setLevel?: (id: number, level: number) => Promise<boolean>;
    setEnabled: (id: number, enabled: boolean) => Promise<boolean>;
  };
  /** Groups the linked number is a member of (from the live socket). */
  discoverGroups: () => Promise<{ jid: string; subject: string; size: number }[]>;
  botLabels: () => Record<number, string>;
  normalizeJid: (jid: string) => string | null | undefined;
}

let deps: AdminDeps | null = null;

export function configureAdminApi(d: AdminDeps): void {
  deps = d;
}

function json(res: http.ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

export function readJsonBody(req: http.IncomingMessage, limit = 16 * 1024): Promise<any> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("body_too_large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("invalid_json"));
      }
    });
    req.on("error", reject);
  });
}

function parseBot(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * Shared CRUD for the two allowlists. `kind` picks the singleton; the shape
 * is identical so one handler serves both.
 */
async function handleAllowlist(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  kind: "groups" | "chats",
  rest: string,
): Promise<void> {
  const list = deps![kind];

  if (rest === "" && req.method === "GET") {
    let items = list.list().map((e) => ({ ...e, level: e.level ?? 1 }));
    try {
      const { redis } = await import("../../storage/redisClient");
      if (kind === "groups") {
        const jids = items.map((x) => x.jid);
        const keys = jids.map((j) => `last_group_interaction:${j}`);
        let times: (string | null)[] = [];
        if (keys.length > 0) {
          times = await redis.mget(...keys).catch(() => []);
        }
        let discovered: { jid: string; subject: string; size: number }[] = [];
        try {
          discovered = await deps!.discoverGroups();
        } catch {}
        const discMap = new Map(discovered.map((d) => [d.jid, d]));
        items = items.map((item, idx) => {
          const disc = discMap.get(item.jid);
          const t = times[idx] ? parseInt(times[idx]!, 10) : null;
          return {
            ...item,
            name: disc?.subject || item.name || null,
            size: disc?.size ?? item.size ?? null,
            lastActive: t,
          };
        });
      } else {
        const names: Record<string, string> = (await redis.hgetall("contact_names").catch(() => null)) || {};
        items = items.map((item) => ({
          ...item,
          name: names[item.jid] || item.name || null,
        }));
      }
    } catch {
      /* non-fatal fallback */
    }
    json(res, 200, { [kind]: items });
    return;
  }

  if (rest === "" && req.method === "POST") {
    let body: any;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      json(res, 400, { error: (err as Error).message });
      return;
    }
    const jidRaw = typeof body.jid === "string" ? body.jid.trim() : "";
    const jid = deps!.normalizeJid(jidRaw) || "";
    const botNumber = parseBot(body.botNumber);
    const wantSuffix = kind === "groups" ? "@g.us" : "@s.whatsapp.net";
    if (!jid.endsWith(wantSuffix)) {
      json(res, 400, { error: "bad_request", detail: `jid must end with ${wantSuffix}` });
      return;
    }
    if (botNumber === null) {
      json(res, 400, { error: "bad_request", detail: "botNumber must be a non-negative integer" });
      return;
    }
    if (list.list().some((e) => e.jid === jid)) {
      json(res, 409, { error: "already_allowlisted" });
      return;
    }
    const lvlRaw = body.level !== undefined ? Number(body.level) : 1;
    const level = (botNumber === 2 && lvlRaw === 2) ? 2 : 1;
    const ok = await list.add(jid, botNumber, level);
    json(res, ok ? 201 : 500, ok ? { added: true, jid, botNumber, level } : { error: "add_failed" });
    return;
  }

  const m = rest.match(/^(\d+)$/);
  if (!m) {
    json(res, 404, { error: "not_found" });
    return;
  }
  const id = Number(m[1]);
  const entry = list.list().find((e) => e.id === id);
  if (!entry) {
    json(res, 404, { error: "not_found" });
    return;
  }

  if (req.method === "PATCH") {
    let body: any;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      json(res, 400, { error: (err as Error).message });
      return;
    }
    const changes: string[] = [];
    if (body.botNumber !== undefined) {
      const bot = parseBot(body.botNumber);
      if (bot === null) {
        json(res, 400, { error: "bad_request", detail: "botNumber must be a non-negative integer" });
        return;
      }
      if (bot !== entry.botNumber) {
        // If switching to non-DKB bot, level must revert to 1
        const newLvl = bot === 2 ? (body.level !== undefined ? Number(body.level) : (entry.level ?? 1)) : 1;
        if (!(await list.setBot(id, bot, newLvl))) {
          json(res, 500, { error: "update_failed", field: "botNumber" });
          return;
        }
        changes.push("botNumber");
        if (newLvl !== (entry.level ?? 1)) {
          changes.push("level");
        }
      }
    }
    if (body.level !== undefined) {
      let lvl = Number(body.level);
      if (lvl !== 1 && lvl !== 2) {
        json(res, 400, { error: "bad_request", detail: "level must be 1 or 2" });
        return;
      }
      const targetBot = body.botNumber !== undefined ? parseBot(body.botNumber) : entry.botNumber;
      if (targetBot !== 2) {
        lvl = 1; // Non-DKB bots currently remain Level 1
      }
      if (lvl !== (entry.level ?? 1)) {
        const setLevelFn = list.setLevel
          ? list.setLevel.bind(list)
          : (i: number, l: number) => list.setBot(i, targetBot ?? entry.botNumber, l);
        if (!(await setLevelFn(id, lvl))) {
          json(res, 500, { error: "update_failed", field: "level" });
          return;
        }
        if (!changes.includes("level")) changes.push("level");
      }
    }
    if (body.enabled !== undefined) {
      const enabled = !!body.enabled;
      if (enabled !== entry.enabled) {
        if (!(await list.setEnabled(id, enabled))) {
          json(res, 500, { error: "update_failed", field: "enabled" });
          return;
        }
        changes.push("enabled");
      }
    }
    json(res, 200, { updated: changes, entry: list.list().find((e) => e.id === id) });
    return;
  }

  if (req.method === "DELETE") {
    const ok = await list.remove(id);
    json(res, ok ? 200 : 500, ok ? { removed: true } : { error: "remove_failed" });
    return;
  }

  json(res, 405, { error: "method_not_allowed" });
}

export async function handleAdminApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  route: string,
): Promise<void> {
  if (!deps) {
    json(res, 503, { error: "admin_not_ready" });
    return;
  }
  const s = getBotStatus();

  // ── session ─────────────────────────────────────────────────────────
  if (route === "status" && req.method === "GET") {
    const now = Date.now();
    const mc = getLastModelCheck();

    // Live infrastructure health checks
    let neonHealth = { ok: false, latencyMs: -1 };
    try {
      const { getPool } = await import("../../storage/db");
      const pool = getPool();
      if (pool) {
        const t0 = Date.now();
        await pool.query("SELECT 1");
        neonHealth = { ok: true, latencyMs: Date.now() - t0 };
      }
    } catch {
      /* database down or offline */
    }

    let redisHealth = { ok: false, latencyMs: -1, keyCount: 0 };
    try {
      const { redis } = await import("../../storage/redisClient");
      const t0 = Date.now();
      const pong = await redis.ping();
      if (pong === "PONG") {
        const dbsize = await redis.dbsize().catch(() => 0);
        redisHealth = { ok: true, latencyMs: Date.now() - t0, keyCount: dbsize };
      }
    } catch {
      /* redis down */
    }

    const searchHealth = {
      tavily: !!process.env.TAVILY_API_KEY,
      brave: !!process.env.BRAVE_API_KEY,
      firecrawl: !!process.env.FIRECRAWL_API_KEY,
      exa: !!process.env.EXA_API_KEY,
    };

    json(res, 200, {
      state: s.state,
      healthy: isHealthy(),
      selfJid: s.selfJid,
      uptimeSec: Math.round((now - s.startedAt) / 1000),
      lastOpenAt: s.lastOpenAt,
      lastCloseAt: s.lastCloseAt,
      lastCloseCode: s.lastCloseCode,
      lastInboundAt: s.lastInboundAt,
      lastOutboundAt: s.lastOutboundAt,
      reconnectAttempts: s.reconnectAttempts,
      qrAvailable: !!s.qr,
      qrAgeSec: s.qrAt ? Math.round((now - s.qrAt) / 1000) : null,
      version: process.env.RENDER_GIT_COMMIT?.slice(0, 7) || null,
      bots: deps.botLabels(),
      models: mc ? { checkedAt: mc.checkedAt, models: mc.models, error: mc.error } : null,
      services: {
        neon: neonHealth,
        redis: redisHealth,
        search: searchHealth,
      },
    });
    return;
  }

  if (route === "qr.svg" && req.method === "GET") {
    if (!s.qr) {
      json(res, 404, { error: "no_qr", state: s.state });
      return;
    }
    const svg = await QRCode.toString(s.qr, { type: "svg", margin: 1, width: 280 });
    res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" });
    res.end(svg);
    return;
  }

  if (route === "relink" && req.method === "POST") {
    json(res, 202, { ok: true, message: "Session wiped. Restarting — reload in about 30 seconds for a new QR." });
    setTimeout(() => deps!.relink().catch((err) => console.error("[admin] relink failed:", err)), 100);
    return;
  }

  if (route === "restart" && req.method === "POST") {
    json(res, 202, { ok: true, message: "Restarting. Back in about 20 seconds." });
    setTimeout(() => deps!.restart(), 100);
    return;
  }

  // ── allowlists ──────────────────────────────────────────────────────
  const al = route.match(/^(groups|chats)(?:\/(.*))?$/);
  if (al) {
    await handleAllowlist(req, res, al[1] as "groups" | "chats", al[2] || "");
    return;
  }

  if (route === "discover/groups" && req.method === "GET") {
    if (!isHealthy()) {
      json(res, 503, { error: "socket_not_open" });
      return;
    }
    const allow = new Set(deps.groups.list().map((g) => g.jid));
    const found = await deps.discoverGroups();
    const groups: DiscoveredGroup[] = found
      .map((g) => ({ ...g, allowlisted: allow.has(g.jid) }))
      .sort((a, b) => Number(a.allowlisted) - Number(b.allowlisted) || a.subject.localeCompare(b.subject));
    json(res, 200, { groups });
    return;
  }

  // ── api keys ────────────────────────────────────────────────────────
  if (route === "keys" && req.method === "GET") {
    json(res, 200, { keys: await listApiKeys() });
    return;
  }

  if (route === "keys" && req.method === "POST") {
    let body: any;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      json(res, 400, { error: (err as Error).message });
      return;
    }
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const role: ApiKeyRole = body.role === "viewer" ? "viewer" : "operator";
    const botRaw = body.botNumber;
    const botNumber = botRaw === null || botRaw === undefined || botRaw === "" ? null : parseBot(botRaw);
    if (!name) {
      json(res, 400, { error: "bad_request", detail: "name is required" });
      return;
    }
    if (botRaw !== null && botRaw !== undefined && botRaw !== "" && botNumber === null) {
      json(res, 400, { error: "bad_request", detail: "botNumber must be a non-negative integer or blank" });
      return;
    }
    const { record, key } = await createApiKey(name, role, botNumber);
    json(res, 201, { key, record });
    return;
  }

  const revoke = route.match(/^keys\/(\d+)$/);
  if (revoke && req.method === "DELETE") {
    const ok = await revokeApiKey(Number(revoke[1]));
    json(res, ok ? 200 : 404, ok ? { revoked: true } : { error: "not_found_or_already_revoked" });
    return;
  }

  // ── audit logs ──────────────────────────────────────────────────────
  if (route === "audit" && req.method === "GET") {
    try {
      const { getRecentActionLogs } = await import("../../storage/core/auditRepository");
      const logs = await getRecentActionLogs(30);
      json(res, 200, { logs });
    } catch (err) {
      json(res, 500, { error: "failed_to_fetch_audit_logs", detail: String(err) });
    }
    return;
  }

  if (route === "audit/restore" && req.method === "POST") {
    let body: any;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      json(res, 400, { error: (err as Error).message });
      return;
    }

    let jid = body?.jid;
    let bot = body?.botNumber ?? 1;
    let level = body?.level ?? 1;
    let isGroup = body?.kind === "group" || (typeof jid === "string" && jid.endsWith("@g.us"));
    let logRef = null;

    if (body?.logId) {
      const logId = Number(body.logId);
      try {
        const { getRecentActionLogs } = await import("../../storage/core/auditRepository");
        const logs = await getRecentActionLogs(100);
        const targetLog = logs.find((l) => l.id === logId);
        if (!targetLog) {
          json(res, 404, { error: "audit_log_not_found" });
          return;
        }
        let details: any = {};
        try {
          details = targetLog.details ? JSON.parse(targetLog.details) : {};
        } catch {}

        jid = details.jid || targetLog.targetName || jid;
        bot = details.botNumber ?? bot;
        level = details.level ?? level;
        if (targetLog.actionType.includes("group")) isGroup = true;
        logRef = String(logId);
      } catch (err) {
        json(res, 500, { error: "restore_error", detail: String(err) });
        return;
      }
    }

    if (!jid) {
      json(res, 400, { error: "bad_request", detail: "logId or jid is required" });
      return;
    }

    try {
      const { logAction } = await import("../../storage/core/auditRepository");
      let restored = false;
      if (isGroup) {
        restored = await deps.groups.add(jid, bot, level);
        if (restored) {
          await logAction("admin_web", "restore_group", logRef, jid, JSON.stringify({ jid, botNumber: bot, level }));
        }
      } else {
        restored = await deps.chats.add(jid, bot, level);
        if (restored) {
          await logAction("admin_web", "restore_chat", logRef, jid, JSON.stringify({ jid, botNumber: bot, level }));
        }
      }

      json(res, restored ? 200 : 500, restored ? { ok: true, jid, botNumber: bot, level } : { error: "restore_failed" });
      return;
    } catch (err) {
      json(res, 500, { error: "restore_error", detail: String(err) });
      return;
    }
  }

  json(res, 404, { error: "not_found" });
}
