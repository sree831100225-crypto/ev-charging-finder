/* Verifies the geocode function's parsing against a real Nominatim payload
   (captured with curl, since Node's outbound network is blocked in this
   sandbox). The http module is stubbed so no network is required. */
const httpPath = require.resolve('./netlify/functions/lib/http');
const sample = require('./nominatim_sample.json');

require.cache[httpPath] = {
  id: httpPath,
  filename: httpPath,
  loaded: true,
  exports: {
    getJson: async () => sample,
    request: async () => ({ status: 200, body: '[]' }),
  },
};

const geo = require('./netlify/functions/geocode.js').handler;
let pass = 0, fail = 0;
const check = (l, c, x) => { (c ? pass++ : fail++); console.log((c ? '  PASS  ' : '  FAIL  ') + l + (x !== undefined ? '  -> ' + x : '')); };

(async () => {
  let r = await geo({ httpMethod: 'GET', headers: {}, queryStringParameters: { q: 'Kochi' } });
  let b = JSON.parse(r.body);
  check('geocode maps results', r.statusCode === 200 && b.results.length === 3, b.results.length + ' results');
  check('lat/lon are numbers', typeof b.results[0].lat === 'number' && typeof b.results[0].lon === 'number',
    b.results[0].lat + ',' + b.results[0].lon);
  check('display_name preserved', /Kochi/.test(b.results[0].name), b.results[0].name.slice(0, 50));

  r = await geo({ httpMethod: 'GET', headers: {}, queryStringParameters: { q: 'KOCHI' } });
  check('cache hit (case-insensitive)', r.statusCode === 200);

  r = await geo({ httpMethod: 'GET', headers: {}, queryStringParameters: { q: 'ab' } });
  check('short query rejected', r.statusCode === 400, JSON.parse(r.body).error);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
