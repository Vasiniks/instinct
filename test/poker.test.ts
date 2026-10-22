import assert from "node:assert/strict";
import { test } from "node:test";
import { pAtLeast } from "../src/cards.ts";
import { NO_RULES, estimateScore, evaluateHand, type Joker } from "../src/poker.ts";
import { pcs } from "./helpers.ts";

const ctx = (jokers: Joker[] = [], handsLeft = 4, discardsLeft = 3) => ({ levels: {}, jokers, held: [], rules: NO_RULES, handsLeft, discardsLeft });
const j = (key: string, stats: Record<string, number> = {}, index = 0): Joker => ({ index, key, label: key, effect: "", stats, debuff: false, eternal: false, sell: 1 });

test("detects every vanilla hand", () => {
  const cases: [string, string][] = [
    ["AS", "High Card"],
    ["AS AH", "Pair"],
    ["AS AH KS KH", "Two Pair"],
    ["AS AH AD", "Three of a Kind"],
    ["2S 3H 4D 5C 6S", "Straight"],
    ["AS 2H 3D 4C 5S", "Straight"],
    ["TS JH QD KC AS", "Straight"],
    ["2H 7H 9H JH KH", "Flush"],
    ["AS AH AD KS KH", "Full House"],
    ["AS AH AD AC", "Four of a Kind"],
    ["9H TH JH QH KH", "Straight Flush"],
    ["AS AH AD AC AS", "Five of a Kind"],
    ["AH AH AH KH KH", "Flush House"],
    ["AH AH AH AH AH", "Flush Five"],
  ];
  for (const [codes, hand] of cases) assert.equal(evaluateHand(pcs(codes)).hand, hand, codes);
});

test("a wrap-around is not a straight", () => {
  assert.equal(evaluateHand(pcs("QS KH AD 2C 3S")).hand, "High Card");
});

test("only the pair scores in a pair hand, stones always score", () => {
  const ev = evaluateHand(pcs("AS AH 7D KD:STONE"));
  assert.equal(ev.hand, "Pair");
  assert.deepEqual(ev.scoring.map((c) => c.index), [0, 1, 3]);
});

test("wild cards complete flushes", () => {
  assert.equal(evaluateHand(pcs("2H 7H 9H JH KS:WILD")).hand, "Flush");
});

test("four fingers makes four-card flushes and straights", () => {
  const rules = { ...NO_RULES, fourFingers: true };
  assert.equal(evaluateHand(pcs("2H 7H 9H JH"), rules).hand, "Flush");
  assert.equal(evaluateHand(pcs("5S 6H 7D 8C"), rules).hand, "Straight");
});

test("base score of a pair of aces is (10 + 22) x 2", () => {
  assert.equal(estimateScore(pcs("AS AH"), ctx()).score, 64);
});

test("conditional jokers only fire on matching hands", () => {
  const jolly = [j("j_jolly", { mult: 8 })];
  assert.equal(estimateScore(pcs("AS AH"), ctx(jolly)).score, 32 * 10);
  assert.equal(estimateScore(pcs("AS"), ctx(jolly)).score, 16 * 1);
});

test("glass doubles mult, red seal retriggers, polychrome joker multiplies at the end", () => {
  const glass = pcs("AS:GLASS AH");
  assert.equal(estimateScore(glass, ctx()).score, 32 * 4);
  const sealed = pcs("AS AH");
  sealed[0].seal = "RED";
  assert.equal(estimateScore(sealed, ctx()).score, (10 + 33) * 2);
  const poly = { ...j("j_joker", { mult: 4 }), edition: "POLYCHROME" };
  assert.equal(estimateScore(pcs("AS AH"), ctx([poly])).score, Math.floor(32 * 6 * 1.5));
});

test("unknown jokers fall back to their live stats and mark the estimate approximate", () => {
  const e = estimateScore(pcs("AS AH"), ctx([j("j_cry_mystery", { x_mult: 3 })]));
  assert.equal(e.score, 32 * 6);
  assert.equal(e.approximate, true);
});

test("blueprint copies the joker to its right", () => {
  const e = estimateScore(pcs("AS AH"), ctx([j("j_blueprint", {}, 0), j("j_duo", { x_mult: 2 }, 1)]));
  assert.equal(e.score, 32 * 2 * 2 * 2);
});

test("hypergeometric draw odds", () => {
  assert.equal(pAtLeast(1, 5, 10, 0), 0);
  assert.equal(pAtLeast(0, 5, 10, 3), 1);
  // One club among 10 cards, draw 5: exactly 50%.
  assert.ok(Math.abs(pAtLeast(1, 5, 10, 1) - 0.5) < 1e-9);
});
