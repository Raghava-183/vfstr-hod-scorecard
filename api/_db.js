import { neon } from '@neondatabase/serverless';
import { DEFAULT_YEAR } from './_years.js';

const url = process.env.DATABASE_URL;
if (!url) console.error('DATABASE_URL is not set. Add the Neon integration in Vercel.');

export const sql = neon(url);

/**
 * Creates the tables if they are missing, then brings an older single-year
 * database up to the multi-year shape. Safe to call on every request: the
 * CREATEs are no-ops once the tables exist, and the migration below only
 * fires on a database that has not had it applied yet.
 */
let ready = null;
export function ensureSchema() {
  if (!ready) {
    ready = (async () => {
      // Postgres rejects bind parameters in DDL, so nothing below may use
      // ${...} interpolation — the year is always supplied explicitly by the
      // application on insert, so these columns need no default at all.

      // ---- fresh install: already multi-year ----
      await sql`
        CREATE TABLE IF NOT EXISTS entries (
          year          TEXT NOT NULL,
          metric_no     INTEGER NOT NULL,
          response      TEXT NOT NULL DEFAULT '',
          comment       TEXT NOT NULL DEFAULT '',
          justification TEXT NOT NULL DEFAULT '',
          proof         TEXT NOT NULL DEFAULT '',
          action_plan   TEXT NOT NULL DEFAULT '',
          updated_by    TEXT NOT NULL DEFAULT '',
          updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (year, metric_no)
        )`;
      await sql`
        CREATE TABLE IF NOT EXISTS attachments (
          id            BIGSERIAL PRIMARY KEY,
          year          TEXT NOT NULL,
          metric_no     INTEGER NOT NULL,
          url           TEXT NOT NULL,
          public_id     TEXT NOT NULL,
          resource_type TEXT NOT NULL DEFAULT 'auto',
          filename      TEXT NOT NULL DEFAULT '',
          bytes         BIGINT NOT NULL DEFAULT 0,
          uploaded_by   TEXT NOT NULL DEFAULT '',
          uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await sql`
        CREATE TABLE IF NOT EXISTS history (
          id         BIGSERIAL PRIMARY KEY,
          year       TEXT NOT NULL,
          metric_no  INTEGER NOT NULL,
          field      TEXT NOT NULL,
          old_value  TEXT NOT NULL DEFAULT '',
          new_value  TEXT NOT NULL DEFAULT '',
          changed_by TEXT NOT NULL DEFAULT '',
          changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await sql`
        CREATE TABLE IF NOT EXISTS login_attempts (
          ip       TEXT PRIMARY KEY,
          fails    INTEGER NOT NULL DEFAULT 0,
          last_try TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;

      // ---- existing single-year database: add the year column ----
      // Rows already stored were all entered against DEFAULT_YEAR. The column
      // is added nullable, every existing row is stamped by an UPDATE (where a
      // parameter is allowed), and only then made NOT NULL.
      const cols = await sql`
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN ('entries', 'attachments', 'history')`;
      const has = (t, c) => cols.some(x => x.table_name === t && x.column_name === c);

      if (!has('entries', 'year')) {
        await sql`ALTER TABLE entries ADD COLUMN year TEXT`;
        await sql`UPDATE entries SET year = ${DEFAULT_YEAR} WHERE year IS NULL`;
        await sql`ALTER TABLE entries ALTER COLUMN year SET NOT NULL`;
        // metric_no alone was the primary key; the pair is now what is unique.
        await sql`ALTER TABLE entries DROP CONSTRAINT IF EXISTS entries_pkey`;
        await sql`ALTER TABLE entries ADD CONSTRAINT entries_pkey PRIMARY KEY (year, metric_no)`;
      }
      if (!has('attachments', 'year')) {
        await sql`ALTER TABLE attachments ADD COLUMN year TEXT`;
        await sql`UPDATE attachments SET year = ${DEFAULT_YEAR} WHERE year IS NULL`;
        await sql`ALTER TABLE attachments ALTER COLUMN year SET NOT NULL`;
      }
      if (!has('history', 'year')) {
        await sql`ALTER TABLE history ADD COLUMN year TEXT`;
        await sql`UPDATE history SET year = ${DEFAULT_YEAR} WHERE year IS NULL`;
        await sql`ALTER TABLE history ALTER COLUMN year SET NOT NULL`;
      }

      await sql`CREATE INDEX IF NOT EXISTS attachments_year_metric_idx
                ON attachments (year, metric_no)`;
      await sql`CREATE INDEX IF NOT EXISTS history_year_metric_idx
                ON history (year, metric_no, changed_at DESC)`;
    })().catch(err => { ready = null; throw err; });
  }
  return ready;
}

export function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (Array.isArray(fwd) ? fwd[0] : (fwd || '')).split(',')[0].trim() || 'unknown';
}
