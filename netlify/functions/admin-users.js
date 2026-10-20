/**
 * Admin view of the login registry.
 *
 *   GET /api/admin-users            -> unique/total counts + the user list
 *   header  x-admin-token: <ADMIN_TOKEN>
 *
 * Requires the ADMIN_TOKEN environment variable. Without it the endpoint
 * refuses to serve anything, so a misconfigured deploy cannot leak the list.
 */
const crypto = require('crypto');
const { listUsers, stats, selfTest, initFromEvent, recordLogin, eraseUser } = require('./lib/users');

const json = (statusCode, obj) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(obj),
});

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

exports.handler = async (event) => {
  initFromEvent(event);
  const configured = process.env.ADMIN_TOKEN;
  if (!configured) {
    return json(503, { error: 'ADMIN_TOKEN is not set on this site, so this endpoint is disabled.' });
  }

  const h = event.headers || {};
  const provided = h['x-admin-token'] || h['X-Admin-Token'] ||
    (event.queryStringParameters || {}).token || '';
  if (!safeEqual(provided, configured)) {
    return json(401, { error: 'Unauthorized' });
  }

  const q = event.queryStringParameters || {};

  if (q.selftest === '1') {
    const probe = await selfTest();
    return json(probe.ok ? 200 : 500, { selftest: probe });
  }

  // Exercise the real capture path with a chosen number (ops check).
  if (q.simulate) {
    if (!/^[6-9]\d{9}$/.test(String(q.simulate))) return json(400, { error: 'simulate needs a 10-digit mobile' });
    const rec = await recordLogin(String(q.simulate));
    return json(200, { simulate: rec, mobile: q.simulate, after: await stats() });
  }

  // Erase one number (data-erasure request, or tidy up a test entry).
  if (q.erase) {
    const res = await eraseUser(String(q.erase));
    return json(200, { erase: res, mobile: q.erase, after: await stats() });
  }

  const summary = await stats();
  const users = await listUsers();
  return json(200, Object.assign({ generated: new Date().toISOString() }, summary, { users }));
};
