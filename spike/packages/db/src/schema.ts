import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Spike table only — proves schema → migration → D1 read/write end to end.
// The real events/activities/responses/rankings schema arrives in PR C.
export const pings = sqliteTable("pings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  note: text("note").notNull(),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch())`),
});
