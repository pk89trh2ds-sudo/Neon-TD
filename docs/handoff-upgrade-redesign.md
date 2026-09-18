# Handoff: Upgrade System Redesign (currencies, high level caps, defense/crit, Arsenal, game speed, wave-5000 pacing)

**Branch:** `claude/bold-dijkstra-fu23h1`
**Status as of this handoff:** Design fully approved by the user. Implementation just started — only the very first sub-step of Task #1 (below) is done. Everything else in the 12-step build order is untouched.

This document is self-contained: read this file and you have everything needed to resume without any other context. It supersedes nothing in `CLAUDE.md` — that still applies (naming rules, `.ts`-extension import rule, dev-mode/tamperFlag rule, no-`Math.random()`-in-`sim.ts` rule, `npm run verify` gate, etc.).

## How to resume

1. Read **"Progress so far"** below to see exactly what's already changed on disk.
2. Read **"Remaining work — exact next steps"** for the immediate next edit.
3. Then follow the **"Full approved plan"** section (reproduced verbatim from Plan Mode) as the source of truth for every subsequent step. It contains exact formulas, constants, and file-by-file build order.
4. Keep `npm run verify` (`typecheck && lint && test && build`) green at each of the 12 build-order checkpoints — there is no CI on this repo, this is the entire gate.
5. Commit and push to `claude/bold-dijkstra-fu23h1` as you go (don't let work pile up uncommitted — this environment's containers are ephemeral).

## Progress so far

Only one file has been touched, with one edit applied:

**`src/lib/game/types.ts`** — `WorkshopId`/`InRunId` unions extended, new `ArsenalId` type added:

```diff
 export type WorkshopId =
   | "attack"
   | "defense"
   | "cash"
   | "coins"
   | "range"
   | "cooldown"
-  | "drop";
-export type InRunId = "dmg" | "rng" | "rate" | "bounty" | "repair" | "income";
+  | "drop"
+  | "defensePct"
+  | "defenseFlat"
+  | "critChance"
+  | "critMult"
+  | "gameSpeed";
+export type InRunId =
+  | "dmg"
+  | "rng"
+  | "rate"
+  | "bounty"
+  | "repair"
+  | "income"
+  | "defensePct"
+  | "defenseFlat"
+  | "critChance"
+  | "critMult";
+/** New unlockable Lab "Arsenal" entries — drones/special attacks. Unlocked
+ *  with arsenalTokens (one-time), leveled with coreShards (see arsenal.ts). */
+export type ArsenalId = "sentryDrone" | "empPulse" | "repairDrone" | "elementalDrone";
```

Note: `gameSpeed` is on `WorkshopId` only (Lab-only upgrade), not on `InRunId` — intentional, matches the plan's game-speed design.

