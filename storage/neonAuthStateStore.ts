import type { Pool } from "pg";
import {
  AuthenticationState,
  AuthenticationCreds,
  initAuthCreds,
  BufferJSON,
} from "@whiskeysockets/baileys";
import format from "pg-format";
import "dotenv/config";

import { encrypt, decrypt } from "../security/encryption";

const AUTH_TABLE = "wa_auth_state";
const DEFAULT_NAMESPACE = "parag";

export function getEncryptionKey(): string {
  return process.env.AUTH_STATE_KEY || process.env.AUTH_STATE_JWT_SECRET || "";
}

/**
 * Fail closed: WhatsApp session credentials must not be written to Postgres in
 * plaintext. If no encryption key is configured, refuse to start rather than
 * silently degrading. Set ALLOW_UNENCRYPTED_AUTH_STATE=true to explicitly opt
 * into plaintext storage (not recommended).
 */
export function assertAuthEncryptionConfigured(): void {
  if (getEncryptionKey()) return;
  const optOut =
    (process.env.ALLOW_UNENCRYPTED_AUTH_STATE || "").toLowerCase() === "true";
  if (optOut) {
    console.warn(
      "⚠️ AUTH_STATE_KEY is not set — auth state will be stored UNENCRYPTED (ALLOW_UNENCRYPTED_AUTH_STATE=true).",
    );
    return;
  }
  throw new Error(
    "FATAL: AUTH_STATE_KEY (or AUTH_STATE_JWT_SECRET) is not set. WhatsApp " +
      "session credentials would be stored unencrypted in Postgres. Set an " +
      "encryption key, or set ALLOW_UNENCRYPTED_AUTH_STATE=true to override.",
  );
}

export function getDatabaseUrl(): string | undefined {
  return process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
}

type StorageValue = any;

function serializeStateValue(value: StorageValue): string {
  const jsonStr = JSON.stringify(value, BufferJSON.replacer);
  const key = getEncryptionKey();
  if (key) {
    return "enc:" + encrypt(jsonStr, key);
  }
  return jsonStr;
}

function deserializeStateValue(value: string | null): StorageValue {
  if (!value) return null;

  let jsonStr = value;
  const key = getEncryptionKey();

  if (value.startsWith("enc:")) {
    if (!key) {
      throw new Error(
        "Cannot decrypt auth state: AUTH_STATE_KEY is not configured but state in the database is encrypted.",
      );
    }
    const encryptedData = value.slice(4);
    jsonStr = decrypt(encryptedData, key);
  } else if (key) {
    console.warn(
      "⚠️ Found unencrypted auth state data while encryption is enabled. Upgrading to encrypted on next write.",
    );
  }

  return JSON.parse(jsonStr, BufferJSON.reviver);
}

function buildStorageKey(
  namespace: string,
  type: string,
  subtype?: string,
  id?: string,
): string {
  return [namespace, type, subtype, id].filter(Boolean).join(":");
}

async function ensureSchema(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${AUTH_TABLE} (
      id TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function readOne(pool: Pool, id: string): Promise<StorageValue> {
  const result = await pool.query(
    `SELECT value FROM ${AUTH_TABLE} WHERE id = $1 LIMIT 1`,
    [id],
  );

  if (!result.rows.length) {
    return null as any;
  }

  return deserializeStateValue(result.rows[0].value);
}

/** Anything with pg's `query` — the pool, or one client inside a transaction. */
type Queryable = Pick<Pool, "query">;

/**
 * Retries a key-store operation a few times, then THROWS.
 *
 * Signal key reads and writes must not fail silently. Reporting a failed read
 * as "no such key" makes Baileys believe a session does not exist and build a
 * new one over the top of it; dropping a failed write leaves the database
 * behind the live ratchet. Either way the result is undecryptable messages
 * and, eventually, a pairing that has to be redone. A thrown error fails only
 * the one message being processed, and WhatsApp's retry receipts recover it.
 */
export async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  attempts = 3,
  baseDelayMs = 200,
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, baseDelayMs * Math.pow(2, i)));
      }
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  console.warn(`⚠️ ${label} failed after ${attempts} attempts: ${message}`);
  throw lastError;
}

// Replaces 100 concurrent queries with 1 single bulk insert query.
// This is critical to prevent connection exhaustion in serverless Postgres.
async function upsertMany(
  pool: Queryable,
  writes: { id: string; value: StorageValue }[],
): Promise<void> {
  if (writes.length === 0) return;

  const values = writes.map((w) => [w.id, serializeStateValue(w.value)]);
  const query = format(
    `INSERT INTO ${AUTH_TABLE} (id, value) 
     VALUES %L 
     ON CONFLICT (id) DO UPDATE SET 
       value = EXCLUDED.value, 
       updated_at = NOW()`,
    values,
  );

  await pool.query(query);
}

