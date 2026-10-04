import { registerCommand } from "../commandRegistry";
import groupConfig from "../../../config/groupAllowlist";
import chatConfig from "../../../config/chatAllowlist";
import { sendBotReply, safeGetGroupName, safeGetContactName, buildSessionKey } from "../../../bot";
import { normalizeJid, isAdminAction } from "../../../security/rbac";
import { saveSession } from "../../state";
import { redis } from "../../../storage/redisClient";
import { botLabel } from "../../../agents/core/botLabels";

// ── LIST GROUPS ──
const listGroupsHandler = async (ctx: any) => {
  const list = groupConfig.listGroups();
  if (!list || list.length === 0) {
    await sendBotReply(ctx.sock, ctx.from, "No groups configured (allowlist is empty).");
  } else {
    const formattedPromises = list.map(async (entry) => {
      const statusLabel = entry.enabled ? "Enabled" : "Disabled";
      const groupName = await safeGetGroupName(ctx.sock, entry.jid);
      return `${entry.id}. ${groupName} (${entry.jid}) | Bot ${entry.botNumber} (${botLabel(entry.botNumber)}) [Lvl ${entry.level || 1}] | [${statusLabel}]`;
    });
    const formatted = await Promise.all(formattedPromises);
    await sendBotReply(ctx.sock, ctx.from, `Allowed groups:\n${formatted.join("\n")}`);
  }
};

// ── LIST CHATS ──
const listChatsHandler = async (ctx: any) => {
  const list = chatConfig.listChats();
  if (!list || list.length === 0) {
    await sendBotReply(ctx.sock, ctx.from, "No chats configured (allowlist is empty).");
  } else {
    const formattedPromises = list.map(async (entry) => {
      const statusLabel = entry.enabled ? "Enabled" : "Disabled";
      const name = await safeGetContactName(entry.jid);
      return `${entry.id}. ${name} (${entry.jid}) | Bot ${entry.botNumber} (${botLabel(entry.botNumber)}) [Lvl ${entry.level || 1}] | [${statusLabel}]`;
    });
    const formatted = await Promise.all(formattedPromises);
    await sendBotReply(ctx.sock, ctx.from, `Allowed chats:\n${formatted.join("\n")}`);
  }
};

// ── LIST (!list [-g|-c]) ──
const listHandler = async (ctx: any) => {
  const joined = ctx.cmdArgs.join(" ").toLowerCase();
  const hasGroupFlag = /(?:^|\s)-(?:gid|g)(?:\s+|$)/i.test(joined) || /(?:^|\s)groups?(?:\s+|$)/i.test(joined);
  const hasChatFlag = /(?:^|\s)-(?:cid|c)(?:\s+|$)/i.test(joined) || /(?:^|\s)chats?(?:\s+|$)/i.test(joined);

  if (hasGroupFlag && !hasChatFlag) {
    return listGroupsHandler(ctx);
  }
  if (hasChatFlag && !hasGroupFlag) {
    return listChatsHandler(ctx);
  }
  // Context-aware fallback: list groups if inside group, chats if in private chat
  if (ctx.from.endsWith("@g.us")) {
    return listGroupsHandler(ctx);
  } else {
    return listChatsHandler(ctx);
  }
};

registerCommand({
  name: "listgroups",
  requiresAdmin: true,
  handler: listGroupsHandler,
});

registerCommand({
  name: "listchats",
  requiresAdmin: true,
  handler: listChatsHandler,
});

registerCommand({
  name: "list",
  requiresAdmin: true,
  handler: listHandler,
});

// Resolves which allowlisted group/chat a command targets: an explicit
// -g/-gid or -c/-cid (id or jid), positional id/jid, else the current chat/group.
type ResolvedTarget =
  | { ok: true; type: "group" | "chat"; entry: { id: number; jid: string; botNumber: number; level: number } }
  | { ok: false; msg: string };

