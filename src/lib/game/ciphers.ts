import {
  emptyMods,
  type ChassisInstance,
  type ChassisKind,
  type CipherId,
  type CombatMods,
  type GlyphId,
  type PlayerProfile,
} from "./types";

export const CHASSIS: Record<
  ChassisKind,
  { label: string; sockets: number; detail: string }
> = {
  dual: { label: "Circuit Board", sockets: 2, detail: "Two sockets. Starter frame." },
  tri: { label: "Lattice Frame", sockets: 3, detail: "Three sockets. Mid-run drop." },
  quad: { label: "Prime Chassis", sockets: 4, detail: "Four sockets. High-tier words." },
  hex: { label: "Overclock Array", sockets: 6, detail: "Six sockets. Endgame words." },
};

export const GLYPH: Record<
  GlyphId,
  {
    mark: string;
    label: string;
    tier: 1 | 2 | 3 | 4;
    solo: Partial<CombatMods>;
    weight: number;
    detail: string;
  }
> = {
  spark: { mark: "SP", label: "SPARK", tier: 1, solo: { damage: 0.02 }, weight: 18, detail: "+2% damage" },
  ion: { mark: "IO", label: "ION", tier: 1, solo: { fireRate: 0.02 }, weight: 18, detail: "+2% fire rate" },
  hex: { mark: "HX", label: "HEX", tier: 1, solo: { range: 0.02 }, weight: 16, detail: "+2% range" },
  volt: { mark: "VO", label: "VOLT", tier: 1, solo: { bounty: 0.03 }, weight: 16, detail: "+3% bounty" },
  node: { mark: "ND", label: "NODE", tier: 2, solo: { damage: 0.03 }, weight: 12, detail: "+3% damage" },
  flux: { mark: "FX", label: "FLUX", tier: 2, solo: { range: 0.03 }, weight: 12, detail: "+3% range" },
  coil: { mark: "CL", label: "COIL", tier: 2, solo: { fireRate: 0.03 }, weight: 10, detail: "+3% fire rate" },
  arc: { mark: "AR", label: "ARC", tier: 2, solo: { splashAdd: 0.15 }, weight: 10, detail: "+0.15 splash" },
  surge: { mark: "SG", label: "SURGE", tier: 3, solo: { damage: 0.04 }, weight: 7, detail: "+4% damage" },
  kernel: { mark: "KR", label: "KERNEL", tier: 3, solo: { corePerWave: 0.4 }, weight: 7, detail: "+0.4 core / wave" },
  nulls: { mark: "NL", label: "NULL", tier: 3, solo: { execute: 0.02 }, weight: 6, detail: "Execute 2%" },
  apex: { mark: "AX", label: "APEX", tier: 3, solo: { fireRate: 0.04 }, weight: 6, detail: "+4% fire rate" },
  prism: { mark: "PR", label: "PRISM", tier: 4, solo: { splashConvert: 0.05 }, weight: 3, detail: "5% splash convert" },
  voids: { mark: "VD", label: "VOID", tier: 4, solo: { execute: 0.03 }, weight: 3, detail: "Execute 3%" },
  sigma: { mark: "SM", label: "SIGMA", tier: 4, solo: { bounty: 0.08 }, weight: 2, detail: "+8% bounty" },
  zenith: { mark: "ZN", label: "ZENITH", tier: 4, solo: { damage: 0.06 }, weight: 2, detail: "+6% damage" },
};

export type CipherDef = {
  id: CipherId;
  name: string;
  recipe: GlyphId[];
  detail: string;
  mods: Partial<CombatMods>;
};

