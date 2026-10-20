# EV Charging Station Finder — India

A searchable web app for electric-vehicle charging stations across India, with
mobile-number OTP login. Visitors can find chargers by city, area, pincode or
station name, or by sharing their current location.

Live data source: [Open Charge Map](https://openchargemap.org) — 1,872 stations
across India (snapshot current to April 2026).

**Live:**

| Build | URL | Login |
|---|---|---|
| Netlify (api mode) | https://ev-charging-finder-ugbp.netlify.app | real OTP, dataset behind login |
| GitHub Pages (static mode) | https://sree831100225-crypto.github.io/ev-charging-finder/ | browser-generated code, dataset public |

## Two run modes, one codebase

The front-end probes `/api/config` at boot and picks a mode automatically:

| | **api** mode | **static** mode |
|---|---|---|
| Host | Netlify (static + Functions) | GitHub Pages |
| Login | Real 6-digit OTP by SMS | Code generated in the browser, shown on screen |
| Dataset | Served by `stations.js`, only to a logged-in session | `docs/data/stations.json`, public |
| Geocoding | Proxied through a Function | Called directly from the browser |

**Static mode is a gate, not security.** There is no server on a static host, so
anyone can read `data/stations.json` and the code is generated client-side. That
is acceptable here because Open Charge Map is open data — but if you need the
dataset genuinely protected, use api mode.

## Features

- **Mobile OTP login** — a visitor enters a 10-digit Indian mobile number and a
  6-digit code before the app opens.
- **Search** by free text (city, area, station name, operator) or by pincode.
- **Search by location** — place names are geocoded (OpenStreetMap Nominatim),
  or the visitor can share their current location.
- **Filters** — radius, connector type, fast-charging only, payment type.
- **Map + list** with distance, power (kW), connector types and payment category.

## Layout

```
docs/                       the front-end (GitHub Pages serves this folder)
  index.html  styles.css  app.js
  data/stations.json        dataset for static mode
netlify/functions/
  config.js                 reports { mode: "api" }
  request-otp.js            POST { mobile }               -> sends a code
  verify-otp.js             POST { mobile, code, otpToken } -> session token
  stations.js               GET (Bearer token)            -> station data
  geocode.js                GET ?q=                       -> place -> lat/lon
  lib/auth.js               HMAC-signed stateless tokens
  lib/sms.js                SMS provider abstraction
  lib/http.js               outbound HTTP helper
  data/stations.json        dataset for api mode
netlify.toml                publish = docs, functions = netlify/functions
```

## Deploy — GitHub Pages (static mode)

1. Repository **Settings → Pages**.
2. Source: **Deploy from a branch**; Branch: `main`; Folder: **/docs**.
3. Save. The site appears at `https://<user>.github.io/ev-charging-finder/`.

No build step. The login will be a client-side gate (see the table above).

## Deploy — Netlify (api mode, real OTP)

Already provisioned. To (re)deploy:

**Option A — GitHub Actions (used for the current deploy).** Run the
`Deploy to Netlify` workflow from the Actions tab. It needs one repository
secret: `NETLIFY_AUTH_TOKEN` (a Netlify personal access token) — durable, and
the recommended setting. `NETLIFY_MCP_PROXY_PATH` also works but is a
short-lived credential issued by the Netlify MCP, so prefer the token.

**Option B — the dashboard.** Netlify → **Add new site → Import an existing
project** → pick this repo; or link the repo to the existing project under
**Build & deploy**.

Either way: build command none, publish directory `docs`, functions
`netlify/functions` (all set in `netlify.toml`).

Then set the environment variables (Site configuration → Environment variables):

   | Key | Required | Notes |
   |---|---|---|
   | `APP_SECRET` | **yes** | Any long random string. Signs OTP and session tokens. |
   | `SMS_PROVIDER` | for real SMS | `twilio`, `msg91` or `fast2sms` |
   | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | Twilio | |
   | `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID` | MSG91 | |
   | `FAST2SMS_API_KEY` | Fast2SMS | |
   | `GEOCODE_UA` | recommended | Contact URL/email for the Nominatim User-Agent |

   With no SMS provider set, api mode runs in *dev mode*: no SMS is sent and the
   code is shown on screen.

## Local development

```bash
npm install -g netlify-cli
netlify dev          # runs api mode at http://localhost:8888
```

To preview static mode, serve `docs/` with any static server — `/api/config`
will 404 and the app will fall back automatically.

## Tests

```bash
node test_flow.js      # OTP flow, auth gating, search, filters
node test_geocode.js   # geocoder response mapping
```

## Data and licence

Station data is from Open Charge Map and is mixed-licensed (ODbL / CC-BY-SA and
provider-specific). Attribution belongs to Open Charge Map and its data
providers. Review OCM's terms before redistributing the data.

Geocoding uses OpenStreetMap Nominatim; map tiles are © OpenStreetMap
contributors. Please respect both services' usage policies.
