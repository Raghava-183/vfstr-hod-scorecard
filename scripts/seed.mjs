/**
 * Seeds the database with the workbook's original responses so the
 * department database, not the JSON file, is the source of truth.
 * Only seeds years marked seeded:true in metrics.json — 2026-27 is meant
 * to start empty. Existing rows are left untouched. Run once after deploying:
 *   DATABASE_URL="postgres://..." npm run seed
 */
import { readFile } from 'node:fs/promises';
import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
if (!url) { console.error('Set DATABASE_URL first.'); process.exit(1); }
const sql = neon(url);

const data = JSON.parse(await readFile(new URL('../data/metrics.json', import.meta.url), 'utf8'));
const rows = data.sections.flatMap(s => s.rows);

const years = data.meta.years?.length
  ? data.meta.years
  : [{ id: data.meta.year, seeded: true }];

await sql`
  CREATE TABLE IF NOT EXISTS entries (
    year          TEXT NOT NULL DEFAULT '2025-26',
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

for (const y of years) {
  if (!y.seeded) {
    console.log(`${y.id}: left empty on purpose — faculty enter it through the site.`);
    continue;
  }
  let added = 0;
  for (const r of rows) {
    const res = await sql`
      INSERT INTO entries (year, metric_no, response, updated_by)
      VALUES (${y.id}, ${r.no}, ${r.response ?? ''}, 'workbook import')
      ON CONFLICT (year, metric_no) DO NOTHING
      RETURNING metric_no`;
    if (res.length) added++;
  }
  console.log(`${y.id}: seeded ${added} of ${rows.length} metrics (${rows.length - added} already present).`);
}
