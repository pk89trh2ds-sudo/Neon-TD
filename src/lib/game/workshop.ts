// Extension included so `node --experimental-strip-types` can resolve this
// directly for balance.test.ts — see the matching note in sim.ts.
import { workshopRank, type InRunId, type PlayerProfile, type WorkshopId } from "./types.ts";

export type UpgradeTab = "offense" | "defense" | "special" | "income";

export const IN_RUN_IDS_BY_TAB: Record<UpgradeTab, InRunId[]> = {
  offense:  ["dmg", "rate", "rng", "critChance", "critFactor", "multishotChance", "multishotTargets"],
  defense:  ["maxCore", "repair", "corePerWave", "damageReduction", "slow"],
  special:  ["splashAdd", "splashConvert", "execute", "chain"],
  income:   ["income", "bounty", "interest", "coreOnKill", "freeUpgrade"],
};

export const WORKSHOP: Record<
  WorkshopId,
  { label: string; detail: (rank: number) => string; base: number; per: string }
> = {
  attack: {
    label: "Attack",
    detail: (r) => `+${(r * 2).toFixed(0)}% tower damage`,
    base: 40,
    per: "+2% damage / lvl",
  },
  defense: {
    label: "Core plating",
    detail: (r) => `+${r} core integrity`,
    base: 50,
    per: "+1 core / lvl",
  },
  cash: {
    label: "Starting scrap",
    detail: (r) => `+${r * 18} scrap at deploy`,
    base: 35,
    per: "+18 scrap / lvl",
  },
  coins: {
    label: "Coin bonus",
    detail: (r) => `+${(r * 5).toFixed(0)}% banked after a run`,
    base: 55,
    per: "+5% coins / lvl",
  },
  range: {
    label: "Range",
    detail: (r) => `+${(r * 1.5).toFixed(1)}% tower range`,
    base: 45,
    per: "+1.5% range / lvl",
  },
  cooldown: {
    label: "Fire rate",
    detail: (r) => `+${(r * 1.5).toFixed(1)}% fire rate`,
    base: 45,
    per: "+1.5% fire / lvl",
  },
  drop: {
    label: "Glyph drop",
    detail: (r) => `+${(r * 4).toFixed(0)}% glyph find`,
    base: 70,
    per: "+4% drop / lvl",
  },
};

export const IN_RUN: Record<
  InRunId,
  {
    label: string;
    detail: string;
    tab: UpgradeTab;
    base: number;
    step: number;
    /** Per-purchase cost multiplier — sized so each line reaches its intended
     *  depth within the cumulative scrap budget of a long run. */
    growth: number;
    /** Hard stack cap — only where the mechanic requires one. Uncapped lines
     *  self-limit through cost growth instead. */
    cap?: number;
    /** If true, this line stacks multiplicatively in refreshMods:
     *  effect = Π(1+step)^n instead of n*step. */
    multiplicative?: boolean;
  }
