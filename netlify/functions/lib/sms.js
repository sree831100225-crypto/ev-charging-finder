/**
 * SMS delivery abstraction.
 *
 * Set SMS_PROVIDER to one of: twilio | msg91 | fast2sms  (plus the matching
 * credentials below). With no provider configured the app runs in "dev mode":
 * no SMS is sent and the API returns the code in the response so the flow is
 * testable. Dev mode is a convenience only - it is not secure.
 *
 *   twilio    TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM
 *   msg91     MSG91_AUTH_KEY, MSG91_TEMPLATE_ID
 *   fast2sms  FAST2SMS_API_KEY
 */
const { request } = require('./http');

async function sendSms(mobile, message) {
  const provider = (process.env.SMS_PROVIDER || 'dev').toLowerCase();
  const e164 = '+91' + mobile;

  if (provider === 'twilio') {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const tok = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_FROM;
    if (!sid || !tok || !from) throw new Error('Twilio credentials are not configured');
    const form = new URLSearchParams({ To: e164, From: from, Body: message }).toString();
    const res = await request('POST', `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      headers: {
        Authorization: 'Basic ' + Buffer.from(sid + ':' + tok).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(form),
      },
      body: form,
    });
    if (res.status < 200 || res.status >= 300) throw new Error('Twilio rejected the request (' + res.status + ')');
    return { provider: 'twilio', sent: true };
  }

  if (provider === 'fast2sms') {
    const key = process.env.FAST2SMS_API_KEY;
    if (!key) throw new Error('FAST2SMS_API_KEY is not configured');
    const body = JSON.stringify({ route: 'q', message: message, numbers: mobile });
    const res = await request('POST', 'https://www.fast2sms.com/dev/bulkV2', {
      headers: { authorization: key, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      body: body,
    });
    if (res.status < 200 || res.status >= 300) throw new Error('Fast2SMS rejected the request (' + res.status + ')');
    return { provider: 'fast2sms', sent: true };
  }

  if (provider === 'msg91') {
    const key = process.env.MSG91_AUTH_KEY;
    const tpl = process.env.MSG91_TEMPLATE_ID;
    if (!key || !tpl) throw new Error('MSG91 credentials are not configured');
    const body = JSON.stringify({
      template_id: tpl,
      short_url: '0',
      recipients: [{ mobiles: '91' + mobile, VAR1: message }],
    });
    const res = await request('POST', 'https://control.msg91.com/api/v5/flow/', {
      headers: { authkey: key, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      body: body,
    });
    if (res.status < 200 || res.status >= 300) throw new Error('MSG91 rejected the request (' + res.status + ')');
    return { provider: 'msg91', sent: true };
  }

  return { provider: 'dev', sent: false };
}

module.exports = { sendSms };
