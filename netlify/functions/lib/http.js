/**
 * Minimal outbound HTTP helper built on Node's native `https` module.
 * Avoids depending on the global fetch/undici implementation.
 */
const https = require('https');
const { URL } = require('url');

function request(method, urlStr, options) {
  options = options || {};
  const headers = options.headers || {};
  const body = options.body || null;
  const timeout = options.timeout || 12000;

  return new Promise(function (resolve, reject) {
    const u = new URL(urlStr);
    const req = https.request(
      {
        method: method,
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        headers: headers,
      },
      function (res) {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', function (c) { data += c; });
        res.on('end', function () { resolve({ status: res.statusCode, body: data }); });
      }
    );
    req.on('error', reject);
    req.setTimeout(timeout, function () { req.destroy(new Error('request timed out')); });
    if (body) req.write(body);
    req.end();
  });
}

async function getJson(url, headers) {
  const r = await request('GET', url, { headers: headers });
  if (r.status < 200 || r.status >= 300) throw new Error('HTTP ' + r.status);
  return JSON.parse(r.body);
}

module.exports = { request, getJson };
