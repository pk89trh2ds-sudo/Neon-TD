import { audio } from "./audio";
import { track, type EventProps } from "../analytics";
import { detectPortal, getAdAdapter, initAds, type AdResult } from "../ads/adapter";
import { flushPushNow, schedulePush, syncOnSignIn } from "./cloud-sync";
import {
  applyLogin,
  buyShop,
  checkAchievements,
  claimDailyCrate,
  claimDailyCrateAdBonus,
  claimMission,
  claimMissionAdBonus,
  claimPass,
  claimPassAdBonus,
  grantReward,
  claimShopAdBonus,
  clearRun,
  consumePull,
  consumeRare,
  exportProfileJson,
  importProfileJson,
  loadProfile,
  loadRun,
  prestige,
  progressMission,
  rollModule,
  saveProfile,
  saveRun,
  toggleEquip,
  unlockSkill,
} from "./meta";
import {
  addGlyph,
  equippedChassis,
  loadoutMods,
  matchCipher,
  pickChassis,
  pickGlyph,
  socketGlyph,
  unsocket,
} from "./ciphers";
import { CombatSimulation, SplitMix64, hashStr, waveComposition } from "./sim";
import { submitDailyScore } from "./leaderboard-api";
import { createIapCheckoutSession, getEntitlements } from "./entitlements-api";
import { type IapProductKey } from "./iap-catalog";
import { Renderer } from "./renderer";
import { useGame } from "./store";
import { buyWorkshop, IN_RUN, inRunAtCap, inRunCost } from "./workshop";
import {
  DIFFICULTY_MOD,
  MILESTONES,
  SCHEMA,
  TOWER,
  coinBonus,
  damageBonus,
  dropBonus,
  emptyChassis,
  emptyMods,
  fireRateBonus,
  rangeBonus,
  bountyBonus,
  dayStamp,
  passLevel,
  PREMIUM_PASS_TRACK,
  rewardLabel,
  startingCore,
  startingScrap,
  type ChassisKind,
  type DifficultyTier,
  type GamePhase,
  type GlyphId,
  type GridCoord,
  type InRunId,
  type ModuleId,
  type PlayerProfile,
  type RunRecap,
  type RunSnapshot,
  type ShopItem,
  type SkillId,
  type Screen,
  type TowerKind,
  type UpgradeOffer,
  type WorkshopId,
} from "./types";

export class GameEngine {
  sim = new CombatSimulation();
  renderer: Renderer;
  profile: PlayerProfile;
  phase: GamePhase = "menu";
  wave = 1;
  coreHP = 20;
  maxCore = 20;
  scrap = 0;
  selectedTower: TowerKind = "pulse";
  selectedCoord: GridCoord | null = null;
  offers: UpgradeOffer[] = [];
  paused = false;
  speed: 1 | 2 | 3 = 1;
  seed = 1;
  rng = new SplitMix64(1);
  claimed = new Set<number>();
  endless = false;
  /** Set while playing today's daily challenge — cleared once the run ends
   *  (score submitted) or the tab reloads (a v1 simplification: a daily
   *  challenge run isn't resumable across sessions like a normal run is). */
  dailyChallengeDay: string | null = null;
  /** IAP keys owned by the signed-in player (empty when signed out/offline —
   *  ads stay on, premium pass stays locked; never trust a client override). */
  entitlements: Set<string> = new Set();
  eventLog = "Ready.";
  corePatchUsed = false;
  reviveAdUsed = false;
  inRun: Partial<Record<InRunId, number>> = {};
  runKills = 0;
  runGlyphs: GlyphId[] = [];
  runChassisDrop: ChassisKind | null = null;
  cipherName: string | null = null;
  upgradesOpen = false;
  /**
   * Which ad portal (if any) this instance is running inside. Fixed at
   * construction — the embedding frame can't change mid-session. Used to gate
   * backend features that some portals don't support or actively reject.
   *
   * CrazyGames requires automatic SDK login and rejects external login forms,
   * so when `portal === "crazygames"` we skip all cloud sync, leaderboard
   * submissions, and entitlements checks. The game runs fully on localStorage.
   *
   * TODO (CrazyGames SDK auth): once the game is approved, wire
   * `window.CrazyGames.SDK.user.getUserToken()` here and pass it to the
   * server functions so cloud save can be layered back in without a login form.
   */
  private readonly portal = detectPortal();
  private settled = false;
  private mods = emptyMods();
  private acc = 0;
  private last = 0;
  private raf = 0;
  private running = false;
  private persistAt = 0;
  /** True while a commercial-break ad is in-flight; prevents concurrent breaks. */
  private adBreakActive = false;
  /**
   * Upper bound on how long an ad may hold its in-flight flag.
   * Portal SDKs are supposed to settle every ad promise, but CrazyGames'
   * `requestAd` can invoke neither `adFinished` nor `adError` (blocked frame,
   * SDK torn down mid-request), which would latch a flag on and disable that
   * placement — or all interstitials — for the rest of the session. The flag
   * is released after this window whether or not the SDK ever answered.
   */
  private static readonly AD_FLAG_TTL_MS = 60_000;
  /**
   * Session-level guard against double-granting the starter pack.
   * The cloud-sync merge can restore a profile whose `consumedStarterPack` is
   * false (the flag hadn't been pushed yet when the cloud copy was made);
   * without this guard a subsequent `refreshEntitlements()` call would re-grant.
   */
  private starterPackGrantedThisSession = false;
  /**
   * Resolves once boot's cloud-sync merge has settled (immediately when there
   * is nothing to sync). `refreshEntitlements` waits on it so a grant is never
   * written into a profile that is about to be replaced by the cloud copy.
   */
  private cloudSyncSettled: Promise<void> = Promise.resolve();
  /**
   * Tracks which rewarded-ad placements are currently showing an ad.
   * Prevents a double-tap from firing two concurrent rewarded-ad requests for
   * the same placement (both would pass the pre-await eligibility check).
   */
  private adBonusInFlight = new Set<string>();

