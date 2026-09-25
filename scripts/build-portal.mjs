#!/usr/bin/env node
// Portal build orchestrator (Poki/CrazyGames/itch.io need a self-contained
// static zip — see the `isPortalBuild` block in vite.config.ts for why this
// exists at all).
//
// Known issue: with this project's TanStack Start + Nitro 3 beta versions,
// `vite build` under the `static` preset crashes on its *last* step (bundling
// a server fallback the `static` preset shouldn't need at all — the error is
// "rolldownOptions.input should not be an html file when building for SSR").
// By the time it crashes, the actual static site (`.output/public/`) is
// already fully built and prerendered; the one defect left behind is that
// the prerendered `index.html` links the *SSR* environment's separately
// -hashed CSS build artifact (under node_modules/.nitro/, never shipped)
// instead of the client CSS file that actually ships in `.output/public/`.
// This script runs the build, tolerates that specific late failure, and
// patches the one broken reference — then verifies the result is real
// before calling it done. Revisit removing this once upstream fixes the
// static-preset/SSR-entry interaction.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const publicDir = join(root, ".output", "public");
const assetsDir = join(publicDir, "assets");
const indexPath = join(publicDir, "index.html");

const result = spawnSync(
  process.execPath,
  [join(root, "scripts", "with-app-env.mjs"), "vite", "build"],
  { stdio: "inherit", cwd: root },
);

const builtStaticSite = existsSync(indexPath) && existsSync(assetsDir);

if (result.status !== 0) {
  if (!builtStaticSite) {
    console.error(
      "[build-portal] vite build failed before producing a static site — not a known/tolerated failure.",
    );
    process.exit(result.status ?? 1);
  }
  console.warn(
    "[build-portal] vite build exited non-zero on its known-broken final step; " +
      ".output/public was produced anyway, continuing to patch it.",
  );
}

if (!builtStaticSite) {
  console.error("[build-portal] .output/public/index.html or assets/ missing — nothing to patch.");
  process.exit(1);
}

const cssFile = readdirSync(assetsDir).find((f) => f.startsWith("styles-") && f.endsWith(".css"));
if (!cssFile) {
  console.error("[build-portal] no client CSS file found in .output/public/assets — aborting.");
  process.exit(1);
}

const before = readFileSync(indexPath, "utf8");
const after = before.replace(/href="\/assets\/styles-[\w-]+\.css"/, `href="/assets/${cssFile}"`);
if (after === before && !before.includes(`/assets/${cssFile}`)) {
  console.error("[build-portal] no stylesheet <link> found to rewrite in index.html — aborting.");
  process.exit(1);
}
writeFileSync(indexPath, after);

console.log(
  `[build-portal] OK — .output/public is ready to zip (index.html -> /assets/${cssFile}).`,
);
