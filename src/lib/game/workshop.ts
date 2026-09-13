// Extension included so `node --experimental-strip-types` can resolve this
// directly for balance.test.ts — see the matching note in sim.ts.
import { workshopRank, type InRunId, type PlayerProfile, type WorkshopId } from "./types.ts";

export const IN_RUN_IDS: InRunId[] = ["dmg", "rng", "rate", "bounty", "income", "repair"];

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
    base: number;
    step: number;
    /** Per-purchase cost multiplier. Economy lines (income/bounty) use a
     *  steeper curve than combat lines so they can't fund an unlimited
     *  compounding bankroll the way a flat 1.16 let them — see docs/balance.md. */
    growth: number;
    /** Hard stack cap. Only income/bounty have one — combat lines stay
     *  uncapped but self-limit through cost growth instead. */
    cap?: number;
  }
> = {
  dmg: { label: "Overload", detail: "+6% damage this run", base: 22, step: 0.06, growth: 1.16 },
  rng: { label: "Longscan", detail: "+5% range this run", base: 20, step: 0.05, growth: 1.16 },
  rate: { label: "Coolant", detail: "+6% fire rate this run", base: 24, step: 0.06, growth: 1.16 },
  bounty: {
    label: "Bounty",
    detail: "+3% kill scrap this run",
    base: 18,
    step: 0.03,
    growth: 1.32,
    cap: 10,
  },
  income: {
    label: "Income",
    detail: "+5 scrap each wave",
    base: 16,
    step: 5,
    growth: 1.32,
    cap: 12,
  },
  repair: { label: "Patch", detail: "+4 core integrity", base: 28, step: 4, growth: 1.16 },
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
  return Math.floor(IN_RUN[id].base * Math.pow(IN_RUN[id].growth, bought) + wave * 0.6);
}

/** True once a capped in-run line (income/bounty) can't be bought again. */
export function inRunAtCap(bought: number, id: InRunId): boolean {
  const cap = IN_RUN[id].cap;
  return cap != null && bought >= cap;
}
