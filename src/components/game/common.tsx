/**
 * Small, generic presentational pieces shared across the menu screens and
 * the in-run HUD. Kept dependency-free of any single screen so it can be
 * imported from both `screens/*` and `play-hud.tsx` without a cycle.
 */
import type { ReactNode } from "react";
import { getEngine } from "@/lib/game/engine";
import { useGame } from "@/lib/game/store";
import type { Screen } from "@/lib/game/types";
import { cn } from "@/lib/utils";
import { Btn } from "./ui";

export function NavTile({ icon, label, to }: { icon: ReactNode; label: string; to: Screen }) {
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

export function Back() {
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

export function CenterCard({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-ink/70 p-4">
      <div className="flex max-h-[85dvh] w-full max-w-md flex-col gap-3 overflow-y-auto rounded-xl border border-line bg-panel p-6">
        {children}
      </div>
    </div>
  );
}

export function Toggle({
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

export function Slider({
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
