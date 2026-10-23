import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCandidates } from "../src/candidates.ts";
import { extract } from "../src/extract.ts";
import { estimateScore, NO_RULES } from "../src/poker.ts";
import { roundOdds, roundOutcomes } from "../src/round.ts";
import type { GameState, RawCard } from "../src/types.ts";
import { handState, joker, pcs, raw } from "./helpers.ts";

const opts = { endless: false, maxOptions: 24 };
const named = (key: string, label: string, stats: Record<string, number> = {}): RawCard => ({ ...joker(key, stats), label });
const heartsDeck = [..."23456789TJQKA"].flatMap((r) => [`${r}H`, `${r}H`, `${r}S`]);

test("Plasma balances chips and mult before they multiply", () => {
  const ctx = { levels: {}, jokers: [], held: [], rules: NO_RULES, handsLeft: 4, discardsLeft: 3 };
  const pair = pcs("KS KH");
  const plain = estimateScore(pair, ctx);
  const plasma = estimateScore(pair, { ...ctx, balanced: true });
  // Pair: 10 + 10 + 10 = 30 chips, 2 mult. Plasma: ((30 + 2) / 2)^2 = 256.
  assert.equal(plain.score, 60);
  assert.equal(plasma.score, 256);
});

test("the round simulation keeps a made flush instead of throwing its cards for a long shot", () => {
  // Hearts flush in hand, a flush-paying joker, two hands for 1500 chips, a deck full of hearts.
  const g = handState(["AH", "KH", "9H", "6H", "3H", "4S", "7C", "2D"], { remaining: 1500, hands: 2, discards: 3, deck: heartsDeck, jokers: [named("j_droll", "Droll Joker")] });
  const s = extract(g);
  const [keep, toss] = roundOutcomes(s, [
    { kind: "play", cards: [0, 1, 2, 3, 4] },
    { kind: "discard", cards: [0, 1, 2, 3] },
  ]);
  assert.ok(keep.clear > toss.clear, `play ${keep.clear} vs discard ${toss.clear}`);
  // The best move keeps the five hearts: play them, or first throw only the junk around them.
  const list = buildCandidates(s, opts).candidates;
  const top = [...list].sort((a, b) => b.utility - a.utility)[0];
  const why = list.map((c) => `${c.label} ${c.utility.toFixed(2)}`).join("; ");
  assert.ok(top.estimate?.hand === "Flush" || (top.kind === "discard" && top.cards!.every((i) => s.hand[i].suit !== "H")), why);
  const flush = list.find((c) => c.estimate?.hand === "Flush")!;
  for (const d of list.filter((c) => c.kind === "discard" && c.cards!.some((i) => s.hand[i].suit === "H"))) assert.ok(d.utility < flush.utility, why);
  assert.match(flush.description, /Simulated \d+ finishes of the round/);
});

test("whole-round odds rank a flush joker above a pair joker on a flush deck, and the shop says so", () => {
  const shop = (offers: RawCard[]): GameState => ({
    state: "SHOP",
    ante_num: 3,
    round_num: 8,
    money: 20,
    bankrupt_at: 0,
    deck: "RED",
    stake: "WHITE",
    seed: "SIM",
    round: { reroll_cost: 5 },
    blinds: { small: { type: "SMALL", status: "UPCOMING", name: "Small Blind", effect: "No special effect", score: 2000 } },
    hand: { count: 0, limit: 8, cards: [] },
    cards: { count: heartsDeck.length, limit: 52, cards: heartsDeck.map((c, i) => raw(c, 100 + i)) },
    jokers: { count: 1, limit: 5, cards: [{ ...named("j_joker", "Joker", { mult: 4 }), id: 900 }] },
    consumables: { count: 0, limit: 2, cards: [] },
    shop: { count: offers.length, limit: 2, cards: offers },
    held_tags_ready: true,
  });
  const offer = (key: string, label: string, id: number): RawCard => ({ id, key, set: "JOKER", label, value: { effect: "", rarity: "COMMON" }, modifier: {}, state: {}, cost: { buy: 5, sell: 2 } });
  const s = extract(shop([offer("j_tribe", "The Tribe", 501), offer("j_jolly", "Jolly Joker", 502)]));
  const base = { jokers: s.jokers, levels: s.levels };
  const tribe = { jokers: [...s.jokers, { ...s.jokers[0], index: 1, key: "j_tribe", label: "The Tribe", stats: {} }], levels: s.levels };
  const jolly = { jokers: [...s.jokers, { ...s.jokers[0], index: 1, key: "j_jolly", label: "Jolly Joker", stats: {} }], levels: s.levels };
  const [now, withTribe, withJolly] = roundOdds(s, [base, tribe, jolly], 4000, 4, 3, 60);
  assert.ok(withTribe > withJolly && withTribe > now, `now ${now}, Tribe ${withTribe}, Jolly ${withJolly}`);
  const list = buildCandidates(s, opts).candidates;
  const buy = (label: string) => list.find((c) => c.label.startsWith(`Buy ${label}`))!;
  assert.ok(buy("The Tribe").utility > buy("Jolly Joker").utility);
  assert.match(buy("The Tribe").description, /Simulated rounds at the bosses of antes 3-5/);
});

test("a masked draw pile becomes the starting deck less the hand, flagged as assumed", () => {
  const g = handState(["AS", "KH", "2C"], { deck: [] });
  g.cards = { count: 49, limit: 52, cards: Array.from({ length: 49 }, (_, i): RawCard => ({ id: 300 + i, key: "", set: "DEFAULT", label: "", value: { effect: "" }, modifier: {}, state: { hidden: true }, cost: { buy: 0, sell: 0 } })) };
  const s = extract(g);
  assert.equal(s.deckKnown, false);
  assert.equal(s.deckLeft.length, 49);
  assert.ok(s.deckLeft.every((c) => c.rank && c.suit && !c.hidden));
  assert.ok(!s.deckLeft.some((c) => c.rank === "A" && c.suit === "S"), "the ace of spades is in hand");
  const shown = extract(handState(["AS"], { deck: ["KH", "2C"] }));
  assert.equal(shown.deckKnown, true);
});

test("between rounds the whole deck is the pile, even when part of it sits in the discard pile", () => {
  const g = handState([], { deck: ["AS", "KH"] });
  g.state = "SHOP";
  const all = [..."23456789TJQKA"].flatMap((r) => [..."SHDC"].map((s) => `${r}${s}`));
  g.full_deck = { count: 52, limit: 52, cards: all.map((c, i) => raw(c, 300 + i)) };
  const s = extract(g);
  assert.equal(s.deckLeft.length, 52);
  assert.equal(s.deckKnown, true);
  // In a hand, the draw pile stays what is left to draw.
  const h = handState(["AS"], { deck: ["KH", "2C"] });
  h.full_deck = g.full_deck;
  assert.equal(extract(h).deckLeft.length, 2);
});
