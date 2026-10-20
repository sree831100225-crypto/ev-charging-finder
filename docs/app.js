/* EV Charging Station Finder - front-end logic
 *
 * One codebase, two run modes:
 *   api    - a backend is present (Netlify Functions). Real OTP over SMS and
 *            the dataset served only to authenticated requests.
 *   static - no backend (e.g. GitHub Pages). The OTP step becomes a local
 *            gate and the dataset is fetched from ./data/stations.json.
 * The mode is detected at boot by probing /api/config.
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var SKEY = 'ev_session_v1';

  var MODE = 'static';
  var STATIC = null;      // loaded dataset in static mode
  var localOtp = null;    // pending code in static mode
  var state = { token: null, mobile: null, otpToken: null, map: null, layer: null, results: [] };

  /* ---------------------------------------------------------- session */
  function saveSession(o) { try { localStorage.setItem(SKEY, JSON.stringify(o)); } catch (e) {} }
  function readSession() {
    try {
      var o = JSON.parse(localStorage.getItem(SKEY) || 'null');
      if (o && o.exp > Date.now()) return o;
    } catch (e) {}
    return null;
  }
  function clearSession() { try { localStorage.removeItem(SKEY); } catch (e) {} }

  /* ---------------------------------------------------------- geo maths */
  function haversineKm(lat1, lon1, lat2, lon2) {
    var R = 6371, toRad = function (d) { return (d * Math.PI) / 180; };
    var dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  /* ---------------------------------------------------------- static backend */
  function localStations(p) {
    var out = STATIC.stations;
    if (p.text) {
      var t = p.text.trim().toLowerCase();
      if (t) {
        out = out.filter(function (s) {
          return [s.nm, s.op, s.tw, s.st, s.pin, s.ad].filter(Boolean).some(function (v) {
            return String(v).toLowerCase().indexOf(t) >= 0;
          });
        });
      }
    }
    if (p.pin) out = out.filter(function (s) { return (s.pin || '').indexOf(p.pin) === 0; });
    if (p.state) out = out.filter(function (s) { return (s.st || '').toLowerCase() === p.state.toLowerCase(); });
    if (p.connector) {
      var c = p.connector.toLowerCase();
      out = out.filter(function (s) { return (s.ct || '').toLowerCase().indexOf(c) >= 0; });
    }
    if (p.fast === '1') out = out.filter(function (s) { return s.fc === 1; });
    if (p.payment === 'pay') out = out.filter(function (s) { return s.py === 1; });
    else if (p.payment === 'membership') out = out.filter(function (s) { return s.mb === 1; });
    else if (p.payment === 'public') out = out.filter(function (s) { return (s.us || '').indexOf('Public') === 0; });
    else if (p.payment === 'private') out = out.filter(function (s) { return /^Priv/i.test(s.us || ''); });

    var lat = parseFloat(p.lat), lon = parseFloat(p.lon);
    if (isFinite(lat) && isFinite(lon)) {
      var radius = parseFloat(p.radius) || 25;
      out = out.map(function (s) {
        return Object.assign({}, s, { d: Math.round(haversineKm(lat, lon, s.la, s.lo) * 10) / 10 });
      }).filter(function (s) { return s.d <= radius; }).sort(function (a, b) { return a.d - b.d; });
    } else if (!p.text && !p.pin && !p.state) {
      out = out.slice().sort(function (a, b) {
        return (a.st || '').localeCompare(b.st || '') || (a.nm || '').localeCompare(b.nm || '');
      });
    }
    var total = out.length;
    return {
      count: Math.min(total, 3000), total: total, truncated: total > 3000,
      source: STATIC.source, generated: STATIC.generated, stations: out.slice(0, 3000)
    };
  }

  function localGeocode(q) {
    if (!q || q.length < 3) return Promise.resolve({ ok: false, status: 400, data: { error: 'Enter at least 3 characters' } });
    var url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=in&q=' + encodeURIComponent(q);
    return fetch(url, { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (arr) {
        return {
          ok: true, status: 200, data: {
            query: q,
            results: (arr || []).map(function (r) {
              return { name: r.display_name, lat: parseFloat(r.lat), lon: parseFloat(r.lon), type: r.type };
            })
          }
        };
      })
      .catch(function () { return { ok: false, status: 502, data: { error: 'Geocoding unavailable' } }; });
  }

  function localRequestOtp(mobile) {
    var code = String(Math.floor(100000 + Math.random() * 900000));
    localOtp = { mobile: mobile, code: code, exp: Date.now() + 5 * 60 * 1000 };
    return { ok: true, status: 200, data: { ok: true, dev_mode: true, dev_code: code, otpToken: 'local' } };
  }

  function localVerifyOtp(body) {
    if (!localOtp || localOtp.mobile !== body.mobile || Date.now() > localOtp.exp) {
      return { ok: false, status: 400, data: { error: 'This code has expired. Please request a new one.' } };
    }
    if (String(body.code) !== localOtp.code) return { ok: false, status: 401, data: { error: 'Incorrect code' } };
    localOtp = null;
    return { ok: true, status: 200, data: { ok: true, sessionToken: 'local-' + Date.now(), mobile: body.mobile, expiresIn: 12 * 3600 } };
  }

  function apiLocal(path, opts) {
    var qi = path.indexOf('?');
    var name = (qi >= 0 ? path.slice(0, qi) : path).replace(/^\//, '');
    var params = {};
    if (qi >= 0) new URLSearchParams(path.slice(qi + 1)).forEach(function (v, k) { params[k] = v; });
    var body = {};
    try { body = opts && opts.body ? JSON.parse(opts.body) : {}; } catch (e) {}

    if (name === 'stations') {
      if (!STATIC) return Promise.resolve({ ok: false, status: 503, data: { error: 'Dataset not loaded' } });
      return Promise.resolve({ ok: true, status: 200, data: localStations(params) });
    }
    if (name === 'geocode') return localGeocode(params.q || '');
    if (name === 'request-otp') return Promise.resolve(localRequestOtp(body.mobile));
    if (name === 'verify-otp') return Promise.resolve(localVerifyOtp(body));
    return Promise.resolve({ ok: false, status: 404, data: { error: 'Not found' } });
  }

  /* ---------------------------------------------------------- http */
  function apiReal(path, opts) {
    opts = opts || {};
    var headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    if (state.token) headers.Authorization = 'Bearer ' + state.token;
    return fetch('/api' + path, Object.assign({}, opts, { headers: headers }))
      .then(function (res) {
        return res.json().catch(function () { return null; }).then(function (data) {
          return { ok: res.ok, status: res.status, data: data };
        });
      });
  }
  function api(path, opts) { return MODE === 'static' ? apiLocal(path, opts) : apiReal(path, opts); }

  function qs(obj) {
    return Object.keys(obj)
      .filter(function (k) { return obj[k] !== '' && obj[k] !== null && obj[k] !== undefined; })
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]); })
      .join('&');
  }

  function msg(text, kind) {
    var el = $('loginMsg');
    el.textContent = text || '';
    el.className = 'msg' + (kind ? ' ' + kind : '');
  }
  function setBusy(btn, busy, label) {
    btn.disabled = busy;
    if (busy) { btn.dataset.label = btn.textContent; btn.textContent = label || 'Please wait…'; }
    else if (btn.dataset.label) { btn.textContent = btn.dataset.label; }
  }
  function normalizeMobile(raw) {
    var s = String(raw || '').replace(/\D/g, '');
    if (s.length > 10 && s.indexOf('91') === 0) s = s.slice(-10);
    if (s.length === 11 && s.charAt(0) === '0') s = s.slice(1);
    return /^[6-9]\d{9}$/.test(s) ? s : null;
  }

  /* ---------------------------------------------------------- login */
  $('mobileForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var mobile = normalizeMobile($('mobile').value);
    if (!mobile) { msg('Enter a valid 10-digit Indian mobile number', 'error'); return; }
    var btn = $('sendOtpBtn');
    setBusy(btn, true, 'Sending…');
    msg('');
    api('/request-otp', { method: 'POST', body: JSON.stringify({ mobile: mobile }) })
      .then(function (r) {
        setBusy(btn, false);
        if (!r.ok) { msg((r.data && r.data.error) || 'Could not send the code', 'error'); return; }
        state.otpToken = r.data.otpToken;
        state.mobile = mobile;
        $('otpTo').textContent = '+91 ' + mobile;
        $('mobileForm').classList.add('hidden');
        $('otpForm').classList.remove('hidden');
        $('otp').focus();
        msg('Code sent.', 'ok');
        var dn = $('devNotice');
        if (r.data.dev_mode && r.data.dev_code) {
          dn.innerHTML = '<b>No SMS provider is connected.</b> No real text was sent — ' +
            'your code is <code>' + r.data.dev_code + '</code>.';
          dn.classList.remove('hidden');
        } else { dn.classList.add('hidden'); }
      })
      .catch(function () { setBusy(btn, false); msg('Network error. Please try again.', 'error'); });
  });

  $('otpForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var code = String($('otp').value).replace(/\D/g, '');
    if (code.length !== 6) { msg('Enter the 6-digit code', 'error'); return; }
    var btn = $('verifyBtn');
    setBusy(btn, true, 'Verifying…');
    api('/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ mobile: state.mobile, code: code, otpToken: state.otpToken })
    })
      .then(function (r) {
        setBusy(btn, false);
        if (!r.ok) { msg((r.data && r.data.error) || 'Verification failed', 'error'); return; }
        var exp = Date.now() + (r.data.expiresIn || 43200) * 1000;
        saveSession({ token: r.data.sessionToken, mobile: r.data.mobile, exp: exp });
        state.token = r.data.sessionToken;
        enterApp(r.data.mobile);
      })
      .catch(function () { setBusy(btn, false); msg('Network error. Please try again.', 'error'); });
  });

  $('changeNumberBtn').addEventListener('click', function () {
    $('otpForm').classList.add('hidden');
    $('mobileForm').classList.remove('hidden');
    $('otp').value = '';
    $('devNotice').classList.add('hidden');
    msg('');
  });
  $('resendBtn').addEventListener('click', function () { $('mobileForm').dispatchEvent(new Event('submit')); });

  $('logoutBtn').addEventListener('click', function () {
    clearSession();
    state.token = null;
    location.reload();
  });

  /* ---------------------------------------------------------- app entry */
  function enterApp(mobile) {
    $('loginView').classList.add('hidden');
    $('appView').classList.remove('hidden');
    state.mobile = mobile;
    $('whoami').textContent = '+91 ' + mobile;
    if (!state.map) initMap();
    setStatus('Loading stations…');
    loadStations({}, 'Showing all stations across India');
  }

  function setStatus(t) { $('status').textContent = t || ''; }

  /* ---------------------------------------------------------- map */
  function initMap() {
    state.map = L.map('map', { zoomControl: true, worldCopyJump: false }).setView([22.5, 79], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(state.map);
    state.layer = L.layerGroup().addTo(state.map);
  }

  function drawMarkers(list) {
    if (!state.map) return;
    state.layer.clearLayers();
    var bounds = [];
    list.forEach(function (s) {
      var color = s.fc ? '#22c55e' : '#3b82f6';
      var m = L.circleMarker([s.la, s.lo], {
        radius: 6, color: color, weight: 1.5, fillColor: color, fillOpacity: .55
      });
      m.bindPopup(popupHtml(s));
      m.addTo(state.layer);
      bounds.push([s.la, s.lo]);
    });
    if (bounds.length === 1) state.map.setView(bounds[0], 13);
    else if (bounds.length > 1) state.map.fitBounds(bounds, { padding: [30, 30], maxZoom: 12 });
  }

  function popupHtml(s) {
    var pay = s.py ? 'Pay at location' : (s.mb ? 'Membership required' : (s.us || 'Public'));
    return '<h4>' + esc(s.nm || 'EV charging station') + '</h4>' +
      (s.op ? '<p><b>' + esc(s.op) + '</b></p>' : '') +
      '<p>' + esc([s.ad, s.tw, s.st, s.pin].filter(Boolean).join(', ')) + '</p>' +
      '<p>' + (s.kw ? esc(s.kw) + ' kW &middot; ' : '') + esc(s.ct || 'Connector n/a') + '</p>' +
      '<p>' + esc(pay) + (typeof s.d === 'number' ? ' &middot; ' + s.d + ' km away' : '') + '</p>';
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------------------------------------------------------- results */
  function renderList(list) {
    var el = $('list');
    if (!list.length) {
      el.innerHTML = '<div class="empty">No charging stations matched.<br>Try a wider radius or a different place.</div>';
      return;
    }
    el.innerHTML = list.map(function (s, i) {
      var pay = s.py ? 'Pay at location' : (s.mb ? 'Membership required' : (s.us || ''));
      var tags = [];
      if (s.fc) tags.push('<span class="tag green">Fast charge</span>');
      if (s.kw) tags.push('<span class="tag">' + esc(s.kw) + ' kW</span>');
      if (s.ct) tags.push('<span class="tag">' + esc(s.ct) + '</span>');
      if (pay) tags.push('<span class="tag amber">' + esc(pay) + '</span>');
      return '<div class="card" data-i="' + i + '">' +
        (typeof s.d === 'number' ? '<span class="dist">' + s.d + ' km</span>' : '') +
        '<h3>' + esc(s.nm || 'EV charging station') + '</h3>' +
        (s.op ? '<div class="meta">' + esc(s.op) + '</div>' : '') +
        '<div class="meta">' + esc([s.ad, s.tw, s.st, s.pin].filter(Boolean).join(', ')) + '</div>' +
        '<div class="tags">' + tags.join('') + '</div>' +
        '</div>';
    }).join('');
    Array.prototype.forEach.call(el.querySelectorAll('.card'), function (c) {
      c.addEventListener('click', function () {
        var s = list[+c.dataset.i];
        if (state.map) state.map.setView([s.la, s.lo], 14);
      });
    });
  }

  /* ---------------------------------------------------------- data */
  function filters() {
    return {
      radius: $('radius').value,
      connector: $('connector').value,
      payment: $('payment').value,
      fast: $('fastOnly').checked ? '1' : ''
    };
  }

  function loadStations(extra, note) {
    var p = Object.assign(filters(), extra);
    return api('/stations?' + qs(p)).then(function (r) {
      if (r.status === 401) { clearSession(); location.reload(); return; }
      if (!r.ok) { setStatus((r.data && r.data.error) || 'Could not load stations'); return; }
      state.results = r.data.stations || [];
      renderList(state.results);
      drawMarkers(state.results);
      setStatus((note ? note + ' · ' : '') + state.results.length + ' station' +
        (state.results.length === 1 ? '' : 's') + ' shown' +
        (r.data.truncated ? ' (limited)' : '') + '.');
    }).catch(function () { setStatus('Network error while loading stations.'); });
  }

  function mergeStations(a, b) {
    var seen = {}, out = [];
    a.concat(b).forEach(function (s) { if (!seen[s.id]) { seen[s.id] = 1; out.push(s); } });
    out.sort(function (x, y) {
      var dx = typeof x.d === 'number' ? x.d : Infinity;
      var dy = typeof y.d === 'number' ? y.d : Infinity;
      return dx - dy;
    });
    return out;
  }

  function search() {
    var text = $('q').value.trim();
    if (!text) { loadStations({}, 'Showing all stations across India'); return; }
    setStatus('Searching for "' + text + '"…');
    var f = filters();
    var base = Object.assign({}, f, { lat: '', lon: '' });

    api('/stations?' + qs(Object.assign({}, base, { text: text })))
      .then(function (r) {
        if (r.status === 401) { clearSession(); location.reload(); return; }
        var byName = (r.ok && r.data.stations) || [];
        state.results = byName;
        renderList(byName);
        drawMarkers(byName);
        setStatus(byName.length + ' station' + (byName.length === 1 ? '' : 's') + ' matching "' + text + '"…');
      })
      .catch(function () {});

    api('/geocode?q=' + encodeURIComponent(text))
      .then(function (r) {
        if (!r.ok || !r.data.results || !r.data.results.length) {
          setStatus(state.results.length + ' station' + (state.results.length === 1 ? '' : 's') +
            ' matching "' + text + '".');
          return null;
        }
        var c = r.data.results[0];
        if (state.map) state.map.setView([c.lat, c.lon], 11);
        return api('/stations?' + qs(Object.assign({}, f, { lat: c.lat, lon: c.lon })))
          .then(function (r2) {
            if (!r2.ok) return;
            var merged = mergeStations(r2.data.stations, state.results);
            state.results = merged;
            renderList(merged);
            drawMarkers(merged);
            setStatus(merged.length + ' station' + (merged.length === 1 ? '' : 's') + ' near "' + text + '".');
          });
      })
      .catch(function () {});
  }

  function useMyLocation() {
    if (!navigator.geolocation) { setStatus('Your browser does not support location.'); return; }
    setStatus('Getting your location…');
    navigator.geolocation.getCurrentPosition(function (pos) {
      var lat = pos.coords.latitude, lon = pos.coords.longitude;
      if (state.map) state.map.setView([lat, lon], 12);
      loadStations({ lat: lat, lon: lon, text: '' }, 'Near your location');
    }, function () {
      setStatus('Could not get your location. Allow location access or search by place instead.');
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  }

  /* ---------------------------------------------------------- wiring */
  $('searchBtn').addEventListener('click', search);
  $('geoBtn').addEventListener('click', useMyLocation);
  $('q').addEventListener('keydown', function (e) { if (e.key === 'Enter') search(); });
  ['radius', 'connector', 'payment', 'fastOnly'].forEach(function (id) {
    $(id).addEventListener('change', function () {
      var t = $('q').value.trim();
      if (t) search(); else loadStations({}, 'Showing all stations across India');
    });
  });
  $('resetBtn').addEventListener('click', function () {
    $('q').value = '';
    $('radius').value = '25';
    $('connector').value = '';
    $('payment').value = '';
    $('fastOnly').checked = false;
    loadStations({}, 'Showing all stations across India');
  });

  /* ---------------------------------------------------------- boot */
  function boot() {
    var s = readSession();
    if (s) { state.token = s.token; enterApp(s.mobile); }
    else { $('mobile').focus(); }
  }

  function showStaticNotice() {
    var n = $('modeNotice');
    if (!n) return;
    n.innerHTML = '<b>Static build (GitHub Pages).</b> There is no server on this host, so the ' +
      'verification code is generated in your browser and shown on screen — no SMS is sent. ' +
      'The full build, with real SMS and the dataset served only to logged-in users, runs on Netlify.';
    n.classList.remove('hidden');
  }

  function detectMode() {
    return fetch('/api/config', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (c) { return (c && c.mode === 'api') ? 'api' : 'static'; })
      .catch(function () { return 'static'; });
  }

  detectMode().then(function (mode) {
    MODE = mode;
    if (MODE !== 'static') return null;
    showStaticNotice();
    return fetch('data/stations.json')
      .then(function (r) { return r.json(); })
      .then(function (d) { STATIC = d; })
      .catch(function () {});
  }).then(boot).catch(boot);
})();
