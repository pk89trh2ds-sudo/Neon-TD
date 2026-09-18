import {
  MODULE_IDS,
  PASS_TRACK,
  SAVE_KEY,
  SAVE_KEY_LEGACY,
  RUN_KEY,
  SCHEMA,
  SKILL,
  defaultProfile,
  dayStamp,
  emptyChassis,
  passLevel,
  type AchievementId,
  type ChassisKind,
  type DailyMission,
  type GlyphId,
  type ModuleId,
  type PlayerProfile,
  type Reward,
  type RunSnapshot,
  type ShopItem,
  type SkillId,
} from "./types";
import { SplitMix64, hashStr } from "./sim";
import { addGlyph } from "./ciphers";
import { buyWorkshop } from "./workshop";
import type { WorkshopId } from "./types";

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// --- Save-integrity guard -------------------------------------------------
// Saves are plain exportable/importable JSON (see exportProfileJson below),
// which is a legitimate backup feature but also means anyone can hand-edit
// the file to forge currency, ranks, or pulls. This isn't cryptographic
// security (there's no secret a client-side game can actually keep), just a
// tamper *detector*: a keyed hash over the economically meaningful fields,
// checked on load/import. A mismatch flags the profile rather than
// rejecting it, so a legitimate player is never locked out of their own
// save — the flag is what excludes a profile from analytics and, later,
// from leaderboards or anything IAP-adjacent.
const INTEGRITY_SALT = "neontd-v3-guard";

function integritySummary(p: PlayerProfile): string {
  return [
    p.bankScrap,
    p.inventoryPulls,
    p.pendingRareUpgrades,
    p.skillPoints,
    p.prestigeLevel,
    p.highestWaveReached,
    p.loginStreak,
    p.totalRunsCompleted,
    p.lifetimeKills,
    JSON.stringify(p.skillRanks ?? {}),
    JSON.stringify(p.workshop ?? {}),
    JSON.stringify(p.glyphs ?? {}),
    (p.chassis ?? []).length,
    (p.discoveredCiphers ?? []).length,
    (p.ownedModules ?? []).length,
    p.battlePassXP,
    JSON.stringify(p.battlePassClaimed ?? []),
    JSON.stringify(p.achievementsClaimed ?? []),
  ].join("|");
}

function computeChecksum(p: PlayerProfile): string {
  return hashStr(INTEGRITY_SALT + integritySummary(p)).toString(36);
}

type Persisted = PlayerProfile & { checksum?: string };

function verifyChecksum(data: Persisted): boolean {
  if (!data.checksum) return false; // legacy save predating this guard — not tamper, just unverifiable
  return data.checksum === computeChecksum(data);
}

export function loadProfile(): PlayerProfile {
  if (typeof localStorage === "undefined") return defaultProfile();
  try {
    const data =
      safeParse<Persisted>(localStorage.getItem(SAVE_KEY)) ??
      safeParse<Persisted>(localStorage.getItem(SAVE_KEY_LEGACY));
    const base = defaultProfile();
    if (!data) return base;
    // devUnlockAll is OR'd in permanently (not just checked live) so dev-mode
    // testing can never leak into analytics or the daily leaderboard even
    // after the toggle is switched back off — same exclusion path as a
    // hand-edited save, see track() in engine.ts and settleRun's leaderboard
    // gate.
    const tamperFlag = (!!data.checksum && !verifyChecksum(data)) || !!data.devUnlockAll;
    const merged: PlayerProfile = {
      ...base,
      ...data,
      version: 3,
      workshop: { ...base.workshop, ...(data.workshop ?? {}) },
      glyphs: { ...base.glyphs, ...(data.glyphs ?? {}) },
      chassis: Array.isArray(data.chassis) && data.chassis.length ? data.chassis : base.chassis,
      discoveredCiphers: data.discoveredCiphers ?? [],
      skillRanks: { ...base.skillRanks, ...(data.skillRanks ?? {}) },
      ownedModules: data.ownedModules ?? [],
      equippedModules: data.equippedModules ?? [],
      missions: data.missions ?? [],
      battlePassClaimed: data.battlePassClaimed ?? [],
      achievementsClaimed: data.achievementsClaimed ?? [],
      dailyShopBought: data.dailyShopBought ?? [],
      highestByDifficulty: { ...base.highestByDifficulty, ...(data.highestByDifficulty ?? {}) },
      isEndlessUnlocked: true,
      tamperFlag,
    };
    if (!merged.equippedChassisId && merged.chassis[0]) {
      merged.equippedChassisId = merged.chassis[0].id;
    }
    return merged;
  } catch {
    return defaultProfile();
  }
}

