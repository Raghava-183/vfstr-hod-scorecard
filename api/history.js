import { sql, ensureSchema } from './_db.js';
import { requireSession } from './_auth.js';

export default async function handler(req, res) {
  if (!requireSession(req, res)) return;
  await ensureSchema();
  const no = parseInt(req.query.metricNo, 10);
  const rows = Number.isInteger(no)
    ? await sql`SELECT metric_no, field, old_value, new_value, changed_by, changed_at
                FROM history WHERE metric_no = ${no} ORDER BY changed_at DESC LIMIT 50`
    : await sql`SELECT metric_no, field, old_value, new_value, changed_by, changed_at
                FROM history ORDER BY changed_at DESC LIMIT 200`;
  res.setHeader('Cache-Control', 'no-store');
  res.json({ history: rows });
}
