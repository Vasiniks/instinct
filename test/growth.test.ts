import assert from "node:assert/strict";
import { test } from "node:test";
import { extract } from "../src/extract.ts";
import { projectJokers, roundsTo, smallBigBlinds } from "../src/growth.ts";
import { deckCounts, estimateScore, NO_RULES, type Joker } from "../src/poker.ts";
import { roundOdds, roundResources } from "../src/round.ts";
import type { RawCard } from "../src/types.ts";
import { handState, joker, pcs, raw } from "./helpers.ts";

const J = (key: string, stats: Record<string, number> = {}, extra: Partial<Joker> = {}): Joker => ({ index: 0, key, label: key, effect: "", stats, debuff: false, eternal: false, sell: 2, ...extra });
const cues = { faceShare: 0.23, luckyShare: 0, glassShare: 0, enhancedShare: 0 };

test("growing jokers are forecast at what they become; decaying ones at what they keep", () => {
  const [green, ice, gros, constellation] = projectJokers([J("j_green_joker"), J("j_ice_cream"), J("j_gros_michel"), J("j_constellation", { x_mult: 1.4 })], 6, cues);
  assert.equal(green.stats.mult, 12, "a fresh Green Joker: +2 Mult a round");
  assert.equal(ice.stats.chips, 10, "Ice Cream loses 15 Chips a round from 100");
  assert.ok(Math.abs(gros.stats.mult - 15 * (5 / 6) ** 6) < 1e-9, "Gros Michel: its Mult times the chance it survives");
  assert.ok(Math.abs(constellation.stats.x_mult - 2) < 1e-9, "an owned Constellation grows from its live value");
  // At 0 rounds an offered copy only gets its starting value.
  assert.equal(projectJokers([J("j_popcorn")], 0, cues)[0].stats.mult, 20);
  // A Straight build feeds Runner faster than any other.
  const straight = projectJokers([J("j_runner")], 3, { ...cues, faceShare: 0.2, mostPlayed: "Straight" })[0].stats.chips;
  const pairs = projectJokers([J("j_runner")], 3, { ...cues, faceShare: 0.2, mostPlayed: "Pair" })[0].stats.chips;
  assert.ok(straight > pairs);
});

test("Lucky Cat, Glass Joker and Vampire grow only on the cards they feed on", () => {
  const keys = ["j_lucky_cat", "j_glass", "j_vampire"];
  const bare = projectJokers(keys.map((k) => J(k)), 6, cues).map((j) => j.stats.x_mult);
  assert.deepEqual(bare, [1, 1, 1], "a deck without Lucky, Glass or enhanced cards grows none of them");
  const fed = projectJokers(keys.map((k) => J(k)), 6, { ...cues, luckyShare: 0.1, glassShare: 0.1, enhancedShare: 0.2 }).map((j) => j.stats.x_mult);
  assert.ok(fed.every((x) => x > 1), `with the cards they grow: ${fed.join(", ")}`);
});

test("rounds ahead count the blinds left this ante, then three a round per ante", () => {
  const s = extract(handState(["AS"]));
  s.blinds = [
    { type: "SMALL", status: "DEFEATED", name: "Small Blind", effect: "", target: 300 },
    { type: "BIG", status: "UPCOMING", name: "Big Blind", effect: "", target: 450 },
    { type: "BOSS", status: "UPCOMING", name: "The Hook", effect: "", target: 600 },
  ];
  assert.equal(roundsTo(s, 0), 1);
  assert.equal(roundsTo(s, 2), 7);
});

test("round resources from jokers: hand size, hands and discards", () => {
  assert.deepEqual(roundResources([J("j_juggler"), J("j_drunkard")]), { hands: 0, discards: 1, handSize: 1, noDiscards: false });
  const burglar = roundResources([J("j_burglar"), J("j_troubadour")]);
  assert.deepEqual([burglar.hands, burglar.handSize, burglar.noDiscards], [2, 2, true]);
  // In a tight round, Juggler's extra card beats the blind more often.
  const deck = [..."23456789TJQKA"].flatMap((r) => [..."SHDC"].map((su) => `${r}${su}`));
  const g = handState([], { deck });
  g.state = "SHOP";
  const s = extract(g);
  const [plain, juggler] = roundOdds(s, [{ jokers: [], levels: s.levels }, { jokers: [J("j_juggler")], levels: s.levels }], 900, 3, 1, 80);
  assert.ok(juggler >= plain, `${juggler} vs ${plain}`);
});

