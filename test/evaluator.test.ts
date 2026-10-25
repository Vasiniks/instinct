// The fast evaluator (src/poker.ts) against the plain one it replaced: the same hand, the same
// scoring cards in the same order, the same hands contained, on random hands under every rule.
import assert from "node:assert/strict";
import { test } from "node:test";
import { RANKS, SUITS, rankValue, type PCard } from "../src/cards.ts";
import { evaluateHand, suitsOf, type Evaluation, type HandName, type Rules } from "../src/poker.ts";

type Evaluation_ = Evaluation;
const NO_RULES: Rules = { fourFingers: false, shortcut: false, smeared: false, splash: false, pareidolia: false };

function oldFindFlush(cards: PCard[], rules: Rules): PCard[] | null {
  const need = rules.fourFingers ? 4 : 5;
  let best: PCard[] | null = null;
  for (const s of SUITS) {
    const members = cards.filter((c) => suitsOf(c, rules).includes(s));
    if (members.length >= need && (!best || members.length > best.length)) best = members;
  }
  return best;
}

function oldFindStraight(cards: PCard[], rules: Rules): PCard[] | null {
  const need = rules.fourFingers ? 4 : 5;
  const maxGap = rules.shortcut ? 2 : 1;
  const ranked = cards.filter((c) => c.rank);
  const values = new Set<number>();
  for (const c of ranked) {
    const v = rankValue(c.rank!);
    values.add(v);
    if (v === 14) values.add(1);
  }
  const sorted = [...values].sort((a, b) => a - b);
  let run: number[] = [];
  let best: number[] = [];
  for (const v of sorted) {
    if (run.length && v - run[run.length - 1] <= maxGap) run.push(v);
    else run = [v];
    if (run.length > best.length) best = [...run];
  }
  if (best.length < need) return null;
  const inRun = new Set(best.map((v) => (v === 1 ? 14 : v)));
  return ranked.filter((c) => inRun.has(rankValue(c.rank!)));
}

function oldEvaluateHand(cards: PCard[], rules: Rules = NO_RULES): Evaluation_ {
  const ranked = cards.filter((c) => c.rank);
  const byRank = new Map<string, PCard[]>();
  for (const c of ranked) byRank.set(c.rank!, [...(byRank.get(c.rank!) ?? []), c]);
  const groups = [...byRank.values()].sort((a, b) => b.length - a.length || rankValue(b[0].rank!) - rankValue(a[0].rank!));
  const top = groups[0]?.length ?? 0;
  const second = groups[1]?.length ?? 0;
  const flush = oldFindFlush(cards, rules);
  const straight = oldFindStraight(cards, rules);

  const contains = new Set<HandName>(["High Card"]);
  if (top >= 2) contains.add("Pair");
  if (top >= 2 && second >= 2) contains.add("Two Pair");
  if (top >= 3) contains.add("Three of a Kind");
  if (top >= 4) contains.add("Four of a Kind");
  if (top >= 5) contains.add("Five of a Kind");
  if (top >= 3 && second >= 2) contains.add("Full House");
  if (flush) contains.add("Flush");
  if (straight) contains.add("Straight");
  if (flush && straight) contains.add("Straight Flush");

  const union = (...sets: PCard[][]) => cards.filter((c) => sets.some((s) => s.includes(c)));
  let hand: HandName;
  let scoring: PCard[];
  if (top >= 5 && flush) [hand, scoring] = ["Flush Five", union(groups[0], flush)];
  else if (top >= 3 && second >= 2 && flush) [hand, scoring] = ["Flush House", union(groups[0], groups[1], flush)];
  else if (top >= 5) [hand, scoring] = ["Five of a Kind", groups[0]];
  else if (straight && flush) [hand, scoring] = ["Straight Flush", union(straight, flush)];
  else if (top >= 4) [hand, scoring] = ["Four of a Kind", groups[0]];
  else if (top >= 3 && second >= 2) [hand, scoring] = ["Full House", union(groups[0], groups[1])];
  else if (flush) [hand, scoring] = ["Flush", flush];
  else if (straight) [hand, scoring] = ["Straight", straight];
  else if (top >= 3) [hand, scoring] = ["Three of a Kind", groups[0]];
  else if (top >= 2 && second >= 2) [hand, scoring] = ["Two Pair", union(groups[0], groups[1])];
  else if (top >= 2) [hand, scoring] = ["Pair", groups[0]];
  else {
    const high = [...ranked].sort((a, b) => rankValue(b.rank!) - rankValue(a.rank!))[0];
    [hand, scoring] = ["High Card", high ? [high] : []];
  }
  contains.add(hand);

  if (rules.splash) scoring = [...cards];
  else {
    const stones = cards.filter((c) => c.enhancement === "STONE" && !scoring.includes(c));
    if (stones.length) scoring = union(scoring, stones);
  }
  return { hand, scoring, contains };
}


function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

test("the fast evaluator gives the same hand, scoring cards and contained hands as the plain one", () => {
  const rand = rng(12345);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  for (let n = 0; n < 40000; n++) {
    const size = 1 + Math.floor(rand() * 8);
    const cards: PCard[] = Array.from({ length: size }, (_, i) => {
      const r = rand();
      const enhancement = r < 0.06 ? "WILD" : r < 0.1 ? "STONE" : r < 0.13 ? "GLASS" : undefined;
      // Narrow rank and suit pools now and then, so pairs, flushes and straights come up often.
      const ranks = rand() < 0.3 ? RANKS.slice(0, 6) : rand() < 0.3 ? ["T", "J", "Q", "K", "A", "2", "3", "4", "5"] : RANKS;
      const suits = rand() < 0.3 ? SUITS.slice(0, 1) : SUITS;
      const hidden = rand() < 0.03;
      return { index: i, id: i, rank: hidden ? undefined : (pick(ranks) as string), suit: hidden ? undefined : (pick(suits) as string), enhancement, debuff: rand() < 0.05, hidden, forced: false, label: "" } as PCard;
    });
    const rules: Rules = { fourFingers: rand() < 0.3, shortcut: rand() < 0.3, smeared: rand() < 0.3, splash: rand() < 0.15, pareidolia: false };
    const a = evaluateHand(cards, rules);
    const b = oldEvaluateHand(cards, rules);
    const show = () => `${cards.map((c) => `${c.rank}${c.suit}${c.enhancement ? `:${c.enhancement}` : ""}`).join(" ")} ${JSON.stringify(rules)}`;
    assert.equal(a.hand, b.hand, show());
    assert.deepEqual(a.scoring.map((c) => c.id), b.scoring.map((c) => c.id), show());
    assert.deepEqual([...a.contains], [...b.contains], show());
  }
});
