import assert from "node:assert/strict";
import { test } from "node:test";
import { assess } from "../src/assess.ts";
import { profileBuild } from "../src/build.ts";
import { buildCandidates, invisibleReady } from "../src/candidates.ts";
import { extract } from "../src/extract.ts";
import { FEATURES } from "../src/features.ts";
import type { GameState, RawCard } from "../src/types.ts";
import { joker, raw } from "./helpers.ts";

const opts = { endless: false, maxOptions: 24 };
const named = (key: string, label: string, stats: Record<string, number> = {}, effect = ""): RawCard => ({ ...joker(key, stats), label, value: { effect, stats } });
const evenDeck = [..."23456789TJQKA"].flatMap((r) => [`${r}H`, `${r}S`, `${r}C`, `${r}D`]);
const heartsDeck = [..."23456789TJQKA"].flatMap((r) => [`${r}H`, `${r}H`, `${r}S`, `${r}C`]);

function state(o: { phase?: string; ante?: number; money?: number; jokers: RawCard[]; shop?: RawCard[]; packs?: RawCard[]; pack?: RawCard[]; deck?: string[]; hand?: string[]; consumables?: RawCard[] }): GameState {
  const ante = o.ante ?? 3;
  return {
    state: o.phase ?? "SHOP",
    ante_num: ante,
    round_num: ante * 3,
    money: o.money ?? 30,
    bankrupt_at: 0,
    deck: "RED",
    stake: "WHITE",
    seed: "FIXES",
    round: { reroll_cost: 5 },
    blinds: { small: { type: "SMALL", status: "UPCOMING", name: "Small Blind", effect: "No special effect", score: [0, 300, 800, 2000, 5000, 11000][ante] } },
    hand: { count: o.hand?.length ?? 0, limit: 8, cards: (o.hand ?? []).map((c, i) => raw(c, 50 + i)) },
    cards: { count: (o.deck ?? evenDeck).length, limit: 52, cards: (o.deck ?? evenDeck).map((c, i) => raw(c, 100 + i)) },
    jokers: { count: o.jokers.length, limit: 5, cards: o.jokers.map((j, i) => ({ ...j, id: 900 + i })) },
    consumables: { count: o.consumables?.length ?? 0, limit: 2, cards: o.consumables ?? [] },
    shop: { count: o.shop?.length ?? 0, limit: 2, cards: o.shop ?? [] },
    packs: { count: o.packs?.length ?? 0, limit: 2, cards: o.packs ?? [] },
    ...(o.pack ? { pack: { count: o.pack.length, limit: o.pack.length, cards: o.pack, choices_remaining: 1 } as GameState["pack"], pack_ready: true } : {}),
    held_tags_ready: true,
  };
}
const offer = (key: string, label: string, buy = 5, rarity = "COMMON"): RawCard => ({ id: 500, key, set: "JOKER", label, value: { effect: "", rarity }, modifier: {}, state: {}, cost: { buy, sell: Math.floor(buy / 2) } });
const flatRow = () => [named("j_joker", "Joker", { mult: 4 }), named("j_droll", "Droll Joker"), named("j_jolly", "Jolly Joker")];

test("Invisible Joker: sold to duplicate once ready, never before, and never as the swap victim", () => {
  const inv = (n: number) => named("j_invisible", "Invisible Joker", {}, `After 2 rounds, sell this card to Duplicate a random Joker (Currently ${n}/2)`);
  assert.equal(invisibleReady({ effect: "… (Currently 1/2)" }), false);
  assert.equal(invisibleReady({ effect: "… (Currently 2/2)" }), true);
  assert.equal(invisibleReady({ effect: "… (Currently 7/2)" }), true);
  const ready = buildCandidates(extract(state({ jokers: [...flatRow(), inv(3)] })), opts);
  const sell = ready.candidates.find((c) => c.id === "sell_invisible_joker")!;
  assert.ok(sell && sell.utility >= 0.55, ready.candidates.map((c) => `${c.label} ${c.utility.toFixed(2)}`).join("; "));
  assert.match(sell.description, /duplicates one of Joker, Droll Joker, Jolly Joker at random/);
  const early = buildCandidates(extract(state({ jokers: [...flatRow(), inv(1)] })), opts);
  assert.ok(!early.candidates.some((c) => c.kind === "sell" && /Invisible/.test(c.label)), "not sold before it's ready");
  const full = extract(state({ jokers: [...flatRow(), named("j_greedy_joker", "Greedy Joker"), inv(1)], shop: [offer("j_tribe", "The Tribe", 8, "UNCOMMON")] }));
  assert.notEqual(profileBuild(full).weakest?.key, "j_invisible");
  assert.ok(!buildCandidates(full, opts).candidates.some((c) => c.label.startsWith("Sell Invisible Joker, buy")));
});

