// The calls the user made watching live play: copy jokers always, Spectral packs, Verdant Leaf,
// xMult after +Mult, Baron with Mime, no Planet loop on a hand never played.
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCandidates } from "../src/candidates.ts";
import { extract } from "../src/extract.ts";
import type { RawCard } from "../src/types.ts";
import { handState, joker } from "./helpers.ts";

const opts = { endless: false, maxOptions: 24 };
const deck = [..."23456789TJQKA"].flatMap((r) => [..."SHDC"].map((su) => `${r}${su}`));
const named = (key: string, label: string, id: number, stats: Record<string, number> = {}): RawCard => ({ ...joker(key, stats), id, label });
const offer = (key: string, label: string, id: number, buy: number, set = "JOKER", rarity = "RARE"): RawCard => ({ id, key, set, label, value: { effect: "", rarity }, modifier: {}, state: {}, cost: { buy, sell: Math.floor(buy / 2) } });

function shop(jokers: RawCard[], cards: RawCard[], money = 30, packs: RawCard[] = []) {
  const g = handState([], { deck, jokers });
  g.state = "SHOP";
  g.ante_num = 3;
  g.money = money;
  g.blinds = { small: { type: "SMALL", status: "UPCOMING", name: "Small Blind", effect: "", score: 1200 } };
  g.shop = { count: cards.length, limit: 2, cards };
  g.packs = { count: packs.length, limit: 2, cards: packs };
  return buildCandidates(extract(g), opts).candidates;
}

test("Blueprint is bought over everything else, and sold for nothing", () => {
  const cands = shop([named("j_joker", "Joker", 901, { mult: 4 }), named("j_jolly", "Jolly Joker", 902)], [offer("j_blueprint", "Blueprint", 501, 10), offer("j_sly", "Sly Joker", 502, 3, "JOKER", "COMMON")]);
  assert.equal(cands[0].label, "Buy Blueprint ($10)", cands.slice(0, 3).map((c) => `${c.label} ${c.utility.toFixed(2)}`).join("; "));
  // Short of money with a free slot: sell the weakest joker to afford it.
  const short = shop([named("j_joker", "Joker", 901, { mult: 4 }), named("j_jolly", "Jolly Joker", 902)], [offer("j_blueprint", "Blueprint", 501, 10)], 9);
  assert.ok(short.some((c) => /^Sell .*, buy Blueprint$/.test(c.label)), short.map((c) => c.label).join("; "));
});

test("a Spectral pack is worth opening with money in hand", () => {
  const cands = shop([named("j_joker", "Joker", 901, { mult: 4 })], [], 30, [{ id: 601, key: "p_spectral_normal_1", set: "BOOSTER", label: "Spectral Pack", value: { effect: "" }, modifier: {}, state: {}, cost: { buy: 4, sell: 0 } }]);
  const spectral = cands.find((c) => c.label.startsWith("Buy Spectral Pack"));
  const leave = cands.find((c) => c.label === "Leave shop")!;
  assert.ok(spectral && spectral.utility > leave.utility, cands.map((c) => `${c.label} ${c.utility.toFixed(2)}`).join("; "));
});

test("Baron is worth more with Mime held", () => {
  const value = (held: RawCard[]) => shop(held, [offer("j_baron", "Baron", 501, 8)]).find((c) => c.label.startsWith("Buy Baron"))?.utility ?? 0;
  assert.ok(value([named("j_mime", "Mime", 901)]) > value([named("j_joker", "Joker", 901, { mult: 4 })]) + 0.3);
});

test("xMult jokers go after +Mult ones", () => {
  const cands = shop([named("j_duo", "The Duo", 901), named("j_jolly", "Jolly Joker", 902), named("j_joker", "Joker", 903, { mult: 4 })], []);
  const order = cands.find((c) => c.kind === "rearrange");
  assert.ok(order && /The Duo$/.test(order.label), cands.map((c) => c.label).join("; "));
});

test("Verdant Leaf: with the hand debuffed, the only move is selling the weakest joker", () => {
  const g = handState(["AS", "KS", "QH", "9D", "9C", "4S", "3H", "2D"], { deck, jokers: [named("j_joker", "Joker", 901, { mult: 4 }), named("j_duo", "The Duo", 902)] });
  g.blinds = { boss: { type: "BOSS", status: "CURRENT", name: "Verdant Leaf", effect: "All cards debuffed until 1 Joker sold", score: 3000 } };
  for (const c of g.hand!.cards) c.state = { debuff: true };
  const cands = buildCandidates(extract(g), opts).candidates;
  assert.equal(cands.length, 1);
  assert.match(cands[0].label, /^Sell .* to lift Verdant Leaf$/);
});

test("direction: Neutral without a strong lean; a Lucky Cat makes it a Lucky run", async () => {
  const { directionOf } = await import("../src/direction.ts");
  const base = handState([], { deck, jokers: [named("j_joker", "Joker", 901, { mult: 4 })] });
  assert.equal(directionOf(extract(base)).theme, "Neutral");
  const lucky = directionOf(extract(handState([], { deck, jokers: [named("j_lucky_cat", "Lucky Cat", 901)] })));
  assert.equal(lucky.theme, "Lucky cards");
  assert.ok(lucky.tarots.includes("The Magician") && lucky.jokers.includes("Oops! All 6s"));
  // One suit joker alone is no flush plan; with a flush payoff it is.
  assert.equal(directionOf(extract(handState([], { deck, jokers: [named("j_wrathful_joker", "Wrathful Joker", 901)] }))).theme, "Neutral");
  const spades = directionOf(extract(handState([], { deck, jokers: [named("j_wrathful_joker", "Wrathful Joker", 901), named("j_tribe", "The Tribe", 902)] })));
  assert.equal(spades.theme, "Spades flush");
  assert.ok(spades.tarots.includes("The World") && !spades.jokers.includes("The Tribe"));
});
