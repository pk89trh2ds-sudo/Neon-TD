#!/usr/bin/env node
/**
 * Death-wave sweep — tests Lab investment spread across 10 levels.
 * Run: node --experimental-strip-types scripts/sweep.ts [--quick]
 *
 * Each level maps workshop points into attack/range/cooldown ranks.
 * In-run upgrades accumulate at a fixed economy rate (1 buy per 6 waves).
 * Reports p10/median/p90 death waves to verify spread targets:
 *   level 0 → ~wave 35–40  |  level 5 → ~wave 80–130  |  level 9 → wave 200+
 */
import { CombatSimulation, SplitMix64, waveComposition } from "../src/lib/game/sim.ts";
import {
  BASE_CORE,
  emptyMods,
  defaultProfile,
  damageBonus,
  rangeBonus,
  fireRateBonus,
  type GridCoord,
  type PlayerProfile,
  type TowerKind,
} from "../src/lib/game/types.ts";
import { IN_RUN } from "../src/lib/game/workshop.ts";

const QUICK = process.argv.includes("--quick");
const RUNS_PER_LEVEL = QUICK ? 30 : 200;
const MAX_WAVE = 300;
const IN_RUN_BUY_INTERVAL = 6; // buy 1 dmg upgrade every N waves

/** Build a profile with a given total workshop investment spread. */
function buildProfile(investmentLevel: number): PlayerProfile {
  const p = defaultProfile();
  // Distribute points across attack (60%), range (20%), cooldown (20%)
  const total = investmentLevel * 5;
  const atk = Math.floor(total * 0.6);
  const rng = Math.floor(total * 0.2);
  const cd = total - atk - rng;
  p.workshop = { attack: atk, range: rng, cooldown: cd };
  return p;
}

/** Multiplicative mod composition — same fix as engine.ts:refreshMods. */
function buildMods(p: PlayerProfile, dmgStacks: number, rngStacks: number, rateStacks: number) {
  const mods = emptyMods();
  mods.damage = (1 + damageBonus(p)) * (1 + dmgStacks * IN_RUN.dmg.step) - 1;
  mods.range = (1 + rangeBonus(p)) * (1 + rngStacks * IN_RUN.rng.step) - 1;
  mods.fireRate = (1 + fireRateBonus(p)) * (1 + rateStacks * IN_RUN.rate.step) - 1;
  return mods;
}

function findBuildableCoords(sim: CombatSimulation, count: number): GridCoord[] {
  const found: GridCoord[] = [];
  for (let y = 0; y < 8 && found.length < count; y++) {
    for (let x = 0; x < 12 && found.length < count; x++) {
      if (sim.canPlace({ x, y })) found.push({ x, y });
    }
  }
  return found;
}

function runOnce(profile: PlayerProfile, seed: number): number {
  const sim = new CombatSimulation();
  const rng = new SplitMix64(seed);
  const rngFn = () => rng.nextFloat();

  const towerLayout: Array<{ kind: TowerKind; rank: number }> = [
    { kind: "pulse", rank: 3 },
    { kind: "nova", rank: 3 },
    { kind: "beam", rank: 2 },
    { kind: "tesla", rank: 2 },
  ];

  const coords = findBuildableCoords(sim, towerLayout.length);

  let coreHP = BASE_CORE;
  let dmgStacks = 0;
  let rngStacks = 0;
  let rateStacks = 0;

  for (let wave = 1; wave <= MAX_WAVE; wave++) {
    sim.resetCombatants();
    for (let i = 0; i < towerLayout.length; i++) {
      const { kind, rank } = towerLayout[i]!;
      sim.placeTower(kind, coords[i]!);
      for (let r = 1; r < rank; r++) sim.rankUp(coords[i]!);
    }

    // Simple economy: buy a damage upgrade every IN_RUN_BUY_INTERVAL waves
    if (wave % IN_RUN_BUY_INTERVAL === 0) {
      const roll = rng.nextFloat();
      if (roll < 0.5) dmgStacks++;
      else if (roll < 0.75) rngStacks++;
      else rateStacks++;
    }

    const mods = buildMods(profile, dmgStacks, rngStacks, rateStacks);
    sim.queueWave(waveComposition(wave));
    sim.spawnCooldown = 0;

    for (let tick = 0; tick < 90 * 60; tick++) {
      const result = sim.tick(1 / 60, wave, "normal", mods, false, rngFn);
      coreHP -= result.coreDamage;
      if (coreHP <= 0) return wave;
      if (sim.waveCleared()) break;
    }
  }
  return MAX_WAVE;
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)]!;
}

console.log(
  `\nDeath-wave sweep (${RUNS_PER_LEVEL} runs/level, ${QUICK ? "quick" : "full"})\n`,
);
console.log("level | workshop pts | p10 | median | p90");
console.log("------+--------------+-----+--------+----");

for (let level = 0; level <= 9; level++) {
  const profile = buildProfile(level);
  const deaths: number[] = [];
  for (let r = 0; r < RUNS_PER_LEVEL; r++) {
    deaths.push(runOnce(profile, level * 100_000 + r));
  }
  deaths.sort((a, b) => a - b);
  const total = level * 5;
  console.log(
    `  ${String(level).padStart(3)}  |     ${String(total).padStart(5)}    | ${String(percentile(deaths, 0.1)).padStart(3)} |   ${String(percentile(deaths, 0.5)).padStart(3)}  | ${String(percentile(deaths, 0.9)).padStart(3)}`,
  );
}

console.log("\nTargets: level 0 → ~35–40  |  level 5 → ~80–130  |  level 9 → 200+\n");
