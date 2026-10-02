import { getPool } from "../db";

export interface DbGroupEntry {
  id: number;
  jid: string;
  bot_number: number;
  level: number;
  enabled: boolean;
}

export interface DbChatEntry {
  id: number;
  jid: string;
  bot_number: number;
  level: number;
  enabled: boolean;
}

export async function getAllowedGroups(): Promise<DbGroupEntry[]> {
  const pool = getPool();
  if (!pool) return [];
  try {
    const res = await pool.query(
      `SELECT id, jid, bot_number, COALESCE(level, 1) as level, enabled FROM wa_allowed_groups ORDER BY id ASC`
    );
    return res.rows.map((row) => ({
      id: row.id,
      jid: row.jid,
      bot_number: row.bot_number,
      level: Number(row.level) || 1,
      enabled: row.enabled,
    }));
  } catch (error) {
    console.error("⚠️ Error getting allowed groups from DB:", error);
    return [];
  }
}

export async function addAllowedGroup(jid: string, botNumber: number, level: number = 1): Promise<boolean> {
  const pool = getPool();
  if (!pool) return false;
  try {
    await pool.query(
      `INSERT INTO wa_allowed_groups (jid, bot_number, level, enabled)
       VALUES ($1, $2, $3, TRUE)
       ON CONFLICT (jid) DO UPDATE SET bot_number = EXCLUDED.bot_number, level = EXCLUDED.level, enabled = TRUE`,
      [jid, botNumber, level],
    );
    return true;
  } catch (error) {
    console.error(`⚠️ Error adding allowed group ${jid} to DB:`, error);
    return false;
  }
}

export async function removeAllowedGroupById(id: number): Promise<boolean> {
  const pool = getPool();
  if (!pool) return false;
  try {
    const res = await pool.query(
      `DELETE FROM wa_allowed_groups WHERE id = $1`,
      [id],
    );
    return (res.rowCount ?? 0) > 0;
  } catch (error) {
    console.error(`⚠️ Error removing allowed group ID ${id} from DB:`, error);
    return false;
  }
}

export async function getGroupById(id: number): Promise<DbGroupEntry | null> {
  const pool = getPool();
  if (!pool) return null;
  try {
    const res = await pool.query(
      `SELECT id, jid, bot_number, COALESCE(level, 1) as level, enabled FROM wa_allowed_groups WHERE id = $1 LIMIT 1`,
      [id],
    );
    if (!res.rows[0]) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      jid: r.jid,
      bot_number: r.bot_number,
      level: Number(r.level) || 1,
      enabled: r.enabled,
    };
  } catch (error) {
    console.error(`⚠️ Error getting allowed group ID ${id} from DB:`, error);
    return null;
  }
}

export async function setGroupBotNumber(id: number, botNumber: number, level?: number): Promise<boolean> {
  const pool = getPool();
  if (!pool) return false;
  try {
    if (level !== undefined) {
      const res = await pool.query(
        `UPDATE wa_allowed_groups SET bot_number = $1, level = $2 WHERE id = $3`,
        [botNumber, level, id],
      );
      return (res.rowCount ?? 0) > 0;
    }
    const res = await pool.query(
      `UPDATE wa_allowed_groups SET bot_number = $1 WHERE id = $2`,
      [botNumber, id],
    );
    return (res.rowCount ?? 0) > 0;
  } catch (error) {
    console.error(`⚠️ Error setting group bot number for ID ${id}:`, error);
    return false;
  }
}

export async function setGroupEnabled(id: number, enabled: boolean): Promise<boolean> {
  const pool = getPool();
  if (!pool) return false;
  try {
    const res = await pool.query(
      `UPDATE wa_allowed_groups SET enabled = $1 WHERE id = $2`,
      [enabled, id],
    );
    return (res.rowCount ?? 0) > 0;
  } catch (error) {
    console.error(`⚠️ Error setting group enabled status for ID ${id}:`, error);
    return false;
  }
}

export async function getAllowedChats(): Promise<DbChatEntry[]> {
  const pool = getPool();
  if (!pool) return [];
  try {
    const res = await pool.query(
      `SELECT id, jid, bot_number, COALESCE(level, 1) as level, enabled FROM wa_allowed_chats ORDER BY id ASC`
    );
    return res.rows.map((row) => ({
      id: row.id,
      jid: row.jid,
      bot_number: row.bot_number,
      level: Number(row.level) || 1,
      enabled: row.enabled,
    }));
  } catch (error) {
    console.error("⚠️ Error getting allowed chats from DB:", error);
    return [];
  }
}

export async function addAllowedChat(jid: string, botNumber: number, level: number = 1): Promise<boolean> {
  const pool = getPool();
  if (!pool) return false;
  try {
    await pool.query(
      `INSERT INTO wa_allowed_chats (jid, bot_number, level, enabled)
       VALUES ($1, $2, $3, TRUE)
       ON CONFLICT (jid) DO UPDATE SET bot_number = EXCLUDED.bot_number, level = EXCLUDED.level, enabled = TRUE`,
      [jid, botNumber, level],
    );
    return true;
  } catch (error) {
    console.error(`⚠️ Error adding allowed chat ${jid} to DB:`, error);
    return false;
  }
}

export async function removeAllowedChatById(id: number): Promise<boolean> {
  const pool = getPool();
  if (!pool) return false;
  try {
    const res = await pool.query(
      `DELETE FROM wa_allowed_chats WHERE id = $1`,
      [id],
    );
    return (res.rowCount ?? 0) > 0;
  } catch (error) {
    console.error(`⚠️ Error removing allowed chat ID ${id} from DB:`, error);
    return false;
  }
}

export async function getChatById(id: number): Promise<DbChatEntry | null> {
  const pool = getPool();
  if (!pool) return null;
  try {
    const res = await pool.query(
      `SELECT id, jid, bot_number, COALESCE(level, 1) as level, enabled FROM wa_allowed_chats WHERE id = $1 LIMIT 1`,
      [id],
    );
    if (!res.rows[0]) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      jid: r.jid,
      bot_number: r.bot_number,
      level: Number(r.level) || 1,
      enabled: r.enabled,
    };
  } catch (error) {
    console.error(`⚠️ Error getting allowed chat ID ${id} from DB:`, error);
    return null;
  }
}

export async function setChatBotNumber(id: number, botNumber: number, level?: number): Promise<boolean> {
  const pool = getPool();
  if (!pool) return false;
  try {
    if (level !== undefined) {
      const res = await pool.query(
        `UPDATE wa_allowed_chats SET bot_number = $1, level = $2 WHERE id = $3`,
        [botNumber, level, id],
      );
      return (res.rowCount ?? 0) > 0;
    }
    const res = await pool.query(
      `UPDATE wa_allowed_chats SET bot_number = $1 WHERE id = $2`,
      [botNumber, id],
    );
    return (res.rowCount ?? 0) > 0;
  } catch (error) {
    console.error(`⚠️ Error setting chat bot number for ID ${id}:`, error);
    return false;
  }
}

export async function setChatEnabled(id: number, enabled: boolean): Promise<boolean> {
  const pool = getPool();
  if (!pool) return false;
  try {
    const res = await pool.query(
      `UPDATE wa_allowed_chats SET enabled = $1 WHERE id = $2`,
      [enabled, id],
    );
    return (res.rowCount ?? 0) > 0;
  } catch (error) {
    console.error(`⚠️ Error setting chat enabled status for ID ${id}:`, error);
    return false;
  }
}
