import { getDb, pings } from "@survey/db";
import type { Route } from "./+types/home";

export function meta(_: Route.MetaArgs) {
  return [{ title: "custom-survey spike" }];
}

// Loader runs on the Worker with access to Cloudflare bindings — reads D1
// directly, proving the framework side (not just the Hono API) can query the DB.
export async function loader({ context }: Route.LoaderArgs) {
  const db = getDb(context.cloudflare.env.DB);
  const rows = await db.select().from(pings);
  return {
    message: context.cloudflare.env.VALUE_FROM_CLOUDFLARE,
    pingCount: rows.length,
  };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  return (
    <main style={{ fontFamily: "system-ui", padding: "3rem", lineHeight: 1.6 }}>
      <h1>custom-survey — deploy-wiring spike ✅</h1>
      <p>
        React Router v7 (Framework Mode) + Hono API + D1 (Drizzle), one Worker,
        pnpm + Turborepo monorepo.
      </p>
      <ul>
        <li>
          RR loader read env var: <code>{loaderData.message}</code>
        </li>
        <li>
          RR loader read D1: <code>{loaderData.pingCount}</code> ping row(s)
        </li>
        <li>
          API (Hono): <a href="/api/health">/api/health</a> ·{" "}
          <a href="/api/db-ping">/api/db-ping</a>
        </li>
      </ul>
    </main>
  );
}
