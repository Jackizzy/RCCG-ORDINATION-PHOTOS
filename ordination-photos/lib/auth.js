const crypto = require('crypto');
const { appSecret } = require('../db');

function hmac(payload) {
  return crypto.createHmac('sha256', appSecret()).update(payload).digest('base64url');
}

// Signed, expiring tokens: sign(['dl', orderRef, photoId], ttl) -> { exp, sig }
function sign(parts, ttlMs) {
  const exp = Date.now() + ttlMs;
  return { exp, sig: hmac(parts.join('|') + '|' + exp) };
}

function verify(parts, exp, sig) {
  try {
    if (!exp || !sig || Date.now() > Number(exp)) return false;
    const expected = hmac(parts.join('|') + '|' + exp);
    const a = Buffer.from(expected);
    const b = Buffer.from(String(sig));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function adminPassword() {
  return process.env.ADMIN_PASSWORD || 'admin123';
}
function isDefaultPassword() {
  return !process.env.ADMIN_PASSWORD;
}

function makeAdminCookie(secure) {
  const { exp, sig } = sign(['admin'], 12 * 3600 * 1000);
  return `adm=${exp}.${sig}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${12 * 3600}${secure ? '; Secure' : ''}`;
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) {
      try { out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch { /* malformed cookie — ignore */ }
    }
  });
  return out;
}

function isAdmin(req) {
  const c = parseCookies(req).adm;
  if (!c) return false;
  const dot = c.indexOf('.');
  if (dot < 1) return false;
  return verify(['admin'], c.slice(0, dot), c.slice(dot + 1));
}

function adminOnly(req, res, next) {
  if (isAdmin(req)) return next();
  res.status(401).json({ error: 'Not signed in' });
}

// Basic login rate limit: 10 attempts / 15 min per IP
const attempts = new Map();
function loginAllowed(ip) {
  const now = Date.now();
  if (attempts.size > 5000) {
    for (const [k, v] of attempts) if (now > v.reset) attempts.delete(k);
  }
  let rec = attempts.get(ip);
  if (!rec || now > rec.reset) rec = { count: 0, reset: now + 15 * 60 * 1000 };
  rec.count++;
  attempts.set(ip, rec);
  return rec.count <= 10;
}

module.exports = { sign, verify, adminPassword, isDefaultPassword, makeAdminCookie, adminOnly, loginAllowed };
