import crypto from 'node:crypto';

const COOKIE = 'vfstr_sc';
const MAX_AGE = 60 * 60 * 12; // 12 hours

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET is not set');
  return s;
}

const b64 = s => Buffer.from(s, 'utf8').toString('base64url');
const unb64 = s => Buffer.from(s, 'base64url').toString('utf8');

function sign(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

/** Timing-safe string comparison. */
export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) {
    // still burn a comparison so length isn't leaked by timing
    crypto.timingSafeEqual(ba, ba);
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

export function issueCookie(res, name) {
  const body = b64(JSON.stringify({ name, iat: Date.now() }));
  const token = `${body}.${sign(body)}`;
  const parts = [
    `${COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${MAX_AGE}`,
  ];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/** Returns { name } for a valid session, or null. */
export function readSession(req) {
  const raw = req.headers.cookie || '';
  const hit = raw.split(';').map(c => c.trim()).find(c => c.startsWith(COOKIE + '='));
  if (!hit) return null;
  const token = hit.slice(COOKIE.length + 1);
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  if (!safeEqual(mac, sign(body))) return null;
  try {
    const { name, iat } = JSON.parse(unb64(body));
    if (!name || Date.now() - iat > MAX_AGE * 1000) return null;
    return { name };
  } catch {
    return null;
  }
}

/** Guard for protected routes. Responds 401 and returns null when unauthenticated. */
export function requireSession(req, res) {
  const s = readSession(req);
  if (!s) {
    res.status(401).json({ error: 'Not signed in' });
    return null;
  }
  return s;
}
