import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
if (!url) console.error('DATABASE_URL is not set. Add the Neon integration in Vercel.');

export const sql = neon(url);

/**
 * Creates the tables if they are missing. Safe to call on every request:
 * CREATE TABLE IF NOT EXISTS is cheap and keeps first-deploy setup automatic.
 */
let ready = null;
export function ensureSchema() {
  if (!ready) {
    ready = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS entries (
          metric_no     INTEGER PRIMARY KEY,
          response      TEXT NOT NULL DEFAULT '',
          comment       TEXT NOT NULL DEFAULT '',
          justification TEXT NOT NULL DEFAULT '',
          proof         TEXT NOT NULL DEFAULT '',
          action_plan   TEXT NOT NULL DEFAULT '',
          updated_by    TEXT NOT NULL DEFAULT '',
          updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await sql`
        CREATE TABLE IF NOT EXISTS attachments (
          id            BIGSERIAL PRIMARY KEY,
          metric_no     INTEGER NOT NULL,
          url           TEXT NOT NULL,
          public_id     TEXT NOT NULL,
          resource_type TEXT NOT NULL DEFAULT 'auto',
          filename      TEXT NOT NULL DEFAULT '',
          bytes         BIGINT NOT NULL DEFAULT 0,
          uploaded_by   TEXT NOT NULL DEFAULT '',
          uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await sql`CREATE INDEX IF NOT EXISTS attachments_metric_idx ON attachments (metric_no)`;
      await sql`
        CREATE TABLE IF NOT EXISTS history (
          id         BIGSERIAL PRIMARY KEY,
          metric_no  INTEGER NOT NULL,
          field      TEXT NOT NULL,
          old_value  TEXT NOT NULL DEFAULT '',
          new_value  TEXT NOT NULL DEFAULT '',
          changed_by TEXT NOT NULL DEFAULT '',
          changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await sql`CREATE INDEX IF NOT EXISTS history_metric_idx ON history (metric_no, changed_at DESC)`;
      await sql`
        CREATE TABLE IF NOT EXISTS login_attempts (
          ip       TEXT PRIMARY KEY,
          fails    INTEGER NOT NULL DEFAULT 0,
          last_try TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
    })().catch(err => { ready = null; throw err; });
  }
  return ready;
}

export function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (Array.isArray(fwd) ? fwd[0] : (fwd || '')).split(',')[0].trim() || 'unknown';
}
