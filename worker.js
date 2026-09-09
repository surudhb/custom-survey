// Cloudflare Workers entry point.
//
// Static files in public/ are served by the platform (see [assets] in
// wrangler.toml); this Worker only handles the JSON API.
//
// Config is injected at runtime: set the `CONFIG` secret to your real event
// config (the full config.json contents, as one JSON string) with
//   npx wrangler secret put CONFIG
// so real names / dates / venues never have to be committed. If `CONFIG` is
// unset, the bundled (demo) config.json is used.
//
// `ADMIN_KEY` (gates /api/results) is likewise a secret, never committed.
import { createApp } from './src/app.js';
import { KvStore } from './src/store-kv.js';
import { loadConfig } from './src/config.js';
import { resolveSecret } from './src/session.js';
import bundledConfig from './config.json';

let app;

function resolveConfig(env) {
  if (env.CONFIG) {
    try {
      return loadConfig(env.CONFIG);
    } catch (e) {
      console.warn(`CONFIG secret invalid, falling back to bundled config: ${e.message}`);
    }
  }
  return loadConfig(bundledConfig);
}

// Uses the Workers-native Rate Limiting binding if wrangler.toml declares one;
// otherwise writes are unthrottled (the [[ratelimit]] block is optional).
function makeRateLimit(env) {
  const rl = env && env.RATE_LIMITER;
  if (!rl || typeof rl.limit !== 'function') return undefined;
  return async (key) => {
    try {
      const { success } = await rl.limit({ key });
      return success !== false;
    } catch {
      return true; // fail open
    }
  };
}

export default {
  fetch(request, env, ctx) {
    if (!app) {
      const store = new KvStore(env.SURVEY_KV);
      app = createApp({
        config: resolveConfig(env),
        store,
        getAdminKey: async () => env.ADMIN_KEY || null,
        rateLimit: makeRateLimit(env),
        // Cookie-signing secret: SESSION_SECRET if set, else a random one
        // persisted in KV. Set it explicitly to avoid a first-request race:
        //   npx wrangler secret put SESSION_SECRET
        getSessionSecret: () => resolveSecret(env.SESSION_SECRET, store, 'session_secret'),
      });
    }
    return app.fetch(request, env, ctx);
  },
};
