/**
 * Currency/reward screens reachable from the menu: the Battle Pass, the
 * rotating night-market Shop, the Daily Challenge + its leaderboard, and
 * the cosmetic-only Premium IAP catalog.
 */
import { useEffect, useState } from "react";
import { Play } from "lucide-react";
import { getEngine } from "@/lib/game/engine";
import { SignedIn, SignedOut } from "@/lib/auth/gates";
import { shopForDay } from "@/lib/game/meta";
import { getDailyLeaderboard } from "@/lib/game/leaderboard-api";
import { IAP_CATALOG, IAP_PRODUCT_KEYS } from "@/lib/game/iap-catalog";
import { useGame } from "@/lib/game/store";
import {
  PASS_TRACK,
  PREMIUM_PASS_TRACK,
  dayStamp,
  formatHMS,
  msUntilMidnight,
  passLevel,
  rewardLabel,
} from "@/lib/game/types";
import { Btn, Bar, Panel } from "../ui";
import { Back } from "../common";

export function PassPane() {
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

export function ShopPane() {
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

export function DailyPane() {
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

export function PremiumPane() {
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
