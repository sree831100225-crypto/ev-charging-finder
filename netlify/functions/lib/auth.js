/**
 * Auth helpers: stateless HMAC-signed tokens.
 *
 * Because Netlify Functions are stateless, the one-time code is carried in a
 * short-lived signed token rather than server memory. The code itself is only
 * stored as an HMAC (keyed by a server secret), so a client holding the token
 * cannot read or offline-brute-force the code.
 */
const crypto = require('crypto');

const SECRET = process.env.APP_SECRET || 'dev-only-secret-please-set-APP_SECRET';

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return body + '.' + sig;
}

function verify(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const idx = token.lastIndexOf('.');
  const body = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload.exp || payload.exp < Date.now()) return null;
  return payload;
}

function codeHash(mobile, code) {
  return crypto.createHmac('sha256', SECRET).update(mobile + ':' + code).digest('base64url');
}

/** Accepts 9876543210, +91 98765 43210, 098765-43210 ... returns 10 digits or null. */
function normalizeMobile(raw) {
  if (!raw) return null;
  let s = String(raw).replace(/\D/g, '');
  if (s.length > 10 && s.startsWith('91')) s = s.slice(-10);
  if (s.length === 11 && s.startsWith('0')) s = s.slice(1);
  return /^[6-9]\d{9}$/.test(s) ? s : null;
}

module.exports = { sign, verify, codeHash, normalizeMobile };
