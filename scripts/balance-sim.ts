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
  const mods = emptyMods();
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

const maxWave = 300;

const results = [
  runStrategy(
    "2 towers, maxed rank, no economy investment (the reported issue)",
    [
      { kind: "pulse", rank: 5 },
      { kind: "nova", rank: 5 },
    ],
    maxWave,
  ),
  runStrategy(
    "6 towers, maxed rank, one of each kind + 2 extra pulse (moderate investment)",
    [
      { kind: "pulse", rank: 5 },
      { kind: "pulse", rank: 5 },
      { kind: "beam", rank: 5 },
      { kind: "nova", rank: 5 },
      { kind: "nova", rank: 5 },
      { kind: "tesla", rank: 5 },
    ],
    maxWave,
  ),
];

console.log("\n=== Balance sim results ===\n");
for (const r of results) {
  console.log(`${r.label}\n  → died on wave ${r.deathWave ?? `survived past ${maxWave}`}\n`);
}
console.log(
  "Target from the plan: the 2-tower/no-investment strategy should die well before wave 40.\n" +
    "The 6-tower strategy is a rough proxy for 'moderate Lab investment' and should go further\n" +
    "but still fail well short of 300 — full Lab/Upgrades economy isn't modeled here.\n",
);