export function saveProfile(p: PlayerProfile) {
  if (typeof localStorage === "undefined") return;
  try {
    const withChecksum: Persisted = { ...p, checksum: computeChecksum(p) };
    const prev = localStorage.getItem(SAVE_KEY);
    if (prev) localStorage.setItem(SAVE_KEY + ".bak", prev);
    localStorage.setItem(SAVE_KEY, JSON.stringify(withChecksum));
  } catch {
    /* quota / private mode */
  }
}

export function exportProfileJson(p: PlayerProfile): string {
  const withChecksum: Persisted = { ...p, checksum: computeChecksum(p) };
  return JSON.stringify({ ...withChecksum, exportedAt: Date.now() }, null, 2);
}

export function importProfileJson(raw: string): PlayerProfile | null {
  const data = safeParse<Persisted>(raw);
  if (!data || typeof data !== "object") return null;
  const base = defaultProfile();
  const tamperFlag = (!!data.checksum && !verifyChecksum(data)) || !!data.devUnlockAll;
  return {
    ...base,
    ...data,
    version: 3,
    workshop: { ...base.workshop, ...(data.workshop ?? {}) },
    glyphs: { ...base.glyphs, ...(data.glyphs ?? {}) },
    chassis: Array.isArray(data.chassis) ? data.chassis : base.chassis,
    discoveredCiphers: data.discoveredCiphers ?? [],
    highestByDifficulty: { ...base.highestByDifficulty, ...(data.highestByDifficulty ?? {}) },
    tamperFlag,
  };
}

export function loadRun(): RunSnapshot | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const data = safeParse<RunSnapshot>(localStorage.getItem(RUN_KEY));
    if (!data || data.schemaVersion !== SCHEMA) return null;
    if (data.phase === "menu" || data.phase === "gameOver") return null;
    return data;
  } catch {
    return null;
  }
}

export function saveRun(snap: RunSnapshot) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(RUN_KEY, JSON.stringify(snap));
  } catch {
    /* ignore */
  }
}

export function clearRun() {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(RUN_KEY);
  } catch {
    /* ignore */
  }
}

export function grantReward(p: PlayerProfile, r: Reward, runScrap?: { v: number }) {
  switch (r.type) {
    case "currency":
      if (runScrap) runScrap.v += r.amount;
      else p.bankScrap += r.amount;
      break;
    case "gachaPull":
      p.inventoryPulls += 1;
      break;
    case "rareUpgrade":
      p.pendingRareUpgrades += 1;
      break;
    case "battlePassXP":
      p.battlePassXP += r.amount;
      break;
    case "skillPoints":
      p.skillPoints += r.amount;
      break;
    case "glyph":
      addGlyph(p, r.id);
      break;
    case "chassis":
      grantChassis(p, r.kind);
      break;
  }
}

export function grantChassis(p: PlayerProfile, kind: ChassisKind) {
  p.chassis.push(emptyChassis(kind));
}

export function dailyMissions(): DailyMission[] {
  return [
    {
      id: "kill-30",
      description: "Eliminate 30 hostiles",
      target: 30,
      progress: 0,
      reward: { type: "currency", amount: 80 },
      claimed: false,
      adBoosted: false,
    },
    {
      id: "clear-3",
      description: "Clear 3 waves",
      target: 3,
      progress: 0,
      reward: { type: "battlePassXP", amount: 40 },
      claimed: false,
      adBoosted: false,
    },
    {
      id: "place-4",
      description: "Deploy 4 modules",
      target: 4,
      progress: 0,
      reward: { type: "gachaPull" },
      claimed: false,
      adBoosted: false,
    },
  ];
}

