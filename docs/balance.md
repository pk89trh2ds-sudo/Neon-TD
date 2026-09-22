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

## Measured against the target — still off by ~10x

The target table above is **not** what the current numbers produce. Measured
with `scripts/economy-sim.ts` (real cost curves, real kill income, real leak
rules, a greedy buyer, normal difficulty):

| Player state            | Target | Measured | Whole map maxed by |
| ----------------------- | ------ | -------- | ------------------ |
| Fresh, no Lab ranks     | 25–35  | **370**  | wave 89            |
| Moderate Lab investment | ~100   | **400**  | wave 79            |
| Deep Lab investment     | ~200   | **430**  | wave 69            |

A fresh profile takes **2 leaks in 369 waves** and then dies abruptly. No
wave in any of the three runs was unclearable, so nothing is being forgiven
by the harness — the run really is that safe until it isn't.

Two separate problems:

1. **Absolute difficulty is ~10x too low** for a player who builds. The
   2-tower case the rebalance targeted _is_ fixed (`balance-sim.ts`: dies
   wave 9, was wave 250+). Filling the map is not.
2. **Permanent progression barely matters.** Fresh → deep moves the death
   wave by 60 waves (16%) across the entire Lab/skill range. The three
   profiles converge because in-run scrap, not Lab rank, is what actually
   builds the defence.

Root cause of both: **total tower investment is bounded by the tile count
while kill income is unbounded.** There are 62 buildable tiles; filling and
maxing every one costs roughly 52k scrap total, and from ~wave 100 a single
wave pays out thousands. So every profile converges on the same terminal
state — full map, every tower at MAX_RANK — within 90 waves, and the only
sink left is the uncapped dmg/rng/rate lines, which buy a flat +6%/+5% at
`1.16^n`, i.e. damage growing logarithmically in cumulative scrap. That
plateau is the same for everyone, so everyone dies where `endlessScaling`
crosses it.

Steepening `endlessScaling` alone would pull all three numbers down together
without widening the spread — it moves the crossover, not the plateau.
Fixing (2) means either making permanent ranks multiplicatively stronger,
or making in-run coverage something the player has to be Lab-invested to
afford (lower kill income, steeper rank costs), so that a fresh player
cannot reach the terminal build. That is a design decision, not a
retune — deliberately left open here rather than guessed at.

`DIFFICULTY_UNLOCK_WAVE = 100` is also worth revisiting in that light: it
sits below the ~370 floor, so in practice it gates nothing.

## Tuning tools

- `src/lib/game/balance.test.ts` — the objectively-checkable invariants
  (monotonic scaling, boss-wave-harder-than-preceding, cost curve
  regressions, difficulty gating). Run directly:
  `node --experimental-strip-types --test src/lib/game/balance.test.ts`
  (also wired into `npm run test`).
- `src/lib/game/meta.test.ts` — save-integrity guard and the save
  migrations around it (dev-mode taint surviving an export/import round
  trip, locked-difficulty clamping). Also in `npm run test`.
- `scripts/balance-sim.ts` — fixed tower loadout, no economy loop. Isolates
  the enemy-scaling and combat math. Answers "is the curve itself sane".
  `node --experimental-strip-types scripts/balance-sim.ts`
- `scripts/economy-sim.ts` — the same sim with the in-run economy closed:
  scrap income, tower placement/ranks, Upgrade purchases, leaks. This is
  the one that measures the target table above. Takes optional
  `<tier> <maxWave> [--trace]`:
  `node --experimental-strip-types scripts/economy-sim.ts normal 600`

Neither harness models modules, glyphs/ciphers, prestige or rolled offers,
all of which favour the player — so `economy-sim.ts` numbers are lower
bounds on how far a build can actually get.

## Known simplification

Both dev-mode grants (7 taps on the Settings version string, then either
button) permanently tamper-flag the save the moment they're taken, reusing
the existing save-integrity flag (`meta.ts`) rather than a second
mechanism — `engine.markDevUsed()` is the single taint point, and it sets
`tamperFlag` for the current session _and_ `devUnlockAll` so the taint
survives a reload. This means
a save that ever used dev mode is excluded from the daily leaderboard and
analytics forever after, even if the toggle is switched back off. That's
intentional — a save that used unlimited resources even once shouldn't be
comparable to normal play — but it's worth knowing if a tester's save
"stops submitting" and wonders why.
