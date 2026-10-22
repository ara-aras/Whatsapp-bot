import { getPool } from "../db";
import { resolvePhoneJidFromLid } from "./rbacRepository";

/**
 * Screenshot receivers ("SSR") are the non-admin users allowed to run
 * `!screenshot` / `!ss`. The list is a dedicated allowlist rather than a
 * general RBAC role, so granting it confers that one command and nothing
 * else. Admins (ADMIN_JIDS) are always allowed and are not stored here.
 */

export async function addScreenshotReceiver(
  jid: string,
  grantedBy: string,
): Promise<boolean> {
  const pool = getPool();
  if (!pool || !jid) return false;
  try {
    await pool.query(
      `INSERT INTO screenshot_receivers (jid, granted_by)
       VALUES ($1, $2)
       ON CONFLICT (jid) DO NOTHING`,
      [jid, grantedBy],
    );
    return true;
  } catch (error) {
    console.error("⚠️ Error adding screenshot receiver:", error);
    return false;
  }
}

/** Returns true if a row was actually removed. */
export async function removeScreenshotReceiver(jid: string): Promise<boolean> {
  const pool = getPool();
  if (!pool || !jid) return false;
  try {
    const res = await pool.query(
      `DELETE FROM screenshot_receivers WHERE jid = $1`,
      [jid],
    );
    return (res.rowCount ?? 0) > 0;
  } catch (error) {
    console.error("⚠️ Error removing screenshot receiver:", error);
    return false;
  }
}

export async function listScreenshotReceivers(): Promise<string[]> {
  const pool = getPool();
  if (!pool) return [];
  try {
    const res = await pool.query(
      `SELECT jid FROM screenshot_receivers ORDER BY created_at ASC`,
    );
    return res.rows.map((row) => row.jid as string);
  } catch (error) {
    console.error("⚠️ Error listing screenshot receivers:", error);
    return [];
  }
}

/**
 * Whether a sender may take a screenshot. A @lid sender is also checked
 * against its resolved phone JID, mirroring userHasPermission().
 */
export async function isScreenshotReceiver(jid: string): Promise<boolean> {
  const pool = getPool();
  if (!pool || !jid) return false;
  try {
    const res = await pool.query(
      `SELECT 1 FROM screenshot_receivers WHERE jid = $1 LIMIT 1`,
      [jid],
    );
    if (res.rows.length > 0) return true;

    if (jid.endsWith("@lid")) {
      const resolved = await resolvePhoneJidFromLid(jid);
      if (resolved && resolved !== jid) {
        const res2 = await pool.query(
          `SELECT 1 FROM screenshot_receivers WHERE jid = $1 LIMIT 1`,
          [resolved],
        );
        return res2.rows.length > 0;
      }
    }
    return false;
  } catch (error) {
    console.error("⚠️ Error checking screenshot receiver:", error);
    return false;
  }
}