function resolveTarget(ctx: any): ResolvedTarget {
  const rawArgs = [...ctx.cmdArgs];
  const joined = rawArgs.join(" ");

  // Check for mutual exclusivity of group vs chat
  const hasGroupFlag = /(?:^|\s)-(?:gid|g)(?:\s+|$)/i.test(joined);
  const hasChatFlag = /(?:^|\s)-(?:cid|c)(?:\s+|$)/i.test(joined);
  if (hasGroupFlag && hasChatFlag) {
    return { ok: false, msg: "Specify only one of -g/-gid or -c/-cid." };
  }

  // 1. Group target via -gid <val> or -g [val]
  if (hasGroupFlag) {
    const m = joined.match(/-(?:gid|g)(?:\s+([^\s]+))?/i);
    const val = m && m[1] && !m[1].startsWith("-") ? m[1].trim() : "";

    if (val) {
      const id = parseInt(val, 10);
      let entry = !isNaN(id) ? groupConfig.getGroupEntryById(id) : null;
      if (!entry) {
        entry = groupConfig.getGroupEntryByJid(val) || groupConfig.getGroupEntryByJid(normalizeJid(val) as string);
      }
      if (entry) {
        return { ok: true, type: "group", entry };
      }
      return {
        ok: false,
        msg: `No group found with ID or JID "${val}". Use !listgroups to see valid group IDs.`,
      };
    }

    // Bare -g without a value targets the current group
    if (ctx.from.endsWith("@g.us")) {
      const entry = groupConfig.getGroupEntryByJid(ctx.from);
      return entry
        ? { ok: true, type: "group", entry }
        : { ok: false, msg: "This group isn't in the allowlist. Add it with !add -g." };
    }
    return { ok: false, msg: "Pass a group ID or JID with -g <id|jid> (e.g. -g 6)." };
  }

  // 2. Chat target via -cid <val> or -c [val]
  if (hasChatFlag) {
    const m = joined.match(/-(?:cid|c)(?:\s+([^\s]+))?/i);
    const val = m && m[1] && !m[1].startsWith("-") ? m[1].trim() : "";

    if (val) {
      const id = parseInt(val, 10);
      let entry = !isNaN(id) ? chatConfig.getChatEntryById(id) : null;
      if (!entry) {
        entry = chatConfig.getChatEntryByJid(val) || chatConfig.getChatEntryByJid(normalizeJid(val) as string);
      }
      if (entry) {
        return { ok: true, type: "chat", entry };
      }
      return {
        ok: false,
        msg: `No chat found with ID or JID "${val}". Use !listchats to see valid chat IDs.`,
      };
    }

    // Bare -c without a value targets the current chat
    if (!ctx.from.endsWith("@g.us")) {
      const entry = chatConfig.getChatEntryByJid(ctx.from);
      return entry
        ? { ok: true, type: "chat", entry }
        : { ok: false, msg: "This chat isn't in the allowlist. Add it with !add -c." };
    }
    return { ok: false, msg: "Pass a chat ID or JID with -c <id|jid> (e.g. -c 1)." };
  }

  // 3. Positional ID or JID (e.g. !rm 9 or !edit 6 -lvl 2)
  for (let i = 0; i < rawArgs.length; i++) {
    const prev = (rawArgs[i - 1] || "").toLowerCase();
    const curr = rawArgs[i];
    if (prev === "-bid" || prev === "-lvl") continue;
    if (curr.startsWith("-")) continue;

    const id = parseInt(curr, 10);
    if (!isNaN(id)) {
      const g = groupConfig.getGroupEntryById(id);
      if (g) return { ok: true, type: "group", entry: g };
      const c = chatConfig.getChatEntryById(id);
      if (c) return { ok: true, type: "chat", entry: c };
      return {
        ok: false,
        msg: `No group or chat found with ID ${id}. Use !listgroups or !listchats to view IDs.`,
      };
    }

    if (curr.includes("@")) {
      const g = groupConfig.getGroupEntryByJid(curr);
      if (g) return { ok: true, type: "group", entry: g };
      const c = chatConfig.getChatEntryByJid(curr);
      if (c) return { ok: true, type: "chat", entry: c };
      return {
        ok: false,
        msg: `No group or chat found with JID "${curr}".`,
      };
    }
  }

  // 4. Infer current chat or group
  if (ctx.from.endsWith("@g.us")) {
    const entry = groupConfig.getGroupEntryByJid(ctx.from);
    return entry
      ? { ok: true, type: "group", entry }
      : { ok: false, msg: "This group isn't in the allowlist. Add it with !add, or target one with -g <id>." };
  }
  const entry = chatConfig.getChatEntryByJid(ctx.from);
  return entry
    ? { ok: true, type: "chat", entry }
    : { ok: false, msg: "This chat isn't in the allowlist. Add it with !add, or target one with -c <id>." };
}

