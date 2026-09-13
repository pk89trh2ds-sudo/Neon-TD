import {
  ClipboardList,
  Cog,
  Cpu,
  FlaskConical,
  Hexagon,
  Lock,
  Play,
  ShoppingBag,
  Sparkles,
  Trophy,
  Zap,
} from "lucide-react";
import { getEngine } from "@/lib/game/engine";
import { useGame } from "@/lib/game/store";
import {
  DIFFICULTIES,
  DIFFICULTY_MOD,
  DIFFICULTY_UNLOCK_WAVE,
  dayStamp,
  difficultyUnlocked,
  formatHMS,
  msUntilMidnight,
  passLevel,
  previousDifficulty,
} from "@/lib/game/types";
import { Btn, Bar, Panel, Stat } from "../ui";
import { cn } from "@/lib/utils";
import { NavTile } from "../common";

export function BootCard() {
  return (
    <div className="flex min-h-[72dvh] flex-col items-center justify-center gap-8 text-center">
      <div className="enter-rise space-y-2">
        <p className="text-xs uppercase tracking-[0.4em] text-muted">Grid online</p>
        <h1 className="font-display text-6xl font-semibold leading-none tracking-[0.18em] text-ice">
          NEON
        </h1>
        <p className="font-display text-2xl leading-none tracking-[0.32em] text-cyan">
          TOWER DEFENSE
        </p>
      </div>
      <Btn variant="primary" className="min-w-48" onClick={() => getEngine()?.enterMenu()}>
        Enter grid
      </Btn>
    </div>
  );
}