> = {
  // ── Offense ─────────────────────────────────────────────────────────────
  dmg: {
    label: "Overload",
    detail: "+6% damage (×)",
    tab: "offense",
    base: 22,
    step: 0.06,
    growth: 1.04,
    multiplicative: true,
  },
  rate: {
    label: "Coolant",
    detail: "+5% fire rate (×)",
    tab: "offense",
    base: 24,
    step: 0.05,
    growth: 1.04,
    multiplicative: true,
  },
  rng: {
    label: "Longscan",
    detail: "+4% range (×)",
    tab: "offense",
    base: 20,
    step: 0.04,
    growth: 1.04,
    multiplicative: true,
  },
  critChance: {
    label: "Crit Charge",
    detail: "+0.1% crit chance",
    tab: "offense",
    base: 30,
    step: 0.001,
    growth: 1.008,
    cap: 750,
  },
  critFactor: {
    label: "Crit Force",
    detail: "+0.05 crit multiplier",
    tab: "offense",
    base: 40,
    step: 0.05,
    growth: 1.02,
  },
  multishotChance: {
    label: "Multishot",
    detail: "+0.5% chance to fire again",
    tab: "offense",
    base: 35,
    step: 0.005,
    growth: 1.01,
    cap: 200,
  },
  multishotTargets: {
    label: "Extra Targets",
    detail: "+1 multishot target",
    tab: "offense",
    base: 200,
    step: 1,
    growth: 1.5,
    cap: 4,
  },

  // ── Defense ──────────────────────────────────────────────────────────────
  maxCore: {
    label: "Core Armor",
    detail: "+2 max core HP",
    tab: "defense",
    base: 25,
    step: 2,
    growth: 1.03,
  },
  repair: {
    label: "Patch",
    detail: "+4 core HP (instant)",
    tab: "defense",
    base: 28,
    step: 4,
    growth: 1.16,
  },
  corePerWave: {
    label: "Core Regen",
    detail: "+1 core HP per wave",
    tab: "defense",
    base: 30,
    step: 1,
    growth: 1.05,
  },
  damageReduction: {
    label: "Damage Shield",
    detail: "+0.5% damage blocked",
    tab: "defense",
    base: 50,
    step: 0.005,
    growth: 1.01,
    cap: 160,
  },
  slow: {
    label: "Cryo Field",
    detail: "+0.5% enemy slow",
    tab: "defense",
    base: 45,
    step: 0.005,
    growth: 1.01,
    cap: 100,
  },

  // ── Special ──────────────────────────────────────────────────────────────
  splashAdd: {
    label: "Blast Radius",
    detail: "+0.3 splash tiles",
    tab: "special",
    base: 80,
    step: 0.3,
    growth: 1.08,
  },
  splashConvert: {
    label: "Blast Convert",
    detail: "+1% single→splash chance",
    tab: "special",
    base: 70,
    step: 0.01,
    growth: 1.01,
    cap: 100,
  },
  execute: {
    label: "Reaper",
    detail: "+0.5% execute threshold",
    tab: "special",
    base: 60,
    step: 0.005,
    growth: 1.01,
    cap: 100,
  },
  chain: {
    label: "Chain Arc",
    detail: "+1 chain target",
    tab: "special",
    base: 150,
    step: 1,
    growth: 1.4,
    cap: 6,
  },

  // ── Income ───────────────────────────────────────────────────────────────
  income: {
    label: "Income",
    detail: "+5 scrap each wave",
    tab: "income",
    base: 16,
    step: 5,
    growth: 1.05,
  },
  bounty: {
    label: "Bounty",
    detail: "+3% kill scrap",
    tab: "income",
    base: 18,
    step: 0.03,
    growth: 1.05,
  },
  interest: {
    label: "Interest",
    detail: "+0.5% of held scrap/wave",
    tab: "income",
    base: 60,
    step: 0.005,
    growth: 1.03,
    cap: 50,
  },
  coreOnKill: {
    label: "Core Siphon",
    detail: "+0.5% core-on-kill chance",
    tab: "income",
    base: 40,
    step: 0.005,
    growth: 1.02,
    cap: 100,
  },
  freeUpgrade: {
    label: "Free Upgrade",
    detail: "+0.1% free-buy chance",
    tab: "income",
    base: 35,
    step: 0.001,
    growth: 1.01,
    cap: 500,
  },
};

export function workshopCost(p: PlayerProfile, id: WorkshopId): number {
  const rank = workshopRank(p, id);
  return Math.floor(WORKSHOP[id].base * Math.pow(1.085, rank));
}

export function buyWorkshop(p: PlayerProfile, id: WorkshopId): boolean {
  const cost = workshopCost(p, id);
  if (p.bankScrap < cost) return false;
  p.bankScrap -= cost;
  p.workshop[id] = workshopRank(p, id) + 1;
  return true;
}

export function inRunCost(bought: number, id: InRunId, wave: number): number {
  const spec = IN_RUN[id];
  return Math.floor(spec.base * Math.pow(spec.growth, bought) + wave * 0.6);
}

/** True once a capped in-run line can't be bought again. */
export function inRunAtCap(bought: number, id: InRunId): boolean {
  const cap = IN_RUN[id].cap;
  return cap != null && bought >= cap;
}

/** Effective additive modifier for one in-run line, given purchase count.
 *  Multiplicative lines return (Π(1+step)^n) - 1 so the caller can do
 *  1 + allModifiers for the final multiplier. */
export function inRunEffect(bought: number, id: InRunId): number {
  const spec = IN_RUN[id];
  if (!bought) return 0;
  if (spec.multiplicative) return Math.pow(1 + spec.step, bought) - 1;
  return bought * spec.step;
}
