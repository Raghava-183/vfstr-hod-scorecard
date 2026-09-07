import { sql, ensureSchema } from './_db.js';
import { requireSession } from './_auth.js';

export default async function handler(req, res) {
  if (!requireSession(req, res)) return;
  await ensureSchema();

  const [entries, files] = await Promise.all([
    sql`SELECT metric_no, response, comment, justification, proof, action_plan,
               updated_by, updated_at
        FROM entries ORDER BY metric_no`,
    sql`SELECT id, metric_no, url, filename, bytes, uploaded_by, uploaded_at
        FROM attachments ORDER BY metric_no, uploaded_at`,
  ]);

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
  res.json({ entries: byMetric, serverTime: new Date().toISOString() });
}
