import { defineConfig } from "drizzle-kit";

// `drizzle-kit generate` writes SQL migrations to ./migrations, which wrangler
// applies to D1 via `wrangler d1 migrations apply` (see apps/web/wrangler.jsonc
// migrations_dir). Dialect is plain sqlite — D1 is SQLite under the hood.
export default defineConfig({
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "sqlite",
});
