# PR 0 — deploy-wiring spike (hard gate)

Throwaway proof that the chosen v2 stack deploys on the **same free, no-credit-card,
git-push Cloudflare Worker** as today. Nothing here is the real app — it's the minimum
that exercises every moving part end to end. PR B builds the real monorepo from this
proven recipe; this `spike/` directory is deleted once PR B lands.

## What it proves (all verified locally, no account touched)

| Piece | Proof |
| --- | --- |
| pnpm + Turborepo monorepo | `apps/web` consumes `@survey/db` via `workspace:*`; `pnpm build` / `pnpm typecheck` run through turbo |
| React Router **v7 (7.9.6)** Framework Mode, SSR on Workers | `app/routes/home.tsx` renders server-side |
| Hono `/api/*` on the **same** Worker | `workers/app.ts`: Hono owns routing, `/api/*` handled there, everything else → RR request handler |
| Cloudflare **D1 + Drizzle** | `packages/db` schema → `drizzle-kit generate` → `wrangler d1 migrations apply` → read/write |
| Framework **and** API both reach D1 | RR loader (`home.tsx`) and Hono (`/api/db-ping`) both query D1 |
| Deployable build | `wrangler deploy --dry-run` clean, DB binding recognized (~187 KiB gzip) |

Observed in dev (`pnpm --filter @survey/web dev`):

```
GET  /api/health   → {"ok":true,"via":"hono","value":"Hello from Hono/CF"}
GET  /api/db-ping  → {"ok":true,"count":0,"latest":[]}
POST /api/db-ping  → {"ok":true,"inserted":{"id":1,"note":"spike works",...}}
GET  /api/db-ping  → {"ok":true,"count":1,...}
GET  /             → SSR page: "…read D1: 1 ping row(s)"   (loader read D1)
```

## Reproduce locally

```bash
cd spike
pnpm install
pnpm --filter @survey/db generate                                   # schema → migration SQL
pnpm --filter @survey/web exec wrangler d1 migrations apply custom-survey-spike --local
pnpm --filter @survey/web dev                                       # http://localhost:5173
pnpm build && pnpm typecheck                                        # both green
```

## Handoff — the account-touching steps (you run these; they were NOT done)

These need your Cloudflare account and can't be verified offline. Run from `spike/apps/web`:

1. **Create the D1 database** and paste the returned `database_id` into
   `apps/web/wrangler.jsonc` (replacing `local-dev-placeholder`):
   ```bash
   pnpm dlx wrangler d1 create custom-survey-spike
   ```
2. **Apply the migration to the remote DB:**
   ```bash
   pnpm dlx wrangler d1 migrations apply custom-survey-spike --remote
   ```
3. **Deploy to a preview Worker:**
   ```bash
   pnpm build && pnpm dlx wrangler deploy
   ```
   Then `curl https://custom-survey-spike.<subdomain>.workers.dev/api/health` and open `/`.
4. **Git build (dashboard):** point a Worker's build at this repo with
   **Build command** `pnpm install && pnpm --filter @survey/web build` and
   **Deploy command** `pnpm --filter @survey/web exec wrangler deploy`, with a
   pre-deploy `wrangler d1 migrations apply … --remote` step.

If all four are green, the gate passes and PR B proceeds. If any can't be made to work on
the free / git-push flow, we stop and reconsider the stack (per the plan).

## Notes / gotchas found

- The Cloudflare RR template ships **without** the load-context type augmentation, so
  `context.cloudflare` is `unknown` in loaders and `tsc` fails. Fixed in
  `app/load-context.ts` (declares `AppLoadContext`). Carry this into the real app.
- Hono's bundled `ExecutionContext` type lags the runtime types from `wrangler types`
  (missing `tracing`/`abort`); cast at the one boundary in `workers/app.ts`.
- `wrangler types` now supersedes `@cloudflare/workers-types`; the real app should drop
  that dep and rely on generated runtime types (kept here only for `packages/db`'s
  `D1Database` import — revisit in PR C).
