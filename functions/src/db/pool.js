import pg from "pg";

const { Pool } = pg;

let pool = null;

/**
 * Returns the singleton PostgreSQL connection pool configured via DATABASE_URL.
 * Works with Cloud SQL (via Unix socket or Auth Proxy) and local Postgres.
 */
export function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL environment variable is not configured.");
    }
    pool = new Pool({
      connectionString,
      max: Number(process.env.PG_POOL_MAX || 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl: process.env.PG_SSL === "true" ? { rejectUnauthorized: false } : false,
    });
  }
  return pool;
}

/**
 * Executes a parameterized SQL statement against the pool.
 */
export async function query(text, params = []) {
  return getPool().query(text, params);
}

/**
 * Ensures the authenticated Firebase user has a corresponding row in `users`.
 */
export async function ensureUserRecord(user) {
  await query(
    `INSERT INTO users (uid, email, display_name, photo_url)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (uid) DO UPDATE SET
       email        = COALESCE(EXCLUDED.email, users.email),
       display_name = COALESCE(EXCLUDED.display_name, users.display_name),
       photo_url    = COALESCE(EXCLUDED.photo_url, users.photo_url)`,
    [
      user.uid,
      user.email ?? null,
      user.name ?? null,
      user.picture ?? null,
    ]
  );
}
