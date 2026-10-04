import { getPool } from "../db";

export interface DbGroupEntry {
  id: number;
  jid: string;
  bot_number: number;
  level: number;
  enabled: boolean;
  read_mode: boolean;
  ask_mode: boolean;
}

export interface DbChatEntry {
  id: number;
  jid: string;
  bot_number: number;
  level: number;
  enabled: boolean;
  read_mode: boolean;
  ask_mode: boolean;
}

export async function getAllowedGroups(): Promise<DbGroupEntry[]> {
  const pool = getPool();
  if (!pool) return [];
  try {
    const res = await pool.query(
      `SELECT id, jid, bot_number, COALESCE(level, 1) as level, enabled,
              COALESCE(read_mode, false) as read_mode,
              COALESCE(ask_mode, false) as ask_mode
       FROM wa_allowed_groups ORDER BY id ASC`
    );
    return res.rows.map((row) => ({
      id: row.id,
      jid: row.jid,
      bot_number: row.bot_number,
      level: Number(row.level) || 1,
      enabled: row.enabled,
      read_mode: Boolean(row.read_mode),
      ask_mode: Boolean(row.ask_mode),
    }));
  } catch (error) {
    console.error("⚠️ Error getting allowed groups from DB:", error);
    return [];
  }
}

export async function addAllowedGroup(
  jid: string,
  botNumber: number,
  level: number = 1,
  readMode: boolean = false,
  askMode: boolean = false,
): Promise<boolean> {
  const pool = getPool();
  if (!pool) return false;
  try {
    await pool.query(
      `INSERT INTO wa_allowed_groups (jid, bot_number, level, enabled, read_mode, ask_mode)
       VALUES ($1, $2, $3, TRUE, $4, $5)
       ON CONFLICT (jid) DO UPDATE SET
         bot_number = EXCLUDED.bot_number,
         level = EXCLUDED.level,
         enabled = TRUE,
         read_mode = EXCLUDED.read_mode,
         ask_mode = EXCLUDED.ask_mode`,
      [jid, botNumber, level, readMode, askMode],
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
      `SELECT id, jid, bot_number, COALESCE(level, 1) as level, enabled,
              COALESCE(read_mode, false) as read_mode,
              COALESCE(ask_mode, false) as ask_mode
       FROM wa_allowed_groups WHERE id = $1 LIMIT 1`,
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
      read_mode: Boolean(r.read_mode),
      ask_mode: Boolean(r.ask_mode),
    };
  } catch (error) {
    console.error(`⚠️ Error getting allowed group ID ${id} from DB:`, error);
    return null;
  }
}

export async function setGroupBotNumber(
  id: number,
  botNumber: number,
  level?: number,
  readMode?: boolean,
  askMode?: boolean,
): Promise<boolean> {
  const pool = getPool();
  if (!pool) return false;
  try {
    const updates: string[] = ["bot_number = $1"];
    const values: any[] = [botNumber];
    let idx = 2;

    if (level !== undefined) {
      updates.push(`level = $${idx++}`);
      values.push(level);
    }
    if (readMode !== undefined) {
      updates.push(`read_mode = $${idx++}`);
      values.push(readMode);
    }
    if (askMode !== undefined) {
      updates.push(`ask_mode = $${idx++}`);
      values.push(askMode);
    }

    values.push(id);
    const res = await pool.query(
      `UPDATE wa_allowed_groups SET ${updates.join(", ")} WHERE id = $${idx}`,
      values,
    );
    return (res.rowCount ?? 0) > 0;
  } catch (error) {
    console.error(`⚠️ Error setting group bot number for ID ${id}:`, error);
    return false;
  }
}

export async function setGroupReadMode(id: number, readMode: boolean): Promise<boolean> {
  const pool = getPool();
  if (!pool) return false;
  try {
    const res = await pool.query(
      `UPDATE wa_allowed_groups SET read_mode = $1 WHERE id = $2`,
      [readMode, id],
    );
    return (res.rowCount ?? 0) > 0;
  } catch (error) {
    console.error(`⚠️ Error setting group read_mode for ID ${id}:`, error);
    return false;
  }
}

export async function setGroupAskMode(id: number, askMode: boolean): Promise<boolean> {
  const pool = getPool();
  if (!pool) return false;
  try {
    const res = await pool.query(
      `UPDATE wa_allowed_groups SET ask_mode = $1 WHERE id = $2`,
      [askMode, id],
    );
    return (res.rowCount ?? 0) > 0;
  } catch (error) {
    console.error(`⚠️ Error setting group ask_mode for ID ${id}:`, error);
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
      `SELECT id, jid, bot_number, COALESCE(level, 1) as level, enabled,
              COALESCE(read_mode, false) as read_mode,
              COALESCE(ask_mode, false) as ask_mode
       FROM wa_allowed_chats ORDER BY id ASC`
    );
    return res.rows.map((row) => ({
      id: row.id,
      jid: row.jid,
      bot_number: row.bot_number,
      level: Number(row.level) || 1,
      enabled: row.enabled,
      read_mode: Boolean(row.read_mode),
      ask_mode: Boolean(row.ask_mode),
    }));
  } catch (error) {
    console.error("⚠️ Error getting allowed chats from DB:", error);
    return [];
  }
}

export async function addAllowedChat(
  jid: string,
  botNumber: number,
  level: number = 1,
  readMode: boolean = false,
  askMode: boolean = false,
): Promise<boolean> {
  const pool = getPool();
  if (!pool) return false;
  try {
    await pool.query(
      `INSERT INTO wa_allowed_chats (jid, bot_number, level, enabled, read_mode, ask_mode)
       VALUES ($1, $2, $3, TRUE, $4, $5)
       ON CONFLICT (jid) DO UPDATE SET
         bot_number = EXCLUDED.bot_number,
         level = EXCLUDED.level,
         enabled = TRUE,
         read_mode = EXCLUDED.read_mode,
         ask_mode = EXCLUDED.ask_mode`,
      [jid, botNumber, level, readMode, askMode],
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
      `SELECT id, jid, bot_number, COALESCE(level, 1) as level, enabled,
              COALESCE(read_mode, false) as read_mode,
              COALESCE(ask_mode, false) as ask_mode
       FROM wa_allowed_chats WHERE id = $1 LIMIT 1`,
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
      read_mode: Boolean(r.read_mode),
      ask_mode: Boolean(r.ask_mode),
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
