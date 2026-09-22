// Regression tests for the save-integrity guard and the save migrations
// around it. These exist because the dev-mode exclusion is a *hard*
// constraint (see CLAUDE.md): there is a real shared daily leaderboard, and
// a profile that ever took a dev grant must never be able to submit to it.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { defaultProfile, difficultyUnlocked, highestUnlockedDifficulty } from "./types.ts";
import { exportProfileJson, importProfileJson } from "./meta.ts";

describe("save-integrity guard: dev-mode taint survives a round trip", () => {
  it("a clean profile exports and re-imports unflagged", () => {
    const p = defaultProfile();
    p.bankScrap = 4200;
    const back = importProfileJson(exportProfileJson(p));
    assert.ok(back, "export should re-import");
    assert.equal(back.tamperFlag, false, "an untouched save must not be flagged");
    assert.equal(back.bankScrap, 4200);
  });

  it("a devUnlockAll save re-imports flagged", () => {
    const p = defaultProfile();
    p.devUnlockAll = true;
    const back = importProfileJson(exportProfileJson(p));
    assert.ok(back);
    assert.equal(back.tamperFlag, true);
  });

  it("stripping devUnlockAll from the JSON does NOT launder the save clean", () => {
    // The whole exclusion mechanism hangs off this single persisted field, so
    // deleting it by hand used to produce a still-valid checksum and a clean
    // profile. The field is now inside the hashed summary when set, so
    // removing it breaks the checksum and the flag comes back via the
    // mismatch branch instead.
    const p = defaultProfile();
    p.devUnlockAll = true;
    const raw = JSON.parse(exportProfileJson(p)) as Record<string, unknown>;
    delete raw.devUnlockAll;
    const back = importProfileJson(JSON.stringify(raw));
    assert.ok(back);
    assert.equal(back.devUnlockAll, false, "the field really is gone");
    assert.equal(back.tamperFlag, true, "but the save is still flagged");
  });

  it("editing a currency field still trips the checksum", () => {
    const p = defaultProfile();
    const raw = JSON.parse(exportProfileJson(p)) as Record<string, unknown>;
    raw.bankScrap = 999_999;
    const back = importProfileJson(JSON.stringify(raw));
    assert.ok(back);
    assert.equal(back.tamperFlag, true);
  });

  it("keeps the pre-taint hash format for saves that never used dev mode", () => {
    // Guards the back-compat property the conditional marker exists for: if
    // the dev marker ever becomes unconditional, every already-deployed
    // save's checksum stops verifying and the entire install base gets
    // tamper-flagged (and silently dropped from the leaderboard) on upgrade.
    // A clean profile's checksum must therefore not depend on the marker.
    const clean = defaultProfile();
    const alsoClean = defaultProfile();
    alsoClean.devUnlockAll = false;
    assert.equal(
      JSON.parse(exportProfileJson(clean)).checksum,
      JSON.parse(exportProfileJson(alsoClean)).checksum,
    );
  });
});

describe("difficulty migration", () => {
  it("clamps a stored tier the current unlock rules no longer grant", () => {
    // Pre-rebalance saves unlocked tiers off a global highestWaveReached
    // threshold (insane at 50), so a real save can sit on a tier that the
    // per-tier highestByDifficulty gate doesn't grant.
    const p = defaultProfile();
    p.difficulty = "insane";
    p.highestWaveReached = 60;
    p.highestByDifficulty = {};
    const back = importProfileJson(exportProfileJson(p));
    assert.ok(back);
    assert.equal(difficultyUnlocked(back, "insane"), false);
    assert.equal(back.difficulty, "normal", "must not stay on a locked tier");
  });

  it("leaves a legitimately unlocked tier alone", () => {
    const p = defaultProfile();
    p.difficulty = "hard";
    p.highestByDifficulty = { normal: 100 };
    const back = importProfileJson(exportProfileJson(p));
    assert.ok(back);
    assert.equal(back.difficulty, "hard");
  });

  it("highestUnlockedDifficulty walks up only as far as the records allow", () => {
    const p = defaultProfile();
    assert.equal(highestUnlockedDifficulty(p), "normal");
    p.highestByDifficulty = { normal: 100 };
    assert.equal(highestUnlockedDifficulty(p), "hard");
    p.highestByDifficulty = { normal: 100, hard: 100, nightmare: 100 };
    assert.equal(highestUnlockedDifficulty(p), "insane");
  });
});