test("deck-counting jokers and Mime score from the deck and the cards held", () => {
  const ctx = { levels: {}, jokers: [] as Joker[], held: [], rules: NO_RULES, handsLeft: 4, discardsLeft: 3 };
  const pair = pcs("KS KH");
  const steelDeck = pcs("2S:STEEL 3S:STEEL 4S:STEEL 5S:STEEL 6S:STEEL 7S 8S 9S");
  const steel = estimateScore(pair, { ...ctx, jokers: [J("j_steel_joker")], deck: deckCounts(steelDeck, 8) });
  assert.equal(steel.mult, 2 * 2, "five Steel cards: X2");
  const bull = estimateScore(pair, { ...ctx, jokers: [J("j_bull")], money: 20 });
  assert.equal(bull.chips, 30 + 40);
  // Mime retriggers a held Steel King under Baron: X1.5 x X1.5, twice over.
  const held = pcs("KD:STEEL");
  const baron = estimateScore(pcs("2S 2H"), { ...ctx, held, jokers: [J("j_baron")] });
  const mime = estimateScore(pcs("2S 2H"), { ...ctx, held, jokers: [J("j_baron"), { ...J("j_mime"), index: 1 }] });
  assert.ok(Math.abs(mime.mult / baron.mult - 2.25) < 0.01, `${baron.mult} -> ${mime.mult}`);
});

test("an offered Green Joker is worth something in the shop's boss forecast", async () => {
  const { buildCandidates } = await import("../src/candidates.ts");
  const deck = [..."23456789TJQKA"].flatMap((r) => [..."SHDC"].map((su) => `${r}${su}`));
  const g = handState([], { deck, jokers: [{ ...joker("j_joker", { mult: 4 }), id: 900 }] });
  g.state = "SHOP";
  g.ante_num = 2;
  g.blinds = { small: { type: "SMALL", status: "UPCOMING", name: "Small Blind", effect: "", score: 800 } };
  const offer: RawCard = { id: 501, key: "j_green_joker", set: "JOKER", label: "Green Joker", value: { effect: "", rarity: "COMMON" }, modifier: {}, state: {}, cost: { buy: 4, sell: 2 } };
  g.shop = { count: 1, limit: 2, cards: [offer] };
  const buy = buildCandidates(extract(g), { endless: false, maxOptions: 24 }).candidates.find((c) => c.label.startsWith("Buy Green Joker"))!;
  const m = /beaten ([\d%/]+) now, ([\d%/]+) with it/.exec(buy.description);
  assert.ok(m, buy.description);
  const now = m![1].split("/").map((x) => Number.parseInt(x, 10));
  const withIt = m![2].split("/").map((x) => Number.parseInt(x, 10));
  assert.ok(withIt.some((w, k) => w > now[k]), `bosses ${now.join("/")}% now, ${withIt.join("/")}% with it`);
  void raw;
});

test("a Perishable joker is debuffed at a boss past its rounds; Turtle Bean shrinks a card a round", () => {
  const [kept, gone] = projectJokers([J("j_joker", { mult: 4 }, { perishable: 5 }), J("j_joker", { mult: 4 }, { perishable: 2 })], 3, cues);
  assert.equal(kept.debuff, false);
  assert.equal(gone.debuff, true);
  assert.equal(projectJokers([J("j_turtle_bean", { h_size: 4 })], 3, cues)[0].stats.h_size, 1);
  assert.equal(roundResources(projectJokers([J("j_turtle_bean")], 7, cues)).handSize, 0);
});

