// Server-verified device identity.
//
// A "code" is `<id>.<HMAC-SHA256(id, secret)>`. The server hands one out as an
// HttpOnly cookie; because it's self-authenticating the server keeps no session
// store, and the same string doubles as the copy-to-another-device code (adopt
// it via POST /api/session/adopt). Uses Web Crypto so the code path is
// identical on Node 18+ and Cloudflare Workers.
const enc = new TextEncoder();

function b64url(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

export function newId() {
  return crypto.randomUUID().replace(/-/g, '');
}

export async function makeCode(id, secret) {
  return `${id}.${await hmac(secret, id)}`;
}

// Returns the id if the code's signature checks out, else null.
export async function verifyCode(code, secret) {
  if (typeof code !== 'string') return null;
  const dot = code.lastIndexOf('.');
  if (dot < 16) return null;
  const id = code.slice(0, dot);
  const sig = code.slice(dot + 1);
  if (!/^[0-9a-f]{16,64}$/.test(id) || !sig) return null;
  return timingSafeEqual(sig, await hmac(secret, id)) ? id : null;
}

// Resolves the signing secret: an explicit value wins; otherwise a random one
// is generated once and persisted in the store's metadata so it survives
// restarts / new isolates. Set SESSION_SECRET explicitly in production to avoid
// a first-request generation race.
export async function resolveSecret(envValue, store, metaKey = 'session_secret') {
  if (typeof envValue === 'string' && envValue.length >= 16) return envValue;
  let s = store && store.getMeta ? await store.getMeta(metaKey) : null;
  if (!s) {
    s = newId() + newId();
    if (store && store.setMeta) {
      try { await store.setMeta(metaKey, s); } catch { /* fall through with in-memory value */ }
    }
  }
  return s;
}
