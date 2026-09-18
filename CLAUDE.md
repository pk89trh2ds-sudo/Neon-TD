# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — start the dev server (0.0.0.0:8080). Always goes through `scripts/with-app-env.mjs` (never run `vite dev` directly — it injects `.grok/app-env.json` as env, e.g. `VITE_AUTH_ENABLED`).
- `npm run build` — production build (Vercel SSR target): `vite build` → `scripts/copy-pglite-assets.mjs` → `npm run db:migrate`. All three steps matter; see Constraints.
- `npm run build:portal` — static-SPA build for Poki/CrazyGames/itch.io (no server functions; see Architecture below).
- `npm run preview` / `npm run preview:restart` / `npm run preview:stop` — serve the built output on 127.0.0.1:8081.
- `npm run typecheck` — `tsc --noEmit`.
- `npm run lint` / `npm run format` — ESLint / Prettier (`prettier -w .`).
- `npm run test` — runs `scripts/**/*.test.mjs` via `node --test`, plus three TS tests (`src/lib/app-data/app-data.test.ts`, `src/lib/auth/gate-identity.test.ts`, `src/lib/game/balance.test.ts`) via `node --experimental-strip-types --test`.
  - Single `.mjs` test: `node --test scripts/<name>.test.mjs`
  - Single `.ts` test: `node --experimental-strip-types --test src/lib/game/balance.test.ts`
- `npm run verify` — `typecheck && lint && test && build`, in that order. Run this before every push — it's the entire gate, since there is no CI (see Constraints).
- `npm run check:auth` — verifies the auth on/off invariant (`.grok/app-env.json` vs `migrations/`).
- `npm run db:migrate` — applies `migrations/*.sql` (non-recursive) to the configured Postgres. Skips gracefully (does not fail the build) when the DB is unreachable at build time.
- `node scripts/balance-sim.ts` (run via `npx tsx` or `node --experimental-strip-types`) — headless combat-sim harness for iterating difficulty numbers without a browser. See "Balance & difficulty" below.

Before pushing any change, run `npm run typecheck && npm run lint && npm run test && npm run build` locally — **there is no CI on this repo**, so these are the only gate.

## Stack

