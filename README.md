# EV Charging Station Finder — India

A searchable web app for electric-vehicle charging stations across India, with
mobile-number OTP login. Visitors can find chargers by city, area, pincode or
station name, or by sharing their current location.

Data: **3,198 stations across India**, merged from two open sources —
[Open Charge Map](https://openchargemap.org) (1,872) and Zenodo record 18818786
(1,326). This is **not** the complete Indian network: the Bureau of Energy
Efficiency (Ministry of Power) register listed 39,641 public charging points as
of 26 Oct 2025, and it is not included here. Each record carries a `src` field
(`OCM` or `Zenodo`) so you can tell the sources apart.

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
- **Sign-in registry** — every successful login is recorded against the number,
  deduplicated, so the operator can see how many unique people have used it.
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
   | `ADMIN_TOKEN` | for the registry | Long random string. Without it `/api/admin-users` stays disabled. |
   | `USER_STORE_MODE` | optional | `full` (default) stores the number; `hashed` stores only a keyed hash |
   | `USER_HASH_SALT` | with `hashed` | Stable secret so the same number hashes consistently |

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

## Login registry

Every successful OTP verification records the number in a Netlify Blobs store
(`ev-users`). The number is the store key, so the store *is* the deduplication —
repeating a login updates one record instead of adding another, and unique users
is simply the number of keys.

Each record holds `first_seen`, `last_seen` and a `logins` count.

### Reading it

```
GET /api/admin-users                     header:  x-admin-token: <ADMIN_TOKEN>
GET /api/admin-users?selftest=1          write/read/delete probe on the store
GET /api/admin-users?simulate=<mobile>   record a login for that number (ops check)
GET /api/admin-users?erase=<mobile>      delete one number (erasure request)
```

All four require the token and all four are safe to run by hand.

**Reads can lag writes by a few seconds.** Netlify Blobs is eventually
consistent, so the `after` snapshot returned by `simulate` and `erase` may show
the pre-write state. Re-read the plain endpoint a moment later for the true
count — that is what a login does too.

Returns unique users, total logins, active-in-last-24h, repeat users, and the
list. With no `ADMIN_TOKEN` set the endpoint returns 503 and serves nothing.
You can also browse the store directly under **Blobs** in the Netlify dashboard.

The response includes `storage` — check it says `netlify-blobs`. If it says
`memory (dev only)`, the store is not persisting and the counters will reset.
Two things make it work: `@netlify/blobs` is a dependency (pinned to v10, which
supports Node 18; v11 needs Node 22 and breaks the Netlify build), and the
function calls `connectLambda(event)` to seed the Blobs context, because this
deploy type does not inject it automatically. `?selftest=1` runs a
write/read/delete probe so you can confirm the store end to end.

### Privacy

This is personal data — phone numbers — so under India's Digital Personal Data
Protection Act, 2023 you are the data fiduciary for it. The app now says on the
login screen that the sign-in is recorded, which is the consent notice. Two
further controls are built in:

- **`USER_STORE_MODE=hashed`** stores only an HMAC of the number (keyed with
  `USER_HASH_SALT`). You keep unique-user counts and repeat-visit stats, but no
  raw numbers are retained.
- **Retention** is yours to manage: delete keys from the Blobs store, or keep
  only what you need. Prefer the hashed mode unless you genuinely need to
  contact users.

Capturing happens in the backend, so it applies to **api mode** (Netlify) only.
Logins on the static GitHub Pages build are generated in the browser and are not
recorded anywhere.

## Data and licence

Two sources, distinguished by the `src` field on every record:

- **OCM** — Open Charge Map, mixed-licensed (ODbL / CC-BY-SA and
  provider-specific). Attribution belongs to Open Charge Map and its data
  providers. This feed carries the richer fields: connectors, power, operator
  and payment category.
- **Zenodo** — Zenodo record 18818786, "Integrated EV Charging Infrastructure
  Dataset (India)", harmonised from the Kaggle *EV charging stations in India -
  simplified (2025)* dataset and Ministry of Power parliamentary replies. Thinner
  records: name, address and coordinates only, no payment or connector detail.

Neither feed is the complete Indian network. The authoritative register is the
Bureau of Energy Efficiency National Online Database (39,641 public charging
points, 26 Oct 2025), which is not included.

Geocoding uses OpenStreetMap Nominatim; map tiles are © OpenStreetMap
contributors. Please respect both services' usage policies.
