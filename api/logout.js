import { clearCookie } from './_auth.js';

export default function handler(req, res) {
  clearCookie(res);
  res.json({ ok: true });
}
