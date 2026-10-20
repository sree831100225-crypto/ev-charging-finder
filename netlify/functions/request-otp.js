const crypto = require('crypto');
const { sign, codeHash, normalizeMobile } = require('./lib/auth');
const { sendSms } = require('./lib/sms');

// Best-effort per-IP throttle (per warm function instance only).
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > 8;
}

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
  if (!mobile) return json(400, { error: 'Enter a valid 10-digit Indian mobile number' });

  const h = event.headers || {};
  const ip = h['x-nf-client-connection-ip'] || h['client-ip'] || 'unknown';
  if (rateLimited(ip)) return json(429, { error: 'Too many requests. Please try again in a few minutes.' });

  const code = String(crypto.randomInt(100000, 1000000));
  const otpToken = sign({ m: mobile, h: codeHash(mobile, code), exp: Date.now() + 5 * 60 * 1000 });

  let sms;
  try {
    sms = await sendSms(
      mobile,
      `${code} is your verification code for the EV Charging Station Finder. It expires in 5 minutes.`
    );
  } catch (e) {
    return json(502, { error: 'Could not send the SMS: ' + e.message });
  }

  const out = { ok: true, otpToken, dev_mode: !sms.sent };
  if (!sms.sent) out.dev_code = code; // dev mode only - never sent in production
  return json(200, out);
};