// ── ADD (!add [-g|-c] [jid] [-bid <0-3>] [-lvl <1|2>]) ──
// Omit -g/-c and the jid to add THIS chat/group. Default Bot 1, Level 1 when not specified.
// Examples: !add · !add -bid 2 · !add -bid 2 -lvl 2 · !add -g 12036...@g.us -bid 2 -lvl 2
registerCommand({
  name: "add",
  requiresAdmin: true,
  handler: async (ctx) => {
    const toks = [...ctx.cmdArgs];

    // -bid <n> (optional; default Bot 1 when adding without one).
    let botNumber = 1;
    const bi = toks.findIndex((t) => t.toLowerCase() === "-bid");
    if (bi !== -1) {
      botNumber = parseInt(toks[bi + 1] || "", 10);
      toks.splice(bi, 2);
    }
    if (isNaN(botNumber) || botNumber < 0 || botNumber > 3) botNumber = 1;

    // -lvl <n> (optional; default Level 1).
    let level = 1;
    const li = toks.findIndex((t) => t.toLowerCase() === "-lvl");
    if (li !== -1) {
      const parsedLvl = parseInt(toks[li + 1] || "", 10);
      if (isNaN(parsedLvl) || parsedLvl < 1 || parsedLvl > 2) {
        await sendBotReply(ctx.sock, ctx.from, "Invalid level. Usage: -lvl <1|2> (1=Standard Community, 2=Live Intelligence).");
        return;
      }
      level = parsedLvl;
      toks.splice(li, 2);
    }

    const wantGroup = toks.some((t) => t.toLowerCase() === "-g");
    const wantChat = toks.some((t) => t.toLowerCase() === "-c");
    if (wantGroup && wantChat) {
      await sendBotReply(ctx.sock, ctx.from, "Use only one of -g / -c.");
      return;
    }
    const rest = toks.filter((t) => !/^-(g|c)$/i.test(t));
    const explicit = rest[0] ? (normalizeJid(rest[0]) as string) : "";

    // Type: explicit -g/-c, else inferred from the current chat/group.
    const type: "group" | "chat" = wantGroup
      ? "group"
      : wantChat
        ? "chat"
        : ctx.from.endsWith("@g.us")
          ? "group"
          : "chat";
    const jid = explicit || ctx.from;

    if (type === "group" && !jid.endsWith("@g.us")) {
      await sendBotReply(ctx.sock, ctx.from, "Run !add -g inside the group, or pass a group JID (…@g.us).");
      return;
    }
    if (type === "chat" && jid.endsWith("@g.us")) {
      await sendBotReply(ctx.sock, ctx.from, "Run !add -c inside the chat, or pass a chat JID (…@s.whatsapp.net).");
      return;
    }

    const logAdd = async (id: number | null) => {
      try {
        const { logAction } = await import("../../../storage/core/auditRepository");
        await logAction(ctx.senderId || "unknown", `add_${type}`, id != null ? String(id) : null, jid, JSON.stringify({ botNumber, level }));
      } catch {}
    };

    if (type === "group") {
      const ok = await groupConfig.addGroup(jid, botNumber, level);
      if (!ok) { await sendBotReply(ctx.sock, ctx.from, `Failed to add ${jid}.`); return; }
      const entry = groupConfig.getGroupEntryByJid(jid);
      await logAdd(entry ? entry.id : null);
      const name = await safeGetGroupName(ctx.sock, jid);
      await sendBotReply(ctx.sock, ctx.from, `Added group ${name} (${jid})${entry ? ` (ID: ${entry.id})` : ""} | Bot ${botNumber} (${botLabel(botNumber)}) [Level ${level}].`);
      return;
    }

    const ok = await chatConfig.addChat(jid, botNumber, level);
    if (!ok) { await sendBotReply(ctx.sock, ctx.from, `Failed to add ${jid}.`); return; }
    const entry = chatConfig.getChatEntryByJid(jid);
    await logAdd(entry ? entry.id : null);
    const name = await safeGetContactName(jid);
    await sendBotReply(ctx.sock, ctx.from, `Added chat ${name} (${jid})${entry ? ` (ID: ${entry.id})` : ""} | Bot ${botNumber} (${botLabel(botNumber)}) [Level ${level}].`);
  },
});

