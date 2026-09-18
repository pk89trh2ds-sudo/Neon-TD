/**
 * Server functions for the daily seeded challenge leaderboard (`createServerFn`
 * — safe to import from client code; see the naming note in cloud-sync-api.ts
 * for why this is NOT named `*.server.ts`).
 *
 * Known v1 limitation: `wave` is trusted from the client (clamped to a sane
 * range, but not otherwise verified against real gameplay) — the same trust
 * model as most small-game leaderboards, not a claim that it's cheat-proof.
 */
import { createServerFn } from "@tanstack/react-start";
import { getSql } from "../db";
import { authMiddleware } from "../auth/middleware";
import { dayStamp } from "./types";

const MAX_LEADERBOARD_WAVE = 1000;

type ScoreInput = { day: string; wave: number; displayName: string };

function sanitizeScoreInput(input: unknown): ScoreInput {
  const v = input as Partial<ScoreInput> | null;
  if (!v || typeof v !== "object") throw new Error("Malformed score payload");
  const day = typeof v.day === "string" ? v.day : "";
  // Never trust the client's idea of "today" — reject anything else outright.
  if (day !== dayStamp()) throw new Error("Score is not for today's challenge");
  const wave = Math.floor(Number(v.wave));
  if (!Number.isFinite(wave) || wave < 1 || wave > MAX_LEADERBOARD_WAVE) {
    throw new Error("Wave out of range");
  }
  const displayName =
    String(v.displayName ?? "Operator")
      .trim()
      .slice(0, 24) || "Operator";
  return { day, wave, displayName };
}

export const submitDailyScore = createServerFn({ method: "POST" })
  .validator(sanitizeScoreInput)
  .middleware([authMiddleware])
  .handler(async ({ data, context }): Promise<{ best: number }> => {
    const sql = await getSql();
    const rows = await sql<{ wave: number }>`
      insert into daily_leaderboard (day, user_id, display_name, wave)
      values (${data.day}, ${context.userId}, ${data.displayName}, ${data.wave})
      on conflict (day, user_id) do update
        set wave = excluded.wave,
            display_name = excluded.display_name,
            submitted_at = now()
        where excluded.wave > daily_leaderboard.wave
      returning wave
    `;
    if (rows[0]) return { best: rows[0].wave };
    // Conflict update was skipped (existing score was already higher) —
    // read it back so the caller still learns the true best.
    const existing = await sql<{ wave: number }>`
      select wave from daily_leaderboard where day = ${data.day} and user_id = ${context.userId}
    `;
    return { best: existing[0]?.wave ?? data.wave };
  });

export const getDailyLeaderboard = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const day = typeof input === "string" && input ? input : dayStamp();
    return day;
  })
  .handler(async ({ data: day }): Promise<Array<{ displayName: string; wave: number }>> => {
    const sql = await getSql();
    const rows = await sql<{ display_name: string; wave: number }>`
      select display_name, wave from daily_leaderboard
      where day = ${day}
      order by wave desc, submitted_at asc
      limit 20
    `;
    return rows.map((r) => ({ displayName: r.display_name, wave: r.wave }));
  });
