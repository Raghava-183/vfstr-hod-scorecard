import crypto from 'node:crypto';
import { sql, ensureSchema } from './_db.js';
import { requireSession } from './_auth.js';

export default async function handler(req, res) {
  const session = requireSession(req, res);
  if (!session) return;
  await ensureSchema();

  if (req.method === 'POST') {
    const b = req.body || {};
    const no = parseInt(b.metricNo, 10);
    if (!Number.isInteger(no)) return res.status(400).json({ error: 'Invalid metric number' });
    if (!b.url || !b.publicId) return res.status(400).json({ error: 'Missing upload details' });

    const [row] = await sql`
      INSERT INTO attachments (metric_no, url, public_id, resource_type, filename, bytes, uploaded_by)
      VALUES (${no}, ${String(b.url)}, ${String(b.publicId)},
              ${String(b.resourceType || 'auto')}, ${String(b.filename || '').slice(0, 200)},
              ${Number(b.bytes) || 0}, ${session.name})
      RETURNING id, metric_no, url, filename, bytes, uploaded_by, uploaded_at`;
    await sql`
      INSERT INTO history (metric_no, field, old_value, new_value, changed_by)
      VALUES (${no}, 'attachment', '', ${String(b.filename || b.url)}, ${session.name})`;
    return res.json({
      ok: true,
      file: { id: row.id, url: row.url, filename: row.filename,
              bytes: Number(row.bytes), uploadedBy: row.uploaded_by, uploadedAt: row.uploaded_at },
    });
  }

  if (req.method === 'DELETE') {
    const id = parseInt(req.query.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });

    const [row] = await sql`SELECT * FROM attachments WHERE id = ${id}`;
    if (!row) return res.status(404).json({ error: 'Not found' });

    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    if (cloudName && apiKey && apiSecret) {
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = crypto.createHash('sha1')
        .update(`public_id=${row.public_id}&timestamp=${timestamp}${apiSecret}`).digest('hex');
      const type = row.resource_type === 'auto' ? 'image' : row.resource_type;
      const form = new URLSearchParams({
        public_id: row.public_id, timestamp: String(timestamp),
        api_key: apiKey, signature,
      });
      try {
        await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${type}/destroy`,
          { method: 'POST', body: form });
      } catch {
        // The database record is removed either way; an orphaned Cloudinary
        // file is tidied up from the Cloudinary console.
      }
    }

    await sql`DELETE FROM attachments WHERE id = ${id}`;
    await sql`
      INSERT INTO history (metric_no, field, old_value, new_value, changed_by)
      VALUES (${row.metric_no}, 'attachment', ${row.filename || row.url}, '', ${session.name})`;
    return res.json({ ok: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
}
