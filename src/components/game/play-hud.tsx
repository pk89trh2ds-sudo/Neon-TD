/**
 * The in-run HUD: top status bar, boss health bar, the "Upgrades" drawer
 * (rolled offers + stackable buys), tower-placement bar, pause overlay
 * (incl. the dev-mode wave-skip control), game-over recap, and the toast
 * stack. This is the most actively edited file during live-play bugfixing
 * — kept separate from the menu screens for that reason.
 */
import { useEffect, useState } from "react";
import { ArrowUpCircle, FastForward, Pause, Play, Shield, X, Zap } from "lucide-react";
import { getEngine } from "@/lib/game/engine";
import { useGame } from "@/lib/game/store";
import { IN_RUN, IN_RUN_IDS, inRunAtCap, inRunCost } from "@/lib/game/workshop";
import { DIFFICULTY_MOD, TOWER, TOWER_KINDS, type TowerKind } from "@/lib/game/types";
import { Btn, Bar, Panel } from "./ui";
import { cn } from "@/lib/utils";
import { CenterCard } from "./common";

export function PlayHud() {
  const phase = useGame((s) => s.phase);
  const wave = useGame((s) => s.wave);
  const scrap = useGame((s) => s.scrap);
  const core = useGame((s) => s.coreHP);
  const maxCore = useGame((s) => s.maxCore);
  const paused = useGame((s) => s.paused);
  const speed = useGame((s) => s.speed);
  const selected = useGame((s) => s.selectedTower);
  const inspect = useGame((s) => s.inspectText);
  const selectedCoord = useGame((s) => s.selectedCoord);
  const log = useGame((s) => s.eventLog);
  const pending = useGame((s) => s.pendingSpawns);
  const alive = useGame((s) => s.enemiesAlive);
  const tutorial = useGame((s) => s.tutorialStep);
  const cipher = useGame((s) => s.cipherName);
  const upgradesOpen = useGame((s) => s.upgradesOpen);
  const inRun = useGame((s) => s.inRun);
  const offers = useGame((s) => s.offers);
  const bossActive = useGame((s) => s.bossActive);
  const bossHpFrac = useGame((s) => s.bossHpFrac);
  const devUnlockAll = useGame((s) => s.profile.devUnlockAll);

  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-0 p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="pointer-events-auto mx-auto flex max-w-4xl items-center gap-2 rounded-lg border border-line hud-panel px-3 py-2">
          <div className="font-mono text-xs tracking-widest text-cyan">WAVE {wave}</div>
          <div className="text-[11px] uppercase text-muted">endless</div>
          {cipher && (
            <div className="hidden font-mono text-[11px] tracking-widest text-ok sm:block">
              {cipher}
            </div>
          )}
          <div className="ml-auto flex items-center gap-3 font-mono text-xs">
            <span className="text-ice tabular">{scrap} SCRAP</span>
            <span
              className={cn(
                "flex items-center gap-1 tabular",
                core <= 5 ? "text-signal" : "text-ok",
              )}
            >
              <Shield className="size-3.5" />
              {core}/{maxCore}
            </span>
          </div>
          <button
            className="grid size-11 place-items-center rounded-md text-fg"
            onClick={() => getEngine()?.pauseToggle()}
            aria-label={paused ? "Resume" : "Pause"}
          >
            {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
          </button>
          <button
            className="grid size-11 place-items-center rounded-md text-muted"
            onClick={() => getEngine()?.setSpeed(speed === 3 ? 1 : ((speed + 1) as 1 | 2 | 3))}
            aria-label="Speed"
          >
            <FastForward className="size-4" />
          </button>
          <span className="hidden text-[11px] text-faint sm:inline">{speed}x</span>
        </div>
        <div className="mx-auto mt-2 max-w-4xl px-1 font-mono text-[11px] text-muted">
          {log} · {alive} live · {pending} inbound
          {cipher && <span className="sm:hidden"> · {cipher}</span>}
        </div>
        {bossActive && (
          <div className="pointer-events-auto mx-auto mt-2 max-w-4xl rounded-lg border border-signal/50 bg-panel/90 px-3 py-1.5">
            <div className="mb-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-widest text-signal">
              <span>Prime unit</span>
              <span>{Math.round(bossHpFrac * 100)}%</span>
            </div>
            <Bar value={bossHpFrac} max={1} />
          </div>
        )}
      </div>

      <div className="absolute inset-x-0 bottom-0 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {upgradesOpen && phase !== "gameOver" && (
          <div className="mx-auto mb-2 flex max-w-4xl flex-col gap-2 rounded-lg border border-line hud-panel p-2">
            {offers.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <div className="px-1 font-mono text-[10px] uppercase tracking-widest text-cyan">
                  This wave
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {offers.map((o) => (
                    <button
                      key={o.id}
                      onClick={() => getEngine()?.buyOffer(o)}
                      disabled={o.cost > 0 && scrap < o.cost}
                      className="rounded-md border border-cyan/40 bg-panel px-2 py-2 text-left disabled:opacity-40"
                    >
                      <div className="text-xs font-medium">{o.title}</div>
                      <div className="font-mono text-[11px] text-cyan">
                        {o.cost === 0 ? "FREE" : o.cost}
                      </div>
                      <div className="mt-0.5 text-[10px] leading-tight text-muted">{o.detail}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="grid grid-cols-3 gap-2">
              {IN_RUN_IDS.map((id) => {
                const spec = IN_RUN[id];
                const bought = inRun[id] ?? 0;
                const atCap = inRunAtCap(bought, id);
                const cost = inRunCost(bought, id, wave);
                return (
                  <button
                    key={id}
                    onClick={() => getEngine()?.buyInRun(id)}
                    disabled={atCap || scrap < cost}
                    className="rounded-md border border-line bg-panel px-2 py-2 text-left disabled:opacity-40"
                  >
                    <div className="text-xs font-medium">{spec.label}</div>
                    <div className="mt-0.5 text-[10px] leading-tight text-muted">{spec.detail}</div>
                    <div className="mt-0.5 font-mono text-[11px] text-cyan">
                      {atCap ? "maxed" : cost} · {id === "repair" ? "heal" : `x${bought}`}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {selectedCoord && (
          <div className="mx-auto mb-2 flex max-w-4xl items-center gap-2 rounded-lg border border-line hud-panel px-3 py-2">
            <span className="flex-1 font-mono text-xs text-muted">{inspect}</span>
            <Btn className="min-h-10" onClick={() => getEngine()?.rankSelected()}>
              Rank
            </Btn>
            <Btn className="min-h-10" onClick={() => getEngine()?.sellSelected()}>
              Sell
            </Btn>
          </div>
        )}
        <div className="mx-auto grid max-w-4xl grid-cols-5 gap-2">
          <button
            onClick={() => getEngine()?.toggleUpgrades()}
            className={cn(
              "relative flex min-h-16 flex-col items-center justify-center rounded-lg border px-1 py-2",
              upgradesOpen ? "border-cyan bg-cyan/15" : "border-line hud-panel",
            )}
          >
            {offers.length > 0 && !upgradesOpen && (
              <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-cyan" />
            )}
            <ArrowUpCircle className="size-4 text-cyan" />
            <span className="text-xs">Upgrades</span>
            <span className="font-mono text-[11px] text-muted">cash</span>
          </button>
          {TOWER_KINDS.map((kind: TowerKind) => {
            const spec = TOWER[kind];
            const on = selected === kind;
            const afford = scrap >= spec.cost;
            return (
              <button
                key={kind}
                onClick={() => getEngine()?.selectTower(kind)}
                className={cn(
                  "flex min-h-16 flex-col items-center justify-center rounded-lg border px-1 py-2",
                  on ? "border-cyan bg-cyan/15" : "border-line hud-panel",
                  !afford && "opacity-50",
                )}
              >
                <Zap className="size-4 text-cyan" />
                <span className="text-xs">{spec.label}</span>
                <span className="font-mono text-[11px] text-muted">{spec.cost}</span>
              </button>
            );
          })}
        </div>
      </div>

      {tutorial > 0 && tutorial < 4 && phase === "combat" && (
        <div className="pointer-events-none absolute inset-x-0 top-24 flex justify-center px-4">
          <div className="pointer-events-auto max-w-sm rounded-lg border border-line hud-panel px-4 py-3 text-sm">
            {tutorial === 1 && "Tap a dark tile beside the circuit to deploy Pulse."}
            {tutorial === 2 &&
              "Hostiles leak into the vault if they finish the lane. Keep fire on the front."}
            {tutorial === 3 &&
              "Wave clear. Upgrades appear on the right — tap to install while fighting."}
            <div className="mt-2 flex justify-end">
              <Btn
                variant="quiet"
                className="min-h-9"
                onClick={() => getEngine()?.finishTutorial()}
              >
                Dismiss
              </Btn>
            </div>
          </div>
        </div>
      )}

      {paused && phase === "combat" && (
        <CenterCard>
          <h2 className="font-display text-3xl">Paused</h2>
          <Btn variant="primary" onClick={() => getEngine()?.pauseToggle()}>
            Resume
          </Btn>
          <Btn onClick={() => getEngine()?.cashOut()}>Bank &amp; end run</Btn>
          <Btn onClick={() => getEngine()?.returnToMenu()}>Abort to menu</Btn>
          {devUnlockAll && <DevSkipWaveRow />}
        </CenterCard>
      )}

      {phase === "gameOver" && <GameOverCard />}
    </>
  );
}

/** In-run wave-skip, shown on the pause screen once dev mode is already
 *  active (Settings has no path back to itself mid-run, so this is the
 *  only place devSkipToWave — which requires phase === "combat" — is
 *  actually reachable). */
function DevSkipWaveRow() {
  const wave = useGame((s) => s.wave);
  const [value, setValue] = useState(String(wave));
  return (
    <div className="flex items-center gap-2 border-t border-line pt-3">
      <span className="text-[11px] uppercase tracking-widest text-signal">Dev</span>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))}
        className="h-10 w-20 rounded-md border border-line bg-ink px-2 text-center text-fg outline-none focus:border-cyan"
      />
      <Btn
        className="flex-1"
        onClick={() => {
          getEngine()?.devSkipToWave(Number(value) || 1);
          getEngine()?.pauseToggle();
        }}
      >
        Skip to wave
      </Btn>
    </div>
  );
}

function GameOverCard() {
  const wave = useGame((s) => s.wave);
  const core = useGame((s) => s.coreHP);
  const p = useGame((s) => s.profile);
  const recap = p.lastRecap;
  const engine = getEngine();
  const canPatch = engine
    ? !engine.corePatchUsed && core <= 0 && (p.bankScrap >= 80 || useGame.getState().scrap >= 80)
    : false;
  const canRevive = engine ? !engine.reviveAdUsed && core <= 0 : false;
  return (
    <CenterCard>
      <h2 className={cn("font-display text-3xl", core > 0 ? "text-cyan" : "text-signal")}>
        {core > 0 ? "Run banked" : "Core offline"}
      </h2>
      <p className="text-sm text-muted">
        Reached wave {wave} · {DIFFICULTY_MOD[p.difficulty].label}
      </p>
      {recap && (
        <Panel className="space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-muted">Coins banked</span>
            <span className="tabular text-cyan">{recap.banked}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted">Kills</span>
            <span className="tabular">{recap.kills}</span>
          </div>
          {recap.cipherName && (
            <div className="flex justify-between text-sm">
              <span className="text-muted">Cipher</span>
              <span className="tracking-widest text-cyan">{recap.cipherName}</span>
            </div>
          )}
          {recap.glyphs.length > 0 && (
            <div className="text-xs text-muted">
              Glyphs {recap.glyphs.map((g) => g.toUpperCase()).join(" · ")}
            </div>
          )}
        </Panel>
      )}
      {canRevive && (
        <Btn variant="primary" onClick={() => getEngine()?.watchReviveAd()}>
          Watch ad to continue
        </Btn>
      )}
      {canPatch && <Btn onClick={() => getEngine()?.corePatch()}>Emergency patch (80 scrap)</Btn>}
      <Btn variant="primary" onClick={() => getEngine()?.retry()}>
        Retry
      </Btn>
      <Btn onClick={() => getEngine()?.exitTo("lab")}>Open Lab</Btn>
      <Btn onClick={() => getEngine()?.exitTo("forge")}>Open Forge</Btn>
      <Btn variant="quiet" onClick={() => getEngine()?.returnToMenu()}>
        Menu
      </Btn>
    </CenterCard>
  );
}

export function ToastStack({
  toasts,
}: {
  toasts: Array<{ id: number; title: string; detail: string; tone: string }>;
}) {
  useEffect(() => {
    if (!toasts.length) return;
    const id = toasts[toasts.length - 1]!.id;
    const t = window.setTimeout(() => useGame.getState().dismissToast(id), 3200);
    return () => window.clearTimeout(t);
  }, [toasts]);
  return (
    <div className="pointer-events-none absolute right-1 top-1 z-20 flex w-44 flex-col gap-1 pt-[env(safe-area-inset-top)]">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto flex items-start gap-1.5 rounded px-2 py-1">
          <div className="flex-1">
            <div className="text-xs font-medium">{t.title}</div>
            <div className="text-[10px] text-muted">{t.detail}</div>
          </div>
          <button onClick={() => useGame.getState().dismissToast(t.id)} className="text-faint">
            <X className="size-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