export const CIPHERS: CipherDef[] = [
  {
    id: "ignite",
    name: "IGNITE",
    recipe: ["spark", "ion"],
    detail: "+18% damage",
    mods: { damage: 0.18 },
  },
  {
    id: "static",
    name: "STATIC",
    recipe: ["hex", "volt"],
    detail: "+20% fire rate",
    mods: { fireRate: 0.2 },
  },
  {
    id: "drift",
    name: "DRIFT",
    recipe: ["node", "flux"],
    detail: "+16% range",
    mods: { range: 0.16 },
  },
  {
    id: "lash",
    name: "LASH",
    recipe: ["coil", "arc"],
    detail: "Splash +0.7",
    mods: { splashAdd: 0.7 },
  },
  {
    id: "insight",
    name: "INSIGHT",
    recipe: ["spark", "ion", "hex"],
    detail: "+30% bounty",
    mods: { bounty: 0.3 },
  },
  {
    id: "haste",
    name: "HASTE",
    recipe: ["volt", "node", "flux"],
    detail: "+22% fire rate, +10% range",
    mods: { fireRate: 0.22, range: 0.1 },
  },
  {
    id: "bulwark",
    name: "BULWARK",
    recipe: ["coil", "arc", "surge"],
    detail: "+12% damage, +1 core / wave",
    mods: { damage: 0.12, corePerWave: 1 },
  },
  {
    id: "reaper",
    name: "REAPER",
    recipe: ["kernel", "nulls", "apex"],
    detail: "Execute enemies below 12% HP",
    mods: { execute: 0.12 },
  },
  {
    id: "spirit",
    name: "SPIRIT",
    recipe: ["ion", "hex", "volt", "node"],
    detail: "+20% fire, +15% range, +12% damage",
    mods: { fireRate: 0.2, range: 0.15, damage: 0.12 },
  },
  {
    id: "fortitude",
    name: "FORTITUDE",
    recipe: ["flux", "coil", "arc", "surge"],
    detail: "+35% damage, +1.5 core / wave",
    mods: { damage: 0.35, corePerWave: 1.5 },
  },
  {
    id: "enigma",
    name: "ENIGMA",
    recipe: ["kernel", "nulls", "apex", "prism"],
    detail: "18% of hits splash, +15% range",
    mods: { splashConvert: 0.18, range: 0.15 },
  },
  {
    id: "infinity",
    name: "INFINITY",
    recipe: ["voids", "sigma", "spark", "ion"],
    detail: "Splash +1.2, +18% damage",
    mods: { splashAdd: 1.2, damage: 0.18 },
  },
  {
    id: "grief",
    name: "GRIEF",
    recipe: ["spark", "ion", "hex", "volt", "node", "flux"],
    detail: "+45% damage, execute 8%",
    mods: { damage: 0.45, execute: 0.08 },
  },
  {
    id: "lastWish",
    name: "LAST WISH",
    recipe: ["coil", "arc", "surge", "kernel", "nulls", "apex"],
    detail: "+22% all combat, +2 core / wave",
    mods: { damage: 0.22, range: 0.22, fireRate: 0.22, corePerWave: 2 },
  },
  {
    id: "phoenix",
    name: "PHOENIX",
    recipe: ["prism", "voids", "sigma", "zenith", "apex", "nulls"],
    detail: "18% kill heals core, +35% bounty",
    mods: { coreOnKill: 0.18, bounty: 0.35 },
  },
];

export function matchCipher(sockets: Array<GlyphId | null>): CipherDef | null {
  if (sockets.some((s) => s == null)) return null;
  const seq = sockets as GlyphId[];
  return (
    CIPHERS.find(
      (c) => c.recipe.length === seq.length && c.recipe.every((g, i) => g === seq[i]),
    ) ?? null
  );
}

export function equippedChassis(p: PlayerProfile): ChassisInstance | null {
  if (!p.equippedChassisId) return p.chassis[0] ?? null;
  return p.chassis.find((c) => c.id === p.equippedChassisId) ?? p.chassis[0] ?? null;
}

export function addPartial(a: CombatMods, b: Partial<CombatMods>): CombatMods {
  return {
    damage: a.damage + (b.damage ?? 0),
    range: a.range + (b.range ?? 0),
    fireRate: a.fireRate + (b.fireRate ?? 0),
    bounty: a.bounty + (b.bounty ?? 0),
    splashAdd: a.splashAdd + (b.splashAdd ?? 0),
    splashConvert: a.splashConvert + (b.splashConvert ?? 0),
    execute: a.execute + (b.execute ?? 0),
    coreOnKill: a.coreOnKill + (b.coreOnKill ?? 0),
    corePerWave: a.corePerWave + (b.corePerWave ?? 0),
    critChance: a.critChance + (b.critChance ?? 0),
    critMult: a.critMult + (b.critMult ?? 0),
    corePct: a.corePct + (b.corePct ?? 0),
    coreFlat: a.coreFlat + (b.coreFlat ?? 0),
  };
}

export function chassisMods(ch: ChassisInstance | null): { mods: CombatMods; cipher: CipherDef | null } {
  const mods = emptyMods();
  if (!ch) return { mods, cipher: null };
  const word = matchCipher(ch.sockets);
  if (word) return { mods: addPartial(mods, word.mods), cipher: word };
  for (const g of ch.sockets) {
    if (g) addInto(mods, GLYPH[g].solo);
  }
  return { mods, cipher: null };
}

function addInto(a: CombatMods, b: Partial<CombatMods>) {
  a.damage += b.damage ?? 0;
  a.range += b.range ?? 0;
  a.fireRate += b.fireRate ?? 0;
  a.bounty += b.bounty ?? 0;
  a.splashAdd += b.splashAdd ?? 0;
  a.splashConvert += b.splashConvert ?? 0;
  a.execute += b.execute ?? 0;
  a.coreOnKill += b.coreOnKill ?? 0;
  a.corePerWave += b.corePerWave ?? 0;
  a.critChance += b.critChance ?? 0;
  a.critMult += b.critMult ?? 0;
  a.corePct += b.corePct ?? 0;
  a.coreFlat += b.coreFlat ?? 0;
}

