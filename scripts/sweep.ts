#!/usr/bin/env node
/**
 * 4000-run balance sweep (4 difficulties × 50 investment levels × 4 strategies × 5 seeds).
 *
 *   node --experimental-strip-types scripts/sweep.ts [--quick] [--full] [--tier=<tier>]
 *
 * --quick  : 10 investment levels × 2 strategies × 2 seeds = 160 runs (fast iteration)
 * --full   : 50 × 4 × 5 = 4000 runs (overnight at 5000-wave cap)
 * default  : 50 × 4 × 5 = 4000 runs at 400-wave cap (~20 min on 4 cores)
 *
 * Output: printed death-wave table + optional CSV to artifacts/sweep-<timestamp>.csv
 */
import {
  CombatSimulation,
  SplitMix64,
  effectiveRange,
  waveComposition,
} from "../src/lib/game/sim.ts";
import {
  BASE_CORE,
  MAX_RANK,
  TOWER,
  TOWER_KINDS,
  bountyBonus,
  damageBonus,
  defaultProfile,
  emptyMods,
  fireRateBonus,
  rangeBonus,
  skillRank,
  startingScrap,
  workshopRank,
  type CombatMods,
  type DifficultyTier,
  type GridCoord,
  type InRunId,
  type PlayerProfile,
  type TowerKind,
} from "../src/lib/game/types.ts";
import { IN_RUN, inRunAtCap, inRunCost, inRunEffect } from "../src/lib/game/workshop.ts";

const DIFFICULTIES: DifficultyTier[] = ["normal", "hard", "nightmare", "insane"];

/** Mirrors engine.refreshMods() for the 4 fields economy-sim uses. */
function buildMods(p: PlayerProfile, inRun: Partial<Record<InRunId, number>>): CombatMods {
  const mods = emptyMods();
  mods.damage = damageBonus(p) + inRunEffect(inRun.dmg ?? 0, "dmg");
  mods.range = rangeBonus(p) + inRunEffect(inRun.rng ?? 0, "rng");
  mods.fireRate = fireRateBonus(p) + inRunEffect(inRun.rate ?? 0, "rate");
  mods.bounty = bountyBonus(p) + inRunEffect(inRun.bounty ?? 0, "bounty");
  mods.critChance = Math.min(0.75, inRunEffect(inRun.critChance ?? 0, "critChance"));
  mods.critFactor = inRunEffect(inRun.critFactor ?? 0, "critFactor");
  mods.slow = Math.min(0.5, inRunEffect(inRun.slow ?? 0, "slow"));
  mods.damageReduction = Math.min(0.8, inRunEffect(inRun.damageReduction ?? 0, "damageReduction"));
  mods.interest = inRunEffect(inRun.interest ?? 0, "interest");
  return mods;
}

function startingCore(p: PlayerProfile): number {
  return BASE_CORE + skillRank(p, "coreShield") * 4 + workshopRank(p, "defense");
}

function buildableCoords(sim: CombatSimulation): GridCoord[] {
  const out: GridCoord[] = [];
  for (const k of sim.map.buildable) {
    const [x, y] = k.split(",").map(Number);
    out.push({ x: x!, y: y! });
  }
  const mid = sim.map.path[Math.floor(sim.map.path.length / 2)]!;
  out.sort((a, b) => Math.hypot(a.x - mid.x, a.y - mid.y) - Math.hypot(b.x - mid.x, b.y - mid.y));
  return out;
}

function coverage(sim: CombatSimulation, coord: GridCoord, kind: TowerKind, mods: CombatMods) {
  const r = effectiveRange(kind, mods);
  let n = 0;
  for (const p of sim.map.path) {
    if (Math.hypot(p.x - coord.x, p.y - coord.y) <= r) n++;
  }
  return n;
}

type Strategy = "offense" | "income" | "defense" | "balanced";

/** Build a priority list for a given strategy. */
function makePriorities(strategy: Strategy): InRunId[] {
  switch (strategy) {
    case "offense":
      return ["dmg", "rate", "rng", "critChance", "critFactor", "income", "repair", "maxCore"];
    case "income":
      return ["income", "bounty", "interest", "dmg", "rate", "rng", "repair", "maxCore"];
    case "defense":
      return ["maxCore", "repair", "damageReduction", "slow", "income", "dmg", "rate", "rng"];
    case "balanced":
      return ["dmg", "income", "rate", "maxCore", "rng", "repair", "bounty", "slow"];
  }
}