// ── RM / DELETE (!rm / !delete — this chat/group, or -g/-c/-gid/-cid <id|jid>) — confirm via !YES ──
const rmHandler = async (ctx: any) => {
  const t = resolveTarget(ctx);
  if (!t.ok) {
    await sendBotReply(
      ctx.sock,
      ctx.from,
      `${t.msg}\nUsage: !rm (in the chat/group) | !rm -g <id> | !rm -c <id>`,
    );
    return;
  }
  const { id, jid, botNumber } = t.entry;
  if (t.type === "group") {
    const name = await safeGetGroupName(ctx.sock, jid);
    ctx.session.pendingDeleteGroup = { id, jid, botNumber };
    await sendBotReply(
      ctx.sock,
      ctx.from,
      `Remove Group ID: ${id} | Name: ${name} | JID: ${jid} | Bot: ${botNumber} (${botLabel(botNumber)})?\n(Enter !YES to confirm)`,
    );
  } else {
    const name = await safeGetContactName(jid);
    ctx.session.pendingDeleteChat = { id, jid, botNumber };
    await sendBotReply(
      ctx.sock,
      ctx.from,
      `Remove Chat ID: ${id} | Name: ${name} | JID: ${jid} | Bot: ${botNumber} (${botLabel(botNumber)})?\n(Enter !YES to confirm)`,
    );
  }
  await saveSession(buildSessionKey(ctx.from, ctx.senderId), ctx.session);
};

registerCommand({
  name: "rm",
  requiresAdmin: true,
  handler: rmHandler,
});

registerCommand({
  name: "delete",
  requiresAdmin: true,
  handler: rmHandler,
});

