/* Tests for the login registry: deduplication, counts, modes.
   Runs against the in-memory fallback (Netlify Blobs is not available locally). */
process.env.APP_SECRET = 'test-secret';
process.env.USER_HASH_SALT = 'test-salt';

const users = require('./netlify/functions/lib/users.js');
const verifyOtp = require('./netlify/functions/verify-otp.js').handler;
const requestOtp = require('./netlify/functions/request-otp.js').handler;
const adminUsers = require('./netlify/functions/admin-users.js').handler;

let pass = 0, fail = 0;
const check = (l, c, x) => { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l + (x !== undefined ? '  -> ' + x : '')); };
const P = (r) => ({ status: r.statusCode, body: JSON.parse(r.body) });
const ev = (o) => ({ httpMethod: 'GET', headers: o.headers || {}, queryStringParameters: o.query || {}, body: null });

(async () => {
  users._reset();
  const a = await users.recordLogin('9876543210');
  const b = await users.recordLogin('9876543210');
  const c = await users.recordLogin('9876543210');
  check('same number is recorded once (dedup)', (await users.listUsers()).length === 1);
  check('repeat logins increment the counter', (await users.stats()).total_logins === 3, (await users.stats()).total_logins);
  check('first login flagged, later ones not', a.first_time === true && b.first_time === false && c.first_time === false);
  check('same number always maps to the same key', users.keyFor('9876543210') === users.keyFor('9876543210'));

  await users.recordLogin('9812345678');
  await users.recordLogin('9700000001');
  let s = await users.stats();
  check('distinct numbers are distinct users', s.unique_users === 3, s.unique_users);
  check('repeat_users counted', s.repeat_users === 1, s.repeat_users);

  const k1 = users.keyFor('9876543210');
  const k2 = users.keyFor('9812345678');
  check('keys differ per number', k1 !== k2);
  check('key is not the number itself', !k1.includes('9876543210'));

  // ---- end-to-end through the real verify-otp handler
  users._reset();
  const otp = P(await requestOtp({ httpMethod: 'POST', headers: { 'x-nf-client-connection-ip': '1.2.3.4' }, queryStringParameters: {}, body: JSON.stringify({ mobile: '9000000001' }) }));
  const v1 = P(await verifyOtp({ httpMethod: 'POST', headers: {}, queryStringParameters: {}, body: JSON.stringify({ mobile: '9000000001', code: otp.body.dev_code, otpToken: otp.body.otpToken }) }));
  check('verify-otp records the login', (await users.stats()).unique_users === 1, (await users.stats()).unique_users);
  check('first_time true on a new user', v1.body.first_time === true);

  const otp2 = P(await requestOtp({ httpMethod: 'POST', headers: { 'x-nf-client-connection-ip': '1.2.3.4' }, queryStringParameters: {}, body: JSON.stringify({ mobile: '9000000001' }) }));
  const v2 = P(await verifyOtp({ httpMethod: 'POST', headers: {}, queryStringParameters: {}, body: JSON.stringify({ mobile: '9000000001', code: otp2.body.dev_code, otpToken: otp2.body.otpToken }) }));
  s = await users.stats();
  check('second login does not create a second user', s.unique_users === 1 && s.total_logins === 2, s.unique_users + ' users / ' + s.total_logins + ' logins');
  check('first_time false on a returning user', v2.body.first_time === false);

  // ---- erasure
  const before = (await users.stats()).unique_users;
  const er = await users.eraseUser('9000000001');
  const after = (await users.stats()).unique_users;
  check('erase removes the number from the registry', er.erased === true && after === before - 1, before + ' -> ' + after);
  check('erasing an unknown number is harmless', (await users.eraseUser('9111111111')).erased === true);

  await users.recordLogin('9000000001');   // restore for the admin checks below

  // ---- admin endpoint
  process.env.ADMIN_TOKEN = 'admin-secret-xyz';
  let r = P(await adminUsers(ev({})));
  check('admin endpoint rejects a missing token', r.status === 401, r.body.error);
  r = P(await adminUsers(ev({ headers: { 'x-admin-token': 'wrong' } })));
  check('admin endpoint rejects a wrong token', r.status === 401);
  r = P(await adminUsers(ev({ headers: { 'x-admin-token': 'admin-secret-xyz' } })));
  check('admin endpoint returns the registry', r.status === 200 && r.body.unique_users === 1 && Array.isArray(r.body.users), r.body.unique_users + ' unique');
  check('admin payload includes the number', r.body.users[0].mobile === '9000000001', r.body.users[0].mobile);
  delete process.env.ADMIN_TOKEN;
  r = P(await adminUsers(ev({ headers: { 'x-admin-token': 'admin-secret-xyz' } })));
  check('admin endpoint disabled when ADMIN_TOKEN unset', r.status === 503, r.body.error);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