test("a joker that changes nothing in the simulated rounds is worth less; a useful one isn't touched", () => {
  // A deck without face cards: Scary Face (+30 Chips per face card scored) can't score; The Tribe can.
  const noFaces = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "A"].flatMap((r) => [`${r}H`, `${r}H`, `${r}S`, `${r}C`, `${r}D`]);
  const g = () => state({ jokers: [named("j_droll", "Droll Joker"), named("j_lusty_joker", "Lusty Joker")], deck: noFaces, shop: [offer("j_scary_face", "Scary Face"), { ...offer("j_tribe", "The Tribe", 8, "UNCOMMON"), id: 501 }] });
  const value = (on: boolean) => {
    FEATURES.uselessJoker = on;
    try {
      const list = buildCandidates(extract(g()), opts).candidates;
      return { wrath: list.find((c) => c.label.startsWith("Buy Scary Face"))!, tribe: list.find((c) => c.label.startsWith("Buy The Tribe"))! };
    } finally {
      FEATURES.uselessJoker = true;
    }
  };
  const on = value(true);
  const off = value(false);
  assert.equal(on.tribe.utility, off.tribe.utility, "a joker that helps keeps its value");
  assert.match(on.wrath.description, /In the simulated rounds it changed nothing at any of the three bosses/);
  assert.ok(on.wrath.utility < off.wrath.utility - 0.15);
  assert.doesNotMatch(on.tribe.description, /changed nothing/);
});

test("a Flush build names a suit only with a reason: a suit joker or a deck that leans to it", () => {
  const even = profileBuild(extract(state({ jokers: [named("j_droll", "Droll Joker"), named("j_tribe", "The Tribe")] })));
  assert.equal(even.primary.name, "Flush");
  assert.equal(even.deckFix.suit, undefined, even.deckFix.goal);
  assert.match(even.deckFix.goal, /any suit will do/);
  assert.ok(!even.needs.some((n) => /more (Spades|Hearts|Clubs|Diamonds)/.test(n)), even.needs.join(", "));
  const lusty = profileBuild(extract(state({ jokers: [named("j_droll", "Droll Joker"), named("j_lusty_joker", "Lusty Joker")] })));
  assert.equal(lusty.deckFix.suit, "H", lusty.deckFix.goal);
  const leaning = profileBuild(extract(state({ jokers: [named("j_droll", "Droll Joker")], deck: heartsDeck })));
  assert.equal(leaning.deckFix.suit, "H");
});

test("the synergy reading follows the simulated loss: a joker that matters isn't idle", () => {
  const s = extract(state({ ante: 2, jokers: [named("j_droll", "Droll Joker"), named("j_lusty_joker", "Lusty Joker"), named("j_scholar", "Scholar")], deck: heartsDeck }));
  const a = assess(s, profileBuild(s), { samples: 40 });
  const loss = new Map(a.synergy.lift!.perJoker.map((x) => [x.label, x.loss]));
  for (const label of a.synergy.idle) assert.ok((loss.get(label) ?? 0) < 0.02, `${label} is idle but costs ${loss.get(label)}`);
  for (const label of a.synergy.carrying) assert.ok((loss.get(label) ?? 0) >= 0.1);
  assert.match(a.synergy.text, /A boss of \d+ chips falls in \d+% of simulated rounds/);
});
