#!/usr/bin/env node
/**
 * Copies PGLite's runtime assets (WASM binaries, the base data image, and
 * every extension .tar.gz) into the built Vercel serverless function.
 *
 * Why this is needed: `src/lib/db.ts` falls back to an embedded PGLite
 * (Postgres compiled to WASM) whenever `DATABASE_URL` isn't set, specifically
 * so the app "has a working database even with nothing configured — the live
 * preview included" (see that file's comment). But Nitro's dependency
 * bundler for the `vercel` preset only follows JS imports — it bundles
 * `electric-sql__pglite.mjs` into `_libs/` but has no way to know that module
 * reads sibling files (`pglite.wasm`, `pglite.data`, `initdb.wasm`, and the
 * `.tar.gz` for every Postgres contrib extension) directly off disk at
 * runtime. Without them, any request that reaches `ensureDbReady()` without
 * `DATABASE_URL` set 500s with ENOENT — confirmed to reproduce on `main`
 * too, not something introduced by any particular feature branch.
 *
 * This is deploy-config-shaped ("is DATABASE_URL set on this environment?"),
 * not something a fresh clone's local `npm run dev`/`npm run build` hits —
 * PGLite reads straight from `node_modules` there. It only bites the built
 * Vercel function, so the fix lives in the build pipeline, not `db.ts`.
 */
import { readdirSync, copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pgliteDist = join(root, "node_modules", "@electric-sql", "pglite", "dist");
const targetDir = join(
  root,
  ".vercel",
  "output",
  "functions",
  "__server.func",
  "_libs",
);

if (!existsSync(targetDir)) {
  // Static/portal builds have no server function — nothing to patch.
  console.log("[copy-pglite-assets] no _libs directory (static build) — skipping.");
  process.exit(0);
}
if (!existsSync(pgliteDist)) {
  console.log("[copy-pglite-assets] @electric-sql/pglite not installed — skipping.");
  process.exit(0);
}

const assetExtensions = [".wasm", ".data", ".tar.gz"];
const files = readdirSync(pgliteDist).filter((f) =>
  assetExtensions.some((ext) => f.endsWith(ext)),
);

if (files.length === 0) {
  console.error("[copy-pglite-assets] found zero WASM/data/tar.gz assets — PGLite's");
  console.error("  package layout may have changed; the fallback DB will crash at");
  console.error("  runtime without DATABASE_URL. Check node_modules/@electric-sql/pglite/dist.");
  process.exit(1);
}

for (const f of files) {
  copyFileSync(join(pgliteDist, f), join(targetDir, f));
}
console.log(`[copy-pglite-assets] copied ${files.length} PGLite runtime assets into ${targetDir}`);
