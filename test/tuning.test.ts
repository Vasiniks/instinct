import assert from "node:assert/strict";
import { test } from "node:test";
import { FEATURES } from "../src/features.ts";
import { TUNING, applyOverrides, loadProfiles, tuningDefaults, useProfile } from "../src/tuning.ts";

test("a run plays the base numbers plus its deck's and its stake's changes, and --set overrides win", () => {
  const base = tuningDefaults();
  loadProfiles({ deck: { GREEN: { interestLoss: -0.03 } }, stake: { GOLD: { rerollCore: 0.05, interestLoss: 0.01 } } });
  useProfile("GREEN", "GOLD");
  assert.equal(TUNING.interestLoss, base.interestLoss - 0.03 + 0.01);
  assert.equal(TUNING.rerollCore, base.rerollCore + 0.05);
  useProfile("GREEN", "WHITE");
  assert.equal(TUNING.interestLoss, base.interestLoss - 0.03);
  assert.equal(TUNING.rerollCore, base.rerollCore);
  useProfile("RED", "WHITE");
  assert.deepEqual({ ...TUNING }, base);

  applyOverrides("rerollCore=0.5", FEATURES as Record<string, boolean>);
  useProfile("GREEN", "GOLD");
  assert.equal(TUNING.rerollCore, 0.5);
  assert.equal(TUNING.interestLoss, base.interestLoss - 0.03 + 0.01);
});
