# Portal submission checklist

Everything code-side is done: the game builds a self-contained static bundle
(`npm run build:portal` → `.output/public/`), the SDK integration for Poki
and CrazyGames auto-detects which portal it's running on
(`src/lib/ads/adapter.ts`), and store-listing assets are prepared below.
What's left is account creation and clicking submit on each portal's
dashboard — that requires a human to accept their ToS and enter payout/tax
information, which nobody (including an AI agent) can do on your behalf.

## Building the upload

```
npm run build:portal
```

This produces `.output/public/` — zip the **contents** of that folder
(not the folder itself) into `neon-td-portal-build.zip`. Current size is
~3.8 MB, comfortably under every portal's limit below.

Known build quirk (safe to ignore): this step logs one error from Nitro's
beta static-export path near the end (`rolldownOptions.input should not be
an html file...`). The script tolerates it — by that point the actual
static site is already complete — and only reports success once it's
verified the output is real. If `npm run build:portal` ever exits non-zero,
that's a genuine failure and shouldn't be ignored.

## Prepared copy

- **Title:** NEON TD
- **Short tagline:** Hold the circuit. Deploy Pulse, Beam, Nova and Tesla against endless neon hostiles.
- **Longer description (draft — adjust to each portal's tone/length limits):**
  > NEON TD is an endless tower-defense roguelite. Deploy four node types —
  > Pulse, Beam, Nova, Tesla — along a shifting neon circuit, bank scrap into
  > permanent Lab upgrades, socket glyphs into Cipher Words for combat
  > bonuses, and climb an endless wave count across four difficulty tiers.
  > Daily missions, a login streak, and a free battle pass keep every night's
  > run building toward the next unlock.
- **Genre tags:** Tower Defense, Strategy, Roguelite, Endless

## Prepared assets

- **Icon:** `public/icon-512.png` and `public/icon-1080.png` (freshly rendered
  from the game's existing brand mark, `public/favicon.svg` — square, no
  text, matches each portal's "no borders/logos/text on icons" rule).
- **Screenshots** (pick 3–5; these are real gameplay captures, not staged art):
  `screenshots/menu.png`, `screenshots/combat.png`, `screenshots/midwave.png`,
  `screenshots/placed.png`, `screenshots/skills.png`. Avoid the `qa-*.png`
  files — those are internal debug captures, not store-quality.
- **Not yet produced:** Poki's *animated* thumbnail (1080×1080+, 4–6s loop,
  ≥50fps) and CrazyGames' three cover-image crops (1920×1080 landscape,
  800×1200 portrait, 800×800 square, no borders/logos per their guidelines).
  These are genuine design/video assets, not something to generate blind —
  worth a short follow-up pass (the `design` skill can produce on-brand cover
  art from the existing screenshots/icon) once you're ready to submit.

## Poki

Requirements: 16:9 scaling (640×360 / 836×470 / 1031×580), ~8 MB initial
download target, 30 FPS minimum / 60 FPS target, desktop + mobile + tablet
support (already true — the game is touch/pointer-driven and responsive).
[sdk.poki.com/new-requirements](https://sdk.poki.com/new-requirements.html)

1. Create a developer account at [poki.com/developer](https://poki.com/developer) (or the current "Poki for Developers" signup — email verification, then payout/tax details once you're ready to get paid).
2. Start a new game submission, upload `neon-td-portal-build.zip`.
3. Paste in the title/tagline/description above; upload the icon and screenshots.
4. Poki's review checks the SDK lifecycle calls (`gameplayStart`/`gameplayStop`/`commercialBreak`/`rewardedBreak`) are wired correctly — already implemented and portal-detected in `src/lib/ads/adapter.ts`, no extra work needed.
5. Expect a review period (historically days, not hours) before it goes live; common rejection reasons are missing mobile support (not an issue here) and ads not integrated per spec (already handled).

## CrazyGames

Requirements: cover images at 1920×1080 (16:9), 800×1200 (2:3), 800×800
(1:1); ≤250 MB total, ≤50 MB initial download (≤20 MB to be eligible for
the mobile homepage — current build is well under both); ≤1500 files.
[docs.crazygames.com/requirements](https://docs.crazygames.com/requirements/intro/)

1. Create a developer account at [developer.crazygames.com](https://developer.crazygames.com/).
2. New game → upload the same zip.
3. Upload the three cover-image sizes once produced (see "Not yet produced" above) — don't substitute a plain screenshot for these; CrazyGames explicitly rejects covers with borders, extra logos, or blurry/stretched art.
4. IAP is invite-only and unlocks later based on traction — not needed for this submission; ads work immediately once approved.

## itch.io

Lowest-friction option, useful while the other two are in review — no SDK,
no ads (this build correctly falls back to `NullAdapter` there), payments
default to donation-only unless you set the project's "Kind of project" to
Downloadable. [itch.io/docs/creators/html5](https://itch.io/docs/creators/html5)

1. Create an account at [itch.io](https://itch.io/) → create a new project.
2. Kind of project: **HTML**. Upload the zip, check "This file will be played in the browser."
3. Embed options: fullscreen button on, viewport matching the game's aspect ratio.
4. Paste in the same title/description; itch has no strict cover-size requirements, but a 630×500 or larger cover image reads well on the storefront (`public/og.jpg` at 1200×630 works as a stand-in until dedicated cover art exists).
