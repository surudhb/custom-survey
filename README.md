# custom-survey

A tiny **ranked-choice survey** for picking a group activity. People drag the
options into their preferred order — the order *is* their ranking, so it's
impossible to rank two things the same or skip one. Anonymous, editable, no
accounts.

Built for "what should we actually do for the birthday / offsite / trip?", but
the options, title, date and venues are all just config. Runs on **Node**
(`npm start`) or **Cloudflare Workers** (free tier, `git push` to deploy).

> The screenshots and the committed `config.json` use a made-up event
> ("Alex's Birthday Bash", generic venues). Drop in your own details before you
> share it.

<p align="center">
  <img src="docs/screenshots/01-vote.png" width="30%" alt="Ranking view">
  <img src="docs/screenshots/02-drag.png" width="30%" alt="Drag to reorder">
  <img src="docs/screenshots/03-thanks.png" width="30%" alt="Thanks view">
</p>
<p align="center">
  <img src="docs/screenshots/04-results.png" width="30%" alt="Live results">
  <img src="docs/screenshots/05-theme.png" width="30%" alt="Colour themes">
  <img src="docs/screenshots/06-drumroll.png" width="30%" alt="Drumroll">
</p>
<p align="center">
  <img src="docs/screenshots/07-winner.png" width="46%" alt="Winner reveal">
</p>

## Features

- **Drag-to-rank** — reorderable list (pointer + touch), animated: the dragged
  card lifts and tilts, the others slide to open a gap, everything renumbers on
  drop. No "same rank" or "skipped option" states are possible.
- **Anonymous** — no name/email. Each browser gets a random private token in
  `localStorage`; that's the only thing tying a response to a person. Copy the
  token to edit the same response from another device.
- **Editable** — submit again to overwrite. A thank-you screen offers *edit your
  response* and *see what others picked* (a live Borda-count leaderboard).
- **Confetti** on submit, plus a *More confetti* button that fires from a fresh
  origin each press.
- **11 light colour themes** — one button, top-right, cycles them; choice is
  remembered. White surfaces stay white, backgrounds stay gradient, fonts don't
  change.
- **Drumroll reveal** — after the submission deadline, visitors get a drum with a
  slider: sliding speeds up the drumsticks, and reaching the end fires confetti
  and reveals the winning activity with its location, address, time and a Google
  Maps link.

## Quick start (local)

Requires Node.js 18+.

```bash
npm install
npm start           # Node + flat file, http://localhost:3000
```

On first run it prints an admin key (also saved to `admin_key.txt`) — the
results page is `/results.html?key=<key>`.

To exercise the exact Cloudflare runtime + KV locally instead:

```bash
npm run dev         # wrangler dev, http://localhost:8787 (local KV simulation)
```

## Configure

Everything lives in [`config.json`](config.json):

| Field | What it does |
| --- | --- |
| `title` | Heading on the form |
| `description` | Instruction line under the photos |
| `dateLabel` | Short date shown under the title (e.g. `"March 15"`) |
| `activities` | The options to rank (2+; any number) |
| `submissionsCloseAt` | Local datetime, no timezone — after this, visitors get the drumroll/winner view and new votes are rejected |
| `event.time` | Full date/time shown on the winner screen |
| `event.venues` | Per-activity `{ location, address, mapsUrl }`. Only the winner's is shown; if `mapsUrl` is blank a Google Maps search link is built from the address |

The two photos on the form are placeholders — replace the `src` of
`.photo--left` / `.photo--right` in [`public/index.html`](public/index.html) with
real images (or `data:` URIs).

Keeping real names/dates/venues out of git: put them in `config.real.json`
(git-ignored) and `cp config.real.json config.json` before you deploy. On
Workers, `config.json` is bundled at build time, so changing it = redeploy.

## Deploy — Cloudflare Workers (free, no card, `git push` to ship)

Storage is **Workers KV**; static files are served by Cloudflare's asset
hosting; the Worker only handles `/api/*`. Free tier limits (100k KV reads/day,
1k writes/day, 1 GB) are far more than a group poll needs.

See **[docs/deploy-cloudflare.md](docs/deploy-cloudflare.md)** for the full
click-by-click setup. Short version:

1. Create a free Cloudflare account (no credit card).
2. `npx wrangler login`
3. `npx wrangler kv namespace create SURVEY_KV` → paste the printed `id` into
   [`wrangler.toml`](wrangler.toml).
4. In the dashboard, **Workers & Pages → Create → Connect to Git** → pick this
   repo. Build command `npm ci`, deploy command `npx wrangler deploy`.
5. First build runs; then set the admin key:
   `npx wrangler secret put ADMIN_KEY` (or add it as an encrypted variable in
   the Worker's Settings).
6. Every `git push` to `main` redeploys. KV data persists across deploys.

> KV list is eventually consistent — a brand-new vote can take up to ~60s to
> show in the tally. Fine for a poll.

## Deploy — Cloudflare Tunnel (self-host, no account, no signup)

Run the Node server on any machine you can leave on until the event and expose
it with a free quick tunnel. Truly zero-signup; storage is your own disk.

One-time: `brew install cloudflared` (macOS) or see the
[downloads page](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).

```bash
./run-public.sh
```

Starts the server (votes in `./data/`), opens the tunnel, restarts either half
if it dies, keeps a Mac awake. Prints a `https://<random>.trycloudflare.com`
URL — the link to share. `Ctrl+C` stops everything.

**The quick-tunnel URL is not stable** — it changes if `cloudflared` restarts.
For a permanent URL use a named tunnel (free Cloudflare account + a domain on
Cloudflare):

```bash
cloudflared tunnel login
cloudflared tunnel create custom-survey
cloudflared tunnel route dns custom-survey survey.yourdomain.com
cloudflared tunnel run --url http://localhost:3000 custom-survey   # run `npm start` alongside
```

## Deploy — Docker / any host with a disk

```bash
docker build -t custom-survey .
docker run -p 3000:3000 -v survey-data:/data custom-survey
```

The Node server reads/writes its vote file at `$DATA_DIR` (default: the project
folder). Any host works if it gives that path a persistent volume; on free tiers
**without** one, `data.json` is wiped on every restart.

## How it works

| Route | |
| --- | --- |
| `GET /api/config` | public config (title, activities, deadline, event) |
| `GET/POST/DELETE /api/vote/:token` | a respondent's own entry; `POST` must be a clean permutation of `activities` and is refused after `submissionsCloseAt` |
| `GET /api/summary` | public aggregate — Borda points per activity + count, **no per-response data** |
| `GET /api/results?key=<admin key>` | full breakdown incl. per-rank counts |

The API routes ([`src/app.js`](src/app.js)) are shared verbatim between the two
runtimes; only storage differs:

| | entry point | storage |
| --- | --- | --- |
| Node / self-host | [`server.js`](server.js) | [`src/store-file.js`](src/store-file.js) → `data.json` (`{ "responses": { "<token>": { ranking, updatedAt } } }`) |
| Cloudflare Workers | [`worker.js`](worker.js) | [`src/store-kv.js`](src/store-kv.js) → KV, one key per response (`resp:<token>`) |

Admin key: `ADMIN_KEY` env / secret if set, otherwise (Node only) auto-generated
into `admin_key.txt`.

## Regenerating the screenshots

```bash
npm install          # dev dep: puppeteer-core (uses your system Chrome)
npm start            # in another shell
npm run screenshots
```

Writes `docs/screenshots/*.png`, seeding and then clearing a handful of throwaway
votes so the results/winner views have data.

## License

MIT — see [LICENSE](LICENSE).