This is a **standalone, revenue-ready game**, not a template project:
- **React 19 + TanStack Start/Router** for the UI framework
- **Zustand** for state management (`useGame`)
- **Canvas2D** hand-rolled renderer (no external graphics lib — see `src/lib/game/renderer.ts`)
- **Vite 8 + Nitro v3 beta** for dual build targets (Vercel SSR + static portal SPA)
- **Better Auth** with email/password auth (Google/X federate through Grok's broker, unavailable standalone)
- **Supabase Postgres** for cloud saves, daily leaderboards, and entitlements — free tier, **auto-pauses after inactivity** (see Constraints)
- **PGLite** (`@electric-sql/pglite`, WASM Postgres) as the embedded fallback DB when `DATABASE_URL` is unset
- **Stripe** for in-app purchase handling (Checkout Sessions) — MCP access requires the user to authorize it separately; not available in every session
- **Portal SDKs** for Poki/CrazyGames monetization (portal detection via referrer/ancestorOrigins)
- **`node --test`** (native, no Jest/Vitest) for both `.mjs` and `.ts` tests, the latter via `--experimental-strip-types`

## Architecture

### Config & deployment

- `.grok/app-env.json` — dev environment config (auth/db feature flags, currently **ON**)
- `vite.config.ts` — two build targets: default (Vercel SSR) and `npm run build:portal` (static SPA for zipping)
- `server/middleware/*.ts` — Nitro endpoints (auth API, Stripe webhook, etc.)
- `migrations/*.sql` — Postgres schema for auth, profiles, leaderboards, entitlements
- Vercel gives every PR both a **stable branch-alias URL**
  (`https://neon-td-git-<branch>-neon-td.vercel.app`, always the latest deploy
  for that branch) and an **ephemeral per-deployment URL**
  (`neon-<hash>-neon-td.vercel.app`, goes stale the moment a new deploy
  happens). Always hand the user the branch-alias URL for testing — it's
  posted in the Vercel bot's PR comment. A stale ephemeral-URL tab is a
  common false "the fix didn't work" report.

### Build outputs

After initial Grok scaffolding, the following are safe to remove or repurpose:
- `server/middleware/grok-pwa.ts`, `scripts/grok-pwa-plugin.mjs` — Grok PWA + branding (can be deleted)
- `<PreviewHostBridge />` in `src/routes/__root.tsx` — Grok live-preview (can be removed)
- `public/__grok/`, `.grok/grok-branding/` — Grok assets (can be deleted; keep `.grok/app-env.json` for dev config)
- `startup.sh`, `AGENTS.md`, `AGENTS.project.md` — Grok scaffold contracts (not needed for Vercel deployment)

### Dual-wiring: every raw HTTP route needs a dev-server twin

Nitro (`serverDir: "./server"`) is only registered in `vite.config.ts` for
`build`/`preview`/deploy, not for `npm run dev` (`vite dev`). So every raw
HTTP endpoint is wired **twice**:
1. A Nitro middleware under `server/middleware/*.ts` (build/preview/deploy).
2. A matching Vite `configureServer` plugin in `vite.config.ts` (dev).

Existing examples to copy the pattern from: `authPopupPlugin()` /
`src/lib/auth/popup.server.ts` (OAuth popup, GET-only), `authApiPlugin()` /
`server/middleware/auth-api.ts` (Better Auth at `/api/auth/*`, mounts
`auth.handler(request)`), `stripeWebhookPlugin()` /
`server/middleware/stripe-webhook.ts` (`/api/stripe/webhook`, raw-body
signature verification). Both sides construct a real `Request` from the raw
Node req/res and hand it to the same underlying handler — keep the logic in
one shared module and have both wiring points call into it.

### `.server.ts`-suffixed files are blocked from ALL client-reachable imports

The import-protection Vite plugin (`tanstack-start-core:import-protection`)
blocks importing anything from a `*.server.ts` file into client-reachable
code — **even a `createServerFn` result that's meant to be called from the
client** (it fails at runtime with a "Mocked import used in dev client"
error, and the game engine silently fails to bind). So:
- `createServerFn` definitions callable from the client: name the file
  **without** `.server.ts` (e.g. `src/lib/game/cloud-sync-api.ts`,
  `leaderboard-api.ts`, `entitlements-api.ts`).
- Reserve `.server.ts` only for files that are **never** imported by client
  code — e.g. `src/lib/game/stripe-webhook.server.ts`, imported only from the
  Nitro/Vite middleware above.

### UI split (`src/components/game/`)

`app.tsx` used to be a 1,355-line monolith holding every screen; it was
split so an edit to one screen doesn't require loading the whole thing:

- `app.tsx` — just `NeonApp` (canvas + engine boot/keybind wiring) and the
  `MenuLayer` screen dispatcher. Add a new `Screen` here.
- `common.tsx` — generic pieces shared by multiple screens (`NavTile`,
  `Back`, `CenterCard`, `Toggle`, `Slider`). Zero dependency on any single
  screen file — safe to import from anywhere without a cycle.
- `play-hud.tsx` — the in-run HUD: top bar, boss health bar, the
  "Upgrades" drawer, tower bar, pause overlay (incl. dev wave-skip),
  game-over recap, toast stack. **This is the file that changes during
  live-play bugfixing** (see the range-indicator/upgrade-label/wave-skip
  fixes in git history) — most gameplay-facing reports land here first.
- `screens/menu-home.tsx` — `BootCard`, `MenuHome` (the main menu + nav grid).
- `screens/progression-panes.tsx` — Skills, Lab, Forge, Modules, Ops log.
- `screens/economy-panes.tsx` — Battle Pass, Shop, Daily Challenge, Premium.
- `screens/settings-pane.tsx` — Settings + the hidden dev-mode footer.

When adding a new menu screen, put it in whichever `screens/*` file matches
its theme (progression vs. economy) rather than creating a one-off file per
screen — the goal was fewer, well-scoped files, not maximum fragmentation.

### Game engine/store split (`src/lib/game/`)

- `types.ts` — all shared types/constants (`GamePhase`, `Screen`, tower/enemy
  kinds, `PlayerProfile`, `TOWER`/`ENEMY` balance tables, `defaultProfile()`,
  difficulty/wave-scaling formulas). Imported with an **explicit `.ts`
  extension** by `sim.ts`/`workshop.ts` — see Constraints.
- `sim.ts` — pure simulation: `CombatSimulation`, map generation (`makePath`,
  fully deterministic — no RNG), `effectiveRange()` (the single source of
  truth for a tower's actual range, shared with the renderer — see Balance),
  and `SplitMix64`/`hashStr`, the seeded RNG used for both the daily shop
  and the daily-challenge seed. `tick()` takes an injected `rng: () => number`
  — never call `Math.random()` directly in here, it breaks daily-challenge
  determinism.
- `meta.ts` — profile/economy mutations (shop, workshop, skills, prestige,
  daily crate/missions, save-integrity checksum + tamper flagging,
  export/import JSON).
- `workshop.ts`, `ciphers.ts` — permanent upgrade tree (in-code identifiers
  still say "workshop" — see Naming) and the glyph/chassis "Forge" crafting
  system, respectively.
- `renderer.ts` — hand-rolled Canvas2D renderer (towers/enemies/particles),
  no external rendering lib. Any value that affects gameplay (range, splash
  radius, etc.) must be drawn from the same formula the sim uses
  (`effectiveRange()`), never a static base value from the `TOWER`/`ENEMY`
  tables — see Balance for why this bit us once already.
- `engine.ts` — the orchestrator: owns the game loop, calls into `sim.ts` for
  combat and `meta.ts` for economy, pushes state into the Zustand `store.ts`,
  and wires cross-cutting concerns (analytics `track()`, the ad adapter
  lifecycle, cloud sync, Stripe checkout/entitlements, dev-mode grants). UI
  components read from `store.ts` and call methods on the engine instance,
  never mutate game state directly.
- `store.ts` — Zustand store (`useGame`); pure UI-facing state mirror, no game logic.
- `cloud-sync.ts` / `cloud-sync-api.ts`, `leaderboard-api.ts`,
  `entitlements-api.ts` — the three server-function modules (see the
  `.server.ts` rule above for why they're named this way).

### Ads (`src/lib/ads/adapter.ts`)

A small `AdAdapter` interface (`init`, lifecycle hooks, `showRewardedAd`)
with `NullAdapter`, `PokiAdapter`, `CrazyGamesAdapter`. Both portal SDKs load
harmlessly outside their own portal, so `detectPortal()` checks
`document.referrer`/`location.ancestorOrigins` **before** loading either
script — never infer the portal from which SDK responded.

### Two build targets from one `vite.config.ts`

- Default (`npm run build`): full SSR app, `nitro({ preset: "vercel" })`,
  every non-asset route can hit a serverless function. This is what deploys.
- `npm run build:portal` (env-detected via `npm_lifecycle_event`): a fully
  static SPA (`tanstackStart({ spa: { enabled: true } })` +
  `nitro({ preset: "static" })`) for zipping and uploading to Poki/CrazyGames/
  itch.io — no backend available there. Orchestrated by
  `scripts/build-portal.mjs`, which also works around a known Nitro 3 beta
  crash on the final build step (verifies `.output/public/` is actually
  correct before treating that specific failure as tolerable — never
  silently swallows a different failure).

### Auth

Better Auth runs at `/api/auth/*`. Only **email/password**
(`src/lib/auth/email-password.ts`) actually works in an independently
deployed instance of this app — the Google/X buttons in the upstream
template federate through a Grok-hosted auth broker
(`GROK_AUTH_ISSUER`) that has no presence outside the Grok platform, so they
are not used here.

### Path alias

`@/*` → `./src/*` (see `tsconfig.json`).

## Naming

The in-game vocabulary and the code's internal identifiers have
**deliberately diverged** in one place — don't try to "fix" this by
renaming the internals, it would require a save migration for every
existing player for zero user-visible benefit:

| User-facing name | What it is | Internal identifiers (unchanged) |
|---|---|---|
| **"Lab"** | the **permanent**, out-of-run upgrade screen (meta-progression) | `Screen` enum value `"lab"`; but the profile field is still `profile.workshop`, and the type is still `WorkshopId` — these were NOT renamed |
| **"Upgrades"** | the **in-run** shop/offers drawer (temporary, resets each run) | `engine.upgradesOpen` / `engine.toggleUpgrades()`, `store.ts`'s `upgradesOpen` field |

Before this rename, both screens used the word "Lab"/"Workshop"
inconsistently and there was a third, separate always-visible floating
panel for rolled offers — that panel was **removed entirely**; its content
now lives inside the "Upgrades" drawer under a "This wave" section. If you
see a UI string or comment still saying "workshop" in a user-facing
context, or "upgrade bay" (an old fourth name that existed briefly in
`meta.ts` toast copy), it's stale — fix it to match the table above.

When adding new user-facing copy, use exactly "Lab" and "Upgrades" per the
table — don't introduce a third synonym.

## Constraints

Hard-won gotchas — read before touching the areas below:

- **PGLite's WASM/data assets are not bundled automatically.** Nitro's
  dependency bundler does not copy `@electric-sql/pglite`'s `.wasm`/`.data`/
  `.tar.gz` runtime files into the Vercel serverless function. Without them,
  any deploy that falls back to the embedded DB (`DATABASE_URL` unset, or
  Supabase unreachable) 500s with `FUNCTION_INVOCATION_FAILED` /
  `ENOENT: pglite.data`. This is fixed by `scripts/copy-pglite-assets.mjs`,
  which runs as part of `npm run build` — **never remove that step**, and if
  you change how PGLite is imported/bundled, re-verify with a clean
  `npm run build && npm run preview` (no `DATABASE_URL` set) that it still
  returns 200.
- **Supabase's free tier auto-pauses** the Postgres project after
  inactivity (`status: "INACTIVE"`). A "works locally, 500s in prod" report
  should always check this first (`mcp__Supabase__list_projects` /
  `restore_project`) before assuming a code bug — though see the PGLite
  point above, since both can present identically as a 500 and need to be
  ruled out separately.
- **`scripts/migrate.mjs` must not fail the Vercel build** when the DB is
  unreachable at build time (e.g. Supabase paused, or building without
  secrets configured) — it should skip gracefully, not throw.
- **`node --experimental-strip-types` requires explicit file extensions**
  on relative imports, unlike Vite/tsc's "bundler" module resolution (which
  accepts extensionless imports). Any `.ts` file that needs to run under
  plain `node --test` (i.e. is imported, directly or transitively, by a
  test file) must use `from "./foo.ts"`, not `from "./foo"`, for every
  relative import in that import graph. `sim.ts` and `workshop.ts` already
  do this for their `./types` import — keep that pattern for new pure-logic
  modules you want directly testable.
- **`.server.ts` import-protection** — see Architecture above. Getting this
  wrong fails silently at runtime ("Mocked import used in dev client"), not
  at build time.
- **No CI.** Every check (`typecheck`, `lint`, `test`, `build`) is a local
  run before you push; nothing gates a PR automatically. Always run the
  full chain before pushing, not just the one check you think is relevant.
- **Dev-mode / unlimited-resource saves must never reach the leaderboard.**
  There is a real shared daily-challenge leaderboard. Any save that has
  ever had `profile.devUnlockAll` set is permanently OR'd into the existing
  `tamperFlag` mechanism (`meta.ts`, on both `loadProfile()` and
  `importProfileJson()`) and leaderboard submission is gated on
  `!profile.tamperFlag` in `engine.ts`'s `settleRun()`. If you add another
  "unlimited X" dev grant, make sure it flows through the same flag rather
  than inventing a second exclusion mechanism.

## Balance & difficulty

The full design rationale lives in `docs/balance.md` — read it before
retuning numbers. Summary of the load-bearing pieces:

- **`endlessScaling(wave)`** (`types.ts`) is the enemy HP curve. Combined
  with **`bossHealthMultiplier(wave)`**, target shape is: fresh/no-Lab-ranks
  dies ~wave 25–35, moderate Lab investment gets to ~wave 100, deep
  investment to ~wave 200.
- **`DIFFICULTY_UNLOCK_WAVE = 100`** — reaching wave 100 on a difficulty
  unlocks the next one. `difficultyUnlocked()` checks the **previous
  tier's** `profile.highestByDifficulty[...]`, not the global high score.
  `profile.devUnlockAll` bypasses this entirely.
- **Boss waves** (every 10th wave) are constructed by taking a **full
  ordinary wave's enemy composition and adding boss(es) on top**
  (`waveComposition()` in `sim.ts`) — never by substituting/reducing the
  normal composition. That was the original bug (bosses were *weaker* than
  the wave before them); `balance.test.ts` asserts the
  boss-total-HP-exceeds-preceding-wave invariant across waves 10–250, so a
  regression there fails loudly.
- **`effectiveRange(kind, mods)`** (`sim.ts`) is the *only* place tower
  range should be computed. Both the sim's own targeting logic and the
  renderer's range-ring visuals must call this — a static
  `TOWER[kind].range` lookup anywhere else is a bug (it was, once: the
  range-upgrade visual indicator silently didn't move while the tower's
  real range did).
- **Tuning tools**: `src/lib/game/balance.test.ts` (unit invariants —
  monotonic scaling, boss-harder-than-preceding, cost curves, cap
  enforcement) and `scripts/balance-sim.ts` (headless strategy playthroughs
  without a browser — fastest way to check "does build X die around wave
  Y" before a manual playtest). Prefer extending these over manual-only
  verification when retuning numbers.
- **Module ("glyph") rarity + manual combining is explicitly out of scope**
  for the current balance work (tracked as a future PR) — don't fold that
  into difficulty retuning without checking with the user first, since the
  two were deliberately sequenced ("balance first, then modules").

## Dev mode (hidden)

- Activated by **7 taps on the version string in Settings**. Intentionally
  undocumented in any player-facing UI.
- Grants `profile.devUnlockAll` (all difficulties unlocked) and one-shot
  unlimited scrap/coins/skill points via `engine.devGrantResources()`.
- **Wave-skip (`engine.devSkipToWave()`) only works from the Pause screen
  during an active run** (`DevSkipWaveRow` in `play-hud.tsx`), because it
  requires `phase === "combat"`. There is intentionally **no** working
  wave-skip control in Settings — Settings is only reachable outside a run,
  so a control there can never satisfy that guard. If you add another
  dev-only action gated on run state, put its control on the Pause screen,
  not Settings, or it will silently no-op.
- Any use of dev mode permanently taints the save — see the leaderboard
  point under Constraints.
