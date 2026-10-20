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
const { listUsers, stats, selfTest } = require('./lib/users');

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

  if ((event.queryStringParameters || {}).selftest === '1') {
    const probe = await selfTest();
    return json(probe.ok ? 200 : 500, { selftest: probe });
  }

  const summary = await stats();
  const users = await listUsers();
  return json(200, Object.assign({ generated: new Date().toISOString() }, summary, { users }));
};
