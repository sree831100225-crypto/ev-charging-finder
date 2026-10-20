/* Local end-to-end test of the Netlify functions (no server needed). */
process.env.APP_SECRET = 'test-secret-not-for-production';
process.env.SMS_PROVIDER = 'dev';

const requestOtp = require('./netlify/functions/request-otp.js').handler;
const verifyOtp = require('./netlify/functions/verify-otp.js').handler;
const stations = require('./netlify/functions/stations.js').handler;
const geocode = require('./netlify/functions/geocode.js').handler;

function ev(method, o) {
  o = o || {};
  return {
    httpMethod: method,
    headers: Object.assign({ 'x-nf-client-connection-ip': '127.0.0.1' }, o.headers || {}),
    queryStringParameters: o.query || {},
    body: o.body ? JSON.stringify(o.body) : null,
  };
}
const P = (r) => ({ status: r.statusCode, body: JSON.parse(r.body) });
let pass = 0, fail = 0;
function check(label, cond, extra) {
  (cond ? pass++ : fail++);
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (extra !== undefined ? '  -> ' + extra : ''));
}

(async () => {
  let r = P(await requestOtp(ev('POST', { body: { mobile: '9876543210' } })));
  check('request-otp returns 200 + dev code', r.status === 200 && !!r.body.dev_code, 'code=' + r.body.dev_code);
  const code = r.body.dev_code, otpToken = r.body.otpToken;

  r = P(await requestOtp(ev('POST', { body: { mobile: '12345' } })));
  check('invalid mobile rejected', r.status === 400, r.body.error);

  r = P(await requestOtp(ev('POST', { body: { mobile: '+91 98765-43210' } })));
  check('mobile normalisation (+91, spaces, dash)', r.status === 200);

  r = P(await verifyOtp(ev('POST', { body: { mobile: '9876543210', code: '000000', otpToken } })));
  check('wrong code rejected', r.status === 401, r.body.error);

  r = P(await verifyOtp(ev('POST', { body: { mobile: '9876543211', code, otpToken } })));
  check('code bound to its own number', r.status === 400, r.body.error);

  r = P(await verifyOtp(ev('POST', { body: { mobile: '9876543210', code, otpToken } })));
  check('correct code issues session', r.status === 200 && !!r.body.sessionToken);
  const token = r.body.sessionToken;

  r = P(await stations(ev('GET', {})));
  check('stations blocked without token', r.status === 401, r.body.error);

  r = P(await stations(ev('GET', { headers: { authorization: 'Bearer ' + token.slice(0, -3) + 'aaa' } })));
  check('tampered token rejected', r.status === 401);

  r = P(await stations(ev('GET', { headers: { authorization: 'Bearer ' + token } })));
  check('all stations with token', r.status === 200 && r.body.count > 1800, r.body.count + ' of ' + r.body.total);

  r = P(await stations(ev('GET', { headers: { authorization: 'Bearer ' + token }, query: { lat: '9.9312', lon: '76.2673', radius: '25' } })));
  check('proximity search near Kochi', r.status === 200 && r.body.count > 0,
    r.body.count + ' found; nearest: ' + (r.body.stations[0] && r.body.stations[0].nm) + ' @ ' + (r.body.stations[0] && r.body.stations[0].d) + 'km');

  r = P(await stations(ev('GET', { headers: { authorization: 'Bearer ' + token }, query: { text: 'Statiq' } })));
  check('text search (operator)', r.status === 200 && r.body.count > 0, r.body.count + ' results');

  r = P(await stations(ev('GET', { headers: { authorization: 'Bearer ' + token }, query: { pin: '560066' } })));
  check('pincode search', r.status === 200, r.body.count + ' results');

  r = P(await stations(ev('GET', { headers: { authorization: 'Bearer ' + token }, query: { fast: '1', payment: 'pay' } })));
  check('filter fast + pay-at-location', r.status === 200, r.body.count + ' results');

  r = P(await stations(ev('GET', { headers: { authorization: 'Bearer ' + token }, query: { connector: 'CCS (Type 2)' } })));
  check('filter by connector', r.status === 200, r.body.count + ' results');

  try {
    r = P(await geocode(ev('GET', { query: { q: 'Kochi' } })));
    check('geocode reachable', r.status === 200 && r.body.results.length > 0,
      r.body.results && r.body.results[0] ? r.body.results[0].name.slice(0, 60) + ' (' + r.body.results[0].lat + ',' + r.body.results[0].lon + ')' : r.body.error);
  } catch (e) {
    check('geocode reachable', false, 'threw ' + e.message);
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
