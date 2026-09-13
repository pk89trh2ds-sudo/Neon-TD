/**
 * "Meta progression" screens reachable from the menu: permanent Skills,
 * the permanent-upgrade Lab, the glyph/chassis Forge, owned Modules, and
 * the lifetime Ops log. Grouped together because they share the same
 * Panel-list-with-buy-button shape and are edited together far more often
 * than alongside the economy/settings screens.
 */
import { useState } from "react";
import { getEngine } from "@/lib/game/engine";
import { CHASSIS, CIPHERS, GLYPH, prefixCipher, recipeHint } from "@/lib/game/ciphers";
import { WORKSHOP, workshopCost } from "@/lib/game/workshop";
import { useGame } from "@/lib/game/store";
import {
  GLYPH_IDS,
  MODULE,
  SKILL,
  SKILL_IDS,
  WORKSHOP_IDS,
  workshopRank,
  type GlyphId,
  type ModuleId,
  type SkillId,
} from "@/lib/game/types";
import { Btn, Panel, Stat } from "../ui";
import { cn } from "@/lib/utils";
import { Back } from "../common";

export function SkillsPane() {
  const p = useGame((s) => s.profile);
  return (
    <div className="flex flex-col gap-4 py-4">
      <Back />
      <h2 className="font-display text-3xl">Skills</h2>
      <p className="text-sm text-muted">Points {p.skillPoints}</p>
      {SKILL_IDS.map((id: SkillId) => {
        const spec = SKILL[id];
        const rank = p.skillRanks[id] ?? 0;
        const cost = spec.cost * (rank + 1);
        return (
          <Panel key={id} className="flex items-center justify-between gap-3">
            <div>
              <div className="font-medium">{spec.label}</div>
              <div className="text-xs text-muted">
                {spec.detail} · {rank}/{spec.max}
              </div>
            </div>
            <Btn
              variant="primary"
              className="min-h-10"
              disabled={rank >= spec.max || p.skillPoints < cost}
              onClick={() => getEngine()?.buySkill(id)}
            >
              {rank >= spec.max ? "Max" : `${cost} pts`}
            </Btn>
          </Panel>
        );
      })}
    </div>
  );
}

export function LabPane() {
  const p = useGame((s) => s.profile);
  return (
    <div className="flex flex-col gap-4 py-4">
      <Back />
      <h2 className="font-display text-3xl">Lab</h2>
      <p className="text-sm text-muted">
        Permanent ranks. Bank coins from every run. Coins {p.bankScrap}
      </p>
      {WORKSHOP_IDS.map((id) => {
        const spec = WORKSHOP[id];
        const rank = workshopRank(p, id);
        const cost = workshopCost(p, id);
        return (
          <Panel key={id} className="flex items-center justify-between gap-3">
            <div>
              <div className="font-medium">{spec.label}</div>
              <div className="text-xs text-muted">
                Lv {rank} · {spec.detail(rank)} · {spec.per}
              </div>
            </div>
            <Btn
              variant="primary"
              className="min-h-10"
              disabled={p.bankScrap < cost}
              onClick={() => getEngine()?.buyWorkshopId(id)}
            >
              {cost}
            </Btn>
          </Panel>
        );
      })}
    </div>
  );
}

