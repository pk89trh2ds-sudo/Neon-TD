// Regression tests for the difficulty-rebalance pass: the enemy-scaling
// curve, boss-wave HP invariant, and the economy bugs that made income-only
// play trivially win a 250-wave run. See docs/balance.md for the full
// analysis these numbers come from.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DIFFICULTIES,
  DIFFICULTY_UNLOCK_WAVE,
  ENEMY,
  bossHealthMultiplier,
  defaultProfile,
  difficultyUnlocked,
  endlessScaling,
  enemyHealth,
  killBounty,
  type DifficultyTier,
  type EnemyKind,
} from "./types.ts";
import { waveComposition } from "./sim.ts";
import { IN_RUN, inRunAtCap, inRunCost, inRunEffect } from "./workshop.ts";

describe("endlessScaling", () => {
  it("is monotonically non-decreasing", () => {
    let prev = 0;
    for (let w = 1; w <= 300; w++) {
      const v = endlessScaling(w);
      assert.ok(v >= prev, `wave ${w}: ${v} should be >= previous ${prev}`);
      prev = v;
    }
  });

  it("keeps a fresh run's difficulty low early (wave 25 stays under 3x)", () => {
    // A player with zero permanent progression should not survive much past
    // this without real towers — the old curve only reached 4.3x by wave 25.
    assert.ok(endlessScaling(25) < 3, `wave 25 scaling was ${endlessScaling(25)}`);
  });

  it("is meaningfully steeper than the pre-rebalance curve by wave 100", () => {
    const oldScaling = (wave: number) => {
      const early = 1 + Math.log(Math.max(wave, 1)) * 0.48;
      const late = wave <= 40 ? 0 : Math.pow((wave - 40) / 16, 1.28);
      return early + late;
    };
    assert.ok(
      endlessScaling(100) > oldScaling(100) * 1.5,
      `new ${endlessScaling(100)} vs old ${oldScaling(100)}`,
    );
    assert.ok(
      endlessScaling(200) > oldScaling(200) * 1.5,
      `new ${endlessScaling(200)} vs old ${oldScaling(200)}`,
    );
  });
});

describe("bossHealthMultiplier", () => {
  it("grows in steps every 10 waves and never shrinks", () => {
    assert.equal(bossHealthMultiplier(10), 1.15);
    assert.equal(bossHealthMultiplier(19), 1.15);
    assert.equal(bossHealthMultiplier(20), 1.3);
    let prev = 0;
    for (let w = 0; w <= 300; w++) {
      const v = bossHealthMultiplier(w);
      assert.ok(v >= prev);
      prev = v;
    }
  });
});

describe("boss waves are harder than the wave they replace", () => {
  function waveTotalHealth(wave: number, tier: DifficultyTier): number {
    return waveComposition(wave).reduce(
      (sum, [kind, count]) => sum + enemyHealth(kind as EnemyKind, wave, tier) * count,
      0,
    );
  }

  it("every %10 wave from 10 to 250 has more total HP than the wave before it", () => {
    for (let wave = 10; wave <= 250; wave += 10) {
      const bossTotal = waveTotalHealth(wave, "normal");
      const priorTotal = waveTotalHealth(wave - 1, "normal");
      assert.ok(
        bossTotal > priorTotal,
        `wave ${wave} boss total ${bossTotal.toFixed(0)} should exceed wave ${wave - 1}'s ${priorTotal.toFixed(0)}`,
      );
    }
  });

  it("bosses carry a distraction stream of bits, not a diluted wave", () => {
    const comp = waveComposition(50);
    const bits = comp.find(([k]) => k === "bit");
    assert.ok(bits && bits[1] > 0, "boss waves should still spawn bits");
  });
});

describe("killBounty", () => {
  it("scales up with wave (previously flat forever)", () => {
    const early = killBounty("tank", 5, "normal", 0);
    const late = killBounty("tank", 200, "normal", 0);
    assert.ok(late > early * 1.3, `wave-200 bounty ${late} should clearly exceed wave-5 ${early}`);
  });

  it("stays bounded (waveMult caps at 1.5)", () => {
    const v1 = killBounty("tank", 1000, "normal", 0);
    const v2 = killBounty("tank", 5000, "normal", 0);
    assert.equal(v1, v2, "bounty should plateau once the wave multiplier caps");
  });
});

