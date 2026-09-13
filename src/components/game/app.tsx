import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowUpCircle,
  ClipboardList,
  Cog,
  Cpu,
  FastForward,
  FlaskConical,
  Hexagon,
  Lock,
  Pause,
  Play,
  Shield,
  ShoppingBag,
  Sparkles,
  Trophy,
  X,
  Zap,
} from "lucide-react";
import { bindEngine, GameEngine, getEngine } from "@/lib/game/engine";
import { SignedIn, SignedOut, UserButton } from "@/lib/auth/gates";
import { shopForDay } from "@/lib/game/meta";
import { getDailyLeaderboard } from "@/lib/game/leaderboard-api";
import { IAP_CATALOG, IAP_PRODUCT_KEYS } from "@/lib/game/iap-catalog";
import { CHASSIS, CIPHERS, GLYPH, prefixCipher, recipeHint } from "@/lib/game/ciphers";
import {
  IN_RUN,
  IN_RUN_IDS,
  WORKSHOP,
  inRunAtCap,
  inRunCost,
  workshopCost,
} from "@/lib/game/workshop";
import { useGame } from "@/lib/game/store";
import {
  DIFFICULTIES,
  DIFFICULTY_MOD,
  DIFFICULTY_UNLOCK_WAVE,
  GLYPH_IDS,
  MODULE,
  PASS_TRACK,
  PREMIUM_PASS_TRACK,
  SKILL,
  SKILL_IDS,
  TOWER,
  TOWER_KINDS,
  WORKSHOP_IDS,
  dayStamp,
  difficultyUnlocked,
  formatHMS,
  msUntilMidnight,
  passLevel,
  previousDifficulty,
  rewardLabel,
  workshopRank,
  type GlyphId,
  type ModuleId,
  type Screen,
  type SkillId,
  type TowerKind,
} from "@/lib/game/types";
import { Btn, Bar, Panel, Stat } from "./ui";
import { cn } from "@/lib/utils";