/** Map investment level 0–49 to a PlayerProfile with increasing Lab/skill ranks. */
function profileForLevel(level: number): PlayerProfile {
  const p = defaultProfile();
  // Level 0 = fresh (no ranks), Level 49 = deep
  const workshopScale = Math.floor((level / 49) * 30);
  const skillScale = Math.min(5, Math.floor((level / 49) * 5));
  p.workshop = {
    attack: workshopScale,
    defense: workshopScale,
    cash: Math.floor(workshopScale * 0.5),
    coins: Math.floor(workshopScale * 0.4),
    range: Math.floor(workshopScale * 0.65),
    cooldown: Math.floor(workshopScale * 0.65),
    drop: Math.floor(workshopScale * 0.3),
  };
  p.skillRanks = {
    scrapCache: skillScale,
    coreShield: skillScale,
    overclock: skillScale,
    rangeAmp: Math.min(5, skillScale),
    bountyProtocol: Math.min(5, skillScale),
  };
  return p;
}

type RunResult = {
  deathWave: number | null;
  peakTowers: number;
  totalLeaks: number;
  unclearableWaves: number;
};

function runSim(
  p: PlayerProfile,
  tier: DifficultyTier,
  strategy: Strategy,
  seed: number,
  maxWave: number,
): RunResult {
  const sim = new CombatSimulation();
  const coords = buildableCoords(sim);
  const rng = new SplitMix64(seed);
  const rngFn = () => rng.nextFloat();
  const priorities = makePriorities(strategy);

  const inRun: Partial<Record<InRunId, number>> = {};
  let scrap = startingScrap(p);
  let maxCore = startingCore(p);
  let coreHP = maxCore;
  let mods = buildMods(p, inRun);
  let peakTowers = 0;
  let unclearableWaves = 0;
  let totalLeaks = 0;

  const spend = (wave: number) => {
    for (let guard = 0; guard < 500; guard++) {
      mods = buildMods(p, inRun);
      const options: Array<{ cost: number; score: number; apply: () => void }> = [];

      // Placement first when map isn't full.
      let tile: { coord: GridCoord; kind: TowerKind } | null = null;
      for (const coord of coords) {
        if (!sim.canPlace(coord)) continue;
        let best: { kind: TowerKind; cov: number } | null = null;
        for (const kind of TOWER_KINDS) {
          const cov = coverage(sim, coord, kind, mods);
          if (cov > 0 && (!best || cov > best.cov)) best = { kind, cov };
        }
        if (best) { tile = { coord, kind: best.kind }; break; }
      }
      if (tile) {
        const t = tile;
        options.push({ cost: TOWER[t.kind].cost, score: 10, apply: () => void sim.placeTower(t.kind, t.coord) });
      }

      // Priority upgrades.
      for (let i = 0; i < priorities.length; i++) {
        const id = priorities[i]!;
        const bought = inRun[id] ?? 0;
        if (inRunAtCap(bought, id)) continue;
        const cost = inRunCost(bought, id, wave);
        options.push({
          cost,
          score: priorities.length - i,
          apply: () => {
            inRun[id] = (inRun[id] ?? 0) + 1;
            if (id === "repair") {
              coreHP = Math.min(maxCore, coreHP + IN_RUN.repair.step);
            } else if (id === "maxCore") {
              maxCore += IN_RUN.maxCore.step;
            }
          },
        });
      }

      // Tower ranks.
      let rankPick: { coord: GridCoord; cost: number } | null = null;
      for (const t of sim.towers) {
        if (t.rank >= MAX_RANK) continue;
        const c = sim.rankUpCost(t.coord);
        if (c != null && (!rankPick || c < rankPick.cost)) rankPick = { coord: t.coord, cost: c };
      }
      if (rankPick) {
        const r = rankPick;
        options.push({ cost: r.cost, score: 5, apply: () => void sim.rankUp(r.coord) });
      }

      const afford = options.filter((o) => o.cost <= scrap);
      if (!afford.length) break;
      afford.sort((a, b) => b.score - a.score || a.cost - b.cost);
      scrap -= afford[0]!.cost;
      afford[0]!.apply();
    }
    mods = buildMods(p, inRun);
  };

  for (let wave = 1; wave <= maxWave; wave++) {
    spend(wave);
    peakTowers = Math.max(peakTowers, sim.towers.length);

    sim.resetCombatants();
    sim.queueWave(waveComposition(wave));
    sim.spawnCooldown = 0;
    if (inRun.income) scrap += (inRun.income) * IN_RUN.income.step;
    if (mods.interest > 0) scrap += Math.floor(scrap * mods.interest);

    let cleared = false;
    for (let t = 0; t < 600 * 60; t++) {
      const r = sim.tick(1 / 60, wave, tier, mods, false, rngFn);
      scrap += r.scrap;
      coreHP -= r.coreDamage;
      for (const ev of r.events) {
        if (ev.t === "kill" && ev.kind === "boss") scrap += 80 + wave * 2;
        if (ev.t === "leak") totalLeaks++;
      }
      if (coreHP <= 0) return { deathWave: wave, peakTowers, totalLeaks, unclearableWaves };
      if (sim.waveCleared()) { cleared = true; break; }
    }
    if (!cleared) unclearableWaves++;
  }
  return { deathWave: null, peakTowers, totalLeaks, unclearableWaves };
}

