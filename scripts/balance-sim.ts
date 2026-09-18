#!/usr/bin/env node
/**
 * Headless balance tuning harness — NOT part of `npm run test` (that's what
 * balance.test.ts is for). Run manually while tuning:
 *
 *   node --experimental-strip-types scripts/balance-sim.ts
 *
 * Drives CombatSimulation directly (no GameEngine/canvas needed — sim.ts is
 * pure) through two fixed strategies and reports which wave each dies on.
 * This is a simplified model: fixed tower placement/rank, no in-run economy
 * loop (no Upgrades purchases, no Lab ranks) — it isolates the enemy-scaling
 * curve and tower/splash math from the economy, which is exactly what needs
 * checking after this rebalance. Full economy tuning still needs a manual
 * playtest (see the PR description's Verification section).
 */
import { CombatSimulation, SplitMix64, waveComposition } from "../src/lib/game/sim.ts";
import { BASE_CORE, emptyMods, type GridCoord, type TowerKind } from "../src/lib/game/types.ts";

function findBuildableCoords(sim: CombatSimulation, count: number): GridCoord[] {
  const found: GridCoord[] = [];
  for (let y = 0; y < 8 && found.length < count; y++) {
    for (let x = 0; x < 12 && found.length < count; x++) {
      if (sim.canPlace({ x, y })) found.push({ x, y });
    }
  }
  return found;
}

/** Runs `wave`s of combat with a fixed tower loadout and no economy loop.
 *  Returns the wave the core dropped to 0 on, or null if it survived to
 *  `maxWave`. */
function runStrategy(
  label: string,
  towers: Array<{ kind: TowerKind; rank: number }>,
  maxWave: number,
  mods = emptyMods(),
): { deathWave: number | null; label: string } {
  const sim = new CombatSimulation();
  const coords = findBuildableCoords(sim, towers.length);
  if (coords.length < towers.length) {
    throw new Error(`${label}: map only offered ${coords.length} buildable tiles`);
  }
  for (let i = 0; i < towers.length; i++) {
    const { kind, rank } = towers[i]!;
    sim.placeTower(kind, coords[i]!);
    for (let r = 1; r < rank; r++) sim.rankUp(coords[i]!);
  }

  let coreHP = BASE_CORE;
  const rng = new SplitMix64(1);
  const rngFn = () => rng.nextFloat();

  for (let wave = 1; wave <= maxWave; wave++) {
    sim.resetCombatants();
    // Re-place towers (resetCombatants clears them) — cheap for this
    // fixed-loadout harness, not how the real game works.
    for (let i = 0; i < towers.length; i++) {
      const { kind, rank } = towers[i]!;
      sim.placeTower(kind, coords[i]!);
      for (let r = 1; r < rank; r++) sim.rankUp(coords[i]!);
    }
    sim.queueWave(waveComposition(wave));
    sim.spawnCooldown = 0;
    // Run up to 90 simulated seconds per wave at 60hz — generous; real
    // waves clear well inside this or the run is already lost.
    for (let tick = 0; tick < 90 * 60; tick++) {
      const result = sim.tick(1 / 60, wave, "normal", mods, false, rngFn);
      coreHP -= result.coreDamage;
      if (coreHP <= 0) return { deathWave: wave, label };
      if (sim.waveCleared()) break;
    }
  }
  return { deathWave: null, label };
}

/** Scenarios:
 *  fresh    — 2 towers rank 1, no Lab/mods  →  target: dies ~wave 25–35
 *  moderate — 6 towers rank 5, +30% damage bonus  →  target: ~wave 80–120
 *  deep     — 8 towers rank 5, +80% damage/range/fireRate  →  target: ~wave 180–220
 */

function makeMods(dmgPct = 0, rngPct = 0, ratePct = 0) {
  const m = emptyMods();
  m.damage = dmgPct;
  m.range = rngPct;
  m.fireRate = ratePct;
  return m;
}

/** NOTE: Economy (in-run upgrades, scrap income, Lab compounding) is NOT
 *  modeled here. Real players get substantially more tower power per wave than
 *  these fixed loadouts — so the sim's wave numbers are a FLOOR.  The in-game
 *  targets from balance.md are:
 *    fresh:    ~25–35   moderate: ~100   deep: ~200
 *  Expect the sim to land roughly half those values. */

const maxWave = 350;

const results = [
  // Fresh: 4 rank-2 towers (a player who built a few but didn't invest much)
  runStrategy(
    "fresh (4×rank-2 towers, no mods)",
    [
      { kind: "pulse", rank: 2 },
      { kind: "nova", rank: 2 },
      { kind: "pulse", rank: 2 },
      { kind: "beam", rank: 2 },
    ],
    maxWave,
    makeMods(),
  ),
  // Moderate: 6 rank-5 towers + Lab-level bonuses for ~50 workshop ranks
  runStrategy(
    "moderate (6×rank-5, +20% dmg/rate)",
    [
      { kind: "pulse", rank: 5 },
      { kind: "pulse", rank: 5 },
      { kind: "beam", rank: 5 },
      { kind: "nova", rank: 5 },
      { kind: "nova", rank: 5 },
      { kind: "tesla", rank: 5 },
    ],
    maxWave,
    makeMods(0.20, 0, 0.20),
  ),
  // Deep: 8 rank-5 + heavy Lab investment (+60% all)
  runStrategy(
    "deep (8×rank-5, +60% all)",
    [
      { kind: "pulse", rank: 5 },
      { kind: "pulse", rank: 5 },
      { kind: "beam", rank: 5 },
      { kind: "beam", rank: 5 },
      { kind: "nova", rank: 5 },
      { kind: "nova", rank: 5 },
      { kind: "tesla", rank: 5 },
      { kind: "tesla", rank: 5 },
    ],
    maxWave,
    makeMods(0.60, 0.60, 0.60),
  ),
];

console.log("\n=== Balance sim results ===\n");
for (const r of results) {
  console.log(`${r.label}\n  → died on wave ${r.deathWave ?? `survived past ${maxWave}`}\n`);
}
console.log(
  "Sim targets (economy not modeled — sim floor is roughly 40-80% of in-game target):\n" +
    "  fresh:    ~25–40  (in-game target: 25–35  — sim shows floor, econ gives extra range)\n" +
    "  moderate: ~60–90  (in-game target: ~100)\n" +
    "  deep:     ~200+   (in-game target: ~200)\n" +
    "\nIf fresh dies before wave 20 or moderate before wave 50, retune endlessScaling.\n",
);
