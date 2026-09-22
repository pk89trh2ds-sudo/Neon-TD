#!/usr/bin/env node
/**
 * Economy-aware balance harness — the counterpart to balance-sim.ts.
 *
 *   node --experimental-strip-types scripts/economy-sim.ts
 *
 * balance-sim.ts holds the tower loadout FIXED and models no economy, which
 * isolates the enemy-scaling curve but answers the wrong question: the target
 * table in docs/balance.md ("fresh dies 25-35, moderate ~100, deep ~200") is
 * about how far a *player* gets, and a player spends. That spending is the
 * dominant term — in-run scrap buys tower coverage and ranks far faster than
 * permanent Lab ranks contribute — so a fixed-loadout harness cannot validate
 * those numbers even in principle.
 *
 * This harness closes that loop. It drives the real CombatSimulation with the
 * real cost curves (TOWER costs, CombatSimulation.rankUpCost, inRunCost/
 * inRunAtCap), the real scrap income (killBounty via tick(), the income line,
 * the boss bonus from engine.ts), and the real core/leak rules, then plays a
 * greedy but competent buyer against it.
 *
 * NOT modeled: modules, glyphs/ciphers, prestige, rolled offers (buyOffer),
 * revive/emergency-patch continues. All of those help the player, so every
 * number this prints is a LOWER bound on how far that profile can get.
 *
 * The buyer here is deliberately good at the game — it fills the map. That is
 * the point: the reported bug this rebalance targeted was a player trivially
 * reaching wave 250, so the question is what an optimizing player achieves,
 * not what an average one does.
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

/** Mirrors types.ts startingCore() minus nextRunCoreBonus (not modeled). */
function startingCore(p: PlayerProfile): number {
  return BASE_CORE + skillRank(p, "coreShield") * 4 + workshopRank(p, "defense");
}

/** Mirrors engine.refreshMods() minus modules/chassis (not modeled). */
function buildMods(p: PlayerProfile, inRun: Partial<Record<InRunId, number>>): CombatMods {
  const mods = emptyMods();
  mods.damage = damageBonus(p) + inRunEffect(inRun.dmg ?? 0, "dmg");
  mods.range = rangeBonus(p) + inRunEffect(inRun.rng ?? 0, "rng");
  mods.fireRate = fireRateBonus(p) + inRunEffect(inRun.rate ?? 0, "rate");
  mods.bounty = bountyBonus(p) + inRunEffect(inRun.bounty ?? 0, "bounty");
  return mods;
}

/** Buildable tiles, most central first, so the greedy buyer covers the lane
 *  before it wastes scrap on a corner that sees nothing. */
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

/** Path cells a tower at `coord` could actually shoot — used to skip tiles
 *  that can never fire, which a real player also wouldn't buy. */
function coverage(sim: CombatSimulation, coord: GridCoord, kind: TowerKind, mods: CombatMods) {
  const r = effectiveRange(kind, mods);
  let n = 0;
  for (const p of sim.map.path) {
    if (Math.hypot(p.x - coord.x, p.y - coord.y) <= r) n++;
  }
  return n;
}

type Outcome = {
  deathWave: number | null;
  peakTowers: number;
  maxedAt: number | null;
  unclearableWaves: number;
  totalLeaks: number;
};