export function refreshMissions(p: PlayerProfile) {
  const today = dayStamp();
  if (p.lastMissionResetDay === today && p.missions.length) return;
  p.lastMissionResetDay = today;
  p.missions = dailyMissions();
}

export function progressMission(p: PlayerProfile, prefix: string, by: number) {
  for (const m of p.missions) {
    if (m.description.startsWith(prefix)) {
      m.progress = Math.min(m.target, m.progress + by);
    }
  }
}

export function claimMission(p: PlayerProfile, id: string): Reward | null {
  const m = p.missions.find((x) => x.id === id);
  if (!m || m.claimed || m.progress < m.target) return null;
  m.claimed = true;
  grantReward(p, m.reward);
  return m.reward;
}

/** Rewarded-ad bonus: doubles an already-claimed mission's reward, once. */
export function claimMissionAdBonus(p: PlayerProfile, id: string): Reward | null {
  const m = p.missions.find((x) => x.id === id);
  if (!m || !m.claimed || m.adBoosted) return null;
  m.adBoosted = true;
  grantReward(p, m.reward);
  return m.reward;
}

export function unlockSkill(p: PlayerProfile, id: SkillId): boolean {
  const spec = SKILL[id];
  const current = Math.min(spec.max, p.skillRanks[id] ?? 0);
  if (current >= spec.max) return false;
  const cost = spec.cost * (current + 1);
  if (p.skillPoints < cost) return false;
  p.skillPoints -= cost;
  p.skillRanks[id] = current + 1;
  return true;
}

export function addModule(p: PlayerProfile, id: ModuleId): boolean {
  if (p.ownedModules.includes(id)) return false;
  p.ownedModules.push(id);
  return true;
}

export function toggleEquip(p: PlayerProfile, id: ModuleId): boolean {
  if (!p.ownedModules.includes(id)) return false;
  const idx = p.equippedModules.indexOf(id);
  if (idx >= 0) {
    p.equippedModules.splice(idx, 1);
    return true;
  }
  if (p.equippedModules.length >= 3) return false;
  p.equippedModules.push(id);
  return true;
}

export function rollModule(p: PlayerProfile): { item: ModuleId | null; scrap: number } {
  const missing = MODULE_IDS.filter((id) => !p.ownedModules.includes(id));
  if (missing.length === 0) {
    p.bankScrap += 50;
    return { item: null, scrap: 50 };
  }
  const item = missing[Math.floor(Math.random() * missing.length)]!;
  addModule(p, item);
  return { item, scrap: 0 };
}

export function consumePull(p: PlayerProfile): boolean {
  if (p.inventoryPulls <= 0) return false;
  p.inventoryPulls -= 1;
  return true;
}

export function consumeRare(p: PlayerProfile): boolean {
  if (p.pendingRareUpgrades <= 0) return false;
  p.pendingRareUpgrades -= 1;
  return true;
}

export function claimPass(p: PlayerProfile, level: number): Reward | null {
  const track = PASS_TRACK.find((t) => t.level === level);
  if (!track) return null;
  if (passLevel(p.battlePassXP) < level) return null;
  if (p.battlePassClaimed.includes(level)) return null;
  p.battlePassClaimed.push(level);
  grantReward(p, track.reward);
  return track.reward;
}

export function prestige(p: PlayerProfile): boolean {
  if (p.highestWaveReached < 50) return false;
  p.prestigeLevel += 1;
  p.skillPoints += 5;
  p.bankScrap += 200;
  return true;
}

export type LoginResult = {
  profile: PlayerProfile;
  comeback: boolean;
  streakUp: boolean;
  crateReady: boolean;
};

