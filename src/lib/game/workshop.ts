// Extension included so `node --experimental-strip-types` can resolve this
// directly for balance.test.ts — see the matching note in sim.ts.
import { workshopRank, type InRunId, type PlayerProfile, type WorkshopId } from "./types.ts";

export const IN_RUN_IDS: InRunId[] = [
  "dmg",
  "rng",
  "rate",
  "bounty",
  "income",
  "repair",
  "defensePct",
  "defenseFlat",
  "critChance",
  "critMult",
];

/** Polynomial cost helper replacing exponential growth. Supports hundreds to
 *  thousands of purchases without float overflow. */
function polyCost(bought: number, base: number, k: number, p: number, wave = 0, waveC = 0): number {
  return Math.floor(base * Math.pow(bought + k, p) + waveC * wave);
}

export const WORKSHOP: Record<
  WorkshopId,
  {
    label: string;
    detail: (rank: number) => string;
    per: string;
    base: number;
    k: number;
    p: number;
    cap: number;
    tier: "most" | "lower";
  }
> = {
  attack: {
    label: "Attack",
    detail: (r) => `+${(r * 2).toFixed(0)}% tower damage`,
    per: "+2% damage / lvl",
    base: 1.5, k: 1, p: 1.2, cap: 5000, tier: "most",
  },
  defense: {
    label: "Core plating",
    detail: (r) => `+${r} core integrity`,
    per: "+1 core / lvl",
    base: 1.5, k: 1, p: 1.2, cap: 5000, tier: "most",
  },
  cash: {
    label: "Starting scrap",
    detail: (r) => `+${r * 18} scrap at deploy`,
    per: "+18 scrap / lvl",
    base: 1.5, k: 1, p: 1.2, cap: 5000, tier: "most",
  },
  range: {
    label: "Range",
    detail: (r) => `+${(r * 1.5).toFixed(1)}% tower range`,
    per: "+1.5% range / lvl",
    base: 1.5, k: 1, p: 1.2, cap: 5000, tier: "most",
  },
  cooldown: {
    label: "Fire rate",
    detail: (r) => `+${(r * 1.5).toFixed(1)}% fire rate`,
    per: "+1.5% fire / lvl",
    base: 1.5, k: 1, p: 1.2, cap: 5000, tier: "most",
  },
  coins: {
    label: "Coin bonus",
    detail: (r) => `+${(r * 5).toFixed(0)}% banked after a run`,
    per: "+5% coins / lvl",
    base: 3, k: 1, p: 1.3, cap: 750, tier: "lower",
  },
  drop: {
    label: "Glyph drop",
    detail: (r) => `+${(r * 4).toFixed(0)}% glyph find`,
    per: "+4% drop / lvl",
    base: 3, k: 1, p: 1.3, cap: 750, tier: "lower",
  },
  defensePct: {
    label: "Damage shield %",
    detail: (r) => `${(r * 0.064).toFixed(1)}% damage mitigation`,
    per: "+0.064% mitigation / lvl",
    base: 3, k: 1, p: 1.3, cap: 750, tier: "lower",
  },
  defenseFlat: {
    label: "Damage shield",
    detail: (r) => `${(r * 0.3).toFixed(1)} flat damage reduction`,
    per: "+0.3 flat reduction / lvl",
    base: 3, k: 1, p: 1.3, cap: 750, tier: "lower",
  },
  critChance: {
    label: "Crit chance",
    detail: (r) => `+${(r * 0.027).toFixed(2)}% crit chance`,
    per: "+0.027% crit chance / lvl",
    base: 3, k: 1, p: 1.3, cap: 750, tier: "lower",
  },
  critMult: {
    label: "Crit damage",
    detail: (r) => `+${(r * 0.027).toFixed(2)}% crit multiplier`,
    per: "+0.027% crit mult / lvl",
    base: 3, k: 1, p: 1.3, cap: 750, tier: "lower",
  },
  gameSpeed: {
    label: "Game speed",
    detail: (r) => `Max ${gameSpeedMax(r).toFixed(1)}x speed`,
    per: "Unlocks speed milestones",
    base: 3, k: 1, p: 1.3, cap: 500, tier: "lower",
  },
};

