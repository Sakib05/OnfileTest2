import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// Drizzle Kit CLI commands (push/generate/migrate/studio) are run outside of
// Next.js, so they don't get Next's automatic .env loading — hence the
// explicit `dotenv/config` import above. `dotenv` is already a project
// dependency for exactly this reason.
//
// IMPORTANT: this file intentionally reads the connection string from
// `DATABASE_URL` instead of hard-coding one. A previous `drizzle.config.json`
// in this repo hard-coded `postgresql://postgres:postgres@127.0.0.1:5432/app_db`,
// which happens to match this sandbox's local development database but would
// silently point production schema pushes at the wrong database (or fail
// outright) anywhere else, including Vercel + Supabase. `drizzle-kit` does
// not support environment-variable interpolation inside a `.json` config, so
// a `.ts` config (the format Drizzle Kit's own docs recommend) is required to
// read `process.env.DATABASE_URL` safely.
//
// Supabase note: `DATABASE_URL` should point at a *direct* (non-pgbouncer/
// non-"transaction pooler") Postgres connection for running `drizzle-kit
// push`/`generate`/`migrate` — Supabase's pooled connection string (port
// 6543, `pgbouncer=true`) does not support the session-level features
// Drizzle Kit's DDL commands need. The app's own runtime queries (via
// src/db/index.ts) can use either, but for consistency and to avoid two
// different connection strings to manage, prefer the direct connection for
// `DATABASE_URL` unless you have a specific reason to pool.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
