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

---

## Upgrade system redesign (second pass)

### Enemy HP curve

The original PR's formula was replaced with a 3-phase version designed to
last to wave 5000 without float overflow and give a gentler early ramp:

```
early  = 1 + ln(max(wave, 1)) * 0.55
late   = wave <= 30 ? 0 : pow((wave - 30) / 240, 1.25)
surge  = wave <= 1000 ? 1 : 1 + floor((wave - 1000) / 250) * 0.12
scaling = (early + late) * surge
```

- Early phase: logarithmic — approachable for new players without investment.
- Late phase: power-law starting at wave 30 (not wave 40), stretching the
  "moderate investment" range from ~wave 60 to ~wave 120.
- Surge staircase: above wave 1000 HP ratchets +12% per 250 waves — keeps
  "infinite" runs from trivializing at extreme depths.

`bossHealthMultiplier` is now `1 + min(6, floor(wave/10) * 0.05)` — softer
early ramp, hard cap of 7× so late-game bosses don't one-shot the core.

Boss count: `1 + min(19, floor((wave - 10) / 30))` — previously uncapped.
Without the cap, wave 5000+ would spawn 166+ bosses per wave and the
O(towers × enemies) tick loop would grind to a halt.

### Currency model

Three currencies:

| Currency | Earns via | Used for |
|---|---|---|
| **Scrap** | enemy kills (in-run) | in-run upgrades, tower builds/ranks |
| **Core Shards** | every kill (15% of kill bounty) | Lab (workshop) + Arsenal leveling |
| **Arsenal Tokens** | boss kills (1 + floor(wave/50)) | Arsenal unlock only |

Core Shards replace the old `bankScrap`-for-Lab model — players earn them
continuously rather than having to bank between runs. Arsenal Tokens are
rare enough (boss-only) to make unlock decisions meaningful.

### Cost curves: polynomial not exponential

All cost curves now use `polyCost(bought, base, k, p)`:
```
cost = floor(base * pow(bought + k, p))
```
At 10,000 purchases, `1.5 * 1.13^n ≈ 4.6 × 10^568` (NaN); the polynomial
stays finite. This is why `p < 2` everywhere — the curve is subquadratic.

### Cap and tier scheme

**Lab (workshop) — paid in Core Shards:**

| Tier | IDs | cap | base | p |
|---|---|---|---|---|
| most | attack, defense, cash, range, cooldown | 5000 | 1.5 | 1.2 |
| lower | coins, drop, defensePct, defenseFlat, critChance, critMult | 750 | 3 | 1.3 |
| lower | gameSpeed | 500 | 3 | 1.3 |

**In-run upgrades — paid in Scrap:**

| Tier | IDs | cap | base | p |
|---|---|---|---|---|
| most | dmg, rng, rate, repair | 7500 | 1.2 | 1.13 |
| lower | bounty, income, defensePct, defenseFlat, critChance, critMult | 500 | 3 | 1.25 |

**Arsenal — unlock with Tokens, level with Core Shards:**

All four entries (`sentryDrone`, `empPulse`, `repairDrone`, `elementalDrone`)
share: cap 500, base 3, p 1.3.

Unlock costs: sentryDrone 3, empPulse 5, repairDrone 4, elementalDrone 8.

### Leak damage mitigation pipeline

Enemy reach → raw → percentage shield → flat shield → final:
```
raw      = ceil(ENEMY[kind].core * leakMultiplier)
afterPct = raw * (1 - min(0.75, corePct))     // 75% cap prevents immunity
afterFlat = afterPct - coreFlat
dmg      = max(1, ceil(afterFlat))             // always at least 1
```
`corePct` and `coreFlat` come from Lab `defensePct`/`defenseFlat` +
in-run `defensePct`/`defenseFlat` + any cipher bonuses.

### Crit mechanic

```
isCrit = critChance > 0 && rng() < critChance
if (isCrit) dmg *= 1.5 + critMult
```
Uses the seeded `rng` injected into `tick()` — never `Math.random()` — so
daily-challenge determinism is preserved. `critChance` and `critMult`
accumulate from Lab, in-run, and cipher sources.

### Game speed gating

Speed is gated by the `gameSpeed` Lab entry. `gameSpeedMax(rank)`:

| rank | max speed |
|---|---|
| 0 | 1× (button disabled) |
| 1 | 1.5× |
| 2 | 2× |
| 10 | 3× |
| 25 | 3.5× |
| 60 | 4× |
| 120 | 4.5× |
| 220 | 5× |
| 350 | 5.5× |
| 500 | 6× |

### Difficulty unlock gate

`DIFFICULTY_UNLOCK_WAVE` raised from 100 to 350. The old curve hit a wall
at wave 100 within the first Lab-investment tier; the new curve puts wave
100 in comfortable reach for moderate investment, so the gate was moved to
wave 350 — a point that genuinely requires effort on the new curve.

### Balance-sim calibration results

Run: `node --experimental-strip-types scripts/balance-sim.ts`

With the final constants:
- **fresh** (4×rank-2, no mods): wave 37
- **moderate** (6×rank-5, +20% dmg/rate): wave 80
- **deep** (8×rank-5, +60% all): wave 250

Economy is not modeled in the sim, so these are floors. Actual in-game
targets are 25–35 / ~100 / ~200 — the gap is covered by the in-run upgrade
economy (Upgrades drawer, income, bounty purchases) that the sim omits.