// ── EDIT (!edit [-bid <n>] [-lvl <n>] [-read <val>] [-ask <val>] — this chat/group, or -gid/-cid <id>) ──
// Also routes to event editing (!edit -en ... -on ...) in Core group.
registerCommand({
  name: "edit",
  handler: async (ctx) => {
    const rawJoined = ctx.cmdArgs.join(" ");
    const b = rawJoined.match(/-bid\s+(\d+)/i);
    const l = rawJoined.match(/-lvl\s+(\d+)/i);
    const readMatch = rawJoined.match(/-read\s+([^\s]+)/i);
    const askMatch = rawJoined.match(/-ask\s+([^\s]+)/i);

    const hasEventFlags = /-(?:en|on|sdt|edt|eloc|el|eweb|rlink|reglink|epos|etag|desc|name|email)\b/i.test(rawJoined);
    const hasAllowlistFlags = Boolean(b || l || readMatch || askMatch);

    // If no allowlist flags and (has event flags or no group/chat target specified), route to event editor
    if (!hasAllowlistFlags && (hasEventFlags || !/-(?:g|gid|c|cid)\b/i.test(rawJoined))) {
      const { handleEditEventCommand } = await import(
        "../../../services/DKB/eventIngestionService"
      );
      await handleEditEventCommand(
        ctx.sock,
        ctx.from,
        ctx.senderId,
        ctx.cmdArgs,
        ctx.msg,
      );
      return;
    }

    if (!isAdminAction(ctx.msg, ctx.senderId)) {
      await sendBotReply(
        ctx.sock,
        ctx.from,
        "Unauthorized: admin privileges required to edit allowlisted bot settings.",
      );
      return;
    }

    const t = resolveTarget(ctx);
    if (!t.ok) {
      await sendBotReply(ctx.sock, ctx.from, t.msg);
      return;
    }

    const label = t.type === "group" ? "Group" : "Chat";
    const currentBot = t.entry.botNumber;
    const currentLevel = t.entry.level ?? 1;
    const currentRead = Boolean((t.entry as any).read);
    const currentAsk = Boolean((t.entry as any).ask);

    function parseBoolFlag(val: string | undefined): boolean | null {
      if (!val) return null;
      const v = val.toLowerCase().trim();
      if (["enable", "enabled", "1", "true", "on", "yes"].includes(v)) return true;
      if (["disable", "disabled", "0", "false", "off", "no"].includes(v)) return false;
      return null;
    }

    let newRead: boolean | undefined = undefined;
    if (readMatch) {
      const parsed = parseBoolFlag(readMatch[1]);
      if (parsed === null) {
        await sendBotReply(
          ctx.sock,
          ctx.from,
          "Invalid -read value. Use: -read <enable|enabled|1|disable|disabled|0>",
        );
        return;
      }
      newRead = parsed;
    }

    let newAsk: boolean | undefined = undefined;
    if (askMatch) {
      const parsed = parseBoolFlag(askMatch[1]);
      if (parsed === null) {
        await sendBotReply(
          ctx.sock,
          ctx.from,
          "Invalid -ask value. Use: -ask <enable|enabled|1|disable|disabled|0>",
        );
        return;
      }
      newAsk = parsed;
    }

    let newBot = currentBot;
    if (b) {
      const parsedBot = parseInt(b[1], 10);
      if (isNaN(parsedBot) || parsedBot < 0 || parsedBot > 3) {
        await sendBotReply(ctx.sock, ctx.from, "Invalid bot ID. Available: 0, 1, 2, 3.");
        return;
      }
      newBot = parsedBot;
    }

    let newLevel = currentLevel;
    if (l) {
      const parsedLvl = parseInt(l[1], 10);
      if (isNaN(parsedLvl) || parsedLvl < 1 || parsedLvl > 2) {
        await sendBotReply(
          ctx.sock,
          ctx.from,
          "Invalid level. Usage: -lvl <1|2> (1=Standard Community, 2=Live Intelligence).",
        );
        return;
      }
      newLevel = parsedLvl;
    }

    // Non-DKB bots only support level 1
    if (newBot !== 2 && newLevel === 2) {
      newLevel = 1;
    }

    const { id, jid } = t.entry;
    const botChanged = newBot !== currentBot;
    const levelChanged = newLevel !== currentLevel;
    const readChanged = newRead !== undefined && newRead !== currentRead;
    const askChanged = newAsk !== undefined && newAsk !== currentAsk;

    if (!botChanged && !levelChanged && !readChanged && !askChanged) {
      await sendBotReply(
        ctx.sock,
        ctx.from,
        `${label} is already using Bot ${newBot} (${botLabel(newBot)}) [Level ${newLevel}] (Read: ${currentRead ? "on" : "off"}, Ask: ${currentAsk ? "on" : "off"}).`,
      );
      return;
    }

    // If bot or level changed, prompt for confirmation via !YES
    if (botChanged || levelChanged) {
      const name = t.type === "group" ? await safeGetGroupName(ctx.sock, jid) : await safeGetContactName(jid);
      if (t.type === "group") {
        ctx.session.pendingEditGroup = {
          id,
          jid,
          botNumber: newBot,
          level: newLevel,
          read: newRead !== undefined ? newRead : currentRead,
          ask: newAsk !== undefined ? newAsk : currentAsk,
        };
      } else {
        ctx.session.pendingEditChat = { id, jid, botNumber: newBot, level: newLevel };
      }
      await sendBotReply(
        ctx.sock,
        ctx.from,
        `Change ${label} ID: ${id} | Name: ${name} | JID: ${jid} to Bot ${newBot} (${botLabel(newBot)}) [Level ${newLevel}] from Bot ${currentBot} (${botLabel(currentBot)}) [Level ${currentLevel}]?\n(Enter !YES to confirm)`,
      );
      await saveSession(buildSessionKey(ctx.from, ctx.senderId), ctx.session);
      return;
    }

    // Only read and/or ask flags changed (no bot/level change required): apply immediately
    if (t.type === "group") {
      if (newRead !== undefined) {
        await groupConfig.setGroupRead(id, newRead);
      }
      if (newAsk !== undefined) {
        await groupConfig.setGroupAsk(id, newAsk);
      }
      try {
        const { logAction } = await import("../../../storage/core/auditRepository");
        await logAction(
          ctx.senderId || "unknown",
          "edit_group_flags",
          String(id),
          jid,
          JSON.stringify({ read: newRead, ask: newAsk }),
        );
      } catch {}

      const finalRead = newRead !== undefined ? newRead : currentRead;
      const finalAsk = newAsk !== undefined ? newAsk : currentAsk;
      await sendBotReply(
        ctx.sock,
        ctx.from,
        `✅ Updated Group ID: ${id} | JID: ${jid}\n` +
          `• Bot: ${currentBot} (${botLabel(currentBot)}) [Level ${currentLevel}]\n` +
          `• Read (Listen): ${finalRead ? "Enabled" : "Disabled"}\n` +
          `• Ask (Review Target): ${finalAsk ? "Enabled" : "Disabled"}`,
      );
    }
  },
});

