import fs from "fs";
import path from "path";

interface GroupEntry {
  id: number;
  jid: string;
  botNumber: number;
  enabled: boolean;
}

let allowedGroups: GroupEntry[] | null = null;

function loadFromFile(filePath: string): { jid: string; botNumber: number }[] {
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
            return { jid: entry.trim(), botNumber: 0 };
          }
          if (entry && typeof entry === "object" && entry.jid) {
            const botNum = parseInt(entry.botNumber ?? entry.bot_number ?? "0", 10);
            return {
              jid: String(entry.jid).trim(),
              botNumber: isNaN(botNum) ? 0 : botNum,
            };
          }
          return null;
        })
        .filter((e): e is { jid: string; botNumber: number } => Boolean(e && e.jid));
    }
  } catch (error) {
    console.warn(`⚠️ Failed to parse allowed groups file ${filePath}:`, error);
  }
  return [];
}

function loadFromEnv(): { jid: string; botNumber: number }[] {
  const env = process.env.ALLOWED_GROUPS || "";
  return env
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const parts = entry.split(" ");
      const jid = parts[0];
      const botNumber = parseInt(parts[1] || "0", 10);
      return { jid, botNumber: isNaN(botNumber) ? 0 : botNumber };
    });
}

function loadStaticEntries(): { jid: string; botNumber: number }[] {
  const envEntries = loadFromEnv();
  const filePath = process.env.ALLOWED_GROUPS_FILE || "allowed-groups.json";
  const fileEntries = filePath ? loadFromFile(filePath) : [];

  const map = new Map<string, { jid: string; botNumber: number }>();
  for (const item of [...fileEntries, ...envEntries]) {
    if (item.jid) map.set(item.jid, item);
  }
  return Array.from(map.values());
}

function ensureLoaded(): void {
  if (allowedGroups !== null) return;

  const staticEntries = loadStaticEntries();
  allowedGroups = staticEntries.map((e, idx) => ({
    id: 99000 + idx,
    jid: e.jid,
    botNumber: e.botNumber,
    enabled: true,
  }));
}

function saveToFile(entries: GroupEntry[]): void {
  try {
    const filePath = process.env.ALLOWED_GROUPS_FILE || "allowed-groups.json";
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.join(process.cwd(), filePath);
    const data = entries.map((e) => ({
      jid: e.jid,
      botNumber: e.botNumber,
      enabled: e.enabled,
    }));
    fs.writeFileSync(absolutePath, JSON.stringify(data, null, 2), "utf8");
  } catch (error) {
    console.warn("⚠️ Failed to write allowed groups file:", error);
  }
}

async function init(): Promise<void> {
  const staticEntries = loadStaticEntries();

  let dbEntries: GroupEntry[] = [];
  try {
    const { getAllowedGroups, addAllowedGroup } = await import("../storage/core/allowlistRepository");

    // Sync any env/file entries that don't exist in DB yet
    const currentDb = await getAllowedGroups();
    for (const ent of staticEntries) {
      const exists = currentDb.some((dbE) => dbE.jid === ent.jid);
      if (!exists) {
        await addAllowedGroup(ent.jid, ent.botNumber);
      }
    }

    const dbRows = await getAllowedGroups();
    dbEntries = dbRows.map((e) => ({
      id: e.id,
      jid: e.jid,
      botNumber: e.bot_number,
      enabled: e.enabled,
    }));
  } catch (error) {
    console.warn("⚠️ Failed to load allowed groups from Neon DB, using fallback:", error);
    dbEntries = staticEntries.map((e, idx) => ({
      id: 99000 + idx,
      jid: e.jid,
      botNumber: e.botNumber,
      enabled: true,
    }));
  }

  allowedGroups = dbEntries;
  if (allowedGroups.length > 0) {
    saveToFile(allowedGroups);
  }
}

function getGroupBot(
  jid: string | null | undefined,
): { botNumber: number } | null {
  if (!jid || !jid.endsWith("@g.us")) return null;

  ensureLoaded();

  if (allowedGroups!.length === 0) return null;

  const entry = allowedGroups!.find((g) => g.jid === jid);
  return entry && entry.enabled ? { botNumber: entry.botNumber } : null;
}

