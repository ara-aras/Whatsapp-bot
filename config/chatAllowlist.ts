import fs from "fs";
import path from "path";

interface ChatEntry {
  id: number;
  jid: string;
  botNumber: number;
  level: number;
  enabled: boolean;
}

let allowedChats: ChatEntry[] | null = null;

function normalizeChatJid(
  jid: string | null | undefined,
): string | null | undefined {
  if (!jid || typeof jid !== "string") return jid;
  return jid;
}

function loadFromFile(filePath: string): { jid: string; botNumber: number; level: number }[] {
  try {
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.join(process.cwd(), filePath);
    if (!fs.existsSync(absolutePath)) return [];
    const content = fs.readFileSync(absolutePath, "utf8");
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      return parsed
        .map((entry) => {
          if (typeof entry === "string") {
            return { jid: entry.trim(), botNumber: 0, level: 1 };
          }
          if (entry && typeof entry === "object" && entry.jid) {
            const botNum = parseInt(entry.botNumber ?? entry.bot_number ?? "0", 10);
            const lvl = parseInt(entry.level ?? "1", 10);
            return {
              jid: String(entry.jid).trim(),
              botNumber: isNaN(botNum) ? 0 : botNum,
              level: isNaN(lvl) || lvl < 1 ? 1 : lvl,
            };
          }
          return null;
        })
        .filter((e): e is { jid: string; botNumber: number; level: number } => Boolean(e && e.jid));
    }
  } catch (error) {
    console.warn(`⚠️ Failed to parse allowed chats file ${filePath}:`, error);
  }
  return [];
}

function loadFromEnv(): { jid: string; botNumber: number; level: number }[] {
  const env = process.env.ALLOWED_CHATS || "";
  return env
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const parts = entry.split(" ");
      const jid = parts[0];
      const botNumber = parseInt(parts[1] || "0", 10);
      const level = parseInt(parts[2] || "1", 10);
      return {
        jid: normalizeChatJid(jid) || jid,
        botNumber: isNaN(botNumber) ? 0 : botNumber,
        level: isNaN(level) || level < 1 ? 1 : level,
      };
    });
}

function loadStaticEntries(): { jid: string; botNumber: number; level: number }[] {
  const envEntries = loadFromEnv();
  const filePath = process.env.ALLOWED_CHATS_FILE || "allowed-chats.json";
  const fileEntries = filePath ? loadFromFile(filePath) : [];

  const map = new Map<string, { jid: string; botNumber: number; level: number }>();
  for (const item of [...fileEntries, ...envEntries]) {
    if (item.jid) map.set(item.jid, item);
  }
  return Array.from(map.values());
}

function ensureLoaded(): void {
  if (allowedChats !== null) return;

  const staticEntries = loadStaticEntries();
  allowedChats = staticEntries.map((e, idx) => ({
    id: 99000 + idx,
    jid: e.jid,
    botNumber: e.botNumber,
    level: e.level ?? 1,
    enabled: true,
  }));
}

function saveToFile(entries: ChatEntry[]): void {
  try {
    const filePath = process.env.ALLOWED_CHATS_FILE || "allowed-chats.json";
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.join(process.cwd(), filePath);
    const data = entries.map((e) => ({
      jid: e.jid,
      botNumber: e.botNumber,
      level: e.level ?? 1,
      enabled: e.enabled,
    }));
    fs.writeFileSync(absolutePath, JSON.stringify(data, null, 2), "utf8");
  } catch (error) {
    console.warn("⚠️ Failed to write allowed chats file:", error);
  }
}

async function init(): Promise<void> {
  const staticEntries = loadStaticEntries();

  let dbEntries: ChatEntry[] = [];
  try {
    const { getAllowedChats, addAllowedChat } = await import("../storage/core/allowlistRepository");

    // Sync any env/file entries that don't exist in DB yet
    const currentDb = await getAllowedChats();
    for (const ent of staticEntries) {
      const exists = currentDb.some((dbE) => dbE.jid === ent.jid);
      if (!exists) {
        await addAllowedChat(ent.jid, ent.botNumber, ent.level);
      }
    }

    const dbRows = await getAllowedChats();
    dbEntries = dbRows.map((e) => ({
      id: e.id,
      jid: e.jid,
      botNumber: e.bot_number,
      level: e.level ?? 1,
      enabled: e.enabled,
    }));
  } catch (error) {
    console.warn("⚠️ Failed to load allowed chats from Neon DB, using fallback:", error);
    dbEntries = staticEntries.map((e, idx) => ({
      id: 99000 + idx,
      jid: e.jid,
      botNumber: e.botNumber,
      level: e.level ?? 1,
      enabled: true,
    }));
  }

  allowedChats = dbEntries;
  if (allowedChats.length > 0) {
    saveToFile(allowedChats);
  }
}