  private pendingNotes: Array<{ title: string; detail: string; tone: "ok" | "info" }> = [];

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
    this.profile = loadProfile();
  }

  async boot() {
    void initAds();
    const login = applyLogin(this.profile);
    this.profile = login.profile;
    this.flushProfile();
    useGame.getState().hydrate(this.profile, !!loadRun(), {
      comeback: login.comeback,
      crateReady: login.crateReady,
    });
    if (this.portal !== "crazygames") {
      // Sequenced, not concurrent. syncOnSignIn can replace this.profile
      // wholesale with the cloud copy; if the starter-pack grant landed first
      // it would be thrown away along with the consumedStarterPack flag that
      // records it — and the session guard would then block re-granting until
      // the next page load, losing the purchase outright. Every entitlement
      // refresh waits on this, including the delayed one the Stripe return
      // schedules below.
      this.cloudSyncSettled = (async () => {
        const synced = await syncOnSignIn(this.profile);
        if (synced === this.profile) return;
        this.profile = synced;
        saveProfile(this.profile);
        useGame.getState().patch({ profile: this.profile, bankScrap: this.profile.bankScrap });
        useGame.getState().toast("Cloud sync", "Progress restored from your account", "ok");
      })().catch(() => {});
      void this.refreshEntitlements();
    }
    if (
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("purchase") === "success"
    ) {
      // Stripe's webhook usually lands before this redirect completes, but
      // isn't guaranteed to — one retry after a short delay covers the gap.
      useGame.getState().toast("Purchase received", "Finalizing your purchase…", "ok");
      // Strip only the `purchase` param; preserve other query params and the hash.
      const params = new URLSearchParams(window.location.search);
      params.delete("purchase");
      const newSearch = params.toString();
      window.history.replaceState(
        null,
        "",
        window.location.pathname + (newSearch ? `?${newSearch}` : "") + window.location.hash,
      );
      setTimeout(() => void this.refreshEntitlements(), 2500);
    }
    this.track("session_start", {
      highestWave: this.profile.highestWaveReached,
      prestigeLevel: this.profile.prestigeLevel,
      loginStreak: this.profile.loginStreak,
    });
    if (login.streakUp) {
      this.track("daily_login", { streak: this.profile.loginStreak, comeback: login.comeback });
    }
    if (login.comeback) {
      this.pendingNotes.push({
        title: "Operator returned",
        detail: "Comeback crate: +60 scrap and a pull",
        tone: "ok",
      });
    }
    if (login.streakUp) {
      this.pendingNotes.push({
        title: `Streak ${this.profile.loginStreak}`,
        detail:
          this.profile.loginStreak % 7 === 0 ? "Weekly crate: extra pull" : "Daily scrap banked",
        tone: "ok",
      });
    }
    void this.renderer.load();
    this.renderer.reduced = this.profile.reducedMotion;
    audio.configure({
      musicOn: this.profile.musicEnabled,
      sfxOn: this.profile.sfxEnabled,
      musicVol: this.profile.musicVol,
      sfxVol: this.profile.sfxVol,
    });
    const persist = () => {
      this.flushProfile();
      if (this.phase === "combat" || this.phase === "upgrade") this.persistRun();
      this.track("session_end", { wave: this.wave, phase: this.phase });
      // A backgrounded/closing tab may not survive schedulePush's debounce —
      // flush immediately here so the last few minutes aren't lost.
      // Skip on portals that don't support backend auth (e.g. CrazyGames).
      if (this.portal !== "crazygames") void flushPushNow(this.profile);
    };
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) persist();
    });
    window.addEventListener("pagehide", persist);
  }

  startLoop() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const frame = (now: number) => {
      this.raf = requestAnimationFrame(frame);
      let dt = (now - this.last) / 1000;
      this.last = now;
      if (dt > 0.25) dt = 0.25;
      this.step(dt);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stopLoop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  enterMenu() {
    audio.unlock();
    useGame.getState().patch({ screen: "menu" });
    audio.play("ui");
    for (const n of this.pendingNotes) useGame.getState().toast(n.title, n.detail, n.tone);
    this.pendingNotes = [];
  }

  startGame(difficulty?: DifficultyTier, seedOverride?: number) {
    audio.unlock();
    this.profile.difficulty = difficulty ?? this.profile.difficulty;
    this.sim.resetRun();
    this.seed = seedOverride ?? ((Math.random() * 0xffffffff) >>> 0 || 1);
    this.rng = new SplitMix64(this.seed);
    this.wave = 1;
    this.maxCore = startingCore(this.profile);
    this.coreHP = this.maxCore;
    this.scrap = startingScrap(this.profile);
    this.sim.runDamageBonus = this.profile.nextRunDamageBonus || 0;
    this.sim.runRangeBonus = 0;
    this.sim.runFireRateBonus = 0;
    this.sim.runBountyBonus = 0;
    this.profile.nextRunCoreBonus = 0;
    this.profile.nextRunDamageBonus = 0;
    this.claimed.clear();
    this.endless = true;
    this.offers = [];
    this.paused = false;
    this.speed = 1;
    this.corePatchUsed = false;
    this.reviveAdUsed = false;
    this.selectedCoord = null;
    this.acc = 0;
    this.inRun = {};
    this.runKills = 0;
    this.runGlyphs = [];
    this.runChassisDrop = null;
    this.upgradesOpen = false;
    this.settled = false;
    this.phase = "combat";
    this.refreshMods();
    this.beginWave();
    this.flushProfile();
    this.persistRun();
    useGame.getState().patch({
      screen: "play",
      tutorialStep: this.profile.tutorialDone ? 0 : 1,
    });
    this.syncHud();
    audio.play("wave");
    getAdAdapter().gameplayStart();
    this.track("run_start", { difficulty: this.profile.difficulty });
    if (!this.profile.tutorialDone) this.track("tutorial_step", { step: 1 });
  }

  /**
   * Today's shared seeded run: same seed for every player, so the same
   * sequence of upgrade offers and drop rolls plays out for everyone — normal
   * difficulty always, so "wave reached" is comparable regardless of a
   * player's unlock progress. Permanent Workshop/skill/prestige bonuses still
   * apply (this is "same circuit, same drops — see how far your build gets,"
   * not a strictly fair esport reset), and the final wave is submitted to the
   * daily leaderboard on death/cash-out.
   */
  startDailyChallenge() {
    this.dailyChallengeDay = dayStamp();
    this.startGame("normal", hashStr(`${this.dailyChallengeDay}:daily-v1`) || 1);
    this.track("daily_challenge_start", { day: this.dailyChallengeDay });
  }

  continueRun() {
    const snap = loadRun();
    if (!snap) {
      this.eventLog = "No valid run snapshot.";
      this.syncHud();
      return;
    }
    audio.unlock();
    this.seed = snap.seed || 1;
    this.rng = new SplitMix64(this.seed);
    this.wave = Math.max(1, snap.wave);
    this.coreHP = Math.max(1, snap.coreHP);
    this.maxCore = Math.max(this.coreHP, startingCore(this.profile));
    this.scrap = Math.max(0, snap.scrap);
    this.claimed = new Set(snap.claimedMilestones);
    this.endless = snap.isEndlessUnlocked;
    this.profile.difficulty = snap.difficulty;
    this.paused = false;
    this.corePatchUsed = snap.corePatchUsed;
    this.reviveAdUsed = snap.reviveAdUsed ?? false;
    this.sim.resetRun();
    this.sim.runDamageBonus = snap.runDamageBonus;
    this.sim.runRangeBonus = snap.runRangeBonus;
    this.sim.runFireRateBonus = snap.runFireRateBonus;
    this.sim.runBountyBonus = snap.runBountyBonus;
    this.inRun = snap.inRun ?? {};
    this.runKills = snap.runKills ?? 0;
    this.runGlyphs = [];
    this.runChassisDrop = null;
    this.upgradesOpen = false;
    this.settled = false;
    this.sim.restoreTowers(snap.towers ?? []);
    this.refreshMods();
    if (snap.phase === "upgrade") {
      // Saved mid-upgrade: restore offers and auto-start next wave (no upgrade screen pause)
      this.offers = this.sim.makeOffers(this.wave, this.rng);
      if (this.profile.pendingRareUpgrades > 0) {
        this.offers.unshift(this.sim.injectRareOffer(this.wave));
      }
      this.wave += 1;
      this.phase = "combat";
      this.beginWave();
    } else {
      this.offers = [];
      this.phase = "combat";
      this.sim.queueWave(waveComposition(this.wave));
    }
    this.eventLog = `Resumed wave ${this.wave}.`;
    useGame.getState().patch({ screen: "play" });
    this.syncHud();
    audio.play("ui");
    if (this.phase === "combat") getAdAdapter().gameplayStart();
  }

  returnToMenu() {
    this.exitTo("menu");
  }

  exitTo(screen: Screen) {
    if (!this.settled) {
      this.settleRun(this.phase === "gameOver" ? "death" : "abort");
    }
    this.phase = "menu";
    this.sim.resetRun();
    this.upgradesOpen = false;
    useGame.getState().patch({ screen, hasSavedRun: false, phase: "menu", upgradesOpen: false });
    this.syncHud();
    getAdAdapter().gameplayStop();
    this.maybeCommercialBreak();
  }

  cashOut() {
    if (this.phase !== "combat" && this.phase !== "upgrade") return;
    this.settleRun("cashout");
    this.phase = "gameOver";
    this.eventLog = `Banked at wave ${this.wave}.`;
    this.syncHud();
    audio.play("coin");
  }

  retry() {
    if (!this.settled && this.phase === "gameOver") this.settleRun("death");
    this.startGame(this.profile.difficulty);
  }

  pauseToggle() {
    if (this.phase !== "combat") return;
    this.paused = !this.paused;
    this.syncHud();
    audio.play("ui");
    if (this.paused) getAdAdapter().gameplayStop();
    else getAdAdapter().gameplayStart();
  }

  setSpeed(s: 1 | 2 | 3) {
    this.speed = s;
    this.syncHud();
  }

  toggleUpgrades() {
    this.upgradesOpen = !this.upgradesOpen;
    audio.play("ui");
    this.syncHud();
  }

  buyInRun(id: InRunId) {
    if (this.phase !== "combat" && this.phase !== "upgrade") return;
    const bought = this.inRun[id] ?? 0;
    if (inRunAtCap(bought, id)) {
      audio.play("deny");
      this.eventLog = `${IN_RUN[id].label} maxed this run.`;
      this.syncHud();
      return;
    }
    const cost = inRunCost(bought, id, this.wave);
    if (this.scrap < cost) {
      audio.play("deny");
      this.eventLog = `Need ${cost} scrap.`;
      this.syncHud();
      return;
    }
    this.scrap -= cost;
    // `repair` used to skip this counter entirely, so inRunCost(0, "repair",
    // wave) — a flat, near-constant cost — was recomputed on every single
    // purchase forever. Same 1.16^n curve as every other line now; this is
    // what turned +4 max core into an unbounded scrap sink at ~178 scrap
    // apiece by wave 250.
    this.inRun[id] = bought + 1;
    if (id === "repair") {
      this.coreHP += IN_RUN.repair.step;
      this.maxCore = Math.max(this.maxCore, this.coreHP);
    } else {
      this.refreshMods();
    }
    this.eventLog = `${IN_RUN[id].label} ${this.inRun[id] ?? "applied"}.`;
    audio.play("upgrade");
    this.persistRun();
    this.syncHud();
  }

  buyWorkshopId(id: WorkshopId) {
    if (buyWorkshop(this.profile, id)) {
      audio.play("claim");
      this.afterMeta("Lab rank up");
      this.track("workshop_upgrade", { id });
    } else audio.play("deny");
  }

  socket(chassisId: string, slot: number, glyph: GlyphId) {
    if (socketGlyph(this.profile, chassisId, slot, glyph)) {
      const ch = this.profile.chassis.find((c) => c.id === chassisId);
      const word = ch ? matchCipher(ch.sockets) : null;
      audio.play(word ? "cipher" : "socket");
      this.refreshMods();
      this.afterMeta(word ? `Cipher ${word.name}` : "Glyph socketed");
    } else audio.play("deny");
  }

  unsocketSlot(chassisId: string, slot: number) {
    if (unsocket(this.profile, chassisId, slot)) {
      audio.play("ui");
      this.refreshMods();
      this.afterMeta("Glyph returned");
    } else audio.play("deny");
  }

  equipChassis(id: string) {
    if (!this.profile.chassis.some((c) => c.id === id)) {
      audio.play("deny");
      return;
    }
    this.profile.equippedChassisId = id;
    audio.play("ui");
    this.refreshMods();
    this.afterMeta("Chassis equipped");
  }

  selectTower(kind: TowerKind) {
    this.selectedTower = kind;
    audio.play("ui");
    this.syncHud();
  }

  handleTile(coord: GridCoord) {
    if (this.phase !== "combat" && this.phase !== "upgrade") return;
    if (this.sim.towerAt(coord)) {
      this.selectedCoord = coord;
      this.eventLog = this.inspect(coord);
      this.syncHud();
      audio.play("ui");
      return;
    }
    this.place(coord);
  }

  place(coord: GridCoord) {
    if (!this.sim.canPlace(coord)) {
      audio.play("deny");
      return;
    }
    const cost = TOWER[this.selectedTower].cost;
    if (this.scrap < cost) {
      this.eventLog = `Need ${cost} scrap.`;
      audio.play("deny");
      this.syncHud();
      return;
    }
    if (!this.sim.placeTower(this.selectedTower, coord)) return;
    this.scrap -= cost;
    this.eventLog = `Deployed ${TOWER[this.selectedTower].label}.`;
    progressMission(this.profile, "Deploy", 1);
    this.renderer.burst(coord.x, coord.y, "#3ee8ff", 12, 50);
    audio.play("place");
    if (this.profile.tutorialDone === false && this.wave === 1) {
      useGame.getState().patch({ tutorialStep: 2 });
      this.track("tutorial_step", { step: 2 });
    }
    this.persistRun();
    this.flushProfile();
    this.syncHud();
  }

  rankSelected() {
    if (!this.selectedCoord) return;
    const cost = this.sim.rankUpCost(this.selectedCoord);
    if (cost == null) {
      this.eventLog = this.inspect(this.selectedCoord);
      this.syncHud();
      return;
    }
    if (this.scrap < cost) {
      this.eventLog = `Need ${cost} scrap to rank up.`;
      audio.play("deny");
      this.syncHud();
      return;
    }
    this.scrap -= cost;
    this.sim.rankUp(this.selectedCoord);
    this.eventLog = this.inspect(this.selectedCoord);
    audio.play("upgrade");
    this.persistRun();
    this.syncHud();
  }

  sellSelected() {
    if (!this.selectedCoord) return;
    const refund = this.sim.sell(this.selectedCoord);
    if (refund == null) return;
    this.scrap += refund;
    this.eventLog = `Sold module for ${refund} scrap.`;
    this.selectedCoord = null;
    audio.play("ui");
    this.persistRun();
    this.syncHud();
  }

  buyOffer(offer: UpgradeOffer) {
    if (this.phase !== "combat" && this.phase !== "upgrade") return;
    if (offer.cost > 0 && this.scrap < offer.cost) {
      this.eventLog = "Not enough scrap.";
      audio.play("deny");
      this.syncHud();
      return;
    }
    if (offer.cost > 0) this.scrap -= offer.cost;
    const core = { v: this.coreHP };
    if (offer.apply.type === "rare") consumeRare(this.profile);
    this.sim.apply(offer.apply, core, (n) => {
      this.scrap += n;
    });
    this.coreHP = core.v;
    this.maxCore = Math.max(this.maxCore, this.coreHP);
    this.refreshMods();
    this.eventLog = `Installed ${offer.title}.`;
    this.offers = this.offers.filter((o) => o.id !== offer.id);
    audio.play("upgrade");
    this.flushProfile();
    this.persistRun();
    this.syncHud();
  }

  startNextWave() {
    if (this.phase !== "upgrade" && this.phase !== "combat") return;
    this.wave += 1;
    this.offers = [];
    this.phase = "combat";
    this.beginWave();
    this.persistRun();
    this.syncHud();
    audio.play("wave");
  }

  corePatch() {
    if (this.phase !== "gameOver" || this.corePatchUsed) return;
    const cost = 80;
    if (this.profile.bankScrap < cost && this.scrap < cost) {
      audio.play("deny");
      return;
    }
    if (this.profile.bankScrap >= cost) this.profile.bankScrap -= cost;
    else this.scrap -= cost;
    this.corePatchUsed = true;
    this.coreHP = 8;
    this.phase = "combat";
    this.sim.queueWave(waveComposition(this.wave));
    this.eventLog = "Emergency core patch applied.";
    this.flushProfile();
    this.persistRun();
    this.syncHud();
    audio.play("upgrade");
    useGame.getState().toast("Core patched", "One more hold", "ok");
  }

  setDifficulty(d: DifficultyTier) {
    this.profile.difficulty = d;
    this.flushProfile();
    this.syncHud();
  }

  rename(name: string) {
    const trimmed = name.trim().slice(0, 24);
    this.profile.displayName = trimmed || "Operator";
    this.flushProfile();
    this.syncHud();
  }

  // --- Hidden dev mode (7 taps on the Settings version string) -----------
  // Testing-only. Reaching devUnlockAll=true permanently tamper-flags the
  // profile (see meta.ts loadProfile/importProfileJson) so it can never
  // submit to the shared daily leaderboard or count in analytics, even
  // after the toggle is switched back off.

  devUnlockAll() {
    this.profile.devUnlockAll = true;
    this.afterMeta("Dev: all difficulties unlocked");
  }

  devGrantResources() {
    this.scrap += 100_000;
    this.profile.bankScrap += 100_000;
    this.profile.skillPoints += 999;
    this.persistRun();
    this.afterMeta("Dev: resources granted");
  }

  /** Jumps straight to `target` wave, resetting combatants and requeuing
   *  that wave's composition — the same primitive covers both "skip ahead"
   *  and "force a boss" (any multiple of 10 spawns one, see waveComposition). */
  devSkipToWave(target: number) {
    if (this.phase !== "combat" || target < 1) {
      // Never fail silently — this used to be reachable from Settings (no
      // run in progress, so phase !== "combat"), where a click just did
      // nothing with zero feedback and looked broken.
      audio.play("deny");
      return;
    }
    this.wave = Math.floor(target);
    this.beginWave();
    this.eventLog = `Dev: jumped to wave ${this.wave}.`;
    this.persistRun();
    this.syncHud();
  }

  buySkill(id: SkillId) {
    if (unlockSkill(this.profile, id)) {
      audio.play("claim");
      this.afterMeta("Protocol upgraded");
    } else audio.play("deny");
  }

  equip(id: ModuleId) {
    if (toggleEquip(this.profile, id)) {
      audio.play("ui");
      this.afterMeta("Loadout updated");
    } else audio.play("deny");
  }

  spendPull() {
    if (!consumePull(this.profile)) {
      audio.play("deny");
      return;
    }
    const rolled = rollModule(this.profile);
    audio.play("claim");
    this.afterMeta(rolled.item ? `Acquired ${rolled.item}` : "+50 scrap (duplicate)");
  }

  claimMissionId(id: string) {
    const r = claimMission(this.profile, id);
    if (!r) {
      audio.play("deny");
      return;
    }
    audio.play("claim");
    this.afterMeta(rewardLabel(r));
    this.track("mission_claim", { id, reward: r.type });
  }

  claimPassLevel(level: number) {
    const r = claimPass(this.profile, level);
    if (!r) {
      audio.play("deny");
      return;
    }
    audio.play("claim");
    this.afterMeta(rewardLabel(r));
    this.track("battlepass_claim", { level, reward: r.type });
  }

  /** The "premium_pass_s1" IAP's parallel reward track — additive on top of
   *  the free one above, never a replacement for it. */
  claimPremiumPassLevel(level: number) {
    if (!this.entitlements.has("premium_pass_s1")) {
      audio.play("deny");
      return;
    }
    const track = PREMIUM_PASS_TRACK.find((t) => t.level === level);
    if (!track || passLevel(this.profile.battlePassXP) < level) {
      audio.play("deny");
      return;
    }
    if (this.profile.premiumPassClaimed.includes(level)) {
      audio.play("deny");
      return;
    }
    this.profile.premiumPassClaimed.push(level);
    grantReward(this.profile, track.reward);
    audio.play("claim");
    this.afterMeta(rewardLabel(track.reward));
    this.track("premium_pass_claim", { level, reward: track.reward.type });
  }

  /** Redirects to Stripe Checkout for the given product. */
  async startCheckout(product: IapProductKey) {
    try {
      const { url } = await createIapCheckoutSession({ data: product });
      this.track("iap_checkout_start", { product });
      window.location.href = url;
    } catch (err) {
      audio.play("deny");
      useGame
        .getState()
        .toast(
          "Checkout unavailable",
          err instanceof Error ? err.message : "Try again later",
          "danger",
        );
    }
  }

  private async refreshEntitlements() {
    // No backend auth on portals that require their own SDK login (e.g. CrazyGames).
    if (this.portal === "crazygames") return;
    // Never grant into a profile the cloud merge is about to discard.
    await this.cloudSyncSettled;
    try {
      const keys = await getEntitlements();
      this.entitlements = new Set(keys);
      if (
        this.entitlements.has("starter_pack") &&
        !this.profile.consumedStarterPack &&
        !this.starterPackGrantedThisSession
      ) {
        // Set the session flag first (synchronously) so a concurrent call that
        // passes the profile check while we're still in this continuation can't
        // also enter this block.  The profile flag guards against cross-session
        // regrant; the session flag guards against regrant after a cloud-sync
        // merge replaces this.profile with a cloud copy that hasn't pushed the
        // consumedStarterPack flag yet.
        this.starterPackGrantedThisSession = true;
        this.profile.consumedStarterPack = true;
        this.profile.bankScrap += 500;
        this.profile.inventoryPulls += 2;
        this.profile.pendingRareUpgrades += 1;
        this.flushProfile();
        useGame.getState().toast("Starter Pack", "+500 scrap, 2 pulls, 1 rare token", "ok");
      }
      useGame.getState().patch({ entitlements: [...this.entitlements] });
      this.syncHud();
    } catch {
      /* signed out, or offline — entitlements stay empty */
    }
  }

  /** Resolves when `p` settles or after `ms`, whichever comes first. Used to
   *  bound how long an unanswered SDK call can hold an in-flight ad flag. */
  private static settleWithin(p: Promise<unknown>, ms: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout>;
    return Promise.race([
      p.then(
        () => {},
        () => {},
      ),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
      }),
    ]).finally(() => clearTimeout(timer));
  }

  /** Interstitial ad break, skipped entirely for a "remove_ads" owner —
   *  rewarded placements (showRewardedAd) are player-initiated and stay on
   *  regardless, since players choose those for a bonus.
   *
   *  A break requested while one is already showing is dropped, not queued:
   *  back-to-back interstitials are poor UX and every portal rate-limits them
   *  anyway, so the second ad would most likely no-op after having stalled
   *  the player twice.
   *
   *  Dropping the ad must not drop the gameplay *signal*, though. Every
   *  adapter's `commercialBreak()` ends with `gameplayStart()`, so a break
   *  still in flight when the run ended (endWave's break, then failRun a beat
   *  later) would tell the portal gameplay had resumed while the game-over
   *  card is up. Re-assert the real state once the break settles rather than
   *  trusting whichever call happened to finish last. */
  private maybeCommercialBreak() {
    if (this.entitlements.has("remove_ads")) return;
    if (this.adBreakActive) return;
    this.adBreakActive = true;
    void GameEngine.settleWithin(getAdAdapter().commercialBreak(), GameEngine.AD_FLAG_TTL_MS).then(
      () => {
        this.adBreakActive = false;
        if (this.phase !== "combat" || this.paused) getAdAdapter().gameplayStop();
      },
    );
  }

  doPrestige() {
    if (!prestige(this.profile)) {
      audio.play("deny");
      return;
    }
    audio.play("clear");
    this.afterMeta("Prestige +5 skill points");
    this.track("prestige", { level: this.profile.prestigeLevel });
  }

  claimCrate() {
    const r = claimDailyCrate(this.profile);
    if (!r) {
      audio.play("deny");
      return;
    }
    audio.play("claim");
    useGame.getState().patch({ crateReady: false });
    this.afterMeta(rewardLabel(r));
    this.track("daily_crate_claim", { reward: r.type, streak: this.profile.loginStreak });
  }

  buy(item: ShopItem) {
    if (!buyShop(this.profile, item)) {
      audio.play("deny");
      return;
    }
    audio.play("claim");
    this.afterMeta(`Purchased ${item.title}`);
    this.track("shop_purchase", { itemId: item.id, cost: item.cost });
  }

  // --- Rewarded-ad placements ---------------------------------------------
  // Every placement amplifies a reward the player can already earn for
  // free — never gates content behind an ad. Eligibility is checked before
  // showing the ad so we never spend an impression on nothing to grant.

  async watchReviveAd() {
    if (
      this.phase !== "gameOver" ||
      this.reviveAdUsed ||
      this.coreHP > 0 ||
      this.adBonusInFlight.has("revive")
    ) {
      audio.play("deny");
      return;
    }
    this.adBonusInFlight.add("revive");
    try {
      const result = await this.showAd("revive");
      if (result !== "granted") return;
      // Re-check after the await: the run can have ended, been retried, or
      // been revived by the emergency patch while the ad was on screen.
      // Reviving twice would re-run queueWave below, refilling the spawn
      // queue on top of the enemies already on the field.
      if (this.phase !== "gameOver" || this.reviveAdUsed || this.coreHP > 0) return;
      this.reviveAdUsed = true;
      this.coreHP = Math.max(this.coreHP, 8);
      this.maxCore = Math.max(this.maxCore, this.coreHP);
      this.phase = "combat";
      this.sim.queueWave(waveComposition(this.wave));
      this.eventLog = "Ad revive: core restored.";
      audio.play("upgrade");
      this.flushProfile();
      this.persistRun();
      this.syncHud();
      getAdAdapter().gameplayStart();
      this.track("ad_reward_granted", { placement: "revive", wave: this.wave });
    } finally {
      this.adBonusInFlight.delete("revive");
    }
  }

  async claimCrateBonusAd() {
    const today = dayStamp();
    if (
      this.profile.dailyCrateDay !== today ||
      this.profile.dailyCrateAdBonusDay === today ||
      this.adBonusInFlight.has("crate_double")
    ) {
      audio.play("deny");
      return;
    }
    this.adBonusInFlight.add("crate_double");
    try {
      const result = await this.showAd("crate_double");
      if (result !== "granted") return;
      const r = claimDailyCrateAdBonus(this.profile);
      if (!r) return;
      audio.play("claim");
      this.afterMeta(`Bonus: ${rewardLabel(r)}`);
      this.track("ad_reward_granted", { placement: "crate_double" });
    } finally {
      this.adBonusInFlight.delete("crate_double");
    }
  }

  async claimMissionBonusAd(id: string) {
    const placementId = `mission_double:${id}`;
    const m = this.profile.missions.find((x) => x.id === id);
    if (!m || !m.claimed || m.adBoosted || this.adBonusInFlight.has(placementId)) {
      audio.play("deny");
      return;
    }
    this.adBonusInFlight.add(placementId);
    try {
      const result = await this.showAd(placementId);
      if (result !== "granted") return;
      const r = claimMissionAdBonus(this.profile, id);
      if (!r) return;
      audio.play("claim");
      this.afterMeta(`Bonus: ${rewardLabel(r)}`);
      this.track("ad_reward_granted", { placement: "mission_double" });
    } finally {
      this.adBonusInFlight.delete(placementId);
    }
  }

  async claimPassBonusAd() {
    const today = dayStamp();
    if (this.profile.dailyPassAdBonusDay === today || this.adBonusInFlight.has("pass_xp_bonus")) {
      audio.play("deny");
      return;
    }
    this.adBonusInFlight.add("pass_xp_bonus");
    try {
      const result = await this.showAd("pass_xp_bonus");
      if (result !== "granted") return;
      const amount = claimPassAdBonus(this.profile);
      if (amount == null) return;
      audio.play("claim");
      this.afterMeta(`+${amount} pass XP`);
      this.track("ad_reward_granted", { placement: "pass_xp_bonus" });
    } finally {
      this.adBonusInFlight.delete("pass_xp_bonus");
    }
  }

  async claimShopBonusAd() {
    const today = dayStamp();
    if (this.profile.dailyShopAdBonusDay === today || this.adBonusInFlight.has("shop_free_item")) {
      audio.play("deny");
      return;
    }
    this.adBonusInFlight.add("shop_free_item");
    try {
      const result = await this.showAd("shop_free_item");
      if (result !== "granted") return;
      const item = claimShopAdBonus(this.profile);
      if (!item) return;
      audio.play("claim");
      this.afterMeta(`Free: ${item.title}`);
      this.track("ad_reward_granted", { placement: "shop_free_item" });
    } finally {
      this.adBonusInFlight.delete("shop_free_item");
    }
  }

  private async showAd(placementId: string): Promise<AdResult> {
    this.track("ad_requested", { placement: placementId });
    // Bounded so an SDK that never answers can't leave the caller awaiting
    // forever with the placement's in-flight flag latched on. A late "granted"
    // after this point is lost, which costs the player nothing they had —
    // the reward was never applied — and the placement stays claimable.
    const result = await Promise.race([
      getAdAdapter()
        .showRewardedAd(placementId)
        .catch((): AdResult => "unavailable"),
      new Promise<AdResult>((resolve) =>
        setTimeout(() => resolve("unavailable"), GameEngine.AD_FLAG_TTL_MS),
      ),
    ]);
    if (result !== "granted") {
      audio.play("deny");
      if (result === "unavailable") {
        useGame.getState().toast("Ad unavailable", "Try again in a moment", "info");
      }
    }
    return result;
  }

  finishTutorial() {
    this.profile.tutorialDone = true;
    this.flushProfile();
    useGame.getState().patch({ tutorialStep: 0, briefing: false, profile: this.profile });
    this.track("tutorial_complete");
  }

  setSetting<K extends keyof PlayerProfile>(key: K, value: PlayerProfile[K]) {
    this.profile[key] = value;
    this.renderer.reduced = this.profile.reducedMotion;
    audio.configure({
      musicOn: this.profile.musicEnabled,
      sfxOn: this.profile.sfxEnabled,
      musicVol: this.profile.musicVol,
      sfxVol: this.profile.sfxVol,
    });
    this.flushProfile();
    this.syncHud();
  }

  downloadSave() {
    const json = exportProfileJson(this.profile);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `neon-td-save-${this.profile.displayName}.json`;
    a.click();
    URL.revokeObjectURL(url);
    audio.play("claim");
  }

  importSave(raw: string) {
    const next = importProfileJson(raw);
    if (!next) {
      audio.play("deny");
      useGame.getState().toast("Import failed", "File was not a valid operator save", "danger");
      return;
    }
    this.profile = next;
    this.flushProfile();
    this.syncHud();
    audio.play("claim");
    useGame.getState().toast("Save loaded", "Operator profile restored", "ok");
  }

  pointer(sx: number, sy: number, kind: "move" | "down") {
    const coord = this.renderer.screenToCell(sx, sy, this.sim.map);
    this.renderer.hover = coord;
    if (kind === "down" && coord) this.handleTile(coord);
  }

  private step(dt: number) {
    if (this.phase === "combat" && !this.paused) {
      this.acc += dt * this.speed;
      let n = 0;
      while (this.acc >= 1 / 60 && n < 8) {
        this.tick(1 / 60);
        this.acc -= 1 / 60;
        n++;
      }
      if (n === 8) this.acc = 0;
    }
    this.renderer.reduced = this.profile.reducedMotion || !this.profile.shakeEnabled;
    if (this.phase === "combat" || this.phase === "upgrade" || this.phase === "gameOver") {
      this.renderer.draw(this.sim, dt, {
        selected: this.selectedCoord,
        hoverKind: this.selectedTower,
        paused: this.paused,
        canPlace: true,
        mods: this.mods,
      });
    }
    if (performance.now() - this.persistAt > 400) {
      this.syncHudLight();
      this.persistAt = performance.now();
    }
  }

  private tick(dt: number) {
    const equipped = new Set(this.profile.equippedModules);
    const result = this.sim.tick(
      dt,
      this.wave,
      this.profile.difficulty,
      this.mods,
      equipped.has("targetingAI"),
      () => this.rng.nextFloat(),
    );
    if (result.scrap) this.scrap += result.scrap;
    if (result.coreHeal) {
      // Clamp to maxCore — no ratchet. The old `maxCore = max(maxCore,
      // coreHP)` right after the clamp undid the clamp on the very next
      // line, letting coreOnKill (e.g. PHOENIX) grow max core without
      // bound over a long run. Only startingCore()/the repair line below
      // are allowed to raise maxCore now.
      this.coreHP = Math.min(this.maxCore, this.coreHP + result.coreHeal);
    }
    if (result.kills.length) {
      progressMission(this.profile, "Eliminate", result.kills.length);
      this.profile.lifetimeKills += result.kills.length;
      this.runKills += result.kills.length;
    }
    for (const ev of result.events) {
      if (ev.t === "fire") {
        const sfx = {
          pulse: "shoot-pulse",
          beam: "shoot-beam",
          nova: "shoot-nova",
          tesla: "shoot-tesla",
        } as const;
        audio.play(sfx[ev.kind]);
      }
      if (ev.t === "hit") {
        this.renderer.float(ev.x, ev.y, `${Math.round(ev.dmg)}`, "#e8eef4");
      }
      if (ev.t === "execute") {
        this.renderer.float(ev.x, ev.y, "EXEC", "#5dffb0");
        audio.play("kill");
      }
      if (ev.t === "kill") {
        audio.play("kill");
        const col = ev.kind === "boss" ? "#ff4d6d" : "#3ee8ff";
        this.renderer.burst(ev.x, ev.y, col, ev.kind === "boss" ? 22 : 10, 70);
        this.renderer.addTrauma(ev.kind === "boss" ? 0.45 : 0.12);
        this.maybeDropGlyph(ev.kind);
        if (ev.kind === "boss") {
          // Guaranteed reward on top of killBounty's normal payout and the
          // 100%-chance glyph drop already in maybeDropGlyph — bosses are
          // meant to be the reliable source of a big scrap swing, not a
          // relief wave.
          const bonus = 80 + this.wave * 2;
          this.scrap += bonus;
          useGame.getState().toast("Boss down", `+${bonus} scrap`, "ok");
        }
      }
      if (ev.t === "leak") {
        audio.play("leak");
        this.renderer.flash = 1;
        this.renderer.addTrauma(0.55);
        this.eventLog = `Core -${ev.dmg}`;
      }
    }
    if (result.coreDamage > 0) {
      this.coreHP -= result.coreDamage;
      if (this.coreHP <= 0) {
        this.coreHP = 0;
        this.failRun();
        return;
      }
    }
    if (this.sim.waveCleared()) this.endWave();
  }

  private beginWave() {
    this.sim.resetCombatants();
    this.sim.queueWave(waveComposition(this.wave));
    this.sim.spawnCooldown = 0; // first enemy of new wave spawns immediately — no visible gap
    const income = (this.inRun.income ?? 0) * IN_RUN.income.step;
    if (income) this.scrap += income;
    if (this.mods.corePerWave > 0) {
      // Clamp to maxCore, no ratchet — see the tick() coreHeal comment
      // above. A cipher with corePerWave (BULWARK/FORTITUDE/LAST WISH)
      // otherwise grew max core without bound over a long run.
      const heal = Math.floor(this.mods.corePerWave);
      this.coreHP = Math.min(this.maxCore, this.coreHP + heal);
    }
    this.eventLog = `Wave ${this.wave} incoming.`;
  }

  private endWave() {
    if (this.phase !== "combat") return;
    const clearedWave = this.wave;
    progressMission(this.profile, "Clear", 1);
    this.checkMilestones();
    this.endless = true;
    this.profile.isEndlessUnlocked = true;
    this.maybeDropChassis();
    this.rng = new SplitMix64(this.seed + clearedWave * 997);
    this.offers = this.sim.makeOffers(clearedWave, this.rng);
    if (this.profile.pendingRareUpgrades > 0) {
      this.offers.unshift(this.sim.injectRareOffer(clearedWave));
    }
    this.noteWave(clearedWave);
    // Was `Math.floor(clearedWave / 5)` points on EVERY clear — +50 points
    // for a single wave-250 clear against a 40-point total skill tree. Flat
    // rate now: exactly 1 point every 5th wave, however high the wave count
    // climbs. Same story for pass XP below (was `clearedWave * 8`, +2000 XP
    // for one wave-250 clear against a 30-level/3000-XP pass).
    if (clearedWave % 5 === 0) this.profile.skillPoints += 1;
    this.profile.battlePassXP += Math.round(Math.min(80, 8 + clearedWave * 0.3));
    // No upgrade-screen pause — next wave starts immediately, offers float over HUD
    this.wave += 1;
    this.eventLog = `Wave ${clearedWave} cleared. Wave ${this.wave} incoming.`;
    audio.play("clear");
    this.renderer.addTrauma(0.2);
    this.beginWave();
    if (this.wave % 10 === 0) {
      useGame
        .getState()
        .toast(
          `WAVE ${this.wave} — BOSS INCOMING`,
          "A Prime unit is inbound. Guaranteed reward on the kill.",
          "danger",
        );
    } else {
      useGame.getState().toast(`Wave ${this.wave}`, "Enemies incoming — game never pauses", "info");
    }
    this.flushProfile();
    this.persistRun();
    this.syncHud();
    if (!this.profile.tutorialDone) {
      useGame.getState().patch({ tutorialStep: 3 });
      this.track("tutorial_step", { step: 3 });
    }
    this.track("wave_cleared", { wave: clearedWave, difficulty: this.profile.difficulty });
    this.maybeCommercialBreak();
  }

  private failRun() {
    if (this.phase === "gameOver") return;
    this.noteWave(this.wave);
    this.phase = "gameOver";
    this.eventLog = `Core breached on wave ${this.wave}.`;
    this.profile.lastRecap = this.makeRecap("death");
    audio.play("gameover");
    this.flushProfile();
    this.persistRun();
    this.syncHud();
    getAdAdapter().gameplayStop();
    this.maybeCommercialBreak();
  }

  private checkMilestones() {
    for (const m of MILESTONES) {
      if (m.wave !== this.wave || this.claimed.has(m.wave)) continue;
      this.claimed.add(m.wave);
      if (m.reward.type === "currency") this.scrap += m.reward.amount;
      else if (m.reward.type === "gachaPull") {
        this.profile.inventoryPulls += 1;
        this.rollDrop();
      } else if (m.reward.type === "rareUpgrade") this.profile.pendingRareUpgrades += 1;
      this.eventLog = `Milestone wave ${m.wave} claimed.`;
      useGame.getState().toast("Milestone", rewardLabel(m.reward), "ok");
      this.track("milestone_claim", { wave: m.wave, reward: m.reward.type });
    }
  }

  private rollDrop() {
    const rolled = rollModule(this.profile);
    if (rolled.item) {
      this.eventLog = `Module acquired.`;
      useGame.getState().toast("Module drop", rolled.item, "ok");
    } else {
      this.scrap += 50;
    }
  }

  private inspect(coord: GridCoord): string {
    const t = this.sim.towerAt(coord);
    if (!t) return this.eventLog;
    const cost = this.sim.rankUpCost(coord);
    const sell = this.sim.sellRefund(coord) ?? 0;
    return `${TOWER[t.kind].label} R${t.rank}  next ${cost ?? "MAX"}  sell ${sell}`;
  }

  private persistRun() {
    const snap: RunSnapshot = {
      schemaVersion: SCHEMA,
      seed: this.seed,
      wave: this.wave,
      phase: this.phase,
      coreHP: this.coreHP,
      scrap: this.scrap,
      claimedMilestones: [...this.claimed],
      isEndlessUnlocked: this.endless,
      difficulty: this.profile.difficulty,
      towers: this.sim.towers.map((t) => ({
        kind: t.kind,
        coord: t.coord,
        rank: t.rank,
        invested: t.invested,
      })),
      runDamageBonus: this.sim.runDamageBonus,
      runRangeBonus: this.sim.runRangeBonus,
      runFireRateBonus: this.sim.runFireRateBonus,
      runBountyBonus: this.sim.runBountyBonus,
      corePatchUsed: this.corePatchUsed,
      reviveAdUsed: this.reviveAdUsed,
      inRun: { ...this.inRun },
      runKills: this.runKills,
    };
    saveRun(snap);
  }

  private refreshMods() {
    const run = {
      damage:
        (1 + damageBonus(this.profile) + this.sim.runDamageBonus) *
          (1 + (this.inRun.dmg ?? 0) * IN_RUN.dmg.step) -
        1,
      range:
        (1 + rangeBonus(this.profile) + this.sim.runRangeBonus) *
          (1 + (this.inRun.rng ?? 0) * IN_RUN.rng.step) -
        1,
      fireRate:
        (1 + fireRateBonus(this.profile) + this.sim.runFireRateBonus) *
          (1 + (this.inRun.rate ?? 0) * IN_RUN.rate.step) -
        1,
      bounty:
        bountyBonus(this.profile) +
        this.sim.runBountyBonus +
        (this.inRun.bounty ?? 0) * IN_RUN.bounty.step,
    };
    const { mods, cipher } = loadoutMods(this.profile, run);
    this.mods = mods;
    this.cipherName = cipher?.name ?? null;
  }

  private noteWave(wave: number) {
    this.profile.highestWaveReached = Math.max(this.profile.highestWaveReached, wave);
    const d = this.profile.difficulty;
    this.profile.highestByDifficulty[d] = Math.max(this.profile.highestByDifficulty[d] ?? 0, wave);
  }

  private settleRun(reason: "death" | "cashout" | "abort") {
    if (this.settled) return;
    this.settled = true;
    this.noteWave(this.wave);
    this.profile.totalRunsCompleted += 1;
    this.profile.isEndlessUnlocked = true;
    const recap = this.makeRecap(reason);
    this.profile.lastRecap = recap;
    this.profile.bankScrap += recap.banked;
    clearRun();
    this.flushProfile();
    this.track("run_end", {
      reason,
      wave: this.wave,
      difficulty: this.profile.difficulty,
      kills: recap.kills,
      bankedScrap: recap.banked,
    });
    const title =
      reason === "cashout" ? "Coins banked" : reason === "abort" ? "Run aborted" : "Core offline";
    useGame
      .getState()
      .toast(
        title,
        `+${recap.banked} coins · wave ${this.wave}`,
        reason === "death" ? "danger" : "ok",
      );
    if (this.dailyChallengeDay) {
      const day = this.dailyChallengeDay;
      const wave = this.wave;
      this.dailyChallengeDay = null;
      // Skip leaderboard submission on portals without backend auth (e.g.
      // CrazyGames), and on a tamper-flagged profile (hand-edited save, or
      // dev mode ever having been enabled — see meta.ts loadProfile) so an
      // unlimited-resources testing run can never poison the shared board.
      if (this.portal !== "crazygames" && !this.profile.tamperFlag) {
        submitDailyScore({ data: { day, wave, displayName: this.profile.displayName } })
          .then(() => this.track("daily_challenge_submit", { day, wave }))
          .catch(() => {
            /* offline / server hiccup — the run still counted locally */
          });
      }
    }
  }

  private makeRecap(reason: "death" | "cashout" | "abort"): RunRecap {
    const diff = DIFFICULTY_MOD[this.profile.difficulty];
    const mult = (reason === "abort" ? 0.5 : 1) * diff.reward * (1 + coinBonus(this.profile));
    const raw = this.wave * 12 + this.runKills * 0.4 + this.scrap * 0.12;
    const banked = Math.max(0, Math.floor(raw * mult));
    const ch = equippedChassis(this.profile);
    const word = ch ? matchCipher(ch.sockets) : null;
    return {
      wave: this.wave,
      difficulty: this.profile.difficulty,
      banked,
      glyphs: [...this.runGlyphs],
      chassis: this.runChassisDrop,
      kills: this.runKills,
      cipherName: word?.name ?? this.cipherName,
    };
  }

  private maybeDropGlyph(kind: "bit" | "virus" | "tank" | "boss") {
    const drop = (1 + dropBonus(this.profile)) * DIFFICULTY_MOD[this.profile.difficulty].drop;
    const chance = kind === "boss" ? 1 : kind === "tank" ? 0.1 * drop : 0.022 * drop;
    if (this.rng.nextFloat() > chance) return;
    const g = pickGlyph(this.wave, () => this.rng.nextFloat());
    addGlyph(this.profile, g);
    this.runGlyphs.push(g);
    useGame.getState().toast("Glyph drop", g.toUpperCase(), "ok");
  }

  private maybeDropChassis() {
    const kind = pickChassis(this.wave, () => this.rng.nextFloat());
    if (!kind) return;
    this.profile.chassis.push(emptyChassis(kind));
    this.runChassisDrop = kind;
    useGame.getState().toast("Chassis recovered", kind, "ok");
  }

  /** Analytics, gated on the save-integrity flag (see meta.ts) — a
   *  hand-edited save is excluded so its numbers don't skew the funnel. */
  private track(event: string, props: EventProps = {}) {
    if (this.profile.tamperFlag) return;
    track(event, props);
  }

  private afterMeta(msg: string) {
    this.flushProfile();
    this.syncHud();
    useGame.getState().toast("Ops", msg, "ok");
  }

  private flushProfile() {
    const unlocked = checkAchievements(this.profile);
    saveProfile(this.profile);
    // No cloud push on portals without backend auth (e.g. CrazyGames); localStorage is the save.
    if (this.portal !== "crazygames") schedulePush(this.profile);
    for (const a of unlocked) {
      useGame.getState().toast(a.title, a.detail, "ok");
    }
  }

  private syncHud() {
    const s = useGame.getState();
    s.patch({
      phase: this.phase,
      wave: this.wave,
      scrap: this.scrap,
      bankScrap: this.profile.bankScrap,
      coreHP: this.coreHP,
      maxCore: this.maxCore,
      paused: this.paused,
      speed: this.speed,
      selectedTower: this.selectedTower,
      selectedCoord: this.selectedCoord,
      eventLog: this.eventLog,
      offers: this.offers,
      pendingRare: this.profile.pendingRareUpgrades,
      pulls: this.profile.inventoryPulls,
      skillPoints: this.profile.skillPoints,
      difficulty: this.profile.difficulty,
      hasSavedRun: !!loadRun(),
      profile: { ...this.profile, missions: this.profile.missions.map((m) => ({ ...m })) },
      enemiesAlive: this.sim.enemies.length,
      pendingSpawns: this.sim.pendingSpawns(),
      inspectText: this.selectedCoord ? this.inspect(this.selectedCoord) : "",
      endless: true,
      inRun: { ...this.inRun },
      cipherName: this.cipherName,
      upgradesOpen: this.upgradesOpen,
      recap: this.profile.lastRecap,
      ...this.bossStatus(),
    });
  }

  private syncHudLight() {
    if (this.phase !== "combat") return;
    useGame.getState().patch({
      scrap: this.scrap,
      coreHP: this.coreHP,
      enemiesAlive: this.sim.enemies.length,
      pendingSpawns: this.sim.pendingSpawns(),
      eventLog: this.eventLog,
      ...this.bossStatus(),
    });
  }

  /** Aggregate HP fraction across all alive bosses, for the HUD boss health
   *  bar (see the "Boss + guaranteed reward" wave design). Throttled the
   *  same as the rest of syncHudLight (every ~400ms), which is plenty for a
   *  DOM-rendered bar next to a canvas that redraws every frame on its own. */
  private bossStatus(): { bossActive: boolean; bossHpFrac: number } {
    let hp = 0;
    let maxHp = 0;
    for (const e of this.sim.enemies) {
      if (e.kind !== "boss" || !e.alive) continue;
      hp += Math.max(0, e.health);
      maxHp += e.maxHealth;
    }
    return { bossActive: maxHp > 0, bossHpFrac: maxHp > 0 ? hp / maxHp : 1 };
  }
}

let engine: GameEngine | null = null;
export function getEngine() {
  return engine;
}
export function bindEngine(e: GameEngine) {
  engine = e;
  if (typeof window !== "undefined") {
    (window as unknown as { __neonTD: GameEngine }).__neonTD = e;
  }
}
