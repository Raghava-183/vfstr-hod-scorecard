/**
 * Seeds the database with the workbook's original responses so the
 * department database, not the JSON file, is the source of truth.
 * Existing rows are left untouched. Run once after deploying:
 *   DATABASE_URL="postgres://..." npm run seed
 */
import { readFile } from 'node:fs/promises';
import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
if (!url) { console.error('Set DATABASE_URL first.'); process.exit(1); }
const sql = neon(url);

const data = JSON.parse(await readFile(new URL('../data/metrics.json', import.meta.url), 'utf8'));
const rows = data.sections.flatMap(s => s.rows);

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

let added = 0;
for (const r of rows) {
  const res = await sql`
    INSERT INTO entries (metric_no, response, updated_by)
    VALUES (${r.no}, ${r.response ?? ''}, 'workbook import')
    ON CONFLICT (metric_no) DO NOTHING
    RETURNING metric_no`;
  if (res.length) added++;
}
console.log(`Seeded ${added} of ${rows.length} metrics (${rows.length - added} already present).`);
