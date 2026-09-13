import { useRef, useState } from "react";
import { getEngine } from "@/lib/game/engine";
import { SignedIn, SignedOut, UserButton } from "@/lib/auth/gates";
import { useGame } from "@/lib/game/store";
import { Btn, Panel } from "../ui";
import { Back, Slider, Toggle } from "../common";

export function SettingsPane() {
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
          <p className="text-[11px] text-faint">
            Wave-skip lives on the pause screen during a run — Settings has no way back to itself
            mid-run, so it can't work from here.
          </p>
        </Panel>
      )}
    </div>
  );
}
