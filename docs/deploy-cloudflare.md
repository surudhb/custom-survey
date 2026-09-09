# Deploying to Cloudflare Workers

End-to-end setup for hosting `custom-survey` on the Cloudflare Workers free
tier, with `git push` auto-deploys and vote storage in Workers KV.

**Cost:** $0. No credit card. One free Cloudflare account.

You'll do this once; after that, deploying a code change is just `git push`.

---

## 0. Prerequisites

- The repo pushed to GitHub (`surudhb/custom-survey`).
- Node 18+ locally (for the one-time `wrangler` commands). `npx wrangler …`
  works without installing anything globally — it uses the `wrangler` dev
  dependency already in `package.json`.

---

## 1. Create a free Cloudflare account

1. Go to <https://dash.cloudflare.com/sign-up>.
2. Sign up with email + password. **No credit card is asked for** — the Workers
   free plan doesn't require one.
3. Verify your email. You do **not** need to add a domain; skip any
   "add a site" prompt.

---

## 2. Log wrangler into that account

From the project directory:

```bash
npx wrangler login
```

A browser window opens — click **Allow**. This stores a token in
`~/.wrangler` so the next commands can create resources in your account.

Check it worked:

```bash
npx wrangler whoami
```

---

## 3. Create the KV namespace (the vote store)

```bash
npx wrangler kv namespace create SURVEY_KV
```

It prints something like:

```
[[kv_namespaces]]
binding = "SURVEY_KV"
id = "0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d"
```

Open [`wrangler.toml`](../wrangler.toml) and replace the placeholder id with the
real one:

```toml
[[kv_namespaces]]
binding = "SURVEY_KV"
id = "0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d"   # <- your id
```

**The id is not a secret.** It's a resource handle — like a database name. It
does nothing without an API token scoped to your account, Cloudflare's tooling
expects it in this committed file, and it appears in thousands of public repos.
Safe to commit.

```bash
git add wrangler.toml
git commit -m "Set KV namespace id"
git push
```

> Want it out of the repo anyway? Delete the `[[kv_namespaces]]` block and add
> the binding in the dashboard (Worker → **Settings** → **Bindings** → **Add** →
> **KV namespace**, binding name `SURVEY_KV`). Git-connected builds pick up
> dashboard bindings; a bare `npx wrangler deploy` would then need
> `--kv-namespace SURVEY_KV=<id>`.

---

## 4a. Deploy — option A: connect the GitHub repo (recommended)

This gives you push-to-deploy.

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Workers** tab →
   **Import a repository** (aka "Connect to Git").
2. Authorize Cloudflare's GitHub app, grant it access to
   `surudhb/custom-survey`, and select that repo.
3. Build settings:
   - **Project name:** `custom-survey` (this becomes
     `custom-survey.<your-subdomain>.workers.dev`)
   - **Production branch:** `main`
   - **Build command:** `npm ci`
   - **Deploy command:** `npx wrangler deploy`
   - **Root directory:** `/` (leave default)
4. Click **Create and deploy**. The first build runs (~1 min); when it's green
   you have a live URL: `https://custom-survey.<subdomain>.workers.dev`.

From now on: **every push to `main` redeploys automatically.** Watch builds
under the Worker → **Deployments**.

## 4b. Deploy — option B: CLI only (no repo connection)

If you'd rather not connect GitHub:

```bash
npx wrangler deploy
```

Redeploy the same way whenever you change code. (You can do both — connect the
repo *and* still run `wrangler deploy` manually.)

---

## 5. Set the secrets

Set these **after the first deploy** (the Worker has to exist first). Neither is
ever written to the repo.

### `ADMIN_KEY` (required for the results page)

```bash
npx wrangler secret put ADMIN_KEY
# paste a value you choose, e.g. a long random string — press Enter
```

### `CONFIG` (to run your real event instead of the committed demo)

The repo's `config.json` is a made-up event. Put your real one in as a secret so
real names / dates / venues never touch git:

```bash
# minify config.real.json to one line and pipe it in:
node -e "process.stdout.write(JSON.stringify(require('./config.real.json')))" | npx wrangler secret put CONFIG
```

(or `npx wrangler secret put CONFIG` and paste the single-line JSON yourself).
Leave it unset to serve the demo config. `wrangler secret put` re-deploys the
Worker on its own, so the new config is live within seconds — no code change.

Either secret can also be set in the dashboard: Worker → **Settings** →
**Variables and Secrets** → **Add** → type **Secret**.

Your results URL is then:

```
https://custom-survey.<subdomain>.workers.dev/results?key=<the ADMIN_KEY value>
```

(Until `ADMIN_KEY` is set, `/api/results` returns 403 — the public form and
`/api/summary` work regardless.)

---

## 6. Verify

```bash
BASE=https://custom-survey.<subdomain>.workers.dev

curl -s $BASE/api/config | head -c 200            # your config JSON
curl -s -X POST $BASE/api/vote -H 'content-type: application/json' \
  -d '{"token":"probe-token-123456","ranking":[<your activities, any order>]}'
curl -s $BASE/api/summary                          # totalResponses: 1
curl -s "$BASE/api/results?key=<ADMIN_KEY>" | head -c 200
curl -s -X DELETE $BASE/api/vote/probe-token-123456
```

Then open `$BASE` in a browser and submit a real ranking.

---

## 7. Day-to-day

| Task | Do this |
| --- | --- |
| Ship a code change | `git push` (option A) or `npx wrangler deploy` |
| Change the event (title, activities, dates, venues, deadline) | update the `CONFIG` secret (`npx wrangler secret put CONFIG` with the new JSON) — no code change, no commit |
| Read all responses | `GET /results?key=…` in a browser |
| Reset all votes | dashboard → Worker → **KV** → `SURVEY_KV` → delete the `resp:*` keys, or `npx wrangler kv key list --binding SURVEY_KV` then `... delete` |
| See logs | dashboard → Worker → **Logs** (live tail), or `npx wrangler tail` |

---

## Custom domain (optional)

`*.workers.dev` is free and permanent — fine to share as-is. If you want
`survey.yourdomain.com` and the domain's nameservers are on Cloudflare:
Worker → **Settings** → **Domains & Routes** → **Add** → **Custom domain**.

---

## Notes & gotchas

- **KV is eventually consistent.** `/api/summary` and `/api/results` list KV
  keys; a just-cast vote can take up to ~60s to appear in the tally globally.
  Individual `GET /api/vote/:token` (what the "edit your response" flow uses) is
  read-your-writes consistent in the same region and near-instant.
- **Free tier writes:** 1,000 KV writes/day. Each submit or edit is one write —
  a poll with dozens of guests is nowhere near the limit.
- **Config is runtime-injected.** The Worker reads the `CONFIG` secret if set,
  else falls back to the committed demo `config.json`. So your real event
  details never enter git, and updating the event is a `wrangler secret put`,
  not a deploy.
- **Nothing sensitive is committed.** `ADMIN_KEY` and `CONFIG` are secrets;
  `data*`, `admin_key.txt`, `config.real.json`, `.dev.vars` are git-ignored. The
  KV namespace `id` in `wrangler.toml` is a resource handle, not a credential.
- **Local testing of this exact path:** `npm run dev` (wrangler dev) uses a
  local KV simulation and reads secrets from `.dev.vars` (copy
  `.dev.vars.example`) — no account needed, data lives under `.wrangler/`.
- **`nodejs_compat` is not required** — the Worker code uses only web-standard
  APIs plus the KV binding.
