// Extension included so `node --experimental-strip-types` can resolve this
// directly for tests — see the matching note in sim.ts.
import { type ArsenalId, type PlayerProfile } from "./types.ts";

/** One-time unlock cost in Arsenal Tokens (rare, boss-drop currency). */
const UNLOCK_COSTS: Record<ArsenalId, number> = {
  sentryDrone: 3,
  empPulse: 5,
  repairDrone: 4,
  elementalDrone: 8,
};

/** Leveling curve: polyCost(level, base, k, p) — Core Shards, same shape as
 *  lower-tier workshop lines. Cap at 500 levels. */
const LEVEL_CURVE: Record<ArsenalId, { base: number; k: number; p: number; cap: number }> = {
  sentryDrone:    { base: 3, k: 1, p: 1.3, cap: 500 },
  empPulse:       { base: 3, k: 1, p: 1.3, cap: 500 },
  repairDrone:    { base: 3, k: 1, p: 1.3, cap: 500 },
  elementalDrone: { base: 3, k: 1, p: 1.3, cap: 500 },
};

export const ARSENAL_IDS: ArsenalId[] = [
  "sentryDrone",
  "empPulse",
  "repairDrone",
  "elementalDrone",
];

export const ARSENAL_LABEL: Record<ArsenalId, string> = {
  sentryDrone:    "Sentry Drone",
  empPulse:       "EMP Pulse",
  repairDrone:    "Repair Drone",
  elementalDrone: "Elemental Drone",
};

export const ARSENAL_DETAIL: Record<ArsenalId, string> = {
  sentryDrone:    "Independent DPS drone orbiting the core tile.",
  empPulse:       "Periodic burst damaging every enemy on the field.",
  repairDrone:    "Periodic core integrity restoration.",
  elementalDrone: "Orbiting drone that slows enemies it hits.",
};

export function arsenalUnlocked(p: PlayerProfile, id: ArsenalId): boolean {
  return (p.arsenal[id] ?? 0) > 0;
}

export function arsenalLevel(p: PlayerProfile, id: ArsenalId): number {
  const raw = p.arsenal[id] ?? 0;
  return arsenalUnlocked(p, id) ? Math.max(0, raw - 1) : 0;
}

export function arsenalUnlockCost(id: ArsenalId): number {
  return UNLOCK_COSTS[id];
}

export function arsenalAtCap(p: PlayerProfile, id: ArsenalId): boolean {
  return arsenalLevel(p, id) >= LEVEL_CURVE[id].cap;
}

export function arsenalLevelCost(p: PlayerProfile, id: ArsenalId): number {
  const lv = arsenalLevel(p, id);
  const c = LEVEL_CURVE[id];
  return Math.floor(c.base * Math.pow(lv + c.k, c.p));
}

/** Buy or level an Arsenal entry.
 *  - If locked: spends Arsenal Tokens at unlockCost, sets level to 0 (unlocked but lv 0).
 *  - If unlocked: spends Core Shards at level cost to gain one level.
 *  Returns true on success. */
export function buyArsenal(p: PlayerProfile, id: ArsenalId): boolean {
  if (!arsenalUnlocked(p, id)) {
    const cost = arsenalUnlockCost(id);
    if (p.arsenalTokens < cost) return false;
    p.arsenalTokens -= cost;
    p.arsenal[id] = 1; // 1 = unlocked at level 0 (raw - 1 = 0)
    return true;
  }
  if (arsenalAtCap(p, id)) return false;
  const cost = arsenalLevelCost(p, id);
  if (p.coreShards < cost) return false;
  p.coreShards -= cost;
  p.arsenal[id] = (p.arsenal[id] ?? 1) + 1;
  return true;
}

// ── Combat tick helpers (called from engine.ts per-tick) ──────────────────

/** Sentry drone DPS per second, scaled by level. */
export function sentryDroneDps(level: number): number {
  return level <= 0 ? 0 : 2 + level * 0.3;
}

/** EMP pulse cooldown (seconds), shrinks with level. */
export function empPulseCooldown(level: number): number {
  return level <= 0 ? Infinity : Math.max(2, 20 - level * 0.035);
}

/** EMP pulse damage per enemy hit. */
export function empPulseDamage(level: number): number {
  return level <= 0 ? 0 : 5 + level * 1.0;
}

/** Repair drone heal interval (seconds). */
export function repairDroneCooldown(level: number): number {
  return level <= 0 ? Infinity : Math.max(3, 30 - level * 0.054);
}

/** Repair drone core heal amount per trigger. */
export function repairDroneHeal(level: number): number {
  return level <= 0 ? 0 : 1 + Math.floor(level * 0.02);
}

/** Elemental drone DPS. */
export function elementalDroneDps(level: number): number {
  return level <= 0 ? 0 : 1.5 + level * 0.25;
}

/** Slow duration applied by elemental drone hits (seconds). */
export function elementalDroneSlow(level: number): number {
  return level <= 0 ? 0 : Math.min(3, 0.5 + level * 0.005);
}

/** Slow speed multiplier while slowed (fraction of base speed). */
export const ELEMENTAL_SLOW_FACTOR = 0.5;
