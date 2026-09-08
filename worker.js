// Cloudflare Workers entry point.
//
// Static files in public/ are served by the platform (see [assets] in
// wrangler.toml); this Worker only handles the JSON API. config.json is
// bundled at build time, so changing it means a redeploy.
import { createApp } from './src/app.js';
import { KvStore } from './src/store-kv.js';
import config from './config.json';

let app;

export default {
  fetch(request, env, ctx) {
    if (!app) {
      app = createApp({
        config,
        store: new KvStore(env.SURVEY_KV),
        getAdminKey: async () => env.ADMIN_KEY || null,
      });
    }
    return app.fetch(request, env, ctx);
  },
};
