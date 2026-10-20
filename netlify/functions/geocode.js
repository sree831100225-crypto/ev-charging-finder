/**
 * Forward geocoding for arbitrary place names / addresses / pincodes, via
 * OpenStreetMap Nominatim. Proxied through the function so we can set a proper
 * User-Agent and cache repeats (Nominatim's usage policy asks for both).
 */
const { getJson } = require('./lib/http');

const cache = new Map();

const json = (statusCode, obj) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
  body: JSON.stringify(obj),
});

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  const query = (q.q || '').trim();
  if (query.length < 3) return json(400, { error: 'Enter at least 3 characters' });

  const key = query.toLowerCase();
  if (cache.has(key)) return json(200, cache.get(key));

  const url =
    'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=in&q=' +
    encodeURIComponent(query);

  try {
    const arr = await getJson(url, {
      'User-Agent':
        process.env.GEOCODE_UA ||
        'EV-Charging-Finder/1.0 (open-source; set GEOCODE_UA to your contact URL)',
      Accept: 'application/json',
    });
    const payload = {
      query: query,
      results: (arr || []).map(function (r) {
        return {
          name: r.display_name,
          lat: parseFloat(r.lat),
          lon: parseFloat(r.lon),
          type: r.type,
        };
      }),
    };
    if (cache.size > 1000) cache.clear();
    cache.set(key, payload);
    return json(200, payload);
  } catch (e) {
    return json(502, { error: 'Geocoding is unavailable right now', detail: String(e.message) });
  }
};
