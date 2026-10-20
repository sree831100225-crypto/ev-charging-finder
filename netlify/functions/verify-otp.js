const crypto = require('crypto');
const { sign, verify, codeHash, normalizeMobile } = require('./lib/auth');
const { recordLogin } = require('./lib/users');

const json = (statusCode, obj) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(obj),
});

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Malformed request' });
  }

  const mobile = normalizeMobile(body.mobile);
  const code = String(body.code || '').replace(/\D/g, '');
  if (!mobile) return json(400, { error: 'Invalid mobile number' });
  if (code.length !== 6) return json(400, { error: 'Enter the 6-digit code' });

  const otp = verify(body.otpToken);
  if (!otp || otp.m !== mobile) {
    return json(400, { error: 'This code has expired. Please request a new one.' });
  }

  const a = Buffer.from(codeHash(mobile, code));
  const b = Buffer.from(otp.h || '');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return json(401, { error: 'Incorrect code' });
  }

  // Record the sign-in. The number is the store key, so repeat logins update
  // one record rather than duplicating. A storage failure must never block login.
  let firstTime = null;
  try {
    const rec = await recordLogin(mobile);
    firstTime = rec.first_time === true;
  } catch (e) {
    /* best effort */
  }

  const sessionToken = sign({ m: mobile, exp: Date.now() + 12 * 60 * 60 * 1000 });
  return json(200, { ok: true, sessionToken, mobile, expiresIn: 12 * 60 * 60, first_time: firstTime });
};
