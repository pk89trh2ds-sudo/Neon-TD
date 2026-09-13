import { ENEMY, type CombatMods, type GridCoord, type TowerKind } from "./types";
import {
  effectiveRange,
  keyOf,
  positionAlong,
  type Battlefield,
  type CombatSimulation,
} from "./sim";

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
};
type Floater = { x: number; y: number; text: string; life: number; color: string };

const TOWER_COLOR: Record<TowerKind, string> = {
  pulse: "#3ee8ff",
  beam: "#7ec8ff",
  nova: "#d7f7ff",
  tesla: "#9dffef",
};
const ENEMY_COLOR = {
  bit: "#3ee8ff",
  virus: "#5dffb0",
  tank: "#ff8a4c",
  boss: "#ff4d6d",
};

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(img);
    img.src = src;
  });
}

export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  images: Record<string, HTMLImageElement> = {};
  floorPat: CanvasPattern | null = null;
  pathPat: CanvasPattern | null = null;
  particles: Particle[] = [];
  floaters: Floater[] = [];
  time = 0;
  shakeX = 0;
  shakeY = 0;
  trauma = 0;
  flash = 0;
  hover: GridCoord | null = null;
  reduced = false;
  cell = 48;
  ox = 0;
  oy = 0;
  ready = false;
  private pool: Particle[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas 2D unavailable");
    this.ctx = ctx;
  }

  async load() {
    const names = ["pulse", "beam", "nova", "tesla", "bit", "virus", "tank", "boss", "core", "pad"];
    await Promise.all(
      names.map(async (n) => {
        this.images[n] = await load(`/sprites/${n}.png`);
      }),
    );
    const floor = await load("/textures/floor.jpg");
    const path = await load("/textures/path.jpg");
    if (floor.width) this.floorPat = this.ctx.createPattern(floor, "repeat");
    if (path.width) this.pathPat = this.ctx.createPattern(path, "repeat");
    this.ready = true;
  }

  resize() {
    const parent = this.canvas.parentElement;
    const w = parent?.clientWidth ?? 800;
    const h = parent?.clientHeight ?? 480;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  layout(map: Battlefield) {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const cell = Math.floor(Math.min(w / map.columns, h / map.rows) * 0.94);
    this.cell = Math.max(28, cell);
    this.ox = (w - map.columns * this.cell) / 2;
    this.oy = (h - map.rows * this.cell) / 2;
  }

  screenToCell(sx: number, sy: number, map: Battlefield): GridCoord | null {
    const x = Math.floor((sx - this.ox) / this.cell);
    const y = Math.floor((sy - this.oy) / this.cell);
    if (x < 0 || y < 0 || x >= map.columns || y >= map.rows) return null;
    return { x, y };
  }

  addTrauma(v: number) {
    if (this.reduced) return;
    this.trauma = Math.min(1, this.trauma + v);
  }

  burst(x: number, y: number, color: string, n = 10, speed = 40) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random());
      const p = this.pool.pop() ?? ({} as Particle);
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * s;
      p.vy = Math.sin(a) * s;
      p.life = p.max = 0.35 + Math.random() * 0.35;
      p.size = 1.4 + Math.random() * 2.2;
      p.color = color;
      this.particles.push(p);
    }
  }

  float(x: number, y: number, text: string, color: string) {
    this.floaters.push({ x, y, text, life: 0.7, color });
  }

  draw(
    sim: CombatSimulation,
    dt: number,
    opts: {
      selected: GridCoord | null;
      hoverKind: TowerKind;
      paused: boolean;
      canPlace: boolean;
      mods: CombatMods;
    },
  ) {
    this.time += dt;
    this.layout(sim.map);
    const ctx = this.ctx;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.trauma = Math.max(0, this.trauma - dt * 1.8);
    const shake = this.trauma * this.trauma;
    this.shakeX = this.reduced ? 0 : (Math.random() * 2 - 1) * shake * 10;
    this.shakeY = this.reduced ? 0 : (Math.random() * 2 - 1) * shake * 10;
    this.flash = Math.max(0, this.flash - dt * 3);

    ctx.fillStyle = "#07090e";
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.translate(this.ox + this.shakeX, this.oy + this.shakeY);

    this.drawBoard(sim, opts);
    this.drawTowers(sim, opts);
    this.drawEnemies(sim);
    this.drawProjectiles(sim);
    this.drawCore(sim);
    this.updateFx(dt);

    ctx.restore();

    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,77,109,${this.flash * 0.18})`;
      ctx.fillRect(0, 0, w, h);
    }
    const g = ctx.createRadialGradient(w / 2, h / 2, w * 0.2, w / 2, h / 2, w * 0.72);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.42)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  private drawBoard(
    sim: CombatSimulation,
    opts: { selected: GridCoord | null; hoverKind: TowerKind; canPlace: boolean; mods: CombatMods },
  ) {
    const ctx = this.ctx;
    const { columns, rows } = sim.map;
    const cell = this.cell;
    ctx.fillStyle = "#0b0e14";
    ctx.fillRect(-2, -2, columns * cell + 4, rows * cell + 4);

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < columns; x++) {
        const k = `${x},${y}`;
        const px = x * cell;
        const py = y * cell;
        if (sim.map.pathSet.has(k)) {
          if (this.pathPat) {
            ctx.save();
            ctx.translate(px, py);
            ctx.fillStyle = this.pathPat;
            ctx.globalAlpha = 0.9;
            ctx.fillRect(0, 0, cell, cell);
            ctx.restore();
          } else {
            ctx.fillStyle = "#10222a";
            ctx.fillRect(px + 1, py + 1, cell - 2, cell - 2);
          }
        } else {
          if (this.floorPat) {
            ctx.save();
            ctx.translate(px, py);
            ctx.fillStyle = this.floorPat;
            ctx.globalAlpha = 0.7;
            ctx.fillRect(0, 0, cell, cell);
            ctx.restore();
          } else {
            ctx.fillStyle = (x + y) % 2 === 0 ? "#10141b" : "#0d1118";
            ctx.fillRect(px + 1, py + 1, cell - 2, cell - 2);
          }
        }
      }
    }

    // energy along path
    ctx.save();
    ctx.strokeStyle = "rgba(62,232,255,0.55)";
    ctx.lineWidth = Math.max(2, cell * 0.12);
    ctx.shadowColor = "#3ee8ff";
    ctx.shadowBlur = 12;
    ctx.lineJoin = "round";
    ctx.beginPath();
    sim.map.path.forEach((c, i) => {
      const px = c.x * cell + cell / 2;
      const py = c.y * cell + cell / 2;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
    ctx.restore();

    const dash = ((this.time * 40) % 80) / 80;
    ctx.save();
    ctx.strokeStyle = "rgba(232,251,255,0.7)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 12]);
    ctx.lineDashOffset = -dash * 40;
    ctx.beginPath();
    sim.map.path.forEach((c, i) => {
      const px = c.x * cell + cell / 2;
      const py = c.y * cell + cell / 2;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
    ctx.restore();

    if (this.hover) {
      const hx = this.hover.x * cell;
      const hy = this.hover.y * cell;
      const buildable = sim.map.buildable.has(keyOf(this.hover));
      const occupied = !!sim.towerAt(this.hover);
      ctx.fillStyle = occupied
        ? "rgba(62,232,255,0.12)"
        : buildable
          ? "rgba(62,232,255,0.16)"
          : "rgba(255,77,109,0.12)";
      ctx.fillRect(hx, hy, cell, cell);
      if (buildable && !occupied) {
        this.rangeRing(
          this.hover.x,
          this.hover.y,
          effectiveRange(opts.hoverKind, opts.mods),
          TOWER_COLOR[opts.hoverKind],
        );
      }
    }
    if (opts.selected) {
      const t = sim.towerAt(opts.selected);
      if (t) {
        this.rangeRing(
          t.coord.x,
          t.coord.y,
          effectiveRange(t.kind, opts.mods),
          TOWER_COLOR[t.kind],
        );
        ctx.strokeStyle = "rgba(62,232,255,0.9)";
        ctx.lineWidth = 2;
        ctx.strokeRect(t.coord.x * cell + 2, t.coord.y * cell + 2, cell - 4, cell - 4);
      }
    }
  }

  private rangeRing(cx: number, cy: number, range: number, color: string) {
    const ctx = this.ctx;
    const cell = this.cell;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx * cell + cell / 2, cy * cell + cell / 2, range * cell, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  private drawTowers(sim: CombatSimulation, _opts: { selected: GridCoord | null }) {
    const ctx = this.ctx;
    const cell = this.cell;
    for (const t of sim.towers) {
      const cx = t.coord.x * cell + cell / 2;
      const cy = t.coord.y * cell + cell / 2;
      const img = this.images[t.kind];
      const pad = this.images.pad;
      if (pad?.width) {
        const s = cell * 0.92;
        ctx.drawImage(pad, cx - s / 2, cy - s / 2, s, s);
      }
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(t.facing);
      const size = cell * (0.78 + t.rank * 0.04);
      if (img?.width) {
        ctx.drawImage(img, -size / 2, -size / 2, size, size);
      } else {
        ctx.fillStyle = TOWER_COLOR[t.kind];
        ctx.beginPath();
        ctx.arc(0, 0, size * 0.28, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      if (t.rank > 1) {
        ctx.fillStyle = "#e8eef4";
        ctx.font = `600 ${Math.max(9, cell * 0.22)}px "IBM Plex Mono", monospace`;
        ctx.textAlign = "right";
        ctx.fillText(String(t.rank), t.coord.x * cell + cell - 4, t.coord.y * cell + 12);
      }
    }
  }

  private drawEnemies(sim: CombatSimulation) {
    const ctx = this.ctx;
    const cell = this.cell;
    for (const e of sim.enemies) {
      const p = positionAlong(sim.map, e.pathIndex);
      const x = p.x * cell + cell / 2;
      const y = p.y * cell + cell / 2 + Math.sin(this.time * 4 + e.id) * 1.2;
      const img = this.images[e.kind];
      const scale = e.kind === "boss" ? 0.92 : e.kind === "tank" ? 0.78 : 0.62;
      const size = cell * scale;
      ctx.save();
      if (e.hitFlash > 0) ctx.globalCompositeOperation = "lighter";
      if (img?.width) ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
      else {
        ctx.fillStyle = ENEMY_COLOR[e.kind];
        ctx.beginPath();
        ctx.arc(x, y, size * 0.28, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      const pct = Math.max(0, e.health / e.maxHealth);
      const bw = cell * 0.46;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(x - bw / 2, y - size / 2 - 6, bw, 3);
      ctx.fillStyle = pct < 0.3 ? "#ff4d6d" : "#5dffb0";
      ctx.fillRect(x - bw / 2, y - size / 2 - 6, bw * pct, 3);
    }
  }

  private drawProjectiles(sim: CombatSimulation) {
    const ctx = this.ctx;
    const cell = this.cell;
    for (const shot of sim.projectiles) {
      const target = sim.enemies.find((e) => e.id === shot.targetId);
      if (!target) continue;
      const to = positionAlong(sim.map, target.pathIndex);
      const t = Math.min(Math.max(shot.travel, 0), 1);
      const x = (shot.ox + (to.x - shot.ox) * t) * cell + cell / 2;
      const y = (shot.oy + (to.y - shot.oy) * t) * cell + cell / 2;
      const color = TOWER_COLOR[shot.kind];
      if (shot.kind === "beam") {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.7;
        ctx.lineWidth = 2;
        ctx.shadowColor = color;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.moveTo(shot.ox * cell + cell / 2, shot.oy * cell + cell / 2);
        ctx.lineTo(to.x * cell + cell / 2, to.y * cell + cell / 2);
        ctx.stroke();
        ctx.restore();
      } else if (shot.kind === "tesla") {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.85;
        ctx.lineWidth = 1.4;
        ctx.shadowColor = color;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        const x0 = shot.ox * cell + cell / 2;
        const y0 = shot.oy * cell + cell / 2;
        const x1 = to.x * cell + cell / 2;
        const y1 = to.y * cell + cell / 2;
        ctx.moveTo(x0, y0);
        const segs = 6;
        for (let i = 1; i <= segs; i++) {
          const u = i / segs;
          const jx = (Math.random() - 0.5) * 10 * (1 - Math.abs(u - 0.5) * 2);
          const jy = (Math.random() - 0.5) * 10 * (1 - Math.abs(u - 0.5) * 2);
          ctx.lineTo(x0 + (x1 - x0) * u + jx, y0 + (y1 - y0) * u + jy);
        }
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.save();
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(x, y, shot.kind === "nova" ? 4.5 : 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  private drawCore(sim: CombatSimulation) {
    const last = sim.map.path[sim.map.path.length - 1];
    if (!last) return;
    const cell = this.cell;
    const x = last.x * cell + cell / 2;
    const y = last.y * cell + cell / 2;
    const img = this.images.core;
    const size = cell * 1.15;
    const pulse = 1 + Math.sin(this.time * 3) * 0.04;
    if (img?.width)
      this.ctx.drawImage(
        img,
        x - (size * pulse) / 2,
        y - (size * pulse) / 2,
        size * pulse,
        size * pulse,
      );
    else {
      this.ctx.fillStyle = "#3ee8ff";
      this.ctx.beginPath();
      this.ctx.arc(x, y, cell * 0.32, 0, Math.PI * 2);
      this.ctx.fill();
    }
  }

  private updateFx(dt: number) {
    const ctx = this.ctx;
    const cell = this.cell;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 18 * dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        this.pool.push(p);
        continue;
      }
      ctx.globalAlpha = p.life / p.max;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x * cell + cell / 2, p.y * cell + cell / 2, p.size, p.size);
      ctx.globalAlpha = 1;
    }
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i]!;
      f.life -= dt;
      f.y -= dt * 0.6;
      if (f.life <= 0) {
        this.floaters.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = Math.min(1, f.life * 2);
      ctx.fillStyle = f.color;
      ctx.font = `600 ${Math.max(10, cell * 0.26)}px "IBM Plex Mono", monospace`;
      ctx.textAlign = "center";
      ctx.fillText(f.text, f.x * cell + cell / 2, f.y * cell + cell / 2);
      ctx.globalAlpha = 1;
    }
  }
}