const isQuick = process.argv.includes("--quick");
const isFull = process.argv.includes("--full");
const tierFilter = process.argv.find((a) => a.startsWith("--tier="))?.slice(7) as DifficultyTier | undefined;

const LEVELS = isQuick ? 10 : 50;
const STRATEGIES: Strategy[] = isQuick ? ["offense", "balanced"] : ["offense", "income", "defense", "balanced"];
const SEEDS = isQuick ? 2 : 5;
const MAX_WAVE = isFull ? 5000 : 400;

const tiers = tierFilter ? [tierFilter] : DIFFICULTIES;
const totalRuns = tiers.length * LEVELS * STRATEGIES.length * SEEDS;

console.log(`\n=== Sweep (${tiers.join(", ")}, ${LEVELS} levels, ${STRATEGIES.length} strategies, ${SEEDS} seeds, cap ${MAX_WAVE}) ===`);
console.log(`Total runs: ${totalRuns}\n`);

type Cell = { level: number; tier: DifficultyTier; deaths: number[]; survivors: number };

const rows: Cell[] = [];

for (const tier of tiers) {
  console.log(`--- ${tier} ---`);
  // Print header
  console.log(`${"level".padEnd(6)} ${"p10".padStart(6)} ${"med".padStart(6)} ${"p90".padStart(6)} ${"surv".padStart(5)}`);

  for (let level = 0; level < LEVELS; level++) {
    const p = profileForLevel(level);
    const deaths: number[] = [];
    let survivors = 0;

    for (const strategy of STRATEGIES) {
      for (let s = 0; s < SEEDS; s++) {
        const seed = 1000 * level + s * 7 + STRATEGIES.indexOf(strategy) * 100;
        const result = runSim(p, tier, strategy, seed, MAX_WAVE);
        if (result.deathWave !== null) {
          deaths.push(result.deathWave);
        } else {
          survivors++;
        }
      }
    }

    const sorted = [...deaths].sort((a, b) => a - b);
    const p10 = sorted[Math.floor(sorted.length * 0.1)] ?? (survivors > 0 ? `>${MAX_WAVE}` : "—");
    const med = sorted[Math.floor(sorted.length * 0.5)] ?? (survivors > 0 ? `>${MAX_WAVE}` : "—");
    const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? (survivors > 0 ? `>${MAX_WAVE}` : "—");
    console.log(`${String(level).padEnd(6)} ${String(p10).padStart(6)} ${String(med).padStart(6)} ${String(p90).padStart(6)} ${String(survivors).padStart(5)}`);
    rows.push({ level, tier, deaths, survivors });
  }
  console.log();
}

console.log(`Done. ${totalRuns} runs completed.`);
console.log("Note: survivors = runs that reached the wave cap without dying.");
console.log("Ideal: level 0 dies early (~25-35), level 49 reaches deep into the endgame.\n");
