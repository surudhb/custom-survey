import { Hono } from 'hono';

// Builds the JSON API. Storage and the admin key are injected so the same
// routes run on Node (flat file) and on Cloudflare Workers (KV).
//
//   store.get(token)        -> { ranking, updatedAt } | null
//   store.set(token, entry) -> Promise<void>
//   store.delete(token)     -> Promise<void>
//   store.list()            -> Promise<Array<{ ranking, updatedAt }>>
//   getAdminKey()           -> Promise<string | null>
export function createApp({ config, store, getAdminKey }) {
  const app = new Hono();
  const activities = config.activities;
  const n = activities.length;
  const activitySet = new Set(activities);

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

  // Create or overwrite a response for a token.
  app.post('/api/vote', async (c) => {
    const body = await c.req.json().catch(() => null);
    const token = body && body.token;
    const ranking = body && body.ranking;
    if (typeof token !== 'string' || token.length < 8 || token.length > 128) {
      return c.json({ error: 'invalid_token' }, 400);
    }
    if (!isValidRanking(ranking)) {
      return c.json({ error: 'invalid_ranking' }, 400);
    }
    if (submissionsClosed()) {
      return c.json({ error: 'submissions_closed' }, 403);
    }
    const existing = await store.get(token);
    await store.set(token, { ranking, updatedAt: new Date().toISOString() });
    return c.json({ ok: true, created: !existing });
  });

  // Let someone remove their own anonymous response.
  app.delete('/api/vote/:token', async (c) => {
    await store.delete(c.req.param('token'));
    return c.json({ ok: true });
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

  // Full breakdown incl. per-rank counts — requires the admin key.
  app.get('/api/results', async (c) => {
    const key = c.req.query('key') || c.req.header('x-admin-key');
    const adminKey = await getAdminKey();
    if (!adminKey || key !== adminKey) return c.json({ error: 'forbidden' }, 403);

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

  return app;
}
