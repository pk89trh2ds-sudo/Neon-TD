import { create } from "zustand";
import {
  type DifficultyTier,
  type GamePhase,
  type GridCoord,
  type InRunId,
  type PlayerProfile,
  type RunRecap,
  type Screen,
  type Toast,
  type TowerKind,
  type UpgradeOffer,
  defaultProfile,
} from "./types";

export type GameStore = {
  ready: boolean;
  screen: Screen;
  phase: GamePhase;
  wave: number;
  scrap: number;
  bankScrap: number;
  coreHP: number;
  maxCore: number;
  paused: boolean;
  speed: 1 | 2 | 3;
  selectedTower: TowerKind;
  selectedCoord: GridCoord | null;
  eventLog: string;
  offers: UpgradeOffer[];
  pendingRare: number;
  pulls: number;
  skillPoints: number;
  difficulty: DifficultyTier;
  hasSavedRun: boolean;
  profile: PlayerProfile;
  toasts: Toast[];
  briefing: boolean;
  showComeback: boolean;
  crateReady: boolean;
  tutorialStep: number;
  enemiesAlive: number;
  pendingSpawns: number;
  inspectText: string;
  endless: boolean;
  inRun: Partial<Record<InRunId, number>>;
  cipherName: string | null;
  upgradesOpen: boolean;
  recap: RunRecap | null;
  entitlements: string[];
  /** True while at least one boss enemy is alive on the field — drives the
   *  HUD boss health bar (see PlayHud in app.tsx). */
  bossActive: boolean;
  /** Aggregate remaining-HP fraction across all alive bosses (1 = full). */
  bossHpFrac: number;
  hydrate: (p: PlayerProfile, hasRun: boolean, extras: { comeback: boolean; crateReady: boolean }) => void;
  patch: (partial: Partial<GameStore>) => void;
  toast: (title: string, detail: string, tone?: Toast["tone"]) => void;
  dismissToast: (id: number) => void;
};

let toastId = 1;

export const useGame = create<GameStore>((set) => ({
  ready: false,
  screen: "boot",
  phase: "menu",
  wave: 1,
  scrap: 0,
  bankScrap: 0,
  coreHP: 20,
  maxCore: 20,
  paused: false,
  speed: 1,
  selectedTower: "pulse",
  selectedCoord: null,
  eventLog: "Ready.",
  offers: [],
  pendingRare: 0,
  pulls: 0,
  skillPoints: 0,
  difficulty: "normal",
  hasSavedRun: false,
  profile: defaultProfile(),
  toasts: [],
  briefing: false,
  showComeback: false,
  crateReady: false,
  tutorialStep: 0,
  enemiesAlive: 0,
  pendingSpawns: 0,
  inspectText: "",
  endless: true,
  inRun: {},
  cipherName: null,
  upgradesOpen: false,
  recap: null,
  entitlements: [],
  bossActive: false,
  bossHpFrac: 1,
  hydrate: (p, hasRun, extras) =>
    set({
      ready: true,
      screen: "boot",
      profile: p,
      bankScrap: p.bankScrap,
      pulls: p.inventoryPulls,
      skillPoints: p.skillPoints,
      pendingRare: p.pendingRareUpgrades,
      difficulty: p.difficulty,
      hasSavedRun: hasRun,
      showComeback: extras.comeback,
      crateReady: extras.crateReady,
      briefing: !p.tutorialDone,
      recap: p.lastRecap,
    }),
  patch: (partial) => set(partial),
  toast: (title, detail, tone = "info") =>
    set((s) => ({
      toasts: [...s.toasts.slice(-4), { id: toastId++, title, detail, tone }],
    })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
