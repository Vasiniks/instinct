import assert from "node:assert/strict";
import { test } from "node:test";
import { profileBuild } from "../src/build.ts";
import { buildCandidates } from "../src/candidates.ts";
import { extract } from "../src/extract.ts";
import { jokerTags } from "../src/knowledge.ts";
import { applyBuildAnswer, buildOptions, updatePlan } from "../src/plan.ts";
import type { GameState, RawCard } from "../src/types.ts";
import { handState, joker, raw } from "./helpers.ts";

const opts = { endless: false, maxOptions: 24 };

/** A shop: owned jokers, offered cards, money, and a deck (codes like "AH"). */
function shopState(o: { jokers: RawCard[]; shop?: RawCard[]; money?: number; deck?: string[]; ante?: number; consumables?: RawCard[]; deckName?: string; levels?: GameState["hands"] }): GameState {
  return {
    state: "SHOP",
    ante_num: o.ante ?? 2,
    round_num: 4,
    money: o.money ?? 12,
    bankrupt_at: 0,
    deck: o.deckName ?? "RED",
    stake: "WHITE",
    seed: "TESTSEED",
    round: { reroll_cost: 5 },
    blinds: {
      small: { type: "SMALL", status: "SELECT", name: "Small Blind", effect: "No special effect", score: 800 },
      big: { type: "BIG", status: "UPCOMING", name: "Big Blind", effect: "No special effect", score: 1200 },
      boss: { type: "BOSS", status: "UPCOMING", name: "The Hook", effect: "Discards 2 random cards per hand played", score: 1600 },
    },
    hand: { count: 0, limit: 8, cards: [] },
    cards: { count: 0, limit: 52, cards: (o.deck ?? []).map((c, i) => raw(c, 100 + i)) },
    jokers: { count: o.jokers.length, limit: 5, cards: o.jokers },
    consumables: { count: o.consumables?.length ?? 0, limit: 2, cards: o.consumables ?? [] },
    shop: { count: o.shop?.length ?? 0, limit: 2, cards: o.shop ?? [] },
    hands: o.levels,
    held_tags_ready: true,
  };
}

function offer(key: string, label: string, effect: string, buy: number, rarity = "COMMON"): RawCard {
  return { id: 500, key, set: "JOKER", label, value: { effect, rarity }, modifier: {}, state: {}, cost: { buy, sell: Math.floor(buy / 2) } };
}

const named = (key: string, label: string, effect = "") => ({ ...joker(key), label, value: { effect, stats: {} } });
const heartsDeck = [..."23456789TJQKA"].flatMap((r) => [`${r}H`, `${r}H`]).concat(["2S", "5C", "9D", "KS"]);

test("vanilla jokers are tagged by key, unknown ones from their effect text", () => {
  assert.ok(jokerTags("j_tribe").has("flush") && jokerTags("j_tribe").has("xmult"));
  const modded = jokerTags("j_modded_thing", "X3 Mult if played hand contains a Flush");
  assert.ok(modded.has("xmult") && modded.has("flush"));
});

test("a hearts-heavy deck with flush jokers profiles as a flush build and names the dead joker", () => {
  const s = extract(
    shopState({
      jokers: [named("j_droll", "Droll Joker", "+10 Mult if played hand contains a Flush"), named("j_lusty_joker", "Lusty Joker"), named("j_sly", "Sly Joker", "+50 Chips if played hand contains a Pair")],
      deck: heartsDeck,
      ante: 3,
    }),
  );
  const p = profileBuild(s);
  assert.equal(p.primary.name, "Flush");
  assert.equal(p.deckFix.suit, "H");
  assert.equal(p.weakest?.label, "Sly Joker");
  assert.ok(p.needs.includes("xmult"), `needs: ${p.needs.join(", ")}`);
  assert.ok(p.synergy.active.some((x) => x.startsWith("Droll Joker")));
  assert.ok(p.synergy.dead.some((x) => x.startsWith("Sly Joker")));
});

test("with full slots, a better joker is offered as one move: sell the weakest, then buy", () => {
  const owned = [named("j_droll", "Droll Joker"), named("j_lusty_joker", "Lusty Joker"), named("j_sly", "Sly Joker"), named("j_crafty", "Crafty Joker"), named("j_joker", "Joker")];
  const s = extract(shopState({ jokers: owned, shop: [offer("j_tribe", "The Tribe", "X2 Mult if played hand contains a Flush", 8, "RARE")], deck: heartsDeck, money: 6, ante: 3 }));
  const swap = buildCandidates(s, opts).candidates.find((c) => c.kind === "swap");
  assert.ok(swap, "expected a swap");
  assert.deepEqual(swap.calls, [
    { method: "sell", params: { joker: 2 } },
    { method: "buy", params: { card: 0 } },
  ]);
  assert.match(swap.label, /Sell Sly Joker, buy The Tribe/);
});

