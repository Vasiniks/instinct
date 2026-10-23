import assert from "node:assert/strict";
import { test } from "node:test";
import type { CandidateSet } from "../src/candidates.ts";
import { applyPolicy } from "../src/policy.ts";
import type { ChoiceAnswer } from "../src/systemone.ts";

const gates = { noneThreshold: 0.2, minConfidence: 0.55 };
const cand = (id: string, utility: number) => ({ id, kind: "play", label: id, description: id, call: { method: "play" }, utility, prior: 0.5 });
const set: CandidateSet = { phase: "SELECTING_HAND", candidates: [cand("a", 0.2), cand("b", 0.9)] };
const answer = (choice: string | null, confidence: number, none = 0.01): ChoiceAnswer => ({ type: "choice", choice, confidence, probabilities: { a: 0.5, b: 0.5 }, none_probability: none });

test("confident answers act on the model's pick", () => {
  const v = applyPolicy(answer("a", 0.8), set, gates, "fallback");
  assert.equal(v.status, "ACT");
  assert.equal(v.chosen, "a");
  assert.equal(v.source, "model");
});

test("low confidence goes to review and the fallback takes the heuristic pick", () => {
  const v = applyPolicy(answer("a", 0.3), set, gates, "fallback");
  assert.equal(v.status, "REVIEW");
  assert.equal(v.chosen, "b");
  assert.equal(v.source, "fallback");
});

test("high none_probability abstains even when confident", () => {
  assert.equal(applyPolicy(answer("a", 0.9, 0.25), set, gates, "fallback").status, "ABSTAIN");
});

test("a null choice abstains", () => {
  assert.equal(applyPolicy(answer(null, 0.9), set, gates, "fallback").status, "ABSTAIN");
});

test("pause mode leaves the decision to a human", () => {
  const v = applyPolicy(answer("a", 0.3), set, gates, "pause");
  assert.equal(v.chosen, undefined);
});

test("model mode trusts the pick through the review gate", () => {
  const v = applyPolicy(answer("a", 0.3), set, gates, "model");
  assert.equal(v.status, "REVIEW");
  assert.equal(v.chosen, "a");
});

test("blend mode multiplies the model's probabilities by the code's priors", () => {
  const priced: CandidateSet = { phase: "SHOP", candidates: [{ ...cand("leave", 0.5), prior: 0.6 }, { ...cand("pack", 0.42), prior: 0.4 }] };
  const ask = (pLeave: number, conf: number): ChoiceAnswer => ({ type: "choice", choice: pLeave > 0.5 ? "leave" : "pack", confidence: conf, probabilities: { leave: pLeave, pack: 1 - pLeave } });
  // The model leans to the pack strongly enough to outweigh the code's lean to leaving.
  const v = applyPolicy(ask(0.2, 0.8), priced, gates, "blend");
  assert.deepEqual([v.status, v.chosen, v.source], ["ACT", "pack", "model"]);
  // A weak lean doesn't: 0.45 x 0.6 beats 0.55 x 0.4.
  const w = applyPolicy(ask(0.45, 0.3), priced, gates, "blend");
  assert.deepEqual([w.status, w.chosen, w.source], ["REVIEW", "leave", "blend"]);
  // An abstention still takes the code's pick.
  assert.equal(applyPolicy({ ...ask(0.2, 0.9), none_probability: 0.4 }, priced, gates, "blend").chosen, "leave");
});

test("cloud answers without none_probability still pass the gate", () => {
  const cloud: ChoiceAnswer = { type: "choice", choice: "a", confidence: 0.9, probabilities: { a: 0.95, b: 0.05 } };
  assert.equal(applyPolicy(cloud, set, gates, "fallback").status, "ACT");
});
