import { useEffect, useRef } from "react";
import { bindEngine, GameEngine, getEngine } from "@/lib/game/engine";
import { useGame } from "@/lib/game/store";
import { cn } from "@/lib/utils";
import { PlayHud, ToastStack } from "./play-hud";
import { BootCard, MenuHome } from "./screens/menu-home";
import { SkillsPane, LabPane, ForgePane, ModulesPane, OpsPane } from "./screens/progression-panes";
import { PassPane, ShopPane, DailyPane, PremiumPane } from "./screens/economy-panes";
import { SettingsPane } from "./screens/settings-pane";

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
