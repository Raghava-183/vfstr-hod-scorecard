import { readSession } from './_auth.js';

export default function handler(req, res) {
  const s = readSession(req);
  res.json({ signedIn: !!s, name: s ? s.name : null });
}
