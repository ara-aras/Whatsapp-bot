import { getPool } from "../db";

export async function isCacheValid(key: string, maxAgeMs: number = 24 * 60 * 60 * 1000): Promise<boolean> {
  const pool = getPool();
  if (!pool) return false;

  try {
    const result = await pool.query(
      `SELECT last_updated FROM dk24_cache_log WHERE key = $1 LIMIT 1`,
      [key],
    );

    if (result.rows.length === 0) return false;

    const lastUpdated = new Date(result.rows[0].last_updated).getTime();
    const now = Date.now();
    const cacheAgeMs = now - lastUpdated;

    return cacheAgeMs < maxAgeMs;
  } catch (error) {
    console.error(`⚠️ Failed to verify cache freshness for ${key}:`, error);
    return false;
  }
}

// Content hash stored alongside the freshness timestamp, used to skip DB
// rewrites when the upstream payload has not changed.
export async function getCacheHash(key: string): Promise<string | null> {
  const pool = getPool();
  if (!pool) return null;

  try {
    const result = await pool.query(
      `SELECT hash FROM dk24_cache_log WHERE key = $1 LIMIT 1`,
      [key],
    );
    return result.rows[0]?.hash ?? null;
  } catch (error) {
    console.error(`⚠️ Failed to read cache hash for ${key}:`, error);
    return null;
  }
}

// Marks `key` as checked now. When `hash` is given it is stored too;
// otherwise the previous hash is kept.
export async function markCacheUpdated(key: string, hash?: string): Promise<void> {
  const pool = getPool();
  if (!pool) return;

  try {
    await pool.query(
      `
      INSERT INTO dk24_cache_log (key, last_updated, hash)
      VALUES ($1, NOW(), $2)
      ON CONFLICT (key) DO UPDATE SET
        last_updated = NOW(),
        hash = COALESCE(EXCLUDED.hash, dk24_cache_log.hash)
    `,
      [key, hash ?? null],
    );
  } catch (error) {
    console.error(`⚠️ Failed to mark cache updated for ${key}:`, error);
  }
}
