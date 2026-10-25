import { sql, ensureSchema } from './_db.js';
import { requireSession } from './_auth.js';
import { validYear } from './_years.js';

const FIELDS = [
  ['response', 'response'],
  ['faculty', 'faculty'],
  ['comment', 'comment'],
  ['justification', 'justification'],
  ['proof', 'proof'],
  ['actionPlan', 'action_plan'],
];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const session = requireSession(req, res);
  if (!session) return;
  await ensureSchema();

  const body = req.body || {};
  const no = parseInt(body.metricNo, 10);
  if (!Number.isInteger(no) || no < 1 || no > 500) {
    return res.status(400).json({ error: 'Invalid metric number' });
  }
  const year = validYear(body.year);
  if (!year) return res.status(400).json({ error: 'Unknown academic year' });

  const next = {};
  for (const [key] of FIELDS) next[key] = String(body[key] ?? '').slice(0, 20000);

  const [current] = await sql`
    SELECT * FROM entries WHERE year = ${year} AND metric_no = ${no}`;

  // Someone else saved this metric since the page loaded it.
  if (!body.force && current && body.baseUpdatedAt) {
    const seen = new Date(body.baseUpdatedAt).getTime();
    const have = new Date(current.updated_at).getTime();
    if (have > seen + 500) {
      return res.status(409).json({
        error: 'conflict',
        theirs: {
          response: current.response,
          faculty: current.faculty,
          comment: current.comment,
          justification: current.justification,
          proof: current.proof,
          actionPlan: current.action_plan,
          updatedBy: current.updated_by,
          updatedAt: current.updated_at,
        },
      });
    }
  }

  const [saved] = await sql`
    INSERT INTO entries (year, metric_no, response, faculty, comment, justification, proof, action_plan, updated_by, updated_at)
    VALUES (${year}, ${no}, ${next.response}, ${next.faculty}, ${next.comment}, ${next.justification},
            ${next.proof}, ${next.actionPlan}, ${session.name}, now())
    ON CONFLICT (year, metric_no) DO UPDATE SET
      response = EXCLUDED.response, faculty = EXCLUDED.faculty, comment = EXCLUDED.comment,
      justification = EXCLUDED.justification, proof = EXCLUDED.proof,
      action_plan = EXCLUDED.action_plan,
      updated_by = EXCLUDED.updated_by, updated_at = now()
    RETURNING updated_by, updated_at`;

  // Record only the fields that actually moved, so the log stays readable.
  for (const [key, col] of FIELDS) {
    const before = current ? String(current[col] ?? '') : '';
    if (before !== next[key]) {
      await sql`
        INSERT INTO history (year, metric_no, field, old_value, new_value, changed_by)
        VALUES (${year}, ${no}, ${key}, ${before.slice(0, 4000)}, ${next[key].slice(0, 4000)}, ${session.name})`;
    }
  }

  res.json({ ok: true, year, updatedBy: saved.updated_by, updatedAt: saved.updated_at });
}