/** Speed milestone table: level → max allowed speed multiplier.
 *  Level 0 = no speed increase available (locked). */
const SPEED_MILESTONES: Array<[number, number]> = [
  [1, 1.5], [2, 2], [10, 3], [25, 3.5], [60, 4], [120, 4.5], [220, 5], [350, 5.5], [500, 6],
];

export function gameSpeedMax(rank: number): number {
  if (rank <= 0) return 1;
  let max = 1;
  for (const [threshold, speed] of SPEED_MILESTONES) {
    if (rank >= threshold) max = speed;
  }
  return max;
}

export const IN_RUN: Record<
  InRunId,
  {
    label: string;
    detail: string;
    base: number;
    step: number;
    k: number;
    p: number;
    waveC: number;
    cap: number;
    tier: "most" | "lower";
  }
> = {
  dmg: {
    label: "Overload", detail: "+0.08% damage this run",
    base: 1.2, step: 0.0008, k: 1, p: 1.13, waveC: 0.04, cap: 7500, tier: "most",
  },
  rng: {
    label: "Longscan", detail: "+0.03% range this run",
    base: 1.2, step: 0.0003, k: 1, p: 1.13, waveC: 0.04, cap: 7500, tier: "most",
  },
  rate: {
    label: "Coolant", detail: "+0.08% fire rate this run",
    base: 1.2, step: 0.0008, k: 1, p: 1.13, waveC: 0.04, cap: 7500, tier: "most",
  },
  repair: {
    label: "Patch", detail: "+4 core integrity",
    base: 1.2, step: 4, k: 1, p: 1.13, waveC: 0.04, cap: 7500, tier: "most",
  },
  bounty: {
    label: "Bounty", detail: "+0.06% kill scrap this run",
    base: 3, step: 0.0006, k: 1, p: 1.25, waveC: 0.15, cap: 500, tier: "lower",
  },
  income: {
    label: "Income", detail: "+5 scrap each wave",
    base: 3, step: 5, k: 1, p: 1.25, waveC: 0.15, cap: 500, tier: "lower",
  },
  defensePct: {
    label: "Shield %", detail: "+0.08% damage mitigation this run",
    base: 3, step: 0.0008, k: 1, p: 1.25, waveC: 0.15, cap: 500, tier: "lower",
  },
  defenseFlat: {
    label: "Shield", detail: "+0.1 flat damage reduction this run",
    base: 3, step: 0.1, k: 1, p: 1.25, waveC: 0.15, cap: 500, tier: "lower",
  },
  critChance: {
    label: "Crit rate", detail: "+0.04% crit chance this run",
    base: 3, step: 0.0004, k: 1, p: 1.25, waveC: 0.15, cap: 500, tier: "lower",
  },
  critMult: {
    label: "Crit power", detail: "+0.04% crit multiplier this run",
    base: 3, step: 0.0004, k: 1, p: 1.25, waveC: 0.15, cap: 500, tier: "lower",
  },
};

export function workshopCost(p: PlayerProfile, id: WorkshopId): number {
  const rank = workshopRank(p, id);
  const e = WORKSHOP[id];
  return polyCost(rank, e.base, e.k, e.p);
}

export function workshopAtCap(p: PlayerProfile, id: WorkshopId): boolean {
  return workshopRank(p, id) >= WORKSHOP[id].cap;
}

/** Lab stat lines now cost Core Shards instead of bankScrap. */
export function buyWorkshop(p: PlayerProfile, id: WorkshopId): boolean {
  if (workshopAtCap(p, id)) return false;
  const cost = workshopCost(p, id);
  if (p.coreShards < cost) return false;
  p.coreShards -= cost;
  p.workshop[id] = workshopRank(p, id) + 1;
  return true;
}

export function inRunCost(bought: number, id: InRunId, wave: number): number {
  const e = IN_RUN[id];
  return polyCost(bought, e.base, e.k, e.p, wave, e.waveC);
}

/** True once a capped in-run line can't be bought again. Every line is now
 *  capped — most-tier at 7500, lower-tier at 500. */
export function inRunAtCap(bought: number, id: InRunId): boolean {
  return bought >= IN_RUN[id].cap;
}