export function NeonApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const screen = useGame((s) => s.screen);
  const toasts = useGame((s) => s.toasts);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new GameEngine(canvas);
    bindEngine(engine);
    let dead = false;
    void engine.boot().then(() => {
      if (dead) return;
      engine.renderer.resize();
      engine.startLoop();
    });
    const onResize = () => engine.renderer.resize();
    const onKey = (e: KeyboardEvent) => {
      const g = getEngine();
      if (!g) return;
      if (e.key === " ") {
        e.preventDefault();
        g.pauseToggle();
      }
      if (e.key === "1") g.selectTower("pulse");
      if (e.key === "2") g.selectTower("beam");
      if (e.key === "3") g.selectTower("nova");
      if (e.key === "4") g.selectTower("tesla");
      if (e.key === "Escape") {
        if (useGame.getState().screen === "play") g.pauseToggle();
        else useGame.getState().patch({ screen: "menu" });
      }
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKey);
    return () => {
      dead = true;
      engine.stopLoop();
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const playing = screen === "play";

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-ink text-fg">
      <canvas
        ref={canvasRef}
        className={cn(
          "absolute inset-0 h-full w-full touch-none",
          playing ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onPointerDown={(e) => {
          const g = getEngine();
          if (!g) return;
          const r = e.currentTarget.getBoundingClientRect();
          g.pointer(e.clientX - r.left, e.clientY - r.top, "down");
        }}
        onPointerMove={(e) => {
          const g = getEngine();
          if (!g) return;
          const r = e.currentTarget.getBoundingClientRect();
          g.pointer(e.clientX - r.left, e.clientY - r.top, "move");
        }}
      />
      {!playing && <MenuLayer />}
      {playing && <PlayHud />}
      <ToastStack toasts={toasts} />
    </main>
  );
}

function MenuLayer() {
  const screen = useGame((s) => s.screen);
  return (
    <div className="absolute inset-0 overflow-y-auto">
      <div
        className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-50"
        style={{ backgroundImage: "url(/textures/menu.jpg)" }}
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-ink/40 via-ink/75 to-ink" />
      <div className="relative mx-auto flex min-h-full max-w-lg flex-col px-4 pb-10 pt-[max(1.5rem,env(safe-area-inset-top))]">
        {screen === "boot" && <BootCard />}
        {screen === "menu" && <MenuHome />}
        {screen === "skills" && <SkillsPane />}
        {screen === "lab" && <LabPane />}
        {screen === "forge" && <ForgePane />}
        {screen === "modules" && <ModulesPane />}
        {screen === "pass" && <PassPane />}
        {screen === "shop" && <ShopPane />}
        {screen === "settings" && <SettingsPane />}
        {screen === "ops" && <OpsPane />}
        {screen === "daily" && <DailyPane />}
        {screen === "premium" && <PremiumPane />}
      </div>
    </div>
  );
}

function BootCard() {
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

function MenuHome() {
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

function NavTile({ icon, label, to }: { icon: ReactNode; label: string; to: Screen }) {
  return (
    <button
      onClick={() => {
        getEngine();
        useGame.getState().patch({ screen: to });
      }}
      className="flex min-h-14 items-center gap-3 rounded-lg border border-line bg-panel px-4 text-left text-sm hover:border-line-strong"
    >
      <span className="text-cyan">{icon}</span>
      {label}
    </button>
  );
}

function Back() {
  return (
    <Btn
      variant="quiet"
      className="self-start"
      onClick={() => useGame.getState().patch({ screen: "menu" })}
    >
      Back
    </Btn>
  );
}

function SkillsPane() {
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

function LabPane() {
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

function ForgePane() {
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

function ModulesPane() {
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

function PassPane() {
  const p = useGame((s) => s.profile);
  const entitlements = useGame((s) => s.entitlements);
  const hasPremium = entitlements.includes("premium_pass_s1");
  const lvl = passLevel(p.battlePassXP);
  return (
    <div className="flex flex-col gap-4 py-4">
      <Back />
      <h2 className="font-display text-3xl">Battle pass</h2>
      <p className="text-sm text-muted">
        Level {lvl} · {p.battlePassXP} XP
      </p>
      <Bar value={p.battlePassXP % 100} max={100} />
      {p.dailyPassAdBonusDay !== dayStamp() && (
        <Btn variant="quiet" onClick={() => getEngine()?.claimPassBonusAd()}>
          Watch ad: +40 XP
        </Btn>
      )}
      {!hasPremium && (
        <Btn onClick={() => useGame.getState().patch({ screen: "premium" })}>
          Get the Premium Pass for a bonus track
        </Btn>
      )}
      {PASS_TRACK.map((t) => {
        const claimed = p.battlePassClaimed.includes(t.level);
        const premiumTier = PREMIUM_PASS_TRACK.find((pt) => pt.level === t.level);
        const premiumClaimed = p.premiumPassClaimed.includes(t.level);
        return (
          <div key={t.level} className="space-y-2">
            <Panel className="flex items-center justify-between gap-3">
              <div>
                <div className="font-medium">Tier {t.level}</div>
                <div className="text-xs text-muted">{rewardLabel(t.reward)}</div>
              </div>
              <Btn
                variant="primary"
                disabled={claimed || lvl < t.level}
                onClick={() => getEngine()?.claimPassLevel(t.level)}
              >
                {claimed ? "Claimed" : "Claim"}
              </Btn>
            </Panel>
            {premiumTier && hasPremium && (
              <Panel className="flex items-center justify-between gap-3 border-cyan/30 bg-cyan/5">
                <div>
                  <div className="font-medium text-cyan">Premium bonus</div>
                  <div className="text-xs text-muted">{rewardLabel(premiumTier.reward)}</div>
                </div>
                <Btn
                  variant="primary"
                  disabled={premiumClaimed || lvl < t.level}
                  onClick={() => getEngine()?.claimPremiumPassLevel(t.level)}
                >
                  {premiumClaimed ? "Claimed" : "Claim"}
                </Btn>
              </Panel>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ShopPane() {
  const p = useGame((s) => s.profile);
  const items = shopForDay(p.dailyShopDay || dayStamp());
  return (
    <div className="flex flex-col gap-4 py-4">
      <Back />
      <h2 className="font-display text-3xl">Night market</h2>
      <p className="text-sm text-muted">Bank {p.bankScrap} · Rotates at midnight</p>
      {p.dailyShopAdBonusDay !== dayStamp() && (
        <Btn variant="quiet" onClick={() => getEngine()?.claimShopBonusAd()}>
          Watch ad: free item
        </Btn>
      )}
      {items.map((item) => {
        const bought = p.dailyShopBought.includes(item.id);
        return (
          <Panel key={item.id} className="flex items-center justify-between gap-3">
            <div>
              <div className="font-medium">{item.title}</div>
              <div className="text-xs text-muted">{item.detail}</div>
            </div>
            <Btn
              variant="primary"
              disabled={bought || p.bankScrap < item.cost}
              onClick={() => getEngine()?.buy(item)}
            >
              {bought ? "Sold" : `${item.cost}`}
            </Btn>
          </Panel>
        );
      })}
    </div>
  );
}

function DailyPane() {
  const p = useGame((s) => s.profile);
  const [scores, setScores] = useState<Array<{ displayName: string; wave: number }> | null>(null);
  const [error, setError] = useState(false);
  const today = dayStamp();

  useEffect(() => {
    let cancelled = false;
    getDailyLeaderboard({ data: today })
      .then((rows) => {
        if (!cancelled) setScores(rows);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [today]);

  return (
    <div className="flex flex-col gap-4 py-4">
      <Back />
      <h2 className="font-display text-3xl">Daily challenge</h2>
      <p className="text-sm text-muted">
        Same circuit, same drops, for everyone today — Normal difficulty, your permanent upgrades
        still apply. Resets {formatHMS(msUntilMidnight())}.
      </p>
      <Btn variant="primary" onClick={() => getEngine()?.startDailyChallenge()}>
        <Play className="size-4" />
        Play today's challenge
      </Btn>
      <Panel className="space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-muted">Today's leaderboard</p>
        {error && <p className="text-sm text-muted">Sign in to see and post scores.</p>}
        {!error && !scores && <p className="text-sm text-muted">Loading…</p>}
        {!error && scores?.length === 0 && (
          <p className="text-sm text-muted">No runs yet today — be the first.</p>
        )}
        {scores?.map((row, i) => (
          <div
            key={`${row.displayName}-${i}`}
            className="flex items-center justify-between text-sm"
          >
            <span className="text-muted">
              #{i + 1} {row.displayName}
              {row.displayName === p.displayName ? " (you)" : ""}
            </span>
            <span className="tabular text-cyan">wave {row.wave}</span>
          </div>
        ))}
      </Panel>
    </div>
  );
}

function PremiumPane() {
  const p = useGame((s) => s.profile);
  const entitlements = useGame((s) => s.entitlements);
  const [pending, setPending] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-4 py-4">
      <Back />
      <h2 className="font-display text-3xl">Premium</h2>
      <p className="text-sm text-muted">
        Optional, one-time purchases. Nothing here sells power — no scrap, no skill points, no
        shortcuts past the Lab grind.
      </p>
      <SignedOut>
        <Panel className="space-y-2">
          <p className="text-sm text-muted">Sign in to make a purchase.</p>
          <Btn onClick={() => (window.location.href = "/login")}>Sign in</Btn>
        </Panel>
      </SignedOut>
      <SignedIn>
        {IAP_PRODUCT_KEYS.map((key) => {
          const item = IAP_CATALOG[key];
          const owned = entitlements.includes(key);
          return (
            <Panel key={key} className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="font-medium">{item.label}</div>
                <div className="tabular text-cyan">{item.priceDisplay}</div>
              </div>
              <p className="text-xs text-muted">{item.blurb}</p>
              <Btn
                variant="primary"
                className="w-full"
                disabled={owned || pending === key}
                onClick={() => {
                  setPending(key);
                  void getEngine()
                    ?.startCheckout(key)
                    .finally(() => setPending(null));
                }}
              >
                {owned ? "Owned" : pending === key ? "Redirecting…" : "Buy"}
              </Btn>
            </Panel>
          );
        })}
      </SignedIn>
      <p className="text-xs text-faint">
        Operator {p.displayName} · purchases sync to your account, not this device.
      </p>
    </div>
  );
}

function OpsPane() {
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

function SettingsPane() {
  const p = useGame((s) => s.profile);
  const [name, setName] = useState(p.displayName);
  return (
    <div className="flex flex-col gap-4 py-4">
      <Back />
      <h2 className="font-display text-3xl">Settings</h2>
      <Panel className="space-y-3">
        <label className="text-xs uppercase tracking-[0.2em] text-muted">Callsign</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-11 w-full rounded-md border border-line bg-ink px-3 text-fg outline-none focus:border-cyan"
        />
        <Btn onClick={() => getEngine()?.rename(name)}>Save name</Btn>
      </Panel>
      <Panel className="space-y-3">
        <Toggle
          label="Music"
          on={p.musicEnabled}
          onChange={(v) => getEngine()?.setSetting("musicEnabled", v)}
        />
        <Toggle
          label="Effects"
          on={p.sfxEnabled}
          onChange={(v) => getEngine()?.setSetting("sfxEnabled", v)}
        />
        <Toggle
          label="Screen shake"
          on={p.shakeEnabled}
          onChange={(v) => getEngine()?.setSetting("shakeEnabled", v)}
        />
        <Toggle
          label="Reduce motion"
          on={p.reducedMotion}
          onChange={(v) => getEngine()?.setSetting("reducedMotion", v)}
        />
        <Slider
          label="Music level"
          value={p.musicVol}
          onChange={(v) => getEngine()?.setSetting("musicVol", v)}
        />
        <Slider
          label="Effects level"
          value={p.sfxVol}
          onChange={(v) => getEngine()?.setSetting("sfxVol", v)}
        />
      </Panel>
      <Btn
        variant="primary"
        disabled={p.highestWaveReached < 50}
        onClick={() => getEngine()?.doPrestige()}
      >
        Prestige (+5 skill points)
      </Btn>
      <p className="text-xs text-faint">
        Unlocks after wave 50. Keeps skills, modules, Lab, and forge.
      </p>
      <Panel className="space-y-3">
        <p className="text-xs uppercase tracking-[0.2em] text-muted">Cloud sync</p>
        <SignedOut>
          <p className="text-sm text-muted">Sign in to sync your save and streak across devices.</p>
          <Btn onClick={() => (window.location.href = "/login")}>Sign in</Btn>
        </SignedOut>
        <SignedIn>
          <UserButton />
        </SignedIn>
      </Panel>
      <Panel className="space-y-3">
        <p className="text-xs uppercase tracking-[0.2em] text-muted">Operator save</p>
        <Btn onClick={() => getEngine()?.downloadSave()}>Download save file</Btn>
        <label className="flex min-h-11 items-center justify-center rounded-md border border-line bg-panel text-sm">
          Import save
          <input
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              void file.text().then((t) => getEngine()?.importSave(t));
              e.target.value = "";
            }}
          />
        </label>
      </Panel>
      <DevModeFooter devUnlocked={p.devUnlockAll} />
    </div>
  );
}

/**
 * Hidden dev toggle: 7 taps on the version string within 2s of each other.
 * Deliberately unlabeled and visually inert until tapped open — this must
 * never be one accidental tap away, since devUnlockAll permanently
 * tamper-flags the save (see meta.ts) and grants unlimited resources.
 */
function DevModeFooter({ devUnlocked }: { devUnlocked: boolean }) {
  const [taps, setTaps] = useState(0);
  const [open, setOpen] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [skipWave, setSkipWave] = useState("100");

  const handleTap = () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
    const next = taps + 1;
    if (next >= 7) {
      setOpen(true);
      setTaps(0);
      return;
    }
    setTaps(next);
    resetTimer.current = setTimeout(() => setTaps(0), 2000);
  };

  return (
    <div className="pt-2 text-center">
      <button onClick={handleTap} className="text-[11px] text-faint">
        NEON TD v1.0.0
      </button>
      {open && (
        <Panel className="mt-2 space-y-2 text-left">
          <p className="text-xs uppercase tracking-[0.2em] text-signal">
            Dev mode{devUnlocked ? " — active" : ""}
          </p>
          <p className="text-[11px] text-faint">
            Testing only. Permanently excludes this save from the daily leaderboard.
          </p>
          <Btn onClick={() => getEngine()?.devUnlockAll()} disabled={devUnlocked}>
            Unlock all difficulties
          </Btn>
          <Btn onClick={() => getEngine()?.devGrantResources()}>
            +100,000 scrap/coins, +999 skill points
          </Btn>
          <div className="flex items-center gap-2">
            <input
              value={skipWave}
              onChange={(e) => setSkipWave(e.target.value.replace(/\D/g, ""))}
              className="h-10 w-20 rounded-md border border-line bg-ink px-2 text-center text-fg outline-none focus:border-cyan"
            />
            <Btn
              className="flex-1"
              onClick={() => getEngine()?.devSkipToWave(Number(skipWave) || 1)}
            >
              Skip to wave (in-run only)
            </Btn>
          </div>
        </Panel>
      )}
    </div>
  );
}

function Toggle({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      className="flex min-h-11 w-full items-center justify-between"
      onClick={() => onChange(!on)}
    >
      <span>{label}</span>
      <span
        className={cn(
          "h-6 w-10 rounded-full p-0.5 transition-colors",
          on ? "bg-cyan" : "bg-panel-2",
        )}
      >
        <span
          className={cn(
            "block h-5 w-5 rounded-full bg-ink transition-transform",
            on && "translate-x-4",
          )}
        />
      </span>
    </button>
  );
}

function Slider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="text-muted">{label}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-cyan"
      />
    </label>
  );
}

function PlayHud() {
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
                    <div className="font-mono text-[11px] text-cyan">
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

function CenterCard({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-ink/70 p-4">
      <div className="flex max-h-[85dvh] w-full max-w-md flex-col gap-3 overflow-y-auto rounded-xl border border-line bg-panel p-6">
        {children}
      </div>
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

function ToastStack({
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