function isGroupAllowed(jid: string | null | undefined): boolean {
  return getGroupBot(jid) !== null;
}

function listGroups(): GroupEntry[] {
  ensureLoaded();
  return allowedGroups!.map((g) => ({
    id: g.id,
    jid: g.jid,
    botNumber: g.botNumber,
    enabled: g.enabled,
  }));
}

function getGroupEntryById(id: number): GroupEntry | null {
  ensureLoaded();
  return allowedGroups!.find((g) => g.id === id) || null;
}

function getGroupEntryByJid(jid: string): GroupEntry | null {
  ensureLoaded();
  return allowedGroups!.find((g) => g.jid === jid) || null;
}

async function addGroup(
  jid: string | null | undefined,
  botNumber: number = 0,
): Promise<boolean> {
  if (!jid || !jid.endsWith("@g.us")) return false;

  ensureLoaded();

  try {
    const { addAllowedGroup } = await import("../storage/core/allowlistRepository");
    const ok = await addAllowedGroup(jid, botNumber);
    if (ok) {
      await init();
      saveToFile(allowedGroups!);
      return true;
    }
  } catch (error) {
    console.warn(`⚠️ Failed to persist added group ${jid} to DB:`, error);
  }

  const existing = allowedGroups!.find((g) => g.jid === jid);
  if (existing) {
    existing.botNumber = botNumber;
    existing.enabled = true;
  } else {
    allowedGroups!.push({
      id: 99000 + allowedGroups!.length,
      jid,
      botNumber,
      enabled: true,
    });
  }
  saveToFile(allowedGroups!);
  return true;
}

async function removeGroupById(id: number): Promise<boolean> {
  ensureLoaded();

  const entry = allowedGroups!.find((g) => g.id === id);
  if (!entry) return false;

  try {
    const { removeAllowedGroupById } = await import("../storage/core/allowlistRepository");
    const ok = await removeAllowedGroupById(id);
    if (ok) {
      await init();
      saveToFile(allowedGroups!);
      return true;
    }
  } catch (error) {
    console.warn(`⚠️ Failed to persist removed group ID ${id} from DB:`, error);
  }

  const index = allowedGroups!.findIndex((g) => g.id === id);
  if (index !== -1) {
    allowedGroups!.splice(index, 1);
    saveToFile(allowedGroups!);
    return true;
  }
  return false;
}

async function editGroupBot(id: number, botNumber: number): Promise<boolean> {
  ensureLoaded();

  const entry = allowedGroups!.find((g) => g.id === id);
  if (!entry) return false;

  try {
    const { setGroupBotNumber } = await import("../storage/core/allowlistRepository");
    const ok = await setGroupBotNumber(id, botNumber);
    if (ok) {
      await init();
      saveToFile(allowedGroups!);
      return true;
    }
  } catch (error) {
    console.warn(`⚠️ Failed to persist edit group bot ID ${id} to DB:`, error);
  }

  entry.botNumber = botNumber;
  saveToFile(allowedGroups!);
  return true;
}

async function setGroupEnabled(id: number, enabled: boolean): Promise<boolean> {
  ensureLoaded();

  const entry = allowedGroups!.find((g) => g.id === id);
  if (!entry) return false;

  try {
    const { setGroupEnabled: dbSetEnabled } = await import("../storage/core/allowlistRepository");
    const ok = await dbSetEnabled(id, enabled);
    if (ok) {
      await init();
      saveToFile(allowedGroups!);
      return true;
    }
  } catch (error) {
    console.warn(`⚠️ Failed to persist enabled group ID ${id} state to DB:`, error);
  }

  entry.enabled = enabled;
  saveToFile(allowedGroups!);
  return true;
}

export default {
  init,
  getGroupBot,
  isGroupAllowed,
  listGroups,
  getGroupEntryById,
  getGroupEntryByJid,
  addGroup,
  removeGroupById,
  editGroupBot,
  setGroupEnabled,
};