export function ForgePane() {
  const p = useGame((s) => s.profile);
  const [pick, setPick] = useState<GlyphId | null>(null);
  const equipped = p.chassis.find((c) => c.id === p.equippedChassisId) ?? p.chassis[0];
  const word = equipped ? prefixCipher(equipped.sockets) : null;
  const complete = equipped
    ? equipped.sockets.every((s) => s) && word && word.have === equipped.sockets.length
    : false;

  return (
    <div className="flex flex-col gap-4 py-4">
      <Back />
      <h2 className="font-display text-3xl">Forge</h2>
      <p className="text-sm text-muted">
        Socket glyphs in order. A complete sequence becomes a Cipher Word and replaces the
        individual bonuses.
      </p>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {p.chassis.map((ch) => (
          <button
            key={ch.id}
            onClick={() => getEngine()?.equipChassis(ch.id)}
            className={cn(
              "min-h-11 shrink-0 rounded-md border px-3 text-xs uppercase tracking-wider",
              ch.id === equipped?.id
                ? "border-cyan bg-cyan/15 text-cyan"
                : "border-line text-muted",
            )}
          >
            {CHASSIS[ch.kind].label}
          </button>
        ))}
      </div>

      {equipped && (
        <Panel className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-[0.2em] text-muted">
              {CHASSIS[equipped.kind].sockets} sockets
            </span>
            {complete && word && (
              <span className="font-display text-lg tracking-widest text-cyan">
                {word.cipher.name}
              </span>
            )}
            {!complete && word && (
              <span className="text-xs text-muted">
                Building {word.cipher.name} {word.have}/{equipped.sockets.length}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {equipped.sockets.map((g, i) => (
              <button
                key={i}
                onClick={() => {
                  if (pick) getEngine()?.socket(equipped.id, i, pick);
                  else if (g) getEngine()?.unsocketSlot(equipped.id, i);
                }}
                className={cn(
                  "grid size-14 place-items-center rounded-md border font-mono text-xs tracking-wider",
                  g ? "border-cyan bg-cyan/10 text-ice" : "border-line text-faint",
                )}
              >
                {g ? GLYPH[g].mark : i + 1}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-faint">
            Tap a glyph, then a socket. Empty socket tap unsockets.
          </p>
        </Panel>
      )}

      <Panel className="space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-muted">Glyph rack</p>
        <div className="grid grid-cols-4 gap-2">
          {GLYPH_IDS.map((id) => {
            const n = p.glyphs[id] ?? 0;
            const spec = GLYPH[id];
            return (
              <button
                key={id}
                disabled={n <= 0}
                onClick={() => setPick(pick === id ? null : id)}
                className={cn(
                  "rounded-md border px-2 py-2 text-left disabled:opacity-30",
                  pick === id ? "border-cyan bg-cyan/15" : "border-line",
                )}
              >
                <div className="font-mono text-xs text-cyan">{spec.mark}</div>
                <div className="text-[11px] text-muted">
                  {spec.label} · {n}
                </div>
              </button>
            );
          })}
        </div>
      </Panel>

      <Panel className="space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-muted">Cipher codex</p>
        {CIPHERS.map((c) => {
          const known = p.discoveredCiphers.includes(c.id);
          return (
            <div key={c.id} className="flex items-start justify-between gap-2 text-sm">
              <div>
                <div className={known ? "text-ice" : "text-muted"}>{known ? c.name : "????"}</div>
                <div className="text-[11px] text-faint">{recipeHint(c, known)}</div>
              </div>
              <div className="text-[11px] text-muted">{c.recipe.length}s</div>
            </div>
          );
        })}
      </Panel>
    </div>
  );
}

export function ModulesPane() {
  const p = useGame((s) => s.profile);
  const pulls = useGame((s) => s.pulls);
  return (
    <div className="flex flex-col gap-4 py-4">
      <Back />
      <h2 className="font-display text-3xl">Modules</h2>
      <p className="text-sm text-muted">
        Pulls {pulls} · Equipped {p.equippedModules.length}/3
      </p>
      <Btn variant="primary" disabled={pulls <= 0} onClick={() => getEngine()?.spendPull()}>
        Spend pull
      </Btn>
      {p.ownedModules.length === 0 && (
        <p className="text-sm text-muted">No modules yet. Clear wave 10 or spend a pull.</p>
      )}
      {p.ownedModules.map((id: ModuleId) => {
        const spec = MODULE[id];
        const on = p.equippedModules.includes(id);
        return (
          <Panel key={id} className="flex items-center justify-between gap-3">
            <div>
              <div className="font-medium">{spec.label}</div>
              <div className="text-xs text-muted">{spec.detail}</div>
            </div>
            <Btn onClick={() => getEngine()?.equip(id)}>{on ? "Unequip" : "Equip"}</Btn>
          </Panel>
        );
      })}
    </div>
  );
}

export function OpsPane() {
  const p = useGame((s) => s.profile);
  return (
    <div className="flex flex-col gap-4 py-4">
      <Back />
      <h2 className="font-display text-3xl">Ops log</h2>
      <Panel>
        <Stat label="Runs" value={p.totalRunsCompleted} />
        <div className="mt-3 text-sm text-muted">
          Kills {p.lifetimeKills} · Achievements {p.achievementsClaimed.length}/12 · Ciphers{" "}
          {p.discoveredCiphers.length}
        </div>
      </Panel>
      <Panel className="space-y-2">
        {p.achievementsClaimed.length === 0 && (
          <p className="text-sm text-muted">No seals yet. Clear waves to stamp the log.</p>
        )}
        {p.achievementsClaimed.map((id) => (
          <div key={id} className="text-sm capitalize text-cyan">
            {id.replace("-", " ")}
          </div>
        ))}
      </Panel>
    </div>
  );
}