export function MenuHome() {
  const p = useGame((s) => s.profile);
  const hasRun = useGame((s) => s.hasSavedRun);
  const crate = useGame((s) => s.crateReady);
  const difficulty = useGame((s) => s.difficulty);
  const briefing = useGame((s) => s.briefing);
  const missions = p.missions;
  const nextMilestone = [10, 25, 50].find((w) => p.highestWaveReached < w) ?? 50;

  return (
    <div className="flex flex-col gap-5 py-4">
      <header className="enter-rise pt-4">
        <p className="text-xs uppercase tracking-[0.35em] text-muted">Operator {p.displayName}</p>
        <h1 className="font-display text-5xl font-semibold tracking-[0.16em] text-ice">NEON TD</h1>
        <p className="mt-1 max-w-sm text-sm text-muted">
          Endless circuit. Cash Upgrades in-run, bank coins into the Lab, socket glyphs into Cipher
          Words.
        </p>
      </header>

      <Panel className="flex items-center justify-between gap-3">
        <Stat label="Wave" value={p.highestWaveReached} />
        <Stat label="Prestige" value={p.prestigeLevel} />
        <Stat label="Streak" value={p.loginStreak} />
        <Stat label="Bank" value={p.bankScrap} />
      </Panel>

      {briefing && (
        <Panel className="space-y-2">
          <p className="text-xs uppercase tracking-[0.2em] text-cyan">Field briefing</p>
          <p className="text-sm text-muted">
            Tap dark tiles to deploy Pulse. Waves never end. Spend scrap on Upgrades during a run.
            After you fall or bank, spend coins on permanent Lab ranks. Socket glyphs in the Forge
            like rune words.
          </p>
          <Btn variant="quiet" onClick={() => getEngine()?.finishTutorial()}>
            Mark as read
          </Btn>
        </Panel>
      )}

      <div className="flex gap-2">
        {DIFFICULTIES.map((d) => {
          const open = difficultyUnlocked(p, d);
          const spec = DIFFICULTY_MOD[d];
          return (
            <button
              key={d}
              disabled={!open}
              onClick={() => open && getEngine()?.setDifficulty(d)}
              className={cn(
                "min-h-11 flex-1 rounded-md border text-xs uppercase tracking-wider",
                difficulty === d
                  ? "border-cyan bg-cyan/15 text-cyan"
                  : "border-line text-muted hover:text-fg",
                !open && "opacity-40",
              )}
            >
              {open ? spec.label : <Lock className="mx-auto size-3.5" />}
            </button>
          );
        })}
      </div>
      <p className="text-center text-[11px] text-faint">
        {DIFFICULTY_MOD[difficulty].label} · HP {DIFFICULTY_MOD[difficulty].hp}x · coins{" "}
        {DIFFICULTY_MOD[difficulty].reward}x
        {(() => {
          const nextLocked = DIFFICULTIES.find((d) => !difficultyUnlocked(p, d));
          if (!nextLocked) return null;
          const prev = previousDifficulty(nextLocked);
          return prev
            ? ` · ${DIFFICULTY_MOD[nextLocked].label} unlocks at wave ${DIFFICULTY_UNLOCK_WAVE} on ${DIFFICULTY_MOD[prev].label}`
            : null;
        })()}
      </p>

      <Btn variant="primary" onClick={() => getEngine()?.startGame(difficulty)}>
        <Play className="size-4" />
        Start new run
      </Btn>
      {hasRun && <Btn onClick={() => getEngine()?.continueRun()}>Continue run</Btn>}

      <Panel className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-[0.2em] text-muted">Daily ops</p>
          <span className="text-xs text-faint">Resets {formatHMS(msUntilMidnight())}</span>
        </div>
        {missions.map((m) => (
          <div key={m.id} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span>{m.description}</span>
              <span className="tabular text-muted">
                {m.progress}/{m.target}
              </span>
            </div>
            <Bar value={m.progress} max={m.target} />
            <div className="flex justify-end gap-2">
              {m.claimed && !m.adBoosted && (
                <Btn
                  variant="quiet"
                  className="min-h-9 px-3 text-xs"
                  onClick={() => getEngine()?.claimMissionBonusAd(m.id)}
                >
                  Watch ad: double
                </Btn>
              )}
              <Btn
                variant="quiet"
                className="min-h-9 px-3 text-xs"
                disabled={m.claimed || m.progress < m.target}
                onClick={() => getEngine()?.claimMissionId(m.id)}
              >
                {m.claimed ? "Claimed" : "Claim"}
              </Btn>
            </div>
          </div>
        ))}
        {crate && (
          <Btn variant="primary" onClick={() => getEngine()?.claimCrate()}>
            Claim daily crate
          </Btn>
        )}
        {!crate && p.dailyCrateDay === dayStamp() && p.dailyCrateAdBonusDay !== dayStamp() && (
          <Btn variant="quiet" onClick={() => getEngine()?.claimCrateBonusAd()}>
            Watch ad: double crate
          </Btn>
        )}
      </Panel>

      <p className="text-center text-xs text-faint">
        Endless waves · Next milestone {nextMilestone} · Pass lvl {passLevel(p.battlePassXP)}
      </p>

      <div className="grid grid-cols-2 gap-2">
        <NavTile icon={<FlaskConical className="size-4" />} label="Lab" to="lab" />
        <NavTile icon={<Hexagon className="size-4" />} label="Forge" to="forge" />
        <NavTile icon={<Sparkles className="size-4" />} label="Skills" to="skills" />
        <NavTile icon={<Cpu className="size-4" />} label="Modules" to="modules" />
        <NavTile icon={<Trophy className="size-4" />} label="Battle pass" to="pass" />
        <NavTile icon={<Trophy className="size-4" />} label="Daily challenge" to="daily" />
        <NavTile icon={<Zap className="size-4" />} label="Premium" to="premium" />
        <NavTile icon={<ShoppingBag className="size-4" />} label="Shop" to="shop" />
        <NavTile icon={<ClipboardList className="size-4" />} label="Ops log" to="ops" />
        <NavTile icon={<Cog className="size-4" />} label="Settings" to="settings" />
      </div>
    </div>
  );
}
