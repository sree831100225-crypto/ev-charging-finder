/**
 * Authenticated station API. Data is only served to a request carrying a valid
 * session token issued by verify-otp, so the dataset is not downloadable
 * without logging in.
 */
const { verify } = require('./lib/auth');
const data = require('./data/stations.json');

const json = (statusCode, obj) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(obj),
});

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

exports.handler = async (event) => {
  const h = event.headers || {};
  const auth = h.authorization || h.Authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const session = verify(token);
  if (!session) return json(401, { error: 'Not authenticated. Please log in.' });

  const q = event.queryStringParameters || {};
  let out = data.stations;

  // free-text: station name, operator, town, state, pincode
  if (q.text) {
    const t = q.text.trim().toLowerCase();
    if (t) {
      out = out.filter((s) =>
        [s.nm, s.op, s.tw, s.st, s.pin, s.ad]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(t))
      );
    }
  }

  if (q.pin) out = out.filter((s) => (s.pin || '').startsWith(q.pin));
  if (q.state) out = out.filter((s) => (s.st || '').toLowerCase() === q.state.toLowerCase());
  if (q.connector) {
    const c = q.connector.toLowerCase();
    out = out.filter((s) => (s.ct || '').toLowerCase().includes(c));
  }
  if (q.fast === '1') out = out.filter((s) => s.fc === 1);
  if (q.payment === 'pay') out = out.filter((s) => s.py === 1);
  else if (q.payment === 'membership') out = out.filter((s) => s.mb === 1);
  else if (q.payment === 'public') out = out.filter((s) => (s.us || '').startsWith('Public'));
  else if (q.payment === 'private')
    out = out.filter((s) => /^Priv/i.test(s.us || ''));

  // proximity
  const lat = parseFloat(q.lat);
  const lon = parseFloat(q.lon);
  const near = isFinite(lat) && isFinite(lon);
  if (near) {
    const radius = parseFloat(q.radius) || 25;
    out = out
      .map((s) => Object.assign({}, s, { d: Math.round(haversineKm(lat, lon, s.la, s.lo) * 10) / 10 }))
      .filter((s) => s.d <= radius)
      .sort((x, y) => x.d - y.d);
  } else if (!q.text && !q.pin && !q.state) {
    out = out.slice().sort((a, b) => (a.st || '').localeCompare(b.st || '') || (a.nm || '').localeCompare(b.nm || ''));
  }

  const limit = Math.min(parseInt(q.limit, 10) || 10000, 10000);
  const total = out.length;
  out = out.slice(0, limit);

  return json(200, {
    count: out.length,
    total,
    truncated: total > out.length,
    source: data.source,
    generated: data.generated,
    stations: out,
  });
};
