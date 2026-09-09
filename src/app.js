import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { PLACEHOLDER_SVG } from './assets.js';
import { newId, makeCode, verifyCode } from './session.js';

// Builds the JSON API. Storage, the admin key, a rate limiter and a session
// secret are injected so the same routes run on Node (flat file) and on
// Cloudflare Workers (KV).
//
//   store.get/set/delete/list/count/getAsset/getMeta/setMeta
//   getAdminKey()      -> Promise<string | null>
//   rateLimit(key)     -> Promise<boolean>          (true = allow; optional)
//   getSessionSecret() -> Promise<string>           (optional; enables cookies)
const TOKEN_RE = /^[A-Za-z0-9_-]{8,128}$/;
const COOKIE = 'sid';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 60; // 60 days

export function createApp({ config, store, getAdminKey, rateLimit, getSessionSecret }) {
  const app = new Hono();
  const activities = config.activities;
  const n = activities.length;
  const activitySet = new Set(activities);
  const maxResponses = Number.isInteger(config.maxResponses) && config.maxResponses > 0
    ? config.maxResponses
    : null;

  function isValidRanking(ranking) {
    if (!Array.isArray(ranking)) return false;
    if (ranking.length !== n) return false;
    const seen = new Set(ranking);
    if (seen.size !== ranking.length) return false; // no duplicates
    for (const item of ranking) if (!activitySet.has(item)) return false; // known only
    return true;
  }

  function submissionsClosed() {
    if (!config.submissionsCloseAt) return false;
    const closeMs = Date.parse(config.submissionsCloseAt);
    return !Number.isNaN(closeMs) && Date.now() > closeMs;
  }

  function clientKey(c) {
    return (
      c.req.header('cf-connecting-ip') ||
      (c.req.header('x-forwarded-for') || '').split(',')[0].trim() ||
      'anon'
    );
  }
  async function limited(c) {
    if (!rateLimit) return false;
    try {
      return !(await rateLimit(clientKey(c)));
    } catch {
      return false; // never block on limiter failure
    }
  }

  // ---- sessions --------------------------------------------------------------
  let _secret;
  let _secretTried = false;
  async function secret() {
    if (!_secretTried) {
      _secretTried = true;
      try {
        _secret = getSessionSecret ? await getSessionSecret() : null;
      } catch {
        _secret = null;
      }
    }
    return _secret;
  }
  function cookieOpts(c) {
    return {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: COOKIE_MAX_AGE,
      secure: new URL(c.req.url).protocol === 'https:',
    };
  }
  // Returns { id, code } for the current device, minting + setting a fresh
  // signed cookie if there isn't a valid one. { id: null } means sessions are
  // disabled (no secret provider) — callers then fall back to a client token.
  async function ensureSession(c) {
    const sec = await secret();
    if (!sec) return { id: null, code: null };
    const current = getCookie(c, COOKIE);
    const id = current ? await verifyCode(current, sec) : null;
    if (id) return { id, code: current };
    const freshId = newId();
    const code = await makeCode(freshId, sec);
    setCookie(c, COOKIE, code, cookieOpts(c));
    return { id: freshId, code };
  }

  // Hand the browser its device id + portable code (the cookie is HttpOnly, so
  // page JS can't read it directly).
  app.get('/api/session', async (c) => {
    const s = await ensureSession(c);
    if (!s.id) return c.json({ sessions: false });
    return c.json({ token: s.id, code: s.code });
  });

  // Adopt a code copied from another device: verify its signature, then make it
  // this device's cookie.
  app.post('/api/session/adopt', async (c) => {
    if (await limited(c)) return c.json({ error: 'rate_limited' }, 429);
    const sec = await secret();
    if (!sec) return c.json({ error: 'sessions_disabled' }, 400);
    const body = await c.req.json().catch(() => ({}));
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    const id = await verifyCode(code, sec);
    if (!id) return c.json({ error: 'invalid_code' }, 400);
    setCookie(c, COOKIE, code, cookieOpts(c));
    return c.json({ token: id });
  });

  app.get('/api/config', (c) =>
    c.json({
      title: config.title,
      description: config.description,
      dateLabel: config.dateLabel || null,
      activities,
      submissionsCloseAt: config.submissionsCloseAt || null,
      // Venue names / addresses / time are only needed for the winner reveal —
      // withhold them until submissions close so they aren't exposed early.
      event: submissionsClosed() ? config.event || null : null,
    }),
  );

  // Fetch an existing response by token, so a returning respondent can edit it.
  app.get('/api/vote/:token', async (c) => {
    const entry = await store.get(c.req.param('token'));
    if (!entry) return c.json({ error: 'not_found' }, 404);
    return c.json({ ranking: entry.ranking, updatedAt: entry.updatedAt });
  });

  // Create or overwrite this device's response.
  app.post('/api/vote', async (c) => {
    if (await limited(c)) return c.json({ error: 'rate_limited' }, 429);

    const body = await c.req.json().catch(() => null);
    const ranking = body && body.ranking;
    if (!isValidRanking(ranking)) {
      return c.json({ error: 'invalid_ranking' }, 400);
    }
    if (submissionsClosed()) {
      return c.json({ error: 'submissions_closed' }, 403);
    }

    const session = await ensureSession(c);
    let token = session.id;
    if (!token) {
      // sessions disabled — trust the client-supplied token instead
      token = body && body.token;
      if (typeof token !== 'string' || !TOKEN_RE.test(token)) {
        return c.json({ error: 'invalid_token' }, 400);
      }
    }

    const existing = await store.get(token);
    if (!existing && maxResponses && (await store.count()) >= maxResponses) {
      return c.json({ error: 'capacity_reached' }, 403);
    }
    await store.set(token, { ranking, updatedAt: new Date().toISOString() });
    return c.json({ ok: true, created: !existing });
  });

  // Remove this device's own response.
  const handleDelete = async (c) => {
    if (await limited(c)) return c.json({ error: 'rate_limited' }, 429);
    const session = await ensureSession(c);
    const token = session.id || c.req.param('token');
    if (!token) return c.json({ error: 'no_session' }, 400);
    await store.delete(token);
    return c.json({ ok: true });
  };
  app.delete('/api/vote', handleDelete);
  app.delete('/api/vote/:token', handleDelete);

  // Invite photos. Real images live in KV (`asset:left` / `asset:right`); this
  // falls back to an inline placeholder so the <img> always resolves.
  app.get('/photo/:side', async (c) => {
    const side = c.req.param('side');
    if (side !== 'left' && side !== 'right') return c.notFound();
    const asset = store.getAsset ? await store.getAsset(`asset:${side}`) : null;
    if (asset) {
      return new Response(asset.body, {
        headers: {
          'content-type': asset.contentType,
          'cache-control': 'public, max-age=300',
        },
      });
    }
    return new Response(PLACEHOLDER_SVG[side], {
      headers: {
        'content-type': 'image/svg+xml; charset=utf-8',
        'cache-control': 'public, max-age=120',
      },
    });
  });

  // Public aggregate — Borda points per activity only, no per-response data.
  app.get('/api/summary', async (c) => {
    const responses = await store.list();
    const points = Object.fromEntries(activities.map((a) => [a, 0]));
    for (const r of responses) {
      r.ranking.forEach((activity, idx) => { points[activity] += n - idx; });
    }
    const leaderboard = activities
      .map((a) => ({ activity: a, points: points[a] }))
      .sort((a, b) => b.points - a.points);
    return c.json({ totalResponses: responses.length, leaderboard });
  });

  async function isAdmin(c) {
    const key = c.req.query('key') || c.req.header('x-admin-key');
    const adminKey = await getAdminKey();
    return !!adminKey && key === adminKey;
  }

  // Full breakdown incl. per-rank counts — requires the admin key.
  app.get('/api/results', async (c) => {
    if (!(await isAdmin(c))) return c.json({ error: 'forbidden' }, 403);

    const responses = await store.list();
    const points = {};
    const rankCounts = {}; // activity -> [count at rank1, count at rank2, ...]
    activities.forEach((a) => {
      points[a] = 0;
      rankCounts[a] = new Array(n).fill(0);
    });
    for (const r of responses) {
      r.ranking.forEach((activity, idx) => {
        points[activity] += n - idx;
        rankCounts[activity][idx] += 1;
      });
    }
    const leaderboard = activities
      .map((a) => ({
        activity: a,
        points: points[a],
        averageRank: responses.length
          ? (rankCounts[a].reduce((s, ct, idx) => s + ct * (idx + 1), 0) / responses.length).toFixed(2)
          : null,
        rankCounts: rankCounts[a],
      }))
      .sort((a, b) => b.points - a.points);

    return c.json({ totalResponses: responses.length, activities, leaderboard });
  });

  // Wipe every response. Keeps photos (`asset:*`) and the session secret
  // (`meta:*`). Admin key required. POST (not GET) so a link can't trigger it.
  app.post('/api/admin/reset', async (c) => {
    if (!(await isAdmin(c))) return c.json({ error: 'forbidden' }, 403);
    const deleted = store.clear ? await store.clear() : 0;
    return c.json({ ok: true, deleted });
  });

  return app;
}