function getChatBot(
  jid: string | null | undefined,
): { botNumber: number; level: number } | null {
  if (!jid) return null;

  ensureLoaded();

  if (allowedChats!.length === 0) return null;

  const normalizedInput = normalizeChatJid(jid);
  const inputVariants = new Set(
    [
      jid,
      normalizedInput,
    ].filter(Boolean),
  );

  const entry = allowedChats!.find((chat) => {
    const normalizedEntry = normalizeChatJid(chat.jid);
    return (
      inputVariants.has(chat.jid) ||
      inputVariants.has(normalizedEntry as string)
    );
  });

  return entry && entry.enabled ? { botNumber: entry.botNumber, level: entry.level ?? 1 } : null;
}

function isChatAllowed(jid: string | null | undefined): boolean {
  return getChatBot(jid) !== null;
}

function listChats(): ChatEntry[] {
  ensureLoaded();
  return allowedChats!.map((c) => ({
    id: c.id,
    jid: c.jid,
    botNumber: c.botNumber,
    level: c.level ?? 1,
    enabled: c.enabled,
  }));
}

function getChatEntryById(id: number): ChatEntry | null {
  ensureLoaded();
  return allowedChats!.find((c) => c.id === id) || null;
}

function getChatEntryByJid(jid: string): ChatEntry | null {
  ensureLoaded();
  return allowedChats!.find((c) => c.jid === jid) || null;
}

async function addChat(
  jid: string | null | undefined,
  botNumber: number = 0,
  level: number = 1,
): Promise<boolean> {
  if (!jid) return false;

  ensureLoaded();

  const normalized = normalizeChatJid(jid) || jid;

  try {
    const { addAllowedChat, getAllowedChats } = await import("../storage/core/allowlistRepository");
    const ok = await addAllowedChat(normalized, botNumber, level);
    if (ok) {
      const dbRows = await getAllowedChats();
      allowedChats = dbRows.map((e) => ({
        id: e.id,
        jid: e.jid,
        botNumber: e.bot_number,
        level: e.level ?? 1,
        enabled: e.enabled,
      }));
      saveToFile(allowedChats!);
      return true;
    }
  } catch (error) {
    console.warn(`⚠️ Failed to persist added chat ${normalized} to DB:`, error);
  }

  const existing = allowedChats!.find((c) => {
    const normalizedEntry = normalizeChatJid(c.jid);
    return normalizedEntry === normalized || c.jid === jid;
  });

  if (existing) {
    existing.botNumber = botNumber;
    existing.level = level;
    existing.enabled = true;
  } else {
    allowedChats!.push({
      id: 99000 + allowedChats!.length,
      jid: normalized,
      botNumber,
      level,
      enabled: true,
    });
  }
  saveToFile(allowedChats!);
  return true;
}

async function removeChatById(id: number): Promise<boolean> {
  ensureLoaded();

  const entry = allowedChats!.find((c) => c.id === id);
  if (!entry) return false;

  try {
    const { removeAllowedChatById } = await import("../storage/core/allowlistRepository");
    await removeAllowedChatById(id);
  } catch (error) {
    console.warn(`⚠️ Failed to persist removed chat ID ${id} from DB:`, error);
  }

  const index = allowedChats!.findIndex((c) => c.id === id);
  if (index !== -1) {
    allowedChats!.splice(index, 1);
  }
  saveToFile(allowedChats!);
  return true;
}

async function editChatBot(id: number, botNumber: number, level?: number): Promise<boolean> {
  ensureLoaded();

  const entry = allowedChats!.find((c) => c.id === id);
  if (!entry) return false;

  const targetLevel = level !== undefined ? level : (entry.level ?? 1);

  try {
    const { setChatBotNumber } = await import("../storage/core/allowlistRepository");
    await setChatBotNumber(id, botNumber, targetLevel);
  } catch (error) {
    console.warn(`⚠️ Failed to persist edit chat bot ID ${id} to DB:`, error);
  }

  entry.botNumber = botNumber;
  entry.level = targetLevel;
  saveToFile(allowedChats!);
  return true;
}


async function setChatEnabled(id: number, enabled: boolean): Promise<boolean> {
  ensureLoaded();

  const entry = allowedChats!.find((c) => c.id === id);
  if (!entry) return false;

  try {
    const { setChatEnabled: dbSetEnabled } = await import("../storage/core/allowlistRepository");
    await dbSetEnabled(id, enabled);
  } catch (error) {
    console.warn(`⚠️ Failed to persist enabled chat ID ${id} state to DB:`, error);
  }

  entry.enabled = enabled;
  saveToFile(allowedChats!);
  return true;
}

export default {
  init,
  getChatBot,
  isChatAllowed,
  listChats,
  getChatEntryById,
  getChatEntryByJid,
  addChat,
  removeChatById,
  editChatBot,
  setChatEnabled,
};