describe("in-run upgrade cost curve (the repair bug)", () => {
  it("repair's cost rises with purchase count, not just wave", () => {
    // This is the core regression: `repair` used to never increment its own
    // counter, so its cost only crept up ~0.6 scrap/wave forever instead of
    // compounding like every other line.
    const cheapEarly = inRunCost(0, "repair", 100);
    const afterTenBuys = inRunCost(10, "repair", 100);
    assert.ok(
      afterTenBuys > cheapEarly * 2,
      `10th repair buy (${afterTenBuys}) should cost well more than the 1st (${cheapEarly})`,
    );
  });

  it("no in-run line is capped below its mechanical limit (cap policy)", () => {
    // Every cap that exists must be justified by a mechanic: crit chance can't
    // exceed 1.0, multishot targets are bounded, etc. Income/bounty must be
    // uncapped (the old policy they once enforced is deleted).
    assert.equal(IN_RUN.income.cap, undefined, "income must be uncapped");
    assert.equal(IN_RUN.bounty.cap, undefined, "bounty must be uncapped");
    // Mechanically capped lines: verify their caps are in range and positive.
    assert.ok((IN_RUN.critChance.cap ?? 0) >= 500, "crit chance cap should reach meaningful depth");
    assert.ok((IN_RUN.damageReduction.cap ?? 0) > 0, "damage reduction should have a cap");
    assert.ok((IN_RUN.slow.cap ?? 0) > 0, "slow should have a cap");
    // inRunAtCap correctly gates at the cap boundary.
    assert.equal(inRunAtCap(IN_RUN.critChance.cap!, "critChance"), true, "at cap → capped");
    assert.equal(inRunAtCap((IN_RUN.critChance.cap ?? 1) - 1, "critChance"), false, "one below cap → not capped");
    assert.equal(inRunAtCap(9999, "income"), false, "uncapped line never caps");
  });

  it("multiplicative offense lines stack multiplicatively, not additively", () => {
    // At n=10, (1+step)^10 - 1 must be larger than n*step for multiplicative lines.
    const multResult = inRunEffect(10, "dmg");
    const addResult = 10 * IN_RUN.dmg.step;
    assert.ok(
      multResult > addResult,
      `multiplicative stacking (${multResult.toFixed(4)}) should exceed additive (${addResult.toFixed(4)})`,
    );
    // Non-multiplicative line should be exactly additive.
    const incomeResult = inRunEffect(10, "income");
    assert.equal(incomeResult, 10 * IN_RUN.income.step, "income should stack additively");
  });
});

describe("difficultyUnlocked", () => {
  it("normal is always unlocked", () => {
    const p = defaultProfile();
    assert.equal(difficultyUnlocked(p, "normal"), true);
  });

  it("hard requires wave 100 on normal, not just any global high-water mark", () => {
    const p = defaultProfile();
    p.highestWaveReached = 250; // old gate would have unlocked everything
    p.highestByDifficulty = {};
    assert.equal(
      difficultyUnlocked(p, "hard"),
      false,
      "reaching wave 250 without a normal-difficulty record must not unlock hard",
    );
    p.highestByDifficulty = { normal: DIFFICULTY_UNLOCK_WAVE };
    assert.equal(difficultyUnlocked(p, "hard"), true);
  });

  it("each tier gates on the immediately preceding tier's record", () => {
    const p = defaultProfile();
    p.highestByDifficulty = { normal: 100, hard: 100 };
    assert.equal(difficultyUnlocked(p, "nightmare"), true);
    assert.equal(difficultyUnlocked(p, "insane"), false);
  });

  it("devUnlockAll bypasses every gate", () => {
    const p = defaultProfile();
    p.devUnlockAll = true;
    for (const d of DIFFICULTIES) assert.equal(difficultyUnlocked(p, d), true);
  });
});

describe("ENEMY.boss leak damage", () => {
  it("is a real penalty (12), not the old value that rounded away on lower tiers", () => {
    assert.equal(ENEMY.boss.core, 12);
  });
});
