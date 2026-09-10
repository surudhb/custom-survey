# Onboarding: the `custom-survey` v2 stack

For someone comfortable with general web development (TypeScript, HTTP, git) but new to
this specific stack. It explains **what each tool is, why it's here, and how the pieces
fit** — then where to put things when you build a feature.

> Status: the v2 architecture is being built on the `v2` branch. A working, minimal
> instance of the whole stack already exists under `spike/` (see the end of this doc).

---

## TL;DR mental model

It's **one program that runs at the edge** (on Cloudflare's servers worldwide), written in
TypeScript. That one program does two jobs:

1. **Serves the web pages** (React, rendered on the server first) — via **React Router v7**.
2. **Answers API calls** at `/api/*` — via **Hono**.

Both jobs share one database (**Cloudflare D1**, a SQLite database) which we query through
**Drizzle** (a type-safe query builder). The code is a **monorepo** (several packages in one
repo) run by **pnpm** + **Turborepo**. You deploy with `git push` — Cloudflare builds and
ships automatically. No servers to manage, no bill (free tier), no credit card.

If you've built "a Node/Express app with a React frontend and a Postgres database on a VPS,"
this is the same *shape*, but: Express→Hono, VPS→Cloudflare Workers, Postgres→D1, and the
frontend + backend are **one deployable** instead of two.

---

## The tools, one at a time

### Cloudflare Workers — *where the code runs*
Instead of a long-running Node server on a rented machine, your code runs as a **Worker**: a
function Cloudflare spins up on demand, close to each user, per request. Think "serverless
function, but fast and everywhere."