// ── ENABLE / DISABLE (this chat/group, or -gid/-cid <id>) ──
async function setAllowlistEnabled(ctx: any, enabled: boolean): Promise<void> {
  const verb = enabled ? "enable" : "disable";
  const t = resolveTarget(ctx);
  if (!t.ok) {
    await sendBotReply(
      ctx.sock,
      ctx.from,
      `${t.msg}\nUsage: !${verb} (in the chat/group) | !${verb} -g <id> | !${verb} -c <id>`,
    );
    return;
  }
  const { id, jid } = t.entry;
  const label = t.type === "group" ? "Group" : "Chat";
  const ok =
    t.type === "group"
      ? await groupConfig.setGroupEnabled(id, enabled)
      : await chatConfig.setChatEnabled(id, enabled);
  if (!ok) {
    await sendBotReply(ctx.sock, ctx.from, `Failed to ${verb} ${label} ID: ${id}.`);
    return;
  }
  try {
    const { logAction } = await import("../../../storage/core/auditRepository");
    await logAction(ctx.senderId || "unknown", `${verb}_${t.type}`, String(id), jid, JSON.stringify({ enabled }));
  } catch {}
  await sendBotReply(
    ctx.sock,
    ctx.from,
    `${enabled ? "Enabled" : "Disabled"} ${label} ID: ${id} | JID: ${jid}.`,
  );
}

registerCommand({
  name: "disable",
  requiresAdmin: true,
  handler: (ctx) => setAllowlistEnabled(ctx, false),
});