export function applyLogin(p: PlayerProfile): LoginResult {
  const today = dayStamp();
  refreshMissions(p);
  if (p.dailyShopDay !== today) {
    p.dailyShopDay = today;
    p.dailyShopBought = [];
  }
  let comeback = false;
  let streakUp = false;
  if (p.lastLoginDay !== today) {
    const yesterday = dayStamp(Date.now() - 86400000);
    if (p.lastLoginDay === yesterday) p.loginStreak = Math.min(30, (p.loginStreak || 0) + 1);
    else p.loginStreak = 1;
    streakUp = true;
    p.lastLoginDay = today;
    p.bankScrap += 10 + p.loginStreak * 4;
    if (p.loginStreak % 7 === 0) p.inventoryPulls += 1;
    if (p.lastSeenAt && Date.now() - p.lastSeenAt > 36 * 3600 * 1000) {
      comeback = true;
      p.bankScrap += 60;
      p.inventoryPulls += 1;
    }
  }
  p.lastSeenAt = Date.now();
  if (!p.equippedChassisId && p.chassis[0]) p.equippedChassisId = p.chassis[0].id;
  const crateReady = p.dailyCrateDay !== today;
  return { profile: p, comeback, streakUp, crateReady };
}

export function claimDailyCrate(p: PlayerProfile): Reward | null {
  const today = dayStamp();
  if (p.dailyCrateDay === today) return null;
  p.dailyCrateDay = today;
  const reward: Reward =
    p.loginStreak >= 7
      ? { type: "gachaPull" }
      : { type: "currency", amount: 25 + p.loginStreak * 5 };
  grantReward(p, reward);
  if (p.loginStreak >= 3) {
    const glyphs: GlyphId[] = ["spark", "ion", "hex", "volt"];
    addGlyph(p, glyphs[p.loginStreak % glyphs.length]!);
  }
  return reward;
}

/** Rewarded-ad bonus: grants a second copy of today's crate reward, once. */
export function claimDailyCrateAdBonus(p: PlayerProfile): Reward | null {
  const today = dayStamp();
  if (p.dailyCrateDay !== today) return null; // must claim the base crate first
  if (p.dailyCrateAdBonusDay === today) return null;
  p.dailyCrateAdBonusDay = today;
  const reward: Reward =
    p.loginStreak >= 7
      ? { type: "gachaPull" }
      : { type: "currency", amount: 25 + p.loginStreak * 5 };
  grantReward(p, reward);
  return reward;
}

/** Rewarded-ad bonus: a flat battle-pass XP top-up, once per day. */
export function claimPassAdBonus(p: PlayerProfile): number | null {
  const today = dayStamp();
  if (p.dailyPassAdBonusDay === today) return null;
  p.dailyPassAdBonusDay = today;
  const amount = 40;
  p.battlePassXP += amount;
  return amount;
}

export function shopForDay(day: string): ShopItem[] {
  const rng = new SplitMix64(hashStr(day + ":shop"));
  const catalog: ShopItem[] = [
    {
      id: "pull",
      title: "Module crate",
      detail: "One gacha pull toward a missing chip",
      cost: 100,
      kind: "pull",
    },
    {
      id: "skill",
      title: "Protocol dump",
      detail: "+2 skill points",
      cost: 180,
      kind: "skill",
    },
    {
      id: "rare",
      title: "Rare overclock",
      detail: "Token for the next Upgrades offer",
      cost: 220,
      kind: "rare",
    },
    {
      id: "patch",
      title: "Core patch",
      detail: "Next run starts with +8 core",
      cost: 70,
      kind: "patch",
    },
    {
      id: "chip",
      title: "Damage chip",
      detail: "Next run starts with +8% damage",
      cost: 150,
      kind: "chip",
    },
    {
      id: "glyph",
      title: "Loose glyph",
      detail: "A random tier-1 glyph for the forge",
      cost: 90,
      kind: "glyph",
    },
  ];
  const pool = [...catalog];
  const out: ShopItem[] = [];
  for (let i = 0; i < 3 && pool.length; i++) {
    const idx = rng.next() % pool.length;
    out.push(pool.splice(idx, 1)[0]!);
  }
  return out;
}

function applyShopEffect(p: PlayerProfile, item: ShopItem) {
  switch (item.kind) {
    case "pull":
      p.inventoryPulls += 1;
      break;
    case "skill":
      p.skillPoints += 2;
      break;
    case "rare":
      p.pendingRareUpgrades += 1;
      break;
    case "patch":
      p.nextRunCoreBonus += 8;
      break;
    case "chip":
      p.nextRunDamageBonus += 0.08;
      break;
    case "glyph": {
      const t1: GlyphId[] = ["spark", "ion", "hex", "volt"];
      addGlyph(p, t1[Math.floor(Math.random() * t1.length)]!);
      break;
    }
  }
}

