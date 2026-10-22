import assert from "node:assert/strict";
import { test } from "node:test";
import { RANKS, SUITS } from "../src/cards.ts";
import { buildCandidates } from "../src/candidates.ts";
import { extract } from "../src/extract.ts";
import { applyPolicy } from "../src/policy.ts";
import { buildRequest } from "../src/strategy.ts";
import { handState, joker } from "./helpers.ts";

const opts = { endless: false, maxOptions: 24 };

test("an 8-card hand yields a short list led by the clearing play", () => {
  const s = extract(handState(["AS", "AH", "AD", "KS", "KH", "2C", "7D", "9C"], { remaining: 300 }));
  const set = buildCandidates(s, opts);
  assert.ok(set.candidates.length <= 24);
  const top = [...set.candidates].sort((a, b) => b.utility - a.utility)[0];
  assert.equal(top.kind, "play");
  assert.equal(top.estimate?.hand, "Full House");
  assert.equal(top.estimate?.clears, true);
  assert.deepEqual(top.call, { method: "play", params: { cards: [0, 1, 2, 3, 4] } });
});

test("every play and discard uses valid, unique hand indices within the limit", () => {
  const s = extract(handState(["2S", "5H", "9D", "JC", "QS", "3H", "8D", "KC"], { deck: ["AS", "AH", "4D"] }));
  for (const c of buildCandidates(s, opts).candidates) {
    if (c.kind !== "play" && c.kind !== "discard") continue;
    const idx = c.call.params!.cards as number[];
    assert.ok(idx.length >= 1 && idx.length <= 5, c.id);
    assert.equal(new Set(idx).size, idx.length, c.id);
    assert.ok(idx.every((i) => i >= 0 && i < s.hand.length), c.id);
  }
});

test("a 104-card hand (Perkeo + Cryptid) stays fast and under the 26-option ceiling", () => {
  const codes = [...SUITS.flatMap((s) => RANKS.map((r) => `${r}${s}`)), ...SUITS.flatMap((s) => RANKS.map((r) => `${r}${s}`))];
  const s = extract(handState(codes, { remaining: 5000 }));
  const t0 = performance.now();
  const set = buildCandidates(s, opts);
  const ms = performance.now() - t0;
  assert.ok(ms < 250, `took ${ms.toFixed(1)}ms`);
  assert.ok(set.candidates.length <= 24);
  // Two of each card per suit: five aces beat a royal straight flush.
  const best = set.candidates.find((c) => c.kind === "play")!;
  assert.equal(best.estimate?.hand, "Five of a Kind");
});

test("a raised play limit is respected", () => {
  const s = extract(handState(["AS", "AH", "AD", "AC", "AS", "AH", "AD"], { limit: 7 }));
  const play = buildCandidates(s, opts).candidates.find((c) => c.kind === "play")!;
  assert.equal((play.call.params!.cards as number[]).length, 7);
});

test("flush chase discards off-suit cards and reports draw odds", () => {
  const deck = ["2H", "3H", "4H", "5S", "6S", "7S", "8C", "9C", "TC", "JD"];
  const s = extract(handState(["AH", "KH", "9H", "4H", "2S", "3C", "5D", "7S"], { remaining: 2000, deck }));
  const chase = buildCandidates(s, opts).candidates.find((c) => c.kind === "discard" && c.description.includes("Flush"));
  assert.ok(chase, "expected a flush chase");
  assert.deepEqual(chase.call.params!.cards, [4, 5, 6, 7]);
  assert.match(chase.description, /\d+% chance to draw into Flush/);
});

test("the request carries one choice option per candidate plus value questions", () => {
  const s = extract(handState(["AS", "AH", "KD", "7C", "2D"], { jokers: [joker("j_jolly", { mult: 8 })] }));
  const set = buildCandidates(s, opts);
  const { request } = buildRequest(s, set, "jev-latest");
  assert.equal(request.model, "jev-latest");
  assert.equal(request.questions.action.type, "choice");
  assert.deepEqual(Object.keys(request.questions.action.criteria!), set.candidates.map((c) => c.id));
  assert.equal(request.questions.position.type, "score");
  assert.equal(request.questions.risk.type, "noul");
});

test("cash out is automatic and never asks the model", () => {
  const set = buildCandidates(extract({ state: "ROUND_EVAL", round: { cashout_preview: { total: 9, lines: [] } } }), opts);
  assert.equal(set.auto?.call.method, "cash_out");
  assert.equal(applyPolicy(undefined, set, { noneThreshold: 0.2, minConfidence: 0.55 }, "fallback").status, "AUTO");
});
