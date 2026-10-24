import { neon } from '@neondatabase/serverless';
import { DEFAULT_YEAR } from './_years.js';

const url = process.env.DATABASE_URL;
if (!url) console.error('DATABASE_URL is not set. Add the Neon integration in Vercel.');

export const sql = neon(url);

/**
 * Brings the database to the shape the app expects: creates the tables on a
 * fresh install, and adds the year column to an older single-year database.
 *
 * Two rules shape everything below.
 *
 *  - Postgres rejects bind parameters in DDL, so no CREATE or ALTER here may
 *    use ${...} interpolation. Only the UPDATEs, which are DML, carry a value.
 *  - Several serverless instances cold-start at once and all run this, so each
 *    batch of DDL sits in a DO block that takes a transaction-level advisory
 *    lock, making the batch atomic and serialised. Statement-level IF NOT
 *    EXISTS is not enough on its own: two instances creating the same index
 *    still collide in the system catalogue.
 */
let ready = null;
export function ensureSchema() {
  if (!ready) {
    ready = (async () => {
      // Fast path: once migrated, one cheap query ends the work. All three
      // tables are checked, so a half-applied migration is still repaired.
      const [state] = await sql`
        SELECT count(*)::int AS n
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name = 'year'
          AND table_name IN ('entries', 'attachments', 'history')`;
      if (state && state.n === 3) return;

      // ---- tables and columns ----
      await sql`
        DO $$
        BEGIN
          PERFORM pg_advisory_xact_lock(8571234);

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
          );
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
          );
          CREATE TABLE IF NOT EXISTS history (
            id         BIGSERIAL PRIMARY KEY,
            year       TEXT NOT NULL,
            metric_no  INTEGER NOT NULL,
            field      TEXT NOT NULL,
            old_value  TEXT NOT NULL DEFAULT '',
            new_value  TEXT NOT NULL DEFAULT '',
            changed_by TEXT NOT NULL DEFAULT '',
            changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
          );
          CREATE TABLE IF NOT EXISTS login_attempts (
            ip       TEXT PRIMARY KEY,
            fails    INTEGER NOT NULL DEFAULT 0,
            last_try TIMESTAMPTZ NOT NULL DEFAULT now()
          );

          -- An older single-year database: added nullable here, made NOT NULL
          -- further down once the existing rows have been stamped.
          ALTER TABLE entries     ADD COLUMN IF NOT EXISTS year TEXT;
          ALTER TABLE attachments ADD COLUMN IF NOT EXISTS year TEXT;
          ALTER TABLE history     ADD COLUMN IF NOT EXISTS year TEXT;
        END $$`;

      // ---- stamp the rows that predate the column ----
      // Everything already stored was entered against DEFAULT_YEAR.
      await sql`UPDATE entries     SET year = ${DEFAULT_YEAR} WHERE year IS NULL`;
      await sql`UPDATE attachments SET year = ${DEFAULT_YEAR} WHERE year IS NULL`;
      await sql`UPDATE history     SET year = ${DEFAULT_YEAR} WHERE year IS NULL`;

      // ---- constraints and indexes ----
      await sql`
        DO $$
        BEGIN
          PERFORM pg_advisory_xact_lock(8571234);

          ALTER TABLE entries     ALTER COLUMN year SET NOT NULL;
          ALTER TABLE attachments ALTER COLUMN year SET NOT NULL;
          ALTER TABLE history     ALTER COLUMN year SET NOT NULL;

          -- metric_no alone used to be the primary key; the pair is what is
          -- unique now, so one metric holds a row per academic year.
          IF (SELECT cardinality(conkey) FROM pg_constraint
               WHERE conrelid = 'entries'::regclass AND contype = 'p') = 1 THEN
            ALTER TABLE entries DROP CONSTRAINT entries_pkey;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_constraint
                          WHERE conrelid = 'entries'::regclass AND contype = 'p') THEN
            ALTER TABLE entries ADD CONSTRAINT entries_pkey PRIMARY KEY (year, metric_no);
          END IF;

          CREATE INDEX IF NOT EXISTS attachments_year_metric_idx
            ON attachments (year, metric_no);
          CREATE INDEX IF NOT EXISTS history_year_metric_idx
            ON history (year, metric_no, changed_at DESC);
        END $$`;
    })().catch(err => { ready = null; throw err; });
  }
  return ready;
}

export function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (Array.isArray(fwd) ? fwd[0] : (fwd || '')).split(',')[0].trim() || 'unknown';
}