- **Why:** free tier, no credit card, auto-scales, deploy via `git push`.
- **The catch to internalize:** it is **not Node.js**. It's a web-standard runtime (like a
  browser without a DOM). You use `fetch`, `Request`, `Response`, Web Crypto — not `fs`, not
  `process`, and not npm packages that assume Node. (This is why session signing uses
  `crypto.subtle`, not Node's `crypto`.)
- **Bindings:** a Worker reaches external resources (database, storage, secrets) through
  **bindings** handed to your code at runtime as `env.DB`, `env.SURVEY_KV`, etc. You declare
  them in `wrangler.jsonc`; you never open a connection string.

### D1 — *the database*
Cloudflare's **SQLite** database, exposed as a binding (`env.DB`). Real SQL: tables, joins,
indexes, transactions.

- **Why:** unlocks the roadmap features — multiple events, "who hasn't responded yet,"
  analytics — that a key-value store made painful. Free, same deploy flow.
- **Migrations:** schema changes are versioned `.sql` files in `packages/db/migrations/`,
  applied with `wrangler d1 migrations apply` (`--local` for dev, `--remote` for production).

### Drizzle (ORM) — *how we query D1*
A **type-safe query builder**. Define tables once in TypeScript (`packages/db/src/schema.ts`);
Drizzle gives autocomplete + compile-time checks on every query and can **generate** the
migration SQL when the schema changes.

```ts
// Fully typed — misspell a column and TS errors:
const rows = await db.select().from(pings).orderBy(desc(pings.id)).limit(5);
```
Workflow: edit `schema.ts` → `pnpm --filter @survey/db generate` → `wrangler d1 migrations apply`.

### React Router v7 — "Framework Mode" — *the web app*
Historically React Router was just client-side routing. **v7 Framework Mode** is a full
**full-stack React framework** (the successor to Remix). Key ideas:

- **File-based routes:** a file in `app/routes/` = a URL. `home.tsx` → `/`.
- **Loaders** (server-side data fetching): each route exports a `loader()` that runs **on the
  Worker** before render, with access to bindings (`context.cloudflare.env.DB`), and returns
  data to the component. No `useEffect`+`fetch` for initial data.
- **Actions** (server-side writes): a route's `action()` handles form submissions / mutations,
  also on the server.
- **SSR:** pages render to HTML on the server first (fast first paint, works without JS), then
  React "hydrates" them for interactivity.

```ts
export async function loader({ context }: Route.LoaderArgs) {
  const db = getDb(context.cloudflare.env.DB);   // runs on the Worker
  return { pingCount: (await db.select().from(pings)).length };
}
export default function Home({ loaderData }: Route.ComponentProps) {
  return <p>{loaderData.pingCount} pings</p>;    // renders with that data
}
```
If you know Next.js: loaders ≈ server components' data fetching; actions ≈ server actions.

### Hono — *the API layer*
A tiny, fast web framework (like Express, built for edge runtimes). We use it for **`/api/*`**
— a stable, versioned JSON API (`/api/v1/...`) a future mobile app, integration, or admin CLI
could call, separate from the web pages.

The integration trick (`workers/app.ts`): Hono is the top-level handler; it answers `/api/*`
itself and lets **everything else fall through to React Router**. One Worker, two jobs:

```ts
const app = new Hono<{ Bindings: Env }>();
app.get("/api/health", (c) => c.json({ ok: true }));
app.all("*", (c) => rrHandler(c.req.raw, { cloudflare: { env: c.env, ctx: c.executionCtx } }));
export default app;
```

### TypeScript + Zod — *the shared contract*
Strict typing across the codebase. The payoff: the **API contract is typed once** (in
`packages/contract`, using **Zod** schemas) and shared by server and browser, so a change to a
request/response shape is a compile error on both sides, not a runtime surprise.

**Zod** is runtime *validation* that also *produces* the TS type — one schema validates an
incoming body **and** is the source of its type, so "what we check" and "what we typed" can't
drift apart.

### Tailwind v4 + shadcn/ui — *styling & components* (arriving in the UI rebuild)
- **Tailwind v4:** utility CSS classes (`flex items-center gap-3`) plus CSS-variable theming
  that drives the 11 runtime color themes.
- **shadcn/ui:** accessible component *primitives* you **copy into the repo** (not a black-box
  dependency) — Slider, Toast, Collapsible, Dialog. You own and can edit them.
- **dnd-kit:** the maintained drag-and-drop library replacing the hand-rolled pointer code for
  the ranking list.

### pnpm + Turborepo — *the monorepo*
- **pnpm:** fast package manager with first-class **workspaces** — multiple packages
  (`apps/web`, `packages/db`, …) in one repo depending on each other via
  `"@survey/db": "workspace:*"`.
- **Turborepo:** runs tasks (`build`, `typecheck`, `test`) across packages, in the right order,
  in parallel, with caching. `pnpm build` at the root builds everything once and reuses cache.

### Vite / Wrangler — *build & run* (you rarely call these directly)
- **Vite:** the bundler/dev-server under React Router; `pnpm dev` gives hot reload.
- **Wrangler:** Cloudflare's CLI — runs the Worker locally (`wrangler dev`), applies D1
  migrations, manages secrets, deploys.

---

## The architecture (target layout)

```
custom-survey/                    ← pnpm workspace + turbo
├─ apps/
│  └─ web/                        ← the deployable Worker (RR7 + Hono)
│     ├─ app/
│     │  ├─ routes/               ← pages (loaders/actions run server-side)
│     │  ├─ components/           ← React UI (built on shadcn primitives)
│     │  └─ load-context.ts       ← types the Cloudflare bindings for loaders
│     ├─ workers/app.ts           ← Worker entry: Hono /api + RR fallthrough
│     └─ wrangler.jsonc           ← bindings (DB, KV), config, deploy settings
├─ packages/
│  ├─ core/                       ← framework-free business logic (pure TS)
│  │  ├─ tally.ts                 ←   ranked-choice math (one place)
│  │  ├─ session.ts               ←   HMAC device-identity signing
│  │  └─ question-types/          ←   "ranking" is one pluggable type; more later
│  ├─ contract/                   ← Zod schemas + inferred types = the API contract
│  └─ db/                         ← Drizzle schema, migrations, D1 client
└─ turbo.json / pnpm-workspace.yaml
```

**Most important principle:** business rules live in `packages/core` and know *nothing* about
React, Hono, or Cloudflare. The frameworks are **delivery mechanisms** wrapped around a pure,
testable core. That's what makes it extensible — a second frontend, a CLI, or a new question
type all reuse the same core.

### How a request flows

Submitting a ranking:
```
Browser → POST /api/v1/vote
  → Cloudflare routes it to your Worker
  → workers/app.ts: matches /api/* → Hono
  → Hono handler: validates the body with a Zod schema (packages/contract)
  → calls a service using packages/core (session check, dedupe)
  → writes via Drizzle → env.DB (D1)
  → returns JSON
```
Loading the invite page:
```
Browser → GET /
  → workers/app.ts: not /api/* → React Router handler
  → home route loader() runs on the Worker, reads D1 via Drizzle
  → page renders to HTML (SSR), sent to the browser, then hydrates
```

---

## Working in it day-to-day

**First-time setup**
```bash
pnpm install                                    # install all packages
pnpm --filter @survey/db generate               # generate migration from schema
pnpm --filter @survey/web exec wrangler d1 migrations apply <db> --local
pnpm --filter @survey/web dev                   # local dev (http://localhost:5173)
```

**Common commands (from the repo root)**

| Task | Command |
| --- | --- |
| Run the app locally | `pnpm dev` |
| Build everything | `pnpm build` |
| Typecheck | `pnpm typecheck` |
| Change the DB schema | edit `packages/db/src/schema.ts` → `pnpm --filter @survey/db generate` → apply |
| Regenerate binding types | `pnpm --filter @survey/web cf-typegen` (after editing `wrangler.jsonc`) |
| Deploy | `git push` (Cloudflare builds & ships) — or `wrangler deploy` manually |

**"Where do I put a…?"**

- **New page** → a file in `apps/web/app/routes/` (+ a `loader` if it needs data).
- **New API endpoint** → a route in the Hono app + a Zod schema in `packages/contract`.
- **New business rule / calculation** → `packages/core` (with a unit test).
- **New table / column** → `packages/db/src/schema.ts`, then generate + apply a migration.
- **New UI piece** → a component in `apps/web/app/components/` (reach for a shadcn primitive).

**Secrets & config** (never committed): `ADMIN_KEY`, `SESSION_SECRET`, and event config live as
Cloudflare **secrets** (`wrangler secret put NAME`), not in the repo. Bindings (the D1/KV
*handles*) live in `wrangler.jsonc` and are safe to commit — an id is useless without an
account-scoped API token.

---

## Coming from Node.js? Gotchas cheat-sheet

- No `fs`, `path`, `process.env` (use bindings/secrets via `env`), no `Buffer` in most places
  (use `Uint8Array` / Web APIs).
- No long-lived global state between requests — a Worker isolate can be recycled anytime.
  Persistent state goes in D1 / KV, not module-level variables.
- Crypto is **Web Crypto** (`crypto.subtle`, `crypto.randomUUID`), async, not Node's `crypto`.
- Many npm packages won't run; prefer ones that declare Workers/edge support.
- `console.log` shows up in `wrangler tail` (live logs) and the dashboard, not a terminal.

## React Router: loaders vs. actions (quick primer)

- **`loader`** = server-side **GET**. Runs before render, returns data to the component via
  `loaderData`. Use it for anything the page needs to display.
- **`action`** = server-side **POST/PUT/DELETE**. Handles a `<Form>` submission or a
  `fetcher.submit`; after it runs, affected loaders re-run automatically so the UI reflects
  the change. Use it for mutations.
- Both receive `{ request, params, context }`; `context.cloudflare.env` is where the bindings
  live. Neither ships to the browser — they're server code, so it's safe to touch the DB and
  secrets there.

---

## The concrete example that exists today

The `spike/` folder (branch `v2`) is a working, minimal instance of this exact architecture —
built to prove it deploys on the free Cloudflare flow. Read these three files to see the real
thing in ~40 lines each:

- `spike/apps/web/workers/app.ts` — the Hono `/api` + React Router split.
- `spike/packages/db/src/schema.ts` — a Drizzle table.
- `spike/apps/web/app/routes/home.tsx` — a loader reading D1.

`spike/README.md` has the local reproduce steps. The full app is built out from this recipe in
the migration PRs (see the plan). This doc grows as those land.
