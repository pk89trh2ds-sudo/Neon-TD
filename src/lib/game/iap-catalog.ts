/**
 * Client-safe IAP catalog — labels/copy only, no secrets. The actual Stripe
 * Price ID for each key comes from a server-only env var (see
 * entitlements-api.ts); this file is what the UI renders and what a
 * checkout-session request names.
 *
 * Deliberately excludes anything that sells power: no scrap, no skill
 * points, no Workshop-rank shortcuts. Remove Ads and the Starter Pack are
 * pure convenience/cosmetic-adjacent; the Premium Pass is an *additional*
 * reward track layered on the free one, never a replacement for it.
 */
export type IapProductKey = "remove_ads" | "premium_pass_s1" | "starter_pack";

export const IAP_PRODUCT_KEYS: IapProductKey[] = ["remove_ads", "premium_pass_s1", "starter_pack"];

export const IAP_CATALOG: Record<
  IapProductKey,
  { label: string; blurb: string; priceDisplay: string }
> = {
  remove_ads: {
    label: "Remove Ads",
    blurb:
      "Permanently disables interstitial ad breaks on this account. Rewarded ads you choose to watch for bonuses are unaffected.",
    priceDisplay: "$4.99",
  },
  premium_pass_s1: {
    label: "Premium Battle Pass",
    blurb:
      "Unlocks a parallel reward track for every tier of this season's free pass — the free track keeps paying out exactly as before.",
    priceDisplay: "$7.99",
  },
  starter_pack: {
    label: "Starter Pack",
    blurb: "A one-time bundle: 500 scrap, 2 module pulls, and a rare overclock token.",
    priceDisplay: "$2.99",
  },
};
