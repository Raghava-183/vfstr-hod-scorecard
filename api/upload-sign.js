import crypto from 'node:crypto';
import { requireSession } from './_auth.js';

/**
 * Returns a short-lived Cloudinary signature. The browser uploads the file
 * straight to Cloudinary, so the API secret never leaves the server and the
 * file never passes through a Vercel function (which caps request bodies).
 */
export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireSession(req, res)) return;

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    return res.status(500).json({ error: 'Cloudinary is not configured' });
  }

  const no = parseInt((req.body || {}).metricNo, 10);
  if (!Number.isInteger(no)) return res.status(400).json({ error: 'Invalid metric number' });

  const timestamp = Math.floor(Date.now() / 1000);
  const folder = `scorecard-2025-26/metric-${String(no).padStart(3, '0')}`;

  // Cloudinary signs the alphabetically sorted params, secret appended.
  const toSign = `folder=${folder}&timestamp=${timestamp}`;
  const signature = crypto.createHash('sha1').update(toSign + apiSecret).digest('hex');

  res.json({ cloudName, apiKey, timestamp, folder, signature });
}
