import { registerCommand } from "../commandRegistry";
import { sendBotReply } from "../../../bot";
import { isAdminAction, normalizeJid } from "../../../security/rbac";
import { logAction } from "../../../storage/core/auditRepository";
import {
  addScreenshotReceiver,
  removeScreenshotReceiver,
  listScreenshotReceivers,
  isScreenshotReceiver,
} from "../../../storage/core/screenshotReceiverRepository";
import {
  captureScreenshot,
  cooldownRemaining,
  isScreenshotEnabled,
  markUsed,
} from "../../../services/screenshot/screenshotService";

/** Parses a `<jid>` / phone-number argument into a canonical JID. */
function parseJidArg(input: string): string | null {
  const inp = (input || "").trim();
  if (inp.includes("@")) {
    const n = normalizeJid(inp);
    if (n && (n.endsWith("@s.whatsapp.net") || n.endsWith("@lid"))) return n;
    return null;
  }
  const m = inp.match(/^\+?(\d{7,15})$/);
  if (m) return `${m[1]}@s.whatsapp.net`;
  return null;
}

function prettyJid(jid: string): string {
  return jid.endsWith("@lid") ? `${jid.split("@")[0]} (LID)` : `+${jid.split("@")[0]}`;
}

function adminJids(): string[] {
  return (process.env.ADMIN_JIDS || "")
    .split(",")
    .map((s) => normalizeJid(s.trim()))
    .filter((j): j is string => !!j);
}

// ── !screenshot / !ss ──
// Admins (ADMIN_JIDS) and anyone on the screenshot-receiver list may run it.
// The image is only ever sent to the requester's DM; non-admin use is rate
// limited, audit-logged, and announced to the admins.
registerCommand({
  name: "screenshot",
  handler: async (ctx) => {
    const isAdmin = isAdminAction(ctx.msg, ctx.senderId);
    if (!isAdmin && !(await isScreenshotReceiver(ctx.senderId))) {
      await sendBotReply(ctx.sock, ctx.from, "Unauthorized: you don't have screenshot access.");
      return;
    }
    if (!isScreenshotEnabled()) {
      await sendBotReply(ctx.sock, ctx.from, "Screenshots are disabled.");
      return;
    }

    if (!isAdmin) {
      const wait = cooldownRemaining(ctx.senderId);
      if (wait > 0) {
        await sendBotReply(ctx.sock, ctx.from, `Slow down, try again in ${wait}s.`);
        return;
      }
      markUsed(ctx.senderId);
    }

    let image: Buffer;
    try {
      image = await captureScreenshot();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[screenshot] capture failed:", msg);
      await sendBotReply(ctx.sock, ctx.from, `Screenshot failed: ${msg}`);
      return;
    }

    const isGroup = ctx.from.endsWith("@g.us");
    const dest = isGroup ? ctx.senderId : ctx.from;
    await ctx.sock.sendMessage(dest, { image, caption: "Phone screenshot" });
    if (isGroup) {
      await sendBotReply(ctx.sock, ctx.from, "Sent to your DM.");
    }

    if (!isAdmin) {
      await logAction(ctx.senderId, "screenshot", null, null, `from=${ctx.from}`);
      for (const admin of adminJids()) {
        await sendBotReply(ctx.sock, admin, `Screenshot taken by ${prettyJid(ctx.senderId)}.`).catch(() => {});
      }
    }
  },
});

// ── !addSSR <jid> ── grant screenshot access (admin only) ──
registerCommand({
  name: "addssr",
  requiresAdmin: true,
  handler: async (ctx) => {
    const target = parseJidArg(ctx.cmdArgs[0] || "");
    if (!target) {
      await sendBotReply(ctx.sock, ctx.from, "Usage: !addSSR <phone-number or jid>");
      return;
    }
    if (adminJids().includes(target)) {
      await sendBotReply(ctx.sock, ctx.from, "That number is an admin — it already has screenshot access.");
      return;
    }
    const ok = await addScreenshotReceiver(target, ctx.senderId);
    if (!ok) {
      await sendBotReply(ctx.sock, ctx.from, "Failed to grant access (database unavailable?).");
      return;
    }
    await logAction(ctx.senderId, "addssr", target, null, null);
    await sendBotReply(ctx.sock, ctx.from, `✅ ${prettyJid(target)} can now use !ss / !screenshot.`);
  },
});

// ── !rmSSR <jid> ── revoke screenshot access (admin only) ──
registerCommand({
  name: "rmssr",
  requiresAdmin: true,
  handler: async (ctx) => {
    const target = parseJidArg(ctx.cmdArgs[0] || "");
    if (!target) {
      await sendBotReply(ctx.sock, ctx.from, "Usage: !rmSSR <phone-number or jid>");
      return;
    }
    const removed = await removeScreenshotReceiver(target);
    if (!removed) {
      await sendBotReply(ctx.sock, ctx.from, `${prettyJid(target)} was not on the screenshot list.`);
      return;
    }
    await logAction(ctx.senderId, "rmssr", target, null, null);
    await sendBotReply(ctx.sock, ctx.from, `✅ Removed ${prettyJid(target)} from screenshot access.`);
  },
});

// ── !listss ── list everyone with screenshot access (admin only) ──
registerCommand({
  name: "listss",
  requiresAdmin: true,
  handler: async (ctx) => {
    const receivers = await listScreenshotReceivers();
    const admins = adminJids();
    const lines: string[] = [];
    if (admins.length) {
      lines.push("Admins (always allowed):");
      lines.push(...admins.map((j) => `• ${prettyJid(j)}`));
    }
    lines.push(receivers.length ? "\nScreenshot receivers:" : "\nScreenshot receivers: (none)");
    lines.push(...receivers.map((j) => `• ${prettyJid(j)}`));
    await sendBotReply(ctx.sock, ctx.from, lines.join("\n"));
  },
});