export function loadoutMods(
  p: PlayerProfile,
  run: { damage: number; range: number; fireRate: number; bounty: number },
): { mods: CombatMods; cipher: CipherDef | null } {
  let mods = emptyMods();
  mods.damage += run.damage;
  mods.range += run.range;
  mods.fireRate += run.fireRate;
  mods.bounty += run.bounty;
  const equipped = new Set(p.equippedModules);
  if (equipped.has("focusingLens")) mods.damage += 0.12;
  if (equipped.has("coolantLoop")) mods.fireRate += 0.12;
  if (equipped.has("rippleCapacitor")) {
    mods.range += 0.08;
    mods.splashAdd += 1;
  }
  const { mods: cm, cipher } = chassisMods(equippedChassis(p));
  mods = addPartial(mods, cm);
  return { mods, cipher };
}

export function glyphCount(p: PlayerProfile, id: GlyphId): number {
  return p.glyphs[id] ?? 0;
}

export function addGlyph(p: PlayerProfile, id: GlyphId, n = 1) {
  p.glyphs[id] = (p.glyphs[id] ?? 0) + n;
}

export function spendGlyph(p: PlayerProfile, id: GlyphId): boolean {
  const n = p.glyphs[id] ?? 0;
  if (n <= 0) return false;
  p.glyphs[id] = n - 1;
  return true;
}

export function socketGlyph(p: PlayerProfile, chassisId: string, slot: number, glyph: GlyphId): boolean {
  const ch = p.chassis.find((c) => c.id === chassisId);
  if (!ch || slot < 0 || slot >= ch.sockets.length) return false;
  if (!spendGlyph(p, glyph)) return false;
  const prev = ch.sockets[slot];
  if (prev) addGlyph(p, prev);
  ch.sockets[slot] = glyph;
  maybeDiscover(p, ch);
  return true;
}

export function unsocket(p: PlayerProfile, chassisId: string, slot: number): boolean {
  const ch = p.chassis.find((c) => c.id === chassisId);
  if (!ch || slot < 0 || slot >= ch.sockets.length) return false;
  const g = ch.sockets[slot];
  if (!g) return false;
  ch.sockets[slot] = null;
  addGlyph(p, g);
  return true;
}

function maybeDiscover(p: PlayerProfile, ch: ChassisInstance) {
  const word = matchCipher(ch.sockets);
  if (word && !p.discoveredCiphers.includes(word.id)) p.discoveredCiphers.push(word.id);
}

export function recipeHint(c: CipherDef, discovered: boolean): string {
  if (discovered) return c.recipe.map((g) => GLYPH[g].label).join(" + ");
  return `${c.recipe.length}-socket · starts ${GLYPH[c.recipe[0]!].label}`;
}

export function prefixCipher(sockets: Array<GlyphId | null>): { cipher: CipherDef; have: number } | null {
  let best: { cipher: CipherDef; have: number } | null = null;
  for (const c of CIPHERS) {
    if (c.recipe.length !== sockets.length) continue;
    let n = 0;
    for (let i = 0; i < sockets.length; i++) {
      const g = sockets[i];
      if (!g) break;
      if (g !== c.recipe[i]) {
        n = 0;
        break;
      }
      n++;
    }
    if (n > 0 && (!best || n > best.have)) best = { cipher: c, have: n };
  }
  return best;
}

export function pickGlyph(wave: number, rng: () => number): GlyphId {
  const maxTier = wave >= 80 ? 4 : wave >= 40 ? 3 : wave >= 18 ? 2 : 1;
  const pool = (Object.keys(GLYPH) as GlyphId[]).filter((id) => GLYPH[id].tier <= maxTier);
  let total = 0;
  for (const id of pool) total += GLYPH[id].weight;
  let roll = rng() * total;
  for (const id of pool) {
    roll -= GLYPH[id].weight;
    if (roll <= 0) return id;
  }
  return pool[0]!;
}

export function pickChassis(wave: number, rng: () => number): ChassisKind | null {
  if (wave === 10) return "dual";
  if (wave === 25) return "tri";
  if (wave === 50) return "quad";
  if (wave === 100) return "hex";
  if (wave > 0 && wave % 10 === 0) {
    const r = rng();
    if (wave >= 80 && r < 0.12) return "hex";
    if (wave >= 40 && r < 0.18) return "quad";
    if (wave >= 20 && r < 0.28) return "tri";
    if (r < 0.2) return "dual";
  }
  return null;
}