registerCommand({
  name: "enable",
  requiresAdmin: true,
  handler: (ctx) => setAllowlistEnabled(ctx, true),
});

// ── FIND GROUPS ──
// Lists every group the bot participates in, most-recently-active first.
// Supports -f <filter> (name/JID) and -p <page>, paginated at the shared size.
const findGroupsHandler = async (ctx: any) => {
  try {
    const rawArgs = ctx.cmdArgs.join(" ").trim();
    let filter = "";
    const filterMatch = rawArgs.match(/-f\s+([^\-]+)/i);
    if (filterMatch) {
      filter = filterMatch[1].trim().toLowerCase();
    } else {
      const cleaned = rawArgs.replace(/-p\s+\d+/i, "").trim();
      if (cleaned && !cleaned.startsWith("-")) {
        filter = cleaned.toLowerCase();
      }
    }
    let page = 1;
    const pageMatch = rawArgs.match(/-p\s+(\d+)/i);
    if (pageMatch) {
      page = parseInt(pageMatch[1], 10);
      if (isNaN(page) || page < 1) page = 1;
    }

    const groups = await ctx.sock.groupFetchAllParticipating();
    let list = Object.values(groups) as any[];
    if (list.length === 0) {
      await sendBotReply(ctx.sock, ctx.from, "The bot is not currently in any groups.");
      return;
    }

    // Sort by most-recent bot interaction (0 = never seen).
    const withTime = await Promise.all(
      list.map(async (g: any) => {
        const t = await redis.get(`last_group_interaction:${g.id}`);
        return { g, lastTime: t ? parseInt(t, 10) : 0 };
      }),
    );
    withTime.sort((a, b) => b.lastTime - a.lastTime);
    let sorted = withTime.map((x) => x.g);

    if (filter) {
      sorted = sorted.filter(
        (g: any) =>
          (g.subject || "").toLowerCase().includes(filter) ||
          String(g.id).toLowerCase().includes(filter),
      );
    }
    if (sorted.length === 0) {
      await sendBotReply(ctx.sock, ctx.from, `No groups match "${filter}".`);
      return;
    }

    const { paginate, PAGINATION_MAX_VIEW } = await import(
      "../../../services/DKB/pagination"
    );
    const { pageItems, page: p, totalPages, total } = paginate(sorted, page);
    const offset = (p - 1) * PAGINATION_MAX_VIEW;
    const formatted = pageItems.map(
      (g: any, idx) => `${offset + idx + 1}. ${g.subject} | JID: ${g.id}`,
    );
    const header = filter
      ? `Groups matching "${filter}" (${total}):`
      : `Groups the bot is in (${total}, recent first):`;
    const footer =
      totalPages > 1
        ? `\n\nPage ${p}/${totalPages}${p < totalPages ? ` — !find -g ${filter ? `-f "${filter}" ` : ""}-p ${p + 1} for more.` : ""}`
        : "";
    await sendBotReply(
      ctx.sock,
      ctx.from,
      `${header}\n${formatted.join("\n")}${footer}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sendBotReply(ctx.sock, ctx.from, `Failed to fetch groups:\n${msg}`);
  }
};

// ── FIND CHATS ──
const findChatsHandler = async (ctx: any) => {
  try {
    const rawArgs = ctx.cmdArgs.join(" ").trim();
    let filter = "";
    let page = 1;

    // Extract -f filter
    const filterMatch = rawArgs.match(/-f\s+([^\-]+)/i);
    if (filterMatch) {
      filter = filterMatch[1].trim().toLowerCase();
    } else {
      const cleaned = rawArgs.replace(/-p\s+\d+/i, "").trim();
      if (cleaned && !cleaned.startsWith("-")) {
        filter = cleaned.toLowerCase();
      }
    }

    // Extract -p page
    const pageMatch = rawArgs.match(/-p\s+(\d+)/i);
    if (pageMatch) {
      page = parseInt(pageMatch[1], 10);
      if (isNaN(page) || page < 1) page = 1;
    }

    const allContacts = await redis.hgetall("contact_names");
    if (!allContacts || Object.keys(allContacts).length === 0) {
      await sendBotReply(ctx.sock, ctx.from, "No cached contacts found in the database yet.");
      return;
    }

    let entries = Object.entries(allContacts);

    if (filter) {
      entries = entries.filter(([jid, name]) => {
        return jid.toLowerCase().includes(filter) || name.toLowerCase().includes(filter);
      });
    }

    if (entries.length === 0) {
      const msg = filter ? `No cached contacts matched your query: "${filter}"` : "No contacts found.";
      await sendBotReply(ctx.sock, ctx.from, msg);
      return;
    }

    const { PAGINATION_MAX_VIEW: PAGE_SIZE } = await import(
      "../../../services/DKB/pagination"
    );
    const totalItems = entries.length;
    const totalPages = Math.ceil(totalItems / PAGE_SIZE);

    if (page > totalPages) page = totalPages;

    const startIndex = (page - 1) * PAGE_SIZE;
    const paginatedEntries = entries.slice(startIndex, startIndex + PAGE_SIZE);

    const formatted = paginatedEntries.map(([jid, name], idx) => {
      return `${startIndex + idx + 1}. ${name} | JID: ${jid}`;
    });

    let header = filter
      ? `*Chats Matching: "${filter}"*\n`
      : `*All Cached Chats*\n`;
    header += `Page ${page} of ${totalPages} (${totalItems} total contacts)\n\n`;

    const footer = `\n\nUse !find -c ${filter ? `-f "${filter}" ` : ""}-p ${page + 1} for the next page.`;

    await sendBotReply(ctx.sock, ctx.from, `${header}${formatted.join("\n")}${page < totalPages ? footer : ""}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sendBotReply(ctx.sock, ctx.from, `Failed to search chats:\n${msg}`);
  }
};

// ── FIND (!find [-g|-c] [query]) ──
const findHandler = async (ctx: any) => {
  const rawArgs = [...ctx.cmdArgs];
  const joined = rawArgs.join(" ");

  const hasGroupFlag = /(?:^|\s)-(?:gid|g)(?:\s+|$)/i.test(joined) || /(?:^|\s)groups?(?:\s+|$)/i.test(joined);
  const hasChatFlag = /(?:^|\s)-(?:cid|c)(?:\s+|$)/i.test(joined) || /(?:^|\s)chats?(?:\s+|$)/i.test(joined);

  // Strip -g, -gid, -c, -cid, groups, chats from args so search filter doesn't include the flag itself
  const filteredArgs = rawArgs.filter(
    (arg) => !/^-(?:gid|g|cid|c)$/i.test(arg) && !/^(?:groups?|chats?)$/i.test(arg),
  );
  const subCtx = { ...ctx, cmdArgs: filteredArgs };

  if (hasGroupFlag && !hasChatFlag) {
    return findGroupsHandler(subCtx);
  }
  if (hasChatFlag && !hasGroupFlag) {
    return findChatsHandler(subCtx);
  }
  // Context-aware fallback: groups if in a group, chats if in private chat
  if (ctx.from.endsWith("@g.us")) {
    return findGroupsHandler(subCtx);
  } else {
    return findChatsHandler(subCtx);
  }
};

registerCommand({
  name: "findgroups",
  requiresAdmin: true,
  handler: findGroupsHandler,
});

registerCommand({
  name: "findgroup",
  requiresAdmin: true,
  handler: findGroupsHandler,
});

registerCommand({
  name: "findchats",
  requiresAdmin: true,
  handler: findChatsHandler,
});

registerCommand({
  name: "findchat",
  requiresAdmin: true,
  handler: findChatsHandler,
});

registerCommand({
  name: "find",
  requiresAdmin: true,
  handler: findHandler,
});
