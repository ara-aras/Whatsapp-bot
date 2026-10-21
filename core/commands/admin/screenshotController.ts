import { registerCommand } from "../commandRegistry";
import { sendBotReply } from "../../../bot";
import { isAdminAction, normalizeJid } from "../../../security/rbac";
import { userHasPermission } from "../../../storage/core/rbacRepository";
import { logAction } from "../../../storage/core/auditRepository";
import {
  captureScreenshot,
  cooldownRemaining,
  isScreenshotEnabled,
  markUsed,
} from "../../../services/screenshot/screenshotService";

// ── SCREENSHOT ──
// Admin always allowed; anyone else needs the privileged `screenshot.take`
// permission. The image only ever goes to the requester's DM, and every
// non-admin use is logged and announced to the admins.
registerCommand({
  name: "screenshot",
  handler: async (ctx) => {
    const isAdmin = isAdminAction(ctx.msg, ctx.senderId);
    if (!isAdmin && !(await userHasPermission(ctx.senderId, "screenshot.take"))) {
      await sendBotReply(ctx.sock, ctx.from, "Unauthorized: permission [screenshot.take] is required.");
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
      const admins = (process.env.ADMIN_JIDS || "")
        .split(",")
        .map((s) => normalizeJid(s.trim()))
        .filter((j): j is string => !!j);
      for (const admin of admins) {
        await sendBotReply(ctx.sock, admin, `Screenshot taken for ${ctx.senderId}.`).catch(() => {});
      }
    }
  },
});
