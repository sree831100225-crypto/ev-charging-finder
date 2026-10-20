/**
 * Login registry — which mobile numbers have signed in, deduplicated.
 *
 * Storage is Netlify Blobs: one key per number, so a repeat login overwrites
 * the same record instead of adding a second one. That makes the store itself
 * the deduplication — unique users = number of keys.
 *
 * When Blobs is unavailable (local dev, unit tests) it falls back to an
 * in-memory Map. That fallback does NOT persist and is never used on Netlify;
 * `stats().storage` reports which backend is live so you can tell.
 *
 * PRIVACY — this holds personal data (phone numbers).
 *   USER_STORE_MODE=full    (default) store the number as supplied
 *   USER_STORE_MODE=hashed  store only a keyed hash; the number is not retained
 * Set USER_HASH_SALT to a stable secret if you use hashed mode.
 */
const crypto = require('crypto');

const STORE_NAME = 'ev-users';
const MODE = (process.env.USER_STORE_MODE || 'full').toLowerCase() === 'hashed' ? 'hashed' : 'full';
const SALT = process.env.USER_HASH_SALT || process.env.APP_SECRET || 'dev-salt-not-for-production';

const mem = new Map();   // dev/test fallback only
let blobStore;
let blobResolved = false;
let blobError = null;   // surfaced via stats() to aid diagnosis

function getBlobStore() {
  if (blobResolved) return blobStore;
  blobResolved = true;
  try {
    // Static require so the bundler traces and includes the package.
    const { getStore } = require('@netlify/blobs');
    blobStore = getStore(STORE_NAME);
  } catch (e) {
    blobStore = null;
    blobError = String((e && e.message) || e);
  }
  return blobStore;
}

/** Stable, non-reversible key for a number. */
function keyFor(mobile) {
  return crypto.createHash('sha256').update(String(mobile)).digest('hex').slice(0, 32);
}

/** Keyed hash, so the same number always maps to the same digest. */
function hashMobile(mobile) {
  return crypto.createHmac('sha256', SALT).update(String(mobile)).digest('hex').slice(0, 32);
}

/**
 * Record a successful login. Safe to call repeatedly: the same number always
 * lands on the same key, so this updates rather than duplicates.
 */
async function recordLogin(mobile) {
  if (!mobile) return { recorded: false };
  const key = keyFor(mobile);
  const now = new Date().toISOString();
  const store = getBlobStore();

  let prev = null;
  if (store) {
    try { prev = await store.get(key, { type: 'json' }); } catch (e) { prev = null; }
  } else {
    prev = mem.get(key) || null;
  }

  const rec = {
    id: key,
    mobile: MODE === 'hashed' ? null : String(mobile),
    mobile_hash: hashMobile(mobile),
    first_seen: (prev && prev.first_seen) || now,
    last_seen: now,
    logins: ((prev && prev.logins) || 0) + 1,
  };

  if (store) {
    try { await store.setJSON(key, rec); } catch (e) { return { recorded: false, error: String(e.message) }; }
  } else {
    mem.set(key, rec);
  }
  return { recorded: true, first_time: !prev };
}

async function listUsers() {
  const store = getBlobStore();
  let items = [];
  if (store) {
    try {
      let cursor;
      do {
        const page = await store.list(cursor ? { cursor } : undefined);
        const blobs = Array.isArray(page) ? page : (page && page.blobs) || [];
        for (const b of blobs) {
          const k = b && (b.key || b);
          if (!k) continue;
          const v = await store.get(k, { type: 'json' });
          if (v) items.push(v);
        }
        cursor = page && !Array.isArray(page) ? page.cursor : null;
      } while (cursor);
    } catch (e) {
      /* fall through with whatever we have */
    }
  } else {
    items = Array.from(mem.values());
  }
  items.sort((a, b) => String(b.last_seen || '').localeCompare(String(a.last_seen || '')));
  return items;
}

async function stats() {
  const items = await listUsers();
  const totalLogins = items.reduce((n, u) => n + (u.logins || 0), 0);
  const now = Date.now();
  const last24h = items.filter((u) => u.last_seen && now - Date.parse(u.last_seen) < 864e5).length;
  return {
    unique_users: items.length,
    total_logins: totalLogins,
    active_last_24h: last24h,
    repeat_users: items.filter((u) => (u.logins || 0) > 1).length,
    store_mode: MODE,
    storage: getBlobStore() ? 'netlify-blobs' : 'memory (dev only — not persisted)',
    blob_error: getBlobStore() ? null : blobError,
  };
}

/**
 * Write/read/delete probe, so the operator can confirm the registry storage is
 * actually working in a deployment (token-gated; leaves nothing behind).
 */
async function selfTest() {
  const store = getBlobStore();
  if (!store) return { ok: false, storage: 'memory (dev only)', error: 'Blobs not available in this runtime' };
  const key = '__selftest__';
  const stamp = new Date().toISOString();
  try {
    await store.setJSON(key, { probe: stamp });
    const back = await store.get(key, { type: 'json' });
    await store.delete(key);
    return { ok: !!(back && back.probe === stamp), storage: 'netlify-blobs', wrote: stamp, read: back && back.probe };
  } catch (e) {
    return { ok: false, storage: 'netlify-blobs', error: String(e.message) };
  }
}

module.exports = { recordLogin, listUsers, stats, selfTest, keyFor, hashMobile, _reset: () => mem.clear() };