test("a deck-fixing Tarot for the build's suit goes before a play that doesn't clear", () => {
  const sun: RawCard = { id: 700, key: "c_sun", set: "TAROT", label: "The Sun", value: { effect: "Converts up to 3 selected cards to Hearts", target_min: 1, target_max: 3 }, modifier: {}, state: {}, cost: { buy: 3, sell: 1 } };
  const g = handState(["AH", "KH", "9H", "4H", "2S", "3C", "5D", "7S"], { remaining: 3000, deck: heartsDeck, jokers: [named("j_droll", "Droll Joker"), named("j_lusty_joker", "Lusty Joker")] });
  g.consumables = { count: 1, limit: 2, cards: [sun] };
  const s = extract(g);
  const list = buildCandidates(s, opts).candidates;
  const use = list.find((c) => c.kind === "use")!;
  const bestPlay = list.filter((c) => c.kind === "play").sort((a, b) => b.utility - a.utility)[0];
  assert.ok(use.utility > bestPlay.utility, `use ${use.utility} vs play ${bestPlay.utility}`);
  for (const i of use.cards!) assert.notEqual(s.hand[i].suit, "H");
});

test("The Ox steers away from the most played hand", () => {
  const g = handState(["AS", "AH", "KD", "KC", "7C", "2D", "9H", "4S"], { remaining: 5000 });
  g.blinds = { boss: { type: "BOSS", status: "CURRENT", name: "The Ox", effect: "Playing a Two Pair sets money to $0", score: 5000 } };
  g.hands = { "Two Pair": { level: 1, chips: 20, mult: 2, played: 9, played_this_round: 0, order: 0, example: [] } } as unknown as GameState["hands"];
  g.money = 30;
  const plays = buildCandidates(extract(g), opts).candidates.filter((c) => c.kind === "play");
  const twoPair = plays.find((c) => c.estimate?.hand === "Two Pair")!;
  const other = plays.find((c) => c.estimate?.hand !== "Two Pair")!;
  assert.ok(twoPair.utility < other.utility);
  assert.match(twoPair.description, /sets money to \$0/);
});

test("the plan holds through small swings, switches on a clear lead, and follows a confident model pivot", () => {
  const flush = extract(shopState({ jokers: [named("j_droll", "Droll Joker"), named("j_tribe", "The Tribe")], deck: heartsDeck }));
  let plan = updatePlan(undefined, flush, profileBuild(flush));
  assert.equal(plan.build, "Flush");
  // One pair joker doesn't outweigh two flush jokers.
  const mixed = extract(shopState({ jokers: [named("j_droll", "Droll Joker"), named("j_tribe", "The Tribe"), named("j_jolly", "Jolly Joker")], deck: heartsDeck }));
  plan = updatePlan(plan, mixed, profileBuild(mixed, plan.build));
  assert.equal(plan.build, "Flush");
  // The model's confident pivot answer moves it.
  const p = profileBuild(mixed, plan.build);
  const options = [...buildOptions(plan, p), { id: "pivot_pair", build: "Pair", why: "test" }];
  plan = applyBuildAnswer(plan, mixed, { type: "choice", choice: "pivot_pair", confidence: 0.7, probabilities: {} }, options);
  assert.equal(plan.build, "Pair");
  assert.equal(plan.pivots.at(-1)?.by, "model");
  // A low-confidence answer does not.
  const kept = applyBuildAnswer(plan, mixed, { type: "choice", choice: "keep", confidence: 0.2, probabilities: {} }, options);
  assert.equal(kept.build, "Pair");
});

test("deck and money set the economy: Green deck spends, a working build saves at the cap", () => {
  const green = profileBuild(extract(shopState({ jokers: [named("j_joker", "Joker")], deckName: "GREEN", money: 30 })));
  assert.equal(green.econ.mode, "spend");
  const full = [named("j_droll", "Droll Joker"), named("j_tribe", "The Tribe"), named("j_lusty_joker", "Lusty Joker"), named("j_crafty", "Crafty Joker"), named("j_joker", "Joker")];
  const saver = profileBuild(extract(shopState({ jokers: full, deck: heartsDeck, money: 30, ante: 3 })));
  assert.equal(saver.econ.mode, "save");
  assert.equal(saver.econ.reserve, 25);
});

test("jokers are reordered so xMult applies after +Mult", () => {
  const s = extract(shopState({ jokers: [named("j_tribe", "The Tribe"), named("j_droll", "Droll Joker")], deck: heartsDeck }));
  const move = buildCandidates(s, opts).candidates.find((c) => c.kind === "rearrange");
  assert.ok(move, "expected a reorder");
  assert.deepEqual(move.call.params, { jokers: [1, 0] });
});
