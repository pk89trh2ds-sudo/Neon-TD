# Difficulty rebalance — design notes

Written alongside the PR that fixed the game being trivially easy (a player
reached wave 250 with 2 towers and only the Income Lab upgrade). This is the
reasoning behind the new numbers, so a future tuning pass doesn't have to
re-derive it from the diff.

## Root causes (pre-existing, all fixed here)

1. **`repair`'s purchase counter never incremented** (`engine.ts`) — its cost
   stayed flat (~178 scrap at wave 250) forever, making infinite max-core
   purchases nearly free.
2. **`maxCore` ratcheted upward** in three places — a heal's clamp to a cap
   was immediately overwritten by `maxCore = max(maxCore, coreHP)` on the
   next line, so per-kill/per-wave passive heals grew max core without
   bound over a long run.
3. **`killBounty` had no wave term** while every survival cost was also
   flat, so purchasing power per wave never degraded — wave 37 and wave 250
   had identical economics.
4. **Enemy count capped at wave 37, speed never scaled, spawn density
   capped at wave 120.** Every wave from 37 on was the same 66 enemies.
5. **Splash damage had no distance falloff and no target cap** — 45% damage
   to every enemy in radius, against a wave that got denser as it scaled,
   gave nova/tesla an 8–17x effective DPS multiplier that grew with wave
   number.
6. **Boss waves were relief waves** — the boss branch of `waveComposition`
   dropped bits and reduced tank/virus counts, so total wave HP dropped to
   38–76% of the preceding wave for most of the game, with zero UI telling
   the player anything different was happening.
7. **`endlessScaling` was too shallow** — only 30.6x HP over 250 waves,
   against a single tower rank-up giving 5x.
8. **Meta-currency awards scaled with the wave number on every clear**
   (`floor(wave/5)` skill points, `wave*8` pass XP) — +50 points and +2000
   XP for one wave-250 clear, against a 40-point/3000-XP total budget.

## Target curve

| Player state            | Dies around                       |
| ----------------------- | --------------------------------- |
| Fresh, no Lab ranks     | wave 25–35                        |
| Moderate Lab investment | wave 100 (difficulty-unlock gate) |
| Deep Lab investment     | wave ~200                         |

Reaching wave 100 on a difficulty unlocks the next one
(`DIFFICULTY_UNLOCK_WAVE` in `types.ts`), gated on the previous tier's
`highestByDifficulty` record — not the old global `highestWaveReached`,
which meant everything was already unlocked regardless of how it was
reached.

## Key formulas (see `types.ts`/`sim.ts` for the code)

- `endlessScaling(wave)`: early-log coefficient 0.48→0.55, late power kicks
  in at wave 25 (was 40) with exponent 1.28→1.42.
- `bossHealthMultiplier(wave) = 1 + floor(wave/10) * 0.15`, stacked on top
  of `endlessScaling` for boss-kind enemies only.
- `killBounty` now has a `1 + min(1.5, wave * 0.006)` multiplier — capped so
  it doesn't runaway-compound, but no longer flat forever.
- Enemy count caps: bits `min(46, 6 + wave*1.1)`, viruses
  `min(34, (wave-2)*0.9)`, tanks `min(26, (wave-5)/1.8)` — up from 28/22/16
  hit by wave 37.
- Splash: linear falloff from 100% at the primary target to 20% at the edge
  of `splashR`, capped at 6 secondary targets (`MAX_SPLASH_TARGETS`).
- Tower rank-up cost doubled (`TOWER[kind].cost * rank * 2`).
- In-run economy lines (income/bounty) use a steeper cost-growth exponent
  (1.32 vs 1.16) and a hard stack cap (12/10) — combat lines are uncapped
  but keep the gentler 1.16 curve.
- Boss waves now stack a full ordinary wave's worth of bits/viruses/tanks
  _underneath_ the boss(es), guaranteeing boss-wave total HP exceeds the
  wave immediately before it (asserted in `balance.test.ts` across waves
  10–250) — the old branch replaced most of the wave with bosses, which is
  what made it easier.

## Tuning tools

- `src/lib/game/balance.test.ts` — the objectively-checkable invariants
  (monotonic scaling, boss-wave-harder-than-preceding, cost curve
  regressions, difficulty gating). Run directly:
  `node --experimental-strip-types --test src/lib/game/balance.test.ts`
  (also wired into `npm run test`).
- `scripts/balance-sim.ts` — a headless sim harness for iterating on the
  curve without launching the browser. Fixed tower loadout, no economy loop
  (no Upgrades/Lab purchases modeled) — it isolates the enemy-scaling and
  combat math from the economy. Run:
  `node --experimental-strip-types scripts/balance-sim.ts`

Neither tool models the full in-run economy (buying Upgrades mid-run,
banking into the Lab between runs), so the wave-100/wave-200 targets above
still need confirming with a real playtest. Expect this to take a couple of
tuning passes — these are principled starting numbers derived from the old
math, not numbers verified against real play.

## Known simplification

The dev-mode toggle (7 taps on the Settings version string) permanently
tamper-flags the save the moment it's turned on, reusing the existing
save-integrity flag (`meta.ts`) rather than a second mechanism. This means
a save that ever used dev mode is excluded from the daily leaderboard and
analytics forever after, even if the toggle is switched back off. That's
intentional — a save that used unlimited resources even once shouldn't be
comparable to normal play — but it's worth knowing if a tester's save
"stops submitting" and wonders why.
