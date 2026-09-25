/**
 * `GET /api/health` — liveness + database round-trip. Server-only.
 *
 * Two jobs:
 *   1. An uptime/deploy smoke check: 200 when the function boots AND the DB
 *      answers, 503 otherwise (so a paused Supabase shows up as unhealthy
 *      instead of as scattered 500s from sign-in / cloud save / leaderboard).
 *   2. Keep-alive: a daily Vercel Cron hits this route (see `vercel.config.crons`
 *      in vite.config.ts), and the `select 1` is the DB activity that stops the
 *      Supabase free tier from auto-pausing the project after a quiet week.
 *
 * Wired in two places, same handler (the dual-wiring rule in CLAUDE.md):
 *   - server/middleware/health.ts (Nitro — build/preview/deploy)
 *   - `healthPlugin` in vite.config.ts (`npm run dev`)
 *
 * Deliberately returns no error detail: this route is public.
 */
import { dbSource, getSql } from "./db";

export async function handleHealth(): Promise<Response> {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  };
  try {
    const sql = await getSql();
    await sql`select 1`;
    return new Response(JSON.stringify({ ok: true, db: dbSource }), { status: 200, headers });
  } catch (err) {
    console.error("[health] database check failed:", err);
    return new Response(JSON.stringify({ ok: false, db: dbSource }), { status: 503, headers });
  }
}
