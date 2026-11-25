// RE: n/a (NEITHER - plain node-postgres pool + DDL for pgvector, documented public API)
import pg from "pg";

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    pool = new pg.Pool({ connectionString, max: 5 });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

/** Idempotent schema. */
export async function ensureSchema(): Promise<void> {
  const p = getPool();
  await p.query("CREATE EXTENSION IF NOT EXISTS vector");
  await p.query(`
    CREATE TABLE IF NOT EXISTS chunks (
      id          bigserial PRIMARY KEY,
      doc_id      text    NOT NULL,
      doc_title   text    NOT NULL,
      lang        text    NOT NULL,
      chunk_index integer NOT NULL,
      content     text    NOT NULL,
      embedding   vector(384) NOT NULL
    )`);
  await p.query("CREATE TABLE IF NOT EXISTS corpus_meta (k text PRIMARY KEY, v text NOT NULL)");
  // Cost ledger: amounts only. No question text, no IP, no user id is ever stored.
  await p.query(`
    CREATE TABLE IF NOT EXISTS spend_ledger (
      id      bigserial PRIMARY KEY,
      at      timestamptz NOT NULL DEFAULT now(),
      kind    text NOT NULL,
      eur     numeric(12,6) NOT NULL
    )`);
  await p.query("CREATE INDEX IF NOT EXISTS spend_ledger_at ON spend_ledger (at)");
}
