// Extension included (unlike this file's other relative imports) so
// `node --experimental-strip-types` can resolve it directly for
// balance.test.ts — Vite/tsc's "bundler" resolution accepts either form.
import {
  COLS,
  DIFFICULTY_MOD,
  ENEMY,
  MAX_RANK,
  ROWS,
  TOWER,
  emptyMods,
  enemyHealth,
  killBounty,
  type CombatMods,
  type DifficultyTier,
  type EnemyKind,
  type EnemyState,
  type GridCoord,
  type ProjectileState,
  type SimEvent,
  type TowerKind,
  type TowerState,
  type UpgradeEffect,
  type UpgradeOffer,
} from "./types.ts";

export class SplitMix64 {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0 || 0x9e3779b9;
  }
  next(): number {
    this.state = (this.state + 0x9e3779b9) >>> 0;
    let z = this.state;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  }
  nextFloat(): number {
    return this.next() / 0x100000000;
  }
  pick<T>(arr: T[]): T {
    return arr[this.next() % arr.length]!;
  }
}

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export type Battlefield = {
  columns: number;
  rows: number;
  path: GridCoord[];
  buildable: Set<string>;
  pathSet: Set<string>;
};

export function keyOf(c: GridCoord): string {
  return `${c.x},${c.y}`;
}

export function makePath(columns = COLS, rows = ROWS): GridCoord[] {
  const coords: GridCoord[] = [];
  let y = 1;
  let goingRight = true;
  let x = 0;
  coords.push({ x: 0, y });
  while (y < rows - 1) {
    if (goingRight) {
      x += 1;
      if (x >= columns - 1) {
        x = columns - 1;
        y += 2;
        goingRight = false;
      }
    } else {
      x -= 1;
      if (x <= 0) {
        x = 0;
        y += 2;
        goingRight = true;
      }
    }
    if (y >= rows) break;
    coords.push({ x, y: Math.min(y, rows - 2) });
  }
  const last = coords[coords.length - 1];
  if (last && last.x !== columns - 1) {
    let lx = last.x;
    const ly = last.y;
    while (lx < columns - 1) {
      lx += 1;
      coords.push({ x: lx, y: ly });
    }
  }
  return coords;
}

export function makeBattlefield(columns = COLS, rows = ROWS): Battlefield {
  const path = makePath(columns, rows);
  const pathSet = new Set(path.map(keyOf));
  const buildable = new Set<string>();
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      const k = `${x},${y}`;
      if (!pathSet.has(k)) buildable.add(k);
    }
  }
  return { columns, rows, path, buildable, pathSet };
}