export function buyShop(p: PlayerProfile, item: ShopItem): boolean {
  if (p.dailyShopBought.includes(item.id)) return false;
  if (p.bankScrap < item.cost) return false;
  p.bankScrap -= item.cost;
  p.dailyShopBought.push(item.id);
  applyShopEffect(p, item);
  return true;
}

/** Rewarded-ad bonus: grants today's first shop item for free, once. */
export function claimShopAdBonus(p: PlayerProfile): ShopItem | null {
  const today = dayStamp();
  if (p.dailyShopAdBonusDay === today) return null;
  const item = shopForDay(today)[0];
  if (!item) return null;
  p.dailyShopAdBonusDay = today;
  applyShopEffect(p, item);
  return item;
}

export function buyPermanent(p: PlayerProfile, id: WorkshopId): boolean {
  return buyWorkshop(p, id);
}

type AchDef = {
  id: AchievementId;
  title: string;
  detail: string;
  test: (p: PlayerProfile) => boolean;
  reward: Reward;
};

const ACHIEVEMENTS: AchDef[] = [
  {
    id: "first-clear",
    title: "Handshake",
    detail: "Clear wave 1",
    test: (p) => p.highestWaveReached >= 1,
    reward: { type: "currency", amount: 30 },
  },
  {
    id: "wave-10",
    title: "Circuit steady",
    detail: "Reach wave 10",
    test: (p) => p.highestWaveReached >= 10,
    reward: { type: "gachaPull" },
  },
  {
    id: "wave-25",
    title: "Deep grid",
    detail: "Reach wave 25",
    test: (p) => p.highestWaveReached >= 25,
    reward: { type: "currency", amount: 150 },
  },
  {
    id: "wave-50",
    title: "Endless protocol",
    detail: "Reach wave 50",
    test: (p) => p.highestWaveReached >= 50,
    reward: { type: "rareUpgrade" },
  },
  {
    id: "wave-100",
    title: "Century circuit",
    detail: "Reach wave 100",
    test: (p) => p.highestWaveReached >= 100,
    reward: { type: "chassis", kind: "hex" },
  },
  {
    id: "prestige",
    title: "Reboot authority",
    detail: "Prestige once",
    test: (p) => p.prestigeLevel >= 1,
    reward: { type: "skillPoints", amount: 3 },
  },
  {
    id: "collector",
    title: "Full rack",
    detail: "Own every module",
    test: (p) => p.ownedModules.length >= 4,
    reward: { type: "currency", amount: 200 },
  },
  {
    id: "streak-7",
    title: "Seven-cycle",
    detail: "7-day login streak",
    test: (p) => p.loginStreak >= 7,
    reward: { type: "gachaPull" },
  },
  {
    id: "specialist",
    title: "Max protocol",
    detail: "Max any skill",
    test: (p) => Object.values(p.skillRanks).some((r) => (r ?? 0) >= 5),
    reward: { type: "skillPoints", amount: 2 },
  },
  {
    id: "century",
    title: "Century cull",
    detail: "100 lifetime kills",
    test: (p) => p.lifetimeKills >= 100,
    reward: { type: "currency", amount: 80 },
  },
  {
    id: "cipher",
    title: "Word spoken",
    detail: "Complete a cipher word",
    test: (p) => p.discoveredCiphers.length >= 1,
    reward: { type: "currency", amount: 120 },
  },
  {
    id: "insane-20",
    title: "Insane hold",
    detail: "Reach wave 20 on Insane",
    test: (p) => (p.highestByDifficulty.insane ?? 0) >= 20,
    reward: { type: "gachaPull" },
  },
];

export function checkAchievements(p: PlayerProfile): AchDef[] {
  const unlocked: AchDef[] = [];
  for (const a of ACHIEVEMENTS) {
    if (p.achievementsClaimed.includes(a.id)) continue;
    if (!a.test(p)) continue;
    p.achievementsClaimed.push(a.id);
    grantReward(p, a.reward);
    unlocked.push(a);
  }
  return unlocked;
}

export { ACHIEVEMENTS };