**Nothing else has been changed.** `PlayerProfile`, `CombatMods`, `emptyMods()`, `endlessScaling`/`bossHealthMultiplier`, `DIFFICULTY_UNLOCK_WAVE`, `WORKSHOP_IDS`/`IN_RUN_IDS`, `workshop.ts`, `sim.ts`, `engine.ts`, `ciphers.ts`, `meta.ts`, `arsenal.ts` (doesn't exist yet), `renderer.ts`, `play-hud.tsx`, `progression-panes.tsx`, `balance.test.ts`, `scripts/balance-sim.ts`, `docs/balance.md` are all still in their pre-redesign state.

`npm run verify` has **not** been re-run since this edit — `types.ts` in its current state is very likely fine (the edit is additive and self-contained) but this hasn't been confirmed. Do that as your first move.

## Remaining work — exact next steps

Continue **Task #1 (`types.ts` foundation)** with these sub-steps, in order, all in the same file before moving to `sim.ts`:

1. Add currency fields to `PlayerProfile` (near `bankScrap: number;`, and `arsenal` near `workshop: Partial<Record<WorkshopId, number>>;`):
   ```ts
   coreShards: number;
   arsenalTokens: number;
   arsenal: Partial<Record<ArsenalId, number>>;
   ```
   And matching entries in `defaultProfile()`:
   ```ts
   coreShards: 0,
   arsenalTokens: 0,
   arsenal: {},
   ```

2. Add four fields to `CombatMods`:
   ```ts
   critChance: number;
   critMult: number;
   corePct: number;
   coreFlat: number;
   ```
   And matching zeroed entries in `emptyMods()`.

3. Replace `endlessScaling`/`bossHealthMultiplier` with the retuned versions (exact code is in the full plan below, under "Wave-pacing retune").

4. Raise `DIFFICULTY_UNLOCK_WAVE` from `100` to `350` (plan's target: "roughly 300–350"; tune later via `balance-sim` if needed).

5. Update the `WORKSHOP_IDS`/`IN_RUN_IDS` const arrays in `types.ts` to include the new ids. Also note: `workshop.ts` has its **own independent** `IN_RUN_IDS` array (`workshop.ts:5`) — that's the one actually imported by `play-hud.tsx`. Either keep both in sync, or delete the `types.ts` copy as dead-code cleanup (confirmed via grep that only `workshop.ts`'s copy is imported anywhere) — your call, plan leans toward cleanup since the file is already being heavily touched.

6. Open `balance.test.ts` and fix the now-broken pre-rebalance curve-comparison test (asserts `endlessScaling(100) > oldScaling(100) * 1.5`ish — this will fail under the new curve since wave 100 is now much easier). Replace it with assertions tied to the new fresh/moderate/deep targets per the plan's testing guidance.

Run `npm run verify` once all six are done. Then mark Task #1 complete and move to **Task #2 (`sim.ts`)** — see the plan's "Build order" section for the full 12-step sequence and the "Critical files" section for what each subsequent file needs.

## Full approved plan

The plan below was designed through three rounds of codebase research plus a dedicated design pass, and was explicitly approved by the user via Plan Mode. Treat every formula/constant in it as a validated starting point (flagged inline where iteration via `balance-sim` is expected), not a guess.

---

### Context

Right now the game has two upgrade tracks that both cap out way too early to support long, ambitious runs:

- The in-run **"Upgrades" drawer** (`IN_RUN` table in `workshop.ts`) has 4 uncapped lines (Overload/Longscan/Coolant/Patch, 1.16x cost growth per buy) and 2 artificially hard-capped lines (Bounty@10, Income@12 — added specifically to kill a "wave 250 with 2 towers" exploit).
- The permanent **"Lab"** (`WORKSHOP` table, internally `profile.workshop`/`WorkshopId`) has 7 lines, all uncapped, funded by `bankScrap` ("Coins"), earned as a lump sum at run-end.

Both use **exponential** cost-growth formulas (`base * growth^n`). That's fine for the small caps they have today, but it's mathematically incompatible with what's being asked for here: the user wants every line to support hundreds to thousands of purchases (250–1000 for smaller/utility lines, 4000–7500 for the main power lines) so that grinding a line feels like a real, escalating achievement — "tower ranks as inspiration" in spirit (towers feel like they have *levels* that matter), not literally copying the tower's own tiny rank-5 cap. An exponential curve hits float-overflow (`Infinity`) or balance-meaningless numbers (10^100+) long before reaching those caps (1.16^4775 and 1.32^2553 already approach `Number.MAX_VALUE`), so the cost curve itself has to be redesigned, not just uncapped.

On top of the higher caps, this PR adds: a new currency ("Core Shards") that funds the Lab and is earned continuously during runs (unlike today's run-end-only `bankScrap`); a third currency ("Arsenal Tokens") gating brand-new unlockable content (drones/special attacks) as opposed to stat leveling; two new stat categories that don't exist today — core-damage mitigation ("defense", % and flat) and crit rate/crit damage — in both the in-run and Lab tracks; a Lab-gated, tiered game-speed upgrade (today's 1x/2x/3x toggle is free and unlimited); and a full wave-pacing retune so a fresh run dies under wave 100, a moderately-invested run reaches wave 500–1000, and a deeply-invested run can push past wave 5000+ (today's curve targets ~25–35/100/200).

This is a single large branch touching the core simulation, the permanent-progression data model, and both major upgrade UIs.

### Currency model

| Currency | Field | Scope | Funds | Earned |
|---|---|---|---|---|
| **Scrap** | `this.scrap` (engine instance, unchanged) | per-run, resets | towers, tower rank-ups, in-run Upgrades drawer | kill bounty + Income line, as today |
| **Core Shards** (new) | `profile.coreShards` | permanent | Lab stat lines (replaces `bankScrap` for this purpose), leveling up already-unlocked Arsenal entries | per-kill during runs, mirroring the scrap-drop code path but at a lower rate — accrues continuously straight onto the profile (not banked at run-end) |
| **Arsenal Tokens** (new) | `profile.arsenalTokens` | permanent | one-time unlock cost for new Arsenal entries only (never stat leveling) | boss kills only, ~25% chance, 1–2 dropped per proc — deliberately rare/milestone-flavored, "cheap-looking unlock costs, hard to obtain currency" |
| `bankScrap` ("Coins") | `profile.bankScrap` | permanent | unchanged: daily shop etc. | unchanged: run-end lump sum |

`bankScrap` keeps its current role untouched — only the Lab's stat-line funding moves off of it and onto Core Shards. This is an intentional, player-facing economy change (existing Lab ranks are preserved as numbers; buying the *next* rank now needs Core Shards, starting at 0) and should be called out explicitly in the PR description, not silently.

### Cost curve redesign (replaces exponential growth everywhere)

Add a shared polynomial cost helper in `workshop.ts`, replacing `Math.pow(1.085, rank)` / `Math.pow(growth, bought)`:

```ts
function polyCost(bought: number, base: number, k: number, p: number, wave = 0, waveC = 0): number {
  return Math.floor(base * Math.pow(bought + k, p) + waveC * wave);
}
```

Every `IN_RUN`/`WORKSHOP` table entry gains `k`, `p`, `waveC` (in-run only), `cap`, and `tier: "lower" | "most"`, replacing `growth`. `inRunCost`/`workshopCost` become thin lookups into `polyCost`. `inRunAtCap` (existing) and a new `workshopAtCap` apply the same `n >= cap` check to every line, not just Bounty/Income.

**Tier split rationale**: "most"-tier = lines with no natural ceiling that directly drive raw DPS/survivability (damage, fire rate, range, HP, starting-cash) — these get the big 4000–7500 caps since they're what the "sense of accomplishment" ask is really about. "Lower"-tier = economy-sensitive lines (Bounty/Income/Coins — the same three reasons they're the *only* capped lines today, per `docs/balance.md`'s root-cause history of a compounding-economy exploit) or naturally-bounded percentage stats (glyph-drop%, defense-mitigation%, crit-chance% — all conceptually capped near 100% regardless of level count; crit *mult* is grouped here too specifically so a huge chance and a huge multiplier can't stack into something game-breaking).

**Starting constants** (to be validated/iterated with `scripts/balance-sim.ts` before shipping — flagged throughout as the highest-risk part of this work):

In-run (funds `scrap`, resets each run):
| id | tier | cap | base/k/p/waveC | effect/lvl |
|---|---|---|---|---|
| `dmg` (Overload) | most | 7500 | 1.2/1/1.13/0.04 | +0.08% dmg |
| `rng` (Longscan) | most | 7500 | 1.2/1/1.13/0.04 | +0.03% range |
| `rate` (Coolant) | most | 7500 | 1.2/1/1.13/0.04 | +0.08% fire rate |
| `repair` (Patch) | most | 7500 | 1.2/1/1.13/0.04 | +4 core HP (unchanged) |
| `bounty`, `income` | lower | 500 | 3/1/1.25/0.15 | unchanged per-level step |
| `defensePct`, `defenseFlat`, `critChance`, `critMult` (new) | lower | 500 | 3/1/1.25/0.15 | see stat sections below |

Lab (funds `coreShards`, permanent):
| id | tier | cap | base/k/p | effect/lvl |
|---|---|---|---|---|
| `attack`, `range`, `cooldown`, `cash`, `defense` (existing, max-HP — untouched id) | most | 5000 | 1.5/1/1.2 | unchanged per-level step |
| `coins`, `drop`, `defensePct`, `defenseFlat`, `critChance`, `critMult` (new) | lower | 750 | 3/1/1.3 | see below |

These constants were grounded against a real computed estimate (~64–120M total scrap income and ~1.7M total Core Shards over a simulated 5000-wave clear): maxing *one* most-tier in-run line in a single run is a deliberate stretch goal (not a same-run completion target), and maxing one most-tier Lab line takes roughly the equivalent of dozens of deep runs — a genuinely long-term permanent-progression grind, comparable in shape to how `bankScrap` progression already feels today, just with far more headroom. The curve is very sensitive to `p`/`base` (a 0.05 change in exponent swung a modeled max-cost from ~100M to ~700M in testing) — **do not skip the `balance-sim` validation pass**, tune from real simulated numbers, not by eye.

### New stat lines (both tracks, same tier/cap/currency rules as above)

**Defense (% and flat core-damage mitigation)** — genuinely new; the existing `defense` WorkshopId only raises max core HP, it doesn't reduce incoming leak damage, so these are new, distinctly-named ids (`defensePct`, `defenseFlat`) that don't touch or rename the existing one (no save migration needed, per CLAUDE.md's Naming philosophy).

Leak damage today (`sim.ts` around the enemy-movement loop, `dmg = Math.max(1, Math.ceil(ENEMY[kind].core * leak))`, then subtracted with zero mitigation in `engine.ts`) gets a mitigation step inserted between the difficulty-leak multiplier and the existing floor:

```ts
const raw = Math.ceil(ENEMY[enemy.kind].core * leak);
const afterPct = raw * (1 - Math.min(0.75, this.mods.corePct));   // hard ceiling, never fully negated
const afterFlat = afterPct - this.mods.coreFlat;
const dmg = Math.max(1, Math.ceil(afterFlat));                     // existing floor — "enemies bleed a little"
```

`this.mods` is already tick-scoped in `sim.ts`'s `tick()`, so `corePct`/`coreFlat` (new `CombatMods` fields) are available with no new plumbing. The `Math.min(0.75, ...)` is a second, independent safety net on top of each line's own per-line cap (in-run max +40%, Lab max +48%, combined below the 75% ceiling) — belt-and-suspenders in the same style as the codebase's existing defensive clamps (`waveSpeedMult`, `killBounty`'s wave multiplier).

**Crit rate / crit damage** — also genuinely new (verified via grep — zero existing crit mechanic anywhere). New `CombatMods` fields `critChance`/`critMult`. Rolled once per shot (not per hit-application) in `sim.ts`'s tower-fire loop, right where `dmg = spec.damage * tower.rank * dmgMult` is computed:

```ts
const isCrit = mods.critChance > 0 && rng() < mods.critChance;
if (isCrit) dmg *= 1.5 + mods.critMult;
```

Must use the injected deterministic `rng()` — never `Math.random()` (hard constraint, breaks daily-challenge determinism). Splash hits inherit the primary hit's crit roll rather than re-rolling per splash target, matching how `execute` already applies uniformly per hit rather than per enemy. Add a `crit: boolean` flag threaded through `ProjectileState`/hit application for a "CRIT" floater (mirrors the existing "EXEC" floater), and a new `SimEvent` variant for the renderer/audio hook.

### New Lab "Arsenal" section — unlockable drones/special attacks

Genuinely greenfield (confirmed via grep — no existing drone/special-attack/ability scaffolding). New file `arsenal.ts` (mirrors `ciphers.ts`'s shape: a data table + pure functions), with the explicit `.ts`-extension import pattern (`from "./types.ts"`) so it stays reachable by `balance.test.ts` under plain `node --experimental-strip-types`, matching `sim.ts`/`workshop.ts`'s existing convention.

Four entries (kept intentionally small — this is a systems PR, not a content PR):
1. **Sentry Drone** — independent DPS source orbiting the core tile, no placement needed. Reuses the sim's existing private `selectTarget`/`fire`/`damageEnemy` machinery from inside the class. Rendered with a plain `ctx.arc` circle + the existing particle pool for muzzle flashes — no new sprite assets.
2. **EMP Pulse** — periodic (level-scaled cooldown), damages every alive enemy on the field at once. One `SimEvent` per pulse (not per enemy hit) to keep the event stream small at wave-5000 enemy counts. Reuses the existing full-screen flash overlay (already used for leak-damage feedback) with a distinct tint.
3. **Repair Drone** — periodic core heal. Reuses the *existing* `CombatTickResult.coreHeal` pipeline already wired end-to-end for `coreOnKill`/`corePerWave` — zero new plumbing, just another source on its own cooldown.
4. **Elemental Drone** (new, per user request) — an orbiting or periodic attack dealing a distinct "elemental" damage type. Since enemy resistances/weaknesses don't exist yet and are explicitly out of scope for this PR ("we can adjust enemy resistances later"), give it an immediate, self-contained identity via a status effect rather than a no-op damage-type tag: e.g. a frost/cryo theme that also briefly slows enemies it hits (a `slowUntil`/speed-multiplier field on the enemy, similar in spirit to the existing `hitFlash` timer). This makes it meaningfully different from the Sentry Drone *today*, and becomes the natural hook point for a future resistance system without needing one now.

Each entry: `unlockCost` (Arsenal Tokens, one-time, cheap-looking numbers e.g. single-to-low-double-digits per the user's "cheap looking, but still harder to obtain" framing — the currency's rarity does the gating, not the sticker price) and a `base/k/p/cap` level curve (Core Shards, same `polyCost` shape and lower-tier cap range as other lower-tier lines). New `engine.ts` method `buyArsenal(id)`: if locked, spend Arsenal Tokens at `unlockCost`; if unlocked, spend Core Shards at the level cost — this is the concrete mechanism for "unlock = currency 3, leveling (and any big passive buff that isn't genuinely new, like a hypothetical all-towers-multishot line) = currency 2."

### Game speed — Lab-gated, tiered (revised per user feedback)

Today: `store.ts`'s `speed: 1|2|3`, free, unlimited, a HUD button in `play-hud.tsx` cycling 1x→2x→3x→1x, consumed via `this.acc += dt * this.speed` in `engine.ts`'s `step()`. The user wants this fully gated — **no speed increase available at all without buying the upgrade** — but explicitly rejected a small 6-level exception in favor of a full-size lower-tier line:

- New `WorkshopId` `"gameSpeed"` (already added to `types.ts` — see Progress above), **lower tier, cap 500** ("about halfway" of the lower-tier 250–1000 band), same `polyCost` curve/base as other lower-tier Lab lines — so maxing it costs roughly what maxing-to-level-500 costs on a comparable lower-tier line, not a special cheap one-off curve.
- The actual speed multiplier only changes at specific milestone levels within that 500-level range (0.5x increments), with early milestones cheap/fast and later ones increasingly spread out — "big jump between levels of speed unlocked," and "x2/x3 semi-cheap":

  | Level | 1 | 2 | 10 | 25 | 60 | 120 | 220 | 350 | 500 |
  |---|---|---|---|---|---|---|---|---|---|
  | Max speed | 1.5x | 2x | 3x | 3.5x | 4x | 4.5x | 5x | 5.5x | 6x |

  (Exact thresholds are starting values, tunable — the shape is what matters: 2x/3x reachable early/cheap, the top end (5.5x/6x) requires deep investment.)
- `engine.ts`: `maxSpeed()` looks up the highest milestone ≤ `workshopRank(profile, "gameSpeed")`; `setSpeed(s)` clamps to it. `store.ts`/`engine.ts`'s `speed: 1|2|3` widens to `speed: number` since the ceiling is now data-driven, not a fixed literal.
- `play-hud.tsx`'s speed button: at rank 0, render locked/disabled (no speed option at all, per the explicit requirement) instead of the current always-on 1x/2x/3x cycle; above rank 0, cycle up through the unlocked milestones only.
- Cap the practical top end at 6x regardless of level — beyond that, the engine's existing tick catch-up limit (`MAX_CATCHUP`, already bounding how many simulation ticks can run per frame) means higher multipliers stop meaningfully speeding anything up, so there's no benefit to a higher ceiling.

This is a player-facing behavior change (speed is free today) — call it out explicitly in the PR description.

### Wave-pacing retune — fresh <100 / moderate 500–1000 / deep 5000+, with a non-static late curve

Baseline reality check (ran the existing, unmodified `scripts/balance-sim.ts`): a fresh, zero-investment run already dies around wave 9–41 depending on tower count — i.e. **"fresh dies under wave 100" is already satisfied by the current early-game curve**. All retuning work is in the late-game tail, which was calibrated for a ~200-wave ceiling and needs to stretch roughly 25x further without changing its fundamental (log-early, power-law-late) shape.

`endlessScaling` keeps its early term unchanged, stretches its late term horizontally, and — per the user's explicit ask for a non-static, non-boring late curve — gains a third **staircase "surge" phase** past wave 1000, so deep runs feel like crossing thresholds rather than grinding one smooth exponent:

```ts
export function endlessScaling(wave: number): number {
  const early = 1 + Math.log(Math.max(wave, 1)) * 0.55;             // unchanged
  const late = wave <= 30 ? 0 : Math.pow((wave - 30) / 240, 1.25);  // was (wave-25)/13, ^1.42
  const surge = wave <= 1000 ? 1 : 1 + Math.floor((wave - 1000) / 250) * 0.12;
  return (early + late) * surge;
}
```

`bossHealthMultiplier` and boss *count* (`waveComposition()` in `sim.ts`) both need hard caps that don't exist today — computed at wave 5000, the *current unmodified* formulas produce ~76x boss HP multiplier stacked on top of ~50-150x `endlessScaling`, and **167 simultaneous full-HP bosses** (from the uncapped `1 + floor((wave-10)/30)` boss-count term) — both a balance absurdity and a real per-tick performance risk (the sim's targeting loop is O(towers × enemies) every 1/60s tick, worse once speed multipliers up to 6x are in play). Cap both:

```ts
export function bossHealthMultiplier(wave: number): number {
  return 1 + Math.min(6, Math.floor(wave / 10) * 0.05);   // was uncapped * 0.15
}
// sim.ts waveComposition():
["boss", 1 + Math.min(19, Math.floor((wave - 10) / 30))],  // was uncapped
```

**`DIFFICULTY_UNLOCK_WAVE`** (currently 100, gates Hard/Nightmare/Insane on reaching wave 100 on the prior tier): the retuned curve makes wave 100 dramatically easier than today, so per the user's confirmation, raise this — target roughly **300–350** — so unlocking the next difficulty still feels like a milestone under the new pacing. Exact value tuned alongside everything else via balance-sim, not hardcoded blind.

All of the above (surge-phase constants, boss caps, unlock-gate wave) are starting points requiring the same `balance-sim` validation pass as the cost curves — this is explicitly the highest-risk, most-iteration-needed part of the whole PR, not a "compute once and ship" formula.

### Required supporting changes

- **`ciphers.ts`**: `addPartial`/`addInto` hand-list every `CombatMods` field — must add the four new fields (`critChance`, `critMult`, `corePct`, `coreFlat`) or glyph/cipher bonuses granting them will silently no-op.
- **`meta.ts`**: `integritySummary()` (the tamper-detection checksum input) must add `coreShards` and `arsenalTokens` to its field list, same as every other economically-meaningful field already is — otherwise a hand-edited save inflating either currency would pass the tamper check undetected.
- **`engine.ts`**: `devGrantResources()` must extend to grant `coreShards`/`arsenalTokens` too, flowing through the existing sanctioned "unlimited X" dev-grant + `tamperFlag`/leaderboard-exclusion mechanism — never invent a second exclusion path (hard CLAUDE.md constraint).
- **`IN_RUN_IDS` duplication**: confirmed via direct file read — `types.ts` and `workshop.ts` each independently define an `IN_RUN_IDS` array with identical values; only `workshop.ts`'s copy is actually imported anywhere (`play-hud.tsx`). Update both when extending the id list, or delete the dead one in `types.ts` as opportunistic cleanup since the file is already being heavily touched.
- **UI density**: the in-run Upgrades drawer grid goes from 6 to 10 lines, and the Lab from 7 to 12+ — both need tier-grouped sub-headers (mirroring the existing "This wave" sub-header pattern) and the drawer container needs a scrollable max-height, since neither currently has one and 10+ buttons will overflow small screens. Every button's level readout should show the cap (`x340/7500`) now that every line has one — this is what actually delivers the "sense of accomplishment" the user asked for.

### Critical files

- `src/lib/game/types.ts` — new currency fields on `PlayerProfile`/`defaultProfile()`, extended `WorkshopId`/`InRunId`/new `ArsenalId`, `CombatMods` + `emptyMods()` additions, retuned `endlessScaling`/`bossHealthMultiplier`, `DIFFICULTY_UNLOCK_WAVE`.
- `src/lib/game/workshop.ts` — `polyCost`, full tier tables for `IN_RUN` and `WORKSHOP` including new lines, `buyWorkshop()` switched from `bankScrap` to `coreShards`.
- `src/lib/game/sim.ts` — leak-damage mitigation pipeline, crit roll in the fire loop, boss-count cap in `waveComposition()`, per-kill Core Shards drop (mirroring the existing `killBounty`/scrap-drop call site), Arsenal combat hooks (drone update methods called from `tick()`).
- `src/lib/game/arsenal.ts` (new) — Arsenal data table + pure functions, mirroring `ciphers.ts`.
- `src/lib/game/engine.ts` — `refreshMods()` gains the four new stat lines in its `run` object composition, `buyArsenal()`, Core Shards/Arsenal Token accrual in `tick()`, game-speed gating (`maxSpeed()`, widened `speed` type), `devGrantResources()` extension, `syncHud()` new fields.
- `src/lib/game/ciphers.ts` — `addPartial`/`addInto` field additions.
- `src/lib/game/meta.ts` — `integritySummary()` additions.
- `src/components/game/play-hud.tsx` — Upgrades drawer regrouping/scroll + cap display, speed-button gating.
- `src/components/game/screens/progression-panes.tsx` — `LabPane` new currency readouts, capped level display, tier grouping, new Arsenal section.
- `src/lib/game/balance.test.ts` — replace the now-obsolete pre-rebalance curve-comparison test with assertions against the new fresh/moderate/deep targets; extend the boss-invariant loop range from 250 to 5000+; generalize the cost-curve tests to loop over every `InRunId`/`WorkshopId` (monotonic cost, `atCap` correctness, no `Infinity`/`NaN` up to cap, most-tier caps > lower-tier caps).
- `scripts/balance-sim.ts` — add a mods-from-ranks helper (building a real `CombatMods` from a given Lab-rank/in-run-purchase build using the actual bonus functions) and three named scenarios (fresh, moderate ~30-50% of caps, deep ~80-100% of caps) that also model progressively *buying* in-run lines as scrap accumulates during the simulated run, not just a static mods snapshot — this is the tool that actually validates the fresh<100/moderate 500-1000/deep 5000+ targets before any of this ships.
- `docs/balance.md` — document the new curve constants, cap/tier scheme, and currency model alongside the existing rebalance write-up, following its existing "why these constants" style.

### Build order (keep `npm run verify` green at each checkpoint)

1. `types.ts` foundation (currencies, ids, `CombatMods`, retuned curves, `DIFFICULTY_UNLOCK_WAVE`) + fix the now-broken pre-rebalance curve-comparison test in the same commit, so `npm run test` never goes red mid-branch. **← IN PROGRESS, see "Remaining work" above for exact next sub-steps.**
2. `sim.ts` (boss-count cap, mitigation pipeline, crit roll, Core Shards drop) + extend the boss-invariant test range.
3. `workshop.ts` (`polyCost`, tier tables, `buyWorkshop()` currency switch) + new generalized cost-curve tests.
4. `ciphers.ts` field-list additions (pair with a quick check that a synthetic glyph granting `critChance` round-trips correctly).
5. `arsenal.ts` (new) + sim-side drone/pulse/heal/elemental hooks.
6. `engine.ts` (accrual, `buyArsenal`, game-speed gating, `devGrantResources`, `syncHud`).
7. `meta.ts` (`integritySummary()`) — same commit as step 6, so a currency never accrues without checksum coverage even briefly.
8. `renderer.ts` (drone draw, EMP flash variant, slow-effect visual) — primitives only, no new sprite assets.
9. UI: `play-hud.tsx` (drawer regroup/scroll, speed gating), `progression-panes.tsx` (`LabPane` currencies/tiers/Arsenal section).
10. `scripts/balance-sim.ts` new scenarios — run manually, iterate on cost-curve/surge-phase/boss-cap constants from what it actually reports before considering the branch done.
11. `docs/balance.md` write-up.
12. Full `npm run verify`, then a manual playtest pass specifically on the Upgrades drawer and Lab screen's new tier-grouped/scrollable layouts (hard to fully verify from static analysis alone) and the gated speed button's locked/unlocked states.

### Verification

- `npm run typecheck && npm run lint && npm run test && npm run build` (i.e. `npm run verify`) must pass clean before considering this done — there is no CI on this repo, this is the entire gate.
- `node --experimental-strip-types --test src/lib/game/balance.test.ts` specifically, to confirm the new/updated invariants (cost curves never overflow, boss HP invariant holds to wave 5000+, new fresh/moderate/deep target assertions) pass in isolation.
- Run `node scripts/balance-sim.ts` (or `npx tsx scripts/balance-sim.ts`) with the new fresh/moderate/deep scenarios and confirm death-wave outcomes land in the target bands (fresh <100, moderate 500–1000, deep 5000+) — iterate on cost-curve/surge/boss-cap constants until they do, since the initial constants are explicitly starting points, not final tuning.
- Manual playtest via `npm run dev`: buy through several levels of an in-run line to confirm the cap display (`x.../cap`) and cost growth feel right; open the Lab and confirm Core Shards (not Coins) are spent on stat lines, the tier grouping renders without overflow, and the Arsenal section correctly gates unlock (Arsenal Tokens) vs leveling (Core Shards); confirm the game-speed button is locked at zero Lab investment and unlocks the documented milestone multipliers as ranks are bought; take a leaked hit with defense upgrades purchased and confirm damage is reduced but never zero.
- Confirm a fresh/default save (no dev-mode) still boots correctly with `coreShards: 0`, `arsenalTokens: 0`, `arsenal: {}` — no crash reading undefined new fields on an old save shape.
- Confirm `profile.tamperFlag`/leaderboard-exclusion behavior is unaffected for non-dev-mode saves, and that `devGrantResources()` still correctly taints the save when used, now covering the two new currencies too.

---

## Key user decisions (verbatim, for nuance not fully captured above)

These were given across two rounds of `AskUserQuestion` plus follow-up chat messages, and are already folded into the plan above — included here only so intent/tone isn't lost in paraphrase:

- Initial request: "upgrades in game need fixing. look to the tower for inspiration and they don't need a hard cap at low levels. lower level upgrades should cap at level 250-1000 and most should cap at level 4000-7500. out of game permanent upgrades should be the same but use a different currency you also obtain in runs and also include some things to unlock in game, such as special attacks and maybe some drones or something like them."
- On Core Shards: "core shards is fine, but every enemy, just like the regular currency, should drop it, just at a lower rate and a higher curve on prices."
- On Arsenal Tokens vs. stat buffs: "new lab category, and specials and other unlocks like drones can be a third currency, but if its something like giving all towers multi shot or something that's not technically 'new' it can be the regular, second, currency."
- On pacing targets: "change the curve, run simulations if needed, it doesn't need to be game breaking, just want it to give players more of a sense of accomplishment for trying to buy so many of them, remember I want early games to end under wave 100, midge with some perm upgrades to end at 500-1000 and late game to look like wave 5000+ also add a game speed upgrade as a perm upgrade, with no option to increase speed without buying it."
- On defense: "also defense as a % and absolute defense as a set number should be considered as an upgrade option, as enemies should bleed a little, past the offensive towers."
- On crit: "crit rate and crit dmg can be upgrades in and out of game also."
- On game speed (rejecting the first proposal of a small 6-level exception): "max speed upgrade should cost around the same amount as other upgrades about halfway capped but big jump between levels of speed unlocked. x2 and x3 semi cheap are ok, and you can even make it .5x speed upgrades."
- On the late-game curve: "raising the gate is ok, but maybe change the curve after a certain wave also, it doesn't have to be a static, boring difficulty curve."
- On Arsenal Token rarity: "those are fine, maybe add some type of elemental dmg, we can adjust enemy resistances and resistances later." and "all of that is fine, upgrades of this type should be cheap looking, but still harder to obtain, compared to the others so its fine to make what the bosses may drop as only 1 or 2 of them."

The final plan was approved in full via `ExitPlanMode`.
