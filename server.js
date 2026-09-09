// Local / self-hosted entry point: Node + Hono + a flat-file store.
// `npm start` behaves exactly as before (serves public/, stores votes in
// data.json under $DATA_DIR, auto-generates admin_key.txt).
//
// The API routes themselves live in src/app.js and are shared verbatim with
// the Cloudflare Workers build (worker.js).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createApp } from './src/app.js';
import { FileStore } from './src/store-file.js';
import { loadConfig } from './src/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
// DATA_DIR lets a host mount a persistent volume for the vote file + admin key.
const DATA_DIR = process.env.DATA_DIR || __dirname;
fs.mkdirSync(DATA_DIR, { recursive: true });
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const ADMIN_KEY_FILE = path.join(DATA_DIR, 'admin_key.txt');
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---- config ----
// Resolution order (real event details never need to be committed):
//   1. process.env.CONFIG        — full config as a JSON string (injected)
//   2. config.real.json          — git-ignored local override
//   3. config.json               — the committed demo config
let config;
try {
  const realFile = path.join(__dirname, 'config.real.json');
  if (process.env.CONFIG) {
    config = loadConfig(process.env.CONFIG);
  } else if (fs.existsSync(realFile)) {
    config = loadConfig(fs.readFileSync(realFile, 'utf8'));
  } else {
    config = loadConfig(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
  }
} catch (e) {
  console.error(`Invalid config: ${e.message}`);
  process.exit(1);
}

// ---- admin key (env, else auto-generated once and reused across restarts) ----
let ADMIN_KEY = process.env.ADMIN_KEY;
if (!ADMIN_KEY) {
  if (fs.existsSync(ADMIN_KEY_FILE)) {
    ADMIN_KEY = fs.readFileSync(ADMIN_KEY_FILE, 'utf8').trim();
  } else {
    ADMIN_KEY = crypto.randomBytes(9).toString('base64url');
    fs.writeFileSync(ADMIN_KEY_FILE, ADMIN_KEY);
  }
}

// ---- simple in-memory write rate limiter (per client key, sliding window) ----
const RL_WINDOW_MS = 60_000;
const RL_MAX = 30;
const rlHits = new Map();
function rateLimit(key) {
  const now = Date.now();
  const recent = (rlHits.get(key) || []).filter((t) => now - t < RL_WINDOW_MS);
  recent.push(now);
  rlHits.set(key, recent);
  if (rlHits.size > 5000) rlHits.clear(); // crude memory cap
  return recent.length <= RL_MAX;
}

const api = createApp({
  config,
  store: new FileStore(DATA_FILE, { assetsDir: path.join(__dirname, 'photos') }),
  getAdminKey: () => ADMIN_KEY,
  rateLimit,
});

// ---- static files (public/) ----
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const app = new Hono();
app.route('/', api);
app.get('*', async (c) => {
  let pathname = decodeURIComponent(new URL(c.req.url).pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = path.join(PUBLIC_DIR, path.normalize(pathname));
  if (!file.startsWith(PUBLIC_DIR)) return c.notFound();
  try {
    const buf = await fs.promises.readFile(file);
    return new Response(buf, {
      headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' },
    });
  } catch {
    return c.notFound();
  }
});

serve({ fetch: app.fetch, port: Number(PORT) }, (info) => {
  console.log(`custom-survey running at http://localhost:${info.port}`);
  console.log(`Admin results:  http://localhost:${info.port}/results.html?key=${ADMIN_KEY}`);
  if (!process.env.ADMIN_KEY) console.log(`(admin key also saved to ${path.relative(process.cwd(), ADMIN_KEY_FILE)})`);
});
