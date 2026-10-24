import { sql, ensureSchema } from './_db.js';
import { requireSession } from './_auth.js';
import { validYear, DEFAULT_YEAR } from './_years.js';

export default async function handler(req, res) {
  try {
    return await state(req, res);
  } catch (err) {
    console.error('state failed:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Server error: ' + (err && err.message ? err.message : String(err)) });
    }
  }
}

async function state(req, res) {
  if (!requireSession(req, res)) return;
  await ensureSchema();

  const year = validYear(req.query.year) || DEFAULT_YEAR;

  const [entries, files, counts] = await Promise.all([
    sql`SELECT metric_no, response, comment, justification, proof, action_plan,
               updated_by, updated_at
        FROM entries WHERE year = ${year} ORDER BY metric_no`,
    sql`SELECT id, metric_no, url, filename, bytes, uploaded_by, uploaded_at
        FROM attachments WHERE year = ${year} ORDER BY metric_no, uploaded_at`,
    // one number per year, so every tab can show its progress
    sql`SELECT year, COUNT(*) FILTER (WHERE response <> '') AS answered
        FROM entries GROUP BY year`,
  ]);
  const byYear = {};
  for (const c of counts) byYear[c.year] = Number(c.answered);

  const byMetric = {};
  for (const e of entries) {
    byMetric[e.metric_no] = {
      response: e.response,
      comment: e.comment,
      justification: e.justification,
      proof: e.proof,
      actionPlan: e.action_plan,
      updatedBy: e.updated_by,
      updatedAt: e.updated_at,
      files: [],
    };
  }
  for (const f of files) {
    (byMetric[f.metric_no] ||= { files: [] }).files ||= [];
    byMetric[f.metric_no].files.push({
      id: f.id, url: f.url, filename: f.filename,
      bytes: Number(f.bytes), uploadedBy: f.uploaded_by, uploadedAt: f.uploaded_at,
    });
  }

  res.setHeader('Cache-Control', 'no-store');
  res.json({ year, entries: byMetric, counts: byYear, serverTime: new Date().toISOString() });
}
