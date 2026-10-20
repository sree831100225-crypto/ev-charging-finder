# EV Charging Station Finder — India

A searchable web app for electric-vehicle charging stations across India, with
mobile-number OTP login. Visitors can find chargers by city, area, pincode or
station name, or by sharing their current location.

Live data source: [Open Charge Map](https://openchargemap.org) — 1,872 stations
across India (snapshot current to April 2026).

## What it does

- **Mobile OTP login** — a visitor enters a 10-digit Indian mobile number and a
  6-digit code before any data is shown.
- **Search** by free text (city, area, station name, operator) or by pincode.
- **Search by location** — free-text place names are geocoded (OpenStreetMap
  Nominatim), or the visitor can share their current location.
- **Filters** — radius, connector type, fast-charging only, payment type.
- **Map + list** view with distance, power (kW), connector types and payment
  category for each station.

## Architecture

```
public/                     static front-end (no framework, no build step)
  index.html  styles.css  app.js
netlify/functions/
  request-otp.js            POST  { mobile }        -> sends a 6-digit code
  verify-otp.js             POST  { mobile, code, otpToken } -> session token
  stations.js               GET   (Bearer token)    -> station data
  geocode.js                GET   ?q=               -> place -> lat/lon
  lib/auth.js               HMAC-signed stateless tokens
  lib/sms.js                SMS provider abstraction
  lib/http.js               outbound HTTP helper
  data/stations.json        the station dataset (served only after login)
netlify.toml                publish dir, functions dir, /api/* redirects
```

The dataset is **not** shipped to the browser. It is served only by
`stations.js`, which requires a valid session token, so the data cannot be
downloaded without logging in.

Sessions are stateless: tokens are HMAC-signed with `APP_SECRET`, so no
database is required.

## Deploy

1. Push this repository to GitHub.
2. On Netlify: **Add new site → Import an existing project**, pick the repo.
   Build command: none. Publish directory: `public`. Functions: `netlify/functions`
   (already set in `netlify.toml`).
3. Set environment variables (Site settings → Environment variables):

   | Key | Required | Notes |
   |---|---|---|
   | `APP_SECRET` | **yes** | Any long random string. Signs OTP and session tokens. |
   | `SMS_PROVIDER` | yes for real SMS | `twilio`, `msg91` or `fast2sms` |
   | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | for Twilio | |
   | `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID` | for MSG91 | |
   | `FAST2SMS_API_KEY` | for Fast2SMS | |
   | `GEOCODE_UA` | recommended | A contact URL/email for the Nominatim User-Agent |

   With **no** SMS provider set, the app runs in *dev mode*: no SMS is sent and
   the code is shown on screen. Convenient for testing — **not** secure.

## Local development

```bash
npm install -g netlify-cli
netlify dev
```

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