async function deleteMany(pool: Queryable, ids: string[]): Promise<void> {
  if (!ids.length) return;

  await pool.query(`DELETE FROM ${AUTH_TABLE} WHERE id = ANY($1::text[])`, [
    ids,
  ]);
}

async function readMany(
  pool: Pool,
  ids: string[],
): Promise<Map<string, StorageValue>> {
  if (!ids.length) return new Map();

  const result = await pool.query(
    `SELECT id, value FROM ${AUTH_TABLE} WHERE id = ANY($1::text[])`,
    [ids],
  );

  const mapped = new Map<string, StorageValue>();
  for (const row of result.rows) {
    mapped.set(row.id, deserializeStateValue(row.value));
  }

  return mapped;
}

/**
 * Wipes every stored credential/key row for the namespace so the next boot
 * pairs from scratch (fresh QR). Used by the admin dashboard's "relink".
 * Returns the number of rows removed.
 */
export async function clearAuthState(
  namespace = DEFAULT_NAMESPACE,
): Promise<number> {
  const { getPool } = await import("./db");
  const pool = getPool();
  if (!pool) {
    throw new Error("Failed to obtain shared database pool for auth state wipe.");
  }
  await ensureSchema(pool);
  const result = await pool.query(
    `DELETE FROM ${AUTH_TABLE} WHERE id = $1 OR id LIKE $2`,
    [buildStorageKey(namespace, "creds"), `${namespace}:%`],
  );
  return result.rowCount ?? 0;
}

export async function useNeonAuthState(
  namespace = DEFAULT_NAMESPACE,
): Promise<any> {
  assertAuthEncryptionConfigured();

  const databaseUrl = getDatabaseUrl();

  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL (or NEON_DATABASE_URL) is required for Neon auth storage.",
    );
  }

  // Use the shared global pool from db.ts instead of creating an independent pool.
  // This prevents connection exhaustion on Neon's serverless tier.
  const { getPool } = await import("./db");
  let pool = getPool();

  if (!pool) {
    throw new Error(
      "Failed to obtain shared database pool for auth state storage.",
    );
  }

  await ensureSchema(pool);

  const credsKey = buildStorageKey(namespace, "creds");
  const creds = (await readOne(pool, credsKey)) || initAuthCreds();

  const state: AuthenticationState = {
    creds: creds as AuthenticationCreds,
    keys: {
      get: async (type: string, ids: string[]) => {
        const keyIds = ids.map((id) =>
          buildStorageKey(namespace, "key", type, id),
        );
        // Throws on failure: an empty result here would mean "these keys do
        // not exist", which is a different (and destructive) answer.
        const rows = await withRetry("Reading auth keys from Neon", () =>
          readMany(pool!, keyIds),
        );
        const data: any = {};

        ids.forEach((id) => {
          const dbKey = buildStorageKey(namespace, "key", type, id);
          const value = rows.get(dbKey);
          if (value) data[id] = value;
        });

        return data;
      },
      set: async (data: any) => {
        const writes: { id: string; value: StorageValue }[] = [];
        const deletions: string[] = [];

        for (const [typeKey, typeData] of Object.entries(data)) {
          for (const [id, value] of Object.entries(typeData as any)) {
            const dbKey = buildStorageKey(namespace, "key", typeKey, id);
            if (value) {
              writes.push({ id: dbKey, value });
            } else {
              deletions.push(dbKey);
            }
          }
        }

        await withRetry("Persisting auth keys to Neon", async () => {
          if (writes.length && deletions.length) {
            // One batch from Baileys is one state transition: apply the
            // upserts and deletions together or not at all.
            const { withTransaction } = await import("./db");
            await withTransaction(pool!, async (client) => {
              await upsertMany(client, writes);
              await deleteMany(client, deletions);
            });
          } else if (writes.length) {
            await upsertMany(pool!, writes);
          } else if (deletions.length) {
            await deleteMany(pool!, deletions);
          }
        });
      },
    } as any,
  };

  return {
    state,
    // Throws after retries; the creds.update handler in bot.ts logs it. The
    // next creds.update writes the full creds object again, so a missed save
    // is recovered rather than lost.
    saveCreds: async () => {
      await withRetry("Persisting auth creds to Neon", () =>
        upsertMany(pool!, [{ id: credsKey, value: state.creds }]),
      );
    },
    close: async () => {
      // No-op: pool lifecycle is managed by db.ts, not by the auth state store
    },
  };
}