function runEconomy(
  p: PlayerProfile,
  tier: DifficultyTier,
  maxWave: number,
  trace = false,
): Outcome {
  const sim = new CombatSimulation();
  const coords = buildableCoords(sim);
  const rng = new SplitMix64(12345);
  const rngFn = () => rng.nextFloat();

  const inRun: Partial<Record<InRunId, number>> = {};
  let scrap = startingScrap(p);
  let maxCore = startingCore(p);
  let coreHP = maxCore;
  let mods = buildMods(p, inRun);
  let peakTowers = 0;
  let maxedAt: number | null = null;
  let unclearableWaves = 0;
  let totalLeaks = 0;

  /** Spend down to nothing on the highest-value affordable purchase. */
  const spend = (wave: number) => {
    for (let guard = 0; guard < 500; guard++) {
      mods = buildMods(p, inRun);
      const options: Array<{ cost: number; score: number; apply: () => void }> = [];

      // Patch first when hurt — losing the run costs more than any upgrade.
      if (coreHP < maxCore * 0.6) {
        options.push({
          cost: inRunCost(inRun.repair ?? 0, "repair", wave),
          score: 6,
          apply: () => {
            inRun.repair = (inRun.repair ?? 0) + 1;
            coreHP += IN_RUN.repair.step;
            maxCore = Math.max(maxCore, coreHP);
          },
        });
      }
      // Coverage beats everything else early.
      let tile: { coord: GridCoord; kind: TowerKind } | null = null;
      for (const coord of coords) {
        if (!sim.canPlace(coord)) continue;
        let best: { kind: TowerKind; cov: number } | null = null;
        for (const kind of TOWER_KINDS) {
          const cov = coverage(sim, coord, kind, mods);
          if (cov > 0 && (!best || cov > best.cov)) best = { kind, cov };
        }
        if (best) {
          tile = { coord, kind: best.kind };
          break;
        }
      }
      if (tile) {
        const t = tile;
        options.push({
          cost: TOWER[t.kind].cost,
          score: 5,
          apply: () => void sim.placeTower(t.kind, t.coord),
        });
      }
      // Then ranks, cheapest first.
      let rankPick: { coord: GridCoord; cost: number } | null = null;
      for (const t of sim.towers) {
        if (t.rank >= MAX_RANK) continue;
        const c = sim.rankUpCost(t.coord);
        if (c != null && (!rankPick || c < rankPick.cost)) rankPick = { coord: t.coord, cost: c };
      }
      if (rankPick) {
        const r = rankPick;
        options.push({ cost: r.cost, score: 4, apply: () => void sim.rankUp(r.coord) });
      }
      // Income only while it still has waves left to pay back over.
      if (wave <= 25 && !inRunAtCap(inRun.income ?? 0, "income")) {
        options.push({
          cost: inRunCost(inRun.income ?? 0, "income", wave),
          score: 3,
          apply: () => (inRun.income = (inRun.income ?? 0) + 1),
        });
      }
      // Finally the uncapped combat lines — the only sink left once the map
      // is full and maxed.
      for (const id of ["dmg", "rate", "rng"] as InRunId[]) {
        if (inRunAtCap(inRun[id] ?? 0, id)) continue;
        options.push({
          cost: inRunCost(inRun[id] ?? 0, id, wave),
          score: 2,
          apply: () => (inRun[id] = (inRun[id] ?? 0) + 1),
        });
      }

      const afford = options.filter((o) => o.cost <= scrap);
      if (!afford.length) break;
      afford.sort((a, b) => b.score - a.score || a.cost - b.cost);
      const pick = afford[0]!;
      scrap -= pick.cost;
      pick.apply();
    }
    mods = buildMods(p, inRun);
  };

  for (let wave = 1; wave <= maxWave; wave++) {
    spend(wave);
    peakTowers = Math.max(peakTowers, sim.towers.length);
    if (maxedAt == null && sim.towers.length > 0 && sim.towers.every((t) => t.rank >= MAX_RANK)) {
      maxedAt = wave;
    }

    // beginWave()
    sim.resetCombatants();
    sim.queueWave(waveComposition(wave));
    sim.spawnCooldown = 0;
    scrap += (inRun.income ?? 0) * IN_RUN.income.step;

    let cleared = false;
    // Generous ceiling. Enemies always advance, so a wave resolves by kill or
    // leak well inside this; a timeout would mean the harness silently forgave
    // an unclearable wave, which is why it's counted and reported.
    for (let t = 0; t < 600 * 60; t++) {
      const r = sim.tick(1 / 60, wave, tier, mods, false, rngFn);
      scrap += r.scrap;
      coreHP -= r.coreDamage;
      for (const ev of r.events) {
        if (ev.t === "kill" && ev.kind === "boss") scrap += 80 + wave * 2;
        if (ev.t === "leak") totalLeaks++;
      }
      if (coreHP <= 0) {
        return { deathWave: wave, peakTowers, maxedAt, unclearableWaves, totalLeaks };
      }
      if (sim.waveCleared()) {
        cleared = true;
        break;
      }
    }
    if (!cleared) unclearableWaves++;
    if (trace && wave % 25 === 0) {
      console.log(
        `    w${String(wave).padStart(4)}  towers ${String(sim.towers.length).padStart(2)}` +
          `  scrap ${String(Math.round(scrap)).padStart(8)}` +
          `  core ${coreHP}/${maxCore}  dmg+${Math.round(mods.damage * 100)}%  leaks ${totalLeaks}`,
      );
    }
  }
  return { deathWave: null, peakTowers, maxedAt, unclearableWaves, totalLeaks };
}

/** The three rows of docs/balance.md's target table. */
function profileFor(kind: "fresh" | "moderate" | "deep"): PlayerProfile {
  const p = defaultProfile();
  if (kind === "moderate") {
    p.workshop = { attack: 8, defense: 8, cash: 5, coins: 4, range: 6, cooldown: 6, drop: 3 };
    p.skillRanks = { scrapCache: 3, coreShield: 3, overclock: 3, rangeAmp: 2, bountyProtocol: 2 };
  } else if (kind === "deep") {
    p.workshop = {
      attack: 30,
      defense: 30,
      cash: 15,
      coins: 15,
      range: 20,
      cooldown: 20,
      drop: 10,
    };
    p.skillRanks = { scrapCache: 5, coreShield: 5, overclock: 5, rangeAmp: 5, bountyProtocol: 5 };
  }
  return p;
}

const TARGETS = { fresh: "25–35", moderate: "~100", deep: "~200" } as const;
const tier = (process.argv[2] as DifficultyTier) ?? "normal";
const maxWave = Number(process.argv[3] ?? 600);
const trace = process.argv.includes("--trace");

console.log(`\n=== Economy-aware balance probe (${tier}, cap ${maxWave}) ===\n`);
for (const kind of ["fresh", "moderate", "deep"] as const) {
  const r = runEconomy(profileFor(kind), tier, maxWave, trace);
  console.log(
    `${kind.padEnd(9)} target ${TARGETS[kind].padEnd(6)} → died wave ${
      r.deathWave ?? `>${maxWave}`
    }   (peak ${r.peakTowers} towers, all maxed by w${r.maxedAt ?? "—"}, ` +
      `${r.totalLeaks} leaks, ${r.unclearableWaves} unclearable)`,
  );
}
console.log(
  "\nThese are lower bounds — modules, glyphs/ciphers, prestige and rolled\n" +
    "offers are not modeled and all favour the player. A large gap between\n" +
    "target and measured means the curve needs another tuning pass; a small\n" +
    "fresh→deep spread means permanent Lab progression isn't moving run\n" +
    "length, whatever the absolute numbers say.\n",
);
