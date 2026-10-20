/**
 * Tells the front-end whether a real backend is present.
 * The app probes /api/config at boot: a JSON reply switches it to "api" mode,
 * anything else (e.g. a 404 from a static host) leaves it in "static" mode.
 */
exports.handler = async () => ({
  statusCode: 200,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify({ mode: 'api', app: 'ev-charging-finder' }),
});
