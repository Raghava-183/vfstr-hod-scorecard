import crypto from 'node:crypto';
import { sql, ensureSchema, clientIp } from './_db.js';
import { issueCookie, safeEqual } from './_auth.js';

const MAX_FAILS = 8;
const WINDOW_MIN = 15;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const expected = process.env.DEPT_PASSWORD;
  if (!expected) return res.status(500).json({ error: 'DEPT_PASSWORD is not configured' });
  const expectedUser = process.env.DEPT_USERNAME || '213';

  const { username = '', password = '', name = '' } = req.body || {};
  const user = String(username).trim();
  // Name is recorded against every save. Falls back to the username if left blank.
  const person = String(name).trim().slice(0, 80) || user;

  await ensureSchema();
  const ip = clientIp(req);

  const [row] = await sql`
    SELECT fails, last_try FROM login_attempts WHERE ip = ${ip}`;
  if (row && row.fails >= MAX_FAILS &&
      Date.now() - new Date(row.last_try).getTime() < WINDOW_MIN * 60000) {
    return res.status(429).json({ error: `Too many attempts. Try again in ${WINDOW_MIN} minutes.` });
  }

  // Hash both sides so the comparison is fixed-length regardless of input.
  const h = v => crypto.createHash('sha256').update(String(v)).digest('hex');
  const okUser = safeEqual(h(user), h(expectedUser));
  const okPass = safeEqual(h(password), h(expected));
  if (!okUser || !okPass) {
    await sql`
      INSERT INTO login_attempts (ip, fails, last_try) VALUES (${ip}, 1, now())
      ON CONFLICT (ip) DO UPDATE SET
        fails = CASE WHEN now() - login_attempts.last_try > make_interval(mins => ${WINDOW_MIN})
                     THEN 1 ELSE login_attempts.fails + 1 END,
        last_try = now()`;
    await new Promise(r => setTimeout(r, 600));
    return res.status(401).json({ error: 'Incorrect username or password.' });
  }

  await sql`DELETE FROM login_attempts WHERE ip = ${ip}`;
  issueCookie(res, person);
  res.json({ ok: true, name: person });
}