test("Madness grows per Small and Big Blind and eats the jokers beside it, Eternal ones spared", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(smallBigBlinds), [0, 1, 2, 2, 3, 4]);
  assert.equal(projectJokers([J("j_madness")], 5, cues)[0].stats.x_mult, 3);
  const deck = [..."23456789TJQKA"].flatMap((r) => [..."SHDC"].map((su) => `${r}${su}`));
  const g = handState([], { deck });
  g.state = "SHOP";
  const s = extract(g);
  const cav = (eternal: boolean) => ({ ...J("j_cavendish", { x_mult: 3 }), eternal });
  const odds = (eternal: boolean) => roundOdds(s, [{ jokers: [cav(eternal)], levels: s.levels }, { jokers: [cav(eternal), { ...J("j_madness"), index: 1 }], levels: s.levels }], 1400, 4, 3, 80, undefined, 3);
  const [alone, withMadness] = odds(false);
  assert.ok(withMadness < alone, `Madness destroys the Cavendish: ${withMadness} vs ${alone}`);
  const [eternalAlone, eternalWith] = odds(true);
  assert.ok(eternalWith > eternalAlone, `an Eternal Cavendish stays: ${eternalWith} vs ${eternalAlone}`);
});

test("Ancient Joker and The Idol score from this round's picks", () => {
  const ctx = { levels: {}, jokers: [J("j_ancient")], held: [], rules: NO_RULES, handsLeft: 4, discardsLeft: 3 };
  const flush = pcs("2S 5S 7S 9S JS");
  const spades = estimateScore(flush, { ...ctx, roundCards: { ancientSuit: "S" } });
  const hearts = estimateScore(flush, { ...ctx, roundCards: { ancientSuit: "H" } });
  const unknown = estimateScore(flush, ctx);
  assert.ok(Math.abs(spades.mult / hearts.mult - 1.5 ** 5) < 0.01, `${spades.mult} vs ${hearts.mult}`);
  assert.ok(unknown.mult > hearts.mult && unknown.mult < spades.mult, "unknown: the expectation");
  const idol = estimateScore(pcs("QH QD"), { ...ctx, jokers: [J("j_idol")], roundCards: { idolRank: "Q", idolSuit: "H" } });
  const plain = estimateScore(pcs("QH QD"), { ...ctx, jokers: [] });
  assert.equal(idol.mult, plain.mult * 2);
  // The live picks come through the snapshot.
  const g = handState(["AS"]);
  g.round = { ...g.round, ancient_suit: "D", idol_rank: "10", idol_suit: "C" };
  assert.deepEqual(extract(g).roundCards, { ancientSuit: "D", idolRank: "T", idolSuit: "C" });
});

test("scaling jokers score with this hand's step, from the value the mod reports before it", () => {
  const ctx = { levels: {}, jokers: [] as Joker[], held: [], rules: NO_RULES, handsLeft: 4, discardsLeft: 3 };
  const pair = pcs("2S 2H");
  const one = (j: Joker, cards = pair, extra = {}) => estimateScore(cards, { ...ctx, jokers: [j], ...extra });
  const plain = one(J("j_joker", { mult: 0 })).mult;
  assert.equal(one(J("j_green_joker", { mult: 3 })).mult, plain + 4);
  assert.equal(one(J("j_ride_the_bus", { mult: 6 }), pcs("KS KH")).mult, plain, "a scoring face card resets it before it scores");
  assert.equal(one(J("j_ride_the_bus", { mult: 6 })).mult, plain + 7);
  assert.equal(one(J("j_bootstraps", { mult: 2 }), pair, { money: 25 }).mult, plain + 10, "the mod reports the rate");
  assert.equal(one(J("j_loyalty_card", { loyalty_remaining: 0, loyalty_every: 5, loyalty_x_mult: 4 })).mult, plain * 4);
  assert.equal(one(J("j_loyalty_card", { loyalty_remaining: 3, loyalty_every: 5, loyalty_x_mult: 4 })).mult, plain);
  const levels = { Pair: { level: 1, chips: 10, mult: 2, played: 5, played_this_round: 0 }, Flush: { level: 1, chips: 35, mult: 4, played: 2, played_this_round: 0 } };
  assert.equal(one(J("j_obelisk", { x_mult: 2 }), pair, { levels }).mult, plain, "the most played hand resets it");
  assert.equal(one(J("j_supernova"), pair, { levels }).mult, plain + 6, "this hand counts");
});