export function positionAlong(map: Battlefield, pathIndex: number): { x: number; y: number } {
  const path = map.path;
  if (path.length < 2) return { x: 0, y: 0 };
  const maxIndex = path.length - 1;
  const clamped = Math.min(Math.max(pathIndex, 0), maxIndex);
  const i0 = Math.floor(clamped);
  const i1 = Math.min(i0 + 1, maxIndex);
  const t = clamped - i0;
  const a = path[i0]!;
  const b = path[i1]!;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * A tower's actual firing range this run — base range scaled by the
 * aggregate range bonus (Lab ranks, in-run Upgrades, skills, glyphs, all
 * folded into `mods.range` by loadoutMods), plus nova/tesla's extra reach
 * from `splashAdd`. Exported so the renderer's range-ring indicator uses
 * the exact same number the sim fires with — previously it drew the tower's
 * static base range from the TOWER table, so a bought range upgrade changed
 * nothing on screen even though it was working under the hood.
 */
export function effectiveRange(kind: TowerKind, mods: CombatMods): number {
  let range = TOWER[kind].range * (1 + mods.range);
  if ((kind === "nova" || kind === "tesla") && mods.splashAdd > 0) {
    range += Math.min(1.4, mods.splashAdd);
  }
  return range;
}

export function waveComposition(wave: number): Array<[EnemyKind, number]> {
  // Caps raised so enemy volume keeps climbing well past the old wave-37
  // ceiling — from wave 37 on, every wave used to be the identical 66
  // enemies forever.
  const bits = Math.min(46, Math.round(6 + wave * 1.1));
  const viruses = Math.min(34, Math.max(0, Math.round((wave - 2) * 0.9)));
  const tanks = Math.min(26, Math.max(0, Math.round((wave - 5) / 1.8)));
  if (wave > 0 && wave % 10 === 0) {
    // The full regular wave rides along as a distraction stream — bosses
    // used to REPLACE bits/reduce tank+virus counts, which (combined with
    // only a mild HP multiplier) made boss waves 38-76% as tough as the
    // wave right before them for most of the game. Bosses now stack ON TOP
    // of an ordinary wave, so a boss wave's total HP is guaranteed to
    // exceed the wave before it — see the bossHealthMultiplier comment in
    // types.ts and balance.test.ts's invariant check. Boss count grows
    // every 30 waves instead of every 50.
    return (
      [
        ["boss", 1 + Math.floor((wave - 10) / 30)],
        ["bit", bits],
        ["virus", viruses],
        ["tank", tanks],
      ] as Array<[EnemyKind, number]>
    ).filter(([, n]) => n > 0);
  }
  return (
    [
      ["bit", bits],
      ["virus", viruses],
      ["tank", tanks],
    ] as Array<[EnemyKind, number]>
  ).filter(([, n]) => n > 0);
}

export type CombatTickResult = {
  kills: EnemyKind[];
  scrap: number;
  coreDamage: number;
  coreHeal: number;
  events: SimEvent[];
};

export class CombatSimulation {
  map: Battlefield;
  enemies: EnemyState[] = [];
  towers: TowerState[] = [];
  projectiles: ProjectileState[] = [];
  spawnQueue: EnemyKind[] = [];
  spawnCooldown = 0;
  runDamageBonus = 0;
  runRangeBonus = 0;
  runFireRateBonus = 0;
  runBountyBonus = 0;
  private mods: CombatMods = emptyMods();
  private nextEnemyId = 1;
  private nextTowerId = 1;
  private nextProjectileId = 1;
  private nextOfferId = 1;

  constructor(map: Battlefield = makeBattlefield()) {
    this.map = map;
  }

  resetCombatants() {
    this.enemies = [];
    this.projectiles = [];
    this.spawnQueue = [];
    this.spawnCooldown = 0;
  }

  resetRun() {
    this.resetCombatants();
    this.towers = [];
    this.runDamageBonus = 0;
    this.runRangeBonus = 0;
    this.runFireRateBonus = 0;
    this.runBountyBonus = 0;
    this.nextEnemyId = 1;
    this.nextTowerId = 1;
    this.nextProjectileId = 1;
  }

  restoreTowers(
    towers: Array<{ kind: TowerKind; coord: GridCoord; rank: number; invested: number }>,
  ) {
    this.towers = towers.map((t, i) => ({
      id: i + 1,
      kind: t.kind,
      coord: t.coord,
      cooldown: 0,
      rank: t.rank,
      facing: 0,
      invested: t.invested,
    }));
    this.nextTowerId = this.towers.length + 1;
  }

  canPlace(coord: GridCoord): boolean {
    const k = keyOf(coord);
    return this.map.buildable.has(k) && !this.towers.some((t) => keyOf(t.coord) === k);
  }

  placeTower(kind: TowerKind, coord: GridCoord): boolean {
    if (!this.canPlace(coord)) return false;
    this.towers.push({
      id: this.nextTowerId++,
      kind,
      coord: { ...coord },
      cooldown: 0,
      rank: 1,
      facing: 0,
      invested: TOWER[kind].cost,
    });
    return true;
  }

  towerAt(coord: GridCoord): TowerState | undefined {
    const k = keyOf(coord);
    return this.towers.find((t) => keyOf(t.coord) === k);
  }

  // 2x the original multiplier — a fully-ranked pulse tower cost only 440
  // scrap total (less than one wave's kill income from ~wave 30 on), which
  // made every tower effectively free and permanently maxed by wave 15.
  private static rankCost(kind: TowerKind, rank: number): number {
    return TOWER[kind].cost * rank * 2;
  }

  rankUpCost(coord: GridCoord): number | null {
    const t = this.towerAt(coord);
    if (!t || t.rank >= MAX_RANK) return null;
    return CombatSimulation.rankCost(t.kind, t.rank);
  }

  rankUp(coord: GridCoord): boolean {
    const t = this.towerAt(coord);
    if (!t || t.rank >= MAX_RANK) return false;
    const cost = CombatSimulation.rankCost(t.kind, t.rank);
    t.rank += 1;
    t.invested += cost;
    return true;
  }

  sellRefund(coord: GridCoord): number | null {
    const t = this.towerAt(coord);
    if (!t) return null;
    return Math.max(1, Math.floor(t.invested / 2));
  }

  sell(coord: GridCoord): number | null {
    const refund = this.sellRefund(coord);
    if (refund == null) return null;
    const k = keyOf(coord);
    this.towers = this.towers.filter((t) => keyOf(t.coord) !== k);
    return refund;
  }

  queueWave(comp: Array<[EnemyKind, number]>) {
    this.spawnQueue = [];
    for (const [kind, count] of comp) {
      for (let i = 0; i < count; i++) this.spawnQueue.push(kind);
    }
    this.spawnCooldown = 0.15;
  }

  pendingSpawns(): number {
    return this.spawnQueue.length;
  }

  waveCleared(): boolean {
    return this.spawnQueue.length === 0 && this.enemies.length === 0;
  }

  tick(
    dt: number,
    wave: number,
    tier: DifficultyTier,
    mods: CombatMods,
    preferHighest: boolean,
    rng: () => number,
  ): CombatTickResult {
    this.mods = mods;
    const result: CombatTickResult = {
      kills: [],
      scrap: 0,
      coreDamage: 0,
      coreHeal: 0,
      events: [],
    };
    this.spawnCooldown -= dt;
    while (this.spawnCooldown <= 0 && this.spawnQueue.length) {
      const kind = this.spawnQueue.shift()!;
      this.spawn(kind, wave, tier);
      result.events.push({ t: "spawn", kind });
      this.spawnCooldown += Math.max(0.12, 0.42 - wave * 0.002);
    }

    const dmgMult = 1 + mods.damage;
    const fireMult = 1 + mods.fireRate;
    const bounty = mods.bounty;
    const splashR = 1.6 + mods.splashAdd;

    for (const tower of this.towers) {
      tower.cooldown -= dt;
      if (tower.cooldown > 0) continue;
      const spec = TOWER[tower.kind];
      const range = effectiveRange(tower.kind, mods);
      const target = this.selectTarget(tower.coord, range, preferHighest);
      if (!target) continue;
      const pos = positionAlong(this.map, target.pathIndex);
      tower.facing = Math.atan2(pos.y - tower.coord.y, pos.x - tower.coord.x);
      tower.cooldown = Math.max(0.08, spec.fire / fireMult);
      const dmg = spec.damage * tower.rank * dmgMult;
      const splash =
        tower.kind === "nova" ||
        tower.kind === "tesla" ||
        (mods.splashConvert > 0 && rng() < mods.splashConvert);
      this.fire(tower, target.id, dmg, splash);
      result.events.push({
        t: "fire",
        kind: tower.kind,
        x: tower.coord.x,
        y: tower.coord.y,
        tx: pos.x,
        ty: pos.y,
      });
    }

    const speed = (kind: TowerKind) => (kind === "beam" ? 14 : kind === "pulse" ? 9 : 7);
    for (const shot of this.projectiles) {
      shot.travel += dt * speed(shot.kind);
    }
    for (const shot of this.projectiles) {
      if (shot.travel < 1) continue;
      this.applyHit(shot, wave, tier, bounty, splashR, result, rng);
      shot.travel = 99;
    }
    this.projectiles = this.projectiles.filter((p) => p.travel < 1);

    const spd = DIFFICULTY_MOD[tier].speed;
    // Enemies pick up pace as waves climb (+0.4%/wave, capped +60% at wave
    // 150) — previously flat forever, so a wave-250 bit crossed the map at
    // the exact same speed as a wave-1 one.
    const waveSpeedMult = 1 + Math.min(0.6, wave * 0.004);
    const leak = DIFFICULTY_MOD[tier].leak;
    for (const enemy of this.enemies) {
      if (enemy.hitFlash > 0) enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
      enemy.pathIndex += ENEMY[enemy.kind].speed * spd * waveSpeedMult * dt;
      if (enemy.pathIndex >= this.map.path.length - 1) {
        enemy.alive = false;
        // Ceil instead of round: at leak=1.2/1.4 a round() silently discards
        // the difficulty modifier for the two most common enemy kinds
        // (round(1.2)=1, round(1.4)=1), so nightmare/insane's leak penalty
        // did nothing for most leaks.
        const dmg = Math.max(1, Math.ceil(ENEMY[enemy.kind].core * leak));
        result.coreDamage += dmg;
        result.events.push({ t: "leak", kind: enemy.kind, dmg });
      }
    }
    this.enemies = this.enemies.filter((e) => e.alive);
    return result;
  }

  makeOffers(wave: number, rng: SplitMix64): UpgradeOffer[] {
    const catalog: Array<[string, string, number, UpgradeEffect]> = [
      ["Overload", "+12% tower damage this run", 50, { type: "damage", v: 0.12 }],
      ["Longscan", "+10% tower range this run", 45, { type: "range", v: 0.1 }],
      ["Coolant", "+15% fire rate this run", 55, { type: "fireRate", v: 0.15 }],
      ["Patch Core", "+5 core integrity", 40, { type: "core", v: 5 }],
      ["Scrap Drop", "+40 scrap", 0, { type: "scrap", v: 40 }],
    ];
    const pool = [...catalog];
    const offers: UpgradeOffer[] = [];
    for (let i = 0; i < 3 && pool.length; i++) {
      const idx = rng.next() % pool.length;
      const item = pool.splice(idx, 1)[0]!;
      offers.push({
        id: this.nextOfferId++,
        title: item[0],
        detail: item[1],
        cost: item[2] + wave,
        apply: item[3],
      });
    }
    return offers;
  }

  injectRareOffer(wave: number): UpgradeOffer {
    return {
      id: 9000 + wave,
      title: "Rare Overclock",
      detail: "+20% damage, +10% range, +10% fire rate",
      cost: 0,
      apply: { type: "rare" },
    };
  }

  apply(effect: UpgradeEffect, coreHP: { v: number }, scrapGrant: (n: number) => void) {
    switch (effect.type) {
      case "damage":
        this.runDamageBonus += effect.v;
        break;
      case "range":
        this.runRangeBonus += effect.v;
        break;
      case "fireRate":
        this.runFireRateBonus += effect.v;
        break;
      case "core":
        coreHP.v += effect.v;
        break;
      case "scrap":
        scrapGrant(effect.v);
        break;
      case "rare":
        this.runDamageBonus += 0.2;
        this.runRangeBonus += 0.1;
        this.runFireRateBonus += 0.1;
        break;
    }
  }

  private spawn(kind: EnemyKind, wave: number, tier: DifficultyTier) {
    const hp = enemyHealth(kind, wave, tier);
    this.enemies.push({
      id: this.nextEnemyId++,
      kind,
      health: hp,
      maxHealth: hp,
      pathIndex: 0,
      alive: true,
      hitFlash: 0,
    });
  }

  private selectTarget(
    coord: GridCoord,
    range: number,
    preferHighestHP: boolean,
  ): EnemyState | null {
    const range2 = range * range;
    let best: EnemyState | null = null;
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      const pos = positionAlong(this.map, enemy.pathIndex);
      const dx = pos.x - coord.x;
      const dy = pos.y - coord.y;
      if (dx * dx + dy * dy > range2) continue;
      if (!best) best = enemy;
      else if (preferHighestHP) {
        if (enemy.health > best.health) best = enemy;
      } else if (enemy.pathIndex > best.pathIndex) best = enemy;
    }
    return best;
  }

  private fire(tower: TowerState, targetId: number, damage: number, splash: boolean) {
    this.projectiles.push({
      id: this.nextProjectileId++,
      ox: tower.coord.x,
      oy: tower.coord.y,
      targetId,
      damage,
      kind: tower.kind,
      travel: 0,
      splash,
    });
  }

  /** Secondary splash targets beyond this many (closest first) take no
   *  damage — previously uncapped, so a tightly packed wave (enemies spawn
   *  as little as 0.12s apart, see spawnCooldown above) let nova/tesla hit
   *  every enemy on screen at full splash percentage every shot. */
  private static readonly MAX_SPLASH_TARGETS = 6;

  private applyHit(
    shot: ProjectileState,
    wave: number,
    tier: DifficultyTier,
    bounty: number,
    splashR: number,
    result: CombatTickResult,
    rng: () => number,
  ) {
    const idx = this.enemies.findIndex((e) => e.id === shot.targetId && e.alive);
    if (idx < 0) return;
    this.damageEnemy(idx, shot.damage, wave, tier, bounty, result, shot.kind, rng);
    if (!shot.splash) return;
    const source = this.enemies[idx];
    if (!source) return;
    const center = positionAlong(this.map, source.pathIndex);
    // Distance-weighted falloff (100% at the primary target's feet down to
    // 20% at the edge of splashR) plus a target cap — previously flat 45%
    // to everyone in radius, with no cap, which is what let splash towers
    // out-DPS their listed single-target numbers by 8-17x against a packed
    // wave.
    const candidates: Array<{ index: number; dist: number }> = [];
    for (let j = 0; j < this.enemies.length; j++) {
      const e = this.enemies[j]!;
      if (!e.alive || e.id === shot.targetId) continue;
      const p = positionAlong(this.map, e.pathIndex);
      const dx = p.x - center.x;
      const dy = p.y - center.y;
      const distSq = dx * dx + dy * dy;
      if (distSq <= splashR * splashR) candidates.push({ index: j, dist: Math.sqrt(distSq) });
    }
    candidates.sort((a, b) => a.dist - b.dist);
    for (const c of candidates.slice(0, CombatSimulation.MAX_SPLASH_TARGETS)) {
      const falloff = 1 - 0.8 * Math.min(1, c.dist / splashR);
      this.damageEnemy(
        c.index,
        shot.damage * 0.45 * falloff,
        wave,
        tier,
        bounty,
        result,
        shot.kind,
        rng,
      );
    }
  }

  private damageEnemy(
    index: number,
    amount: number,
    wave: number,
    tier: DifficultyTier,
    bounty: number,
    result: CombatTickResult,
    kind: TowerKind,
    rng: () => number,
  ) {
    const e = this.enemies[index]!;
    if (!e.alive) return;
    e.health -= amount;
    e.hitFlash = 0.08;
    const pos = positionAlong(this.map, e.pathIndex);
    result.events.push({ t: "hit", x: pos.x, y: pos.y, dmg: amount, kind });
    if (this.mods.execute > 0 && e.health > 0 && e.health / e.maxHealth <= this.mods.execute) {
      e.health = 0;
      result.events.push({ t: "execute", x: pos.x, y: pos.y });
    }
    if (e.health <= 0) {
      e.alive = false;
      result.kills.push(e.kind);
      result.scrap += killBounty(e.kind, wave, tier, bounty);
      result.events.push({ t: "kill", x: pos.x, y: pos.y, kind: e.kind });
      if (this.mods.coreOnKill > 0 && rng() < this.mods.coreOnKill) {
        result.coreHeal += 1;
      }
    }
  }
}
