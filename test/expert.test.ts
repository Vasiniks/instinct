import assert from "node:assert/strict";
import { test } from "node:test";
import { profileBuild } from "../src/build.ts";
import { buildCandidates, offerValue } from "../src/candidates.ts";
import { expertTake, type ExpertPriors } from "../src/expert.ts";
import { extract } from "../src/extract.ts";
import type { GameState, RawCard } from "../src/types.ts";
import { computePriors, deckAt, visitsOf, type Decision, type HandCard, type VideoData } from "../tools/roffle/visits.ts";
import { joker, raw } from "./helpers.ts";

const opts = { endless: false, maxOptions: 24 };
const tally = (offered: number, taken: number, offeredEarly = 0, takenEarly = 0) => ({ offered, taken, offeredEarly, takenEarly, sold: 0, acquired: taken });
const priors: ExpertPriors = {
  source: { videos: ["test"], visits: 10, built: "2026-10-22" },
  base: 0.1,
  baseEarly: 0.1,
  jokers: { j_green_joker: tally(6, 5, 4, 4), j_ride_the_bus: tally(6, 0, 4, 0), j_misprint: tally(1, 1) },
};

function offer(key: string, label: string, buy = 5): RawCard {
  return { id: 500, key, set: "JOKER", label, value: { effect: "", rarity: "COMMON" }, modifier: {}, state: {}, cost: { buy, sell: Math.floor(buy / 2) } };
}

function shop(jokers: RawCard[], offers: RawCard[], ante = 1, money = 20, stake = "WHITE"): GameState {
  const deck = [..."23456789TJQKA"].flatMap((r) => [..."SHDC"].map((s) => `${r}${s}`));
  return {
    state: "SHOP",
    ante_num: ante,
    round_num: 2,
    money,
    bankrupt_at: 0,
    deck: "RED",
    stake,
    seed: "EXPERT",
    round: { reroll_cost: 5 },
    blinds: { small: { type: "SMALL", status: "UPCOMING", name: "Small Blind", effect: "No special effect", score: 300 } },
    hand: { count: 0, limit: 8, cards: [] },
    cards: { count: 52, limit: 52, cards: deck.map((c, i) => raw(c, 100 + i)) },
    jokers: { count: jokers.length, limit: 5, cards: jokers },
    consumables: { count: 0, limit: 2, cards: [] },
    shop: { count: offers.length, limit: offers.length, cards: offers.map((o, i) => ({ ...o, id: 500 + i })) },
    held_tags_ready: true,
  };
}

test("expert counts are smoothed toward the base rate and quoted only when there are enough", () => {
  assert.equal(expertTake(priors, "j_unknown", 1), undefined);
  const green = expertTake(priors, "j_green_joker", 2)!;
  assert.ok(green.delta > 0.4, `delta ${green.delta}`);
  assert.match(green.note!, /took it 4 of 4 times it was offered in antes 1-3/);
  assert.match(expertTake(priors, "j_green_joker", 6)!.note!, /5 of 6 times/);
  assert.ok(expertTake(priors, "j_ride_the_bus", 2)!.delta < 0);
  const once = expertTake(priors, "j_misprint", 2)!;
  assert.equal(once.note, undefined);
  assert.ok(once.delta < 0.25, "one sighting moves the value only a little");
});

test("the expert record nudges the buy's value but is not quoted to the model", () => {
  const s = extract(shop([], [offer("j_green_joker", "Green Joker"), offer("j_ride_the_bus", "Ride the Bus")]));
  const buy = (list: ReturnType<typeof buildCandidates>["candidates"], label: string) => list.find((c) => c.label.startsWith(`Buy ${label}`))!;
  const plain = buildCandidates(s, opts).candidates;
  const nudged = buildCandidates(s, { ...opts, expert: priors }).candidates;
  assert.ok(buy(nudged, "Green Joker").utility > buy(plain, "Green Joker").utility);
  assert.ok(buy(nudged, "Ride the Bus").utility < buy(plain, "Ride the Bus").utility);
  assert.equal(buy(nudged, "Green Joker").description, buy(plain, "Green Joker").description);
  assert.doesNotMatch(buy(nudged, "Green Joker").description, /Roffle|expert/i);
});

test("a fresh scaling xMult joker is not sold for a flat +Mult joker", () => {
  const row = [joker("j_constellation", { x_mult: 1 }), joker("j_joker", { mult: 4 }), joker("j_jolly", { t_mult: 8 }), joker("j_zany", { t_mult: 12 }), joker("j_droll", { t_mult: 10 })].map((j, i) => ({ ...j, id: 900 + i }));
  const s = extract(shop(row, [offer("j_crazy", "Crazy Joker")], 3));
  const p = profileBuild(s);
  assert.notEqual(p.weakest?.key, "j_constellation");
  const swaps = buildCandidates(s, opts).candidates.filter((c) => c.kind === "swap");
  assert.ok(!swaps.some((c) => c.label.includes("Sell Constellation")), swaps.map((c) => c.label).join("; "));
});

test("priors come from shop and Buffoon visits: offers once per visit, takes matched to the offer", () => {
  const card = (key: string) => ({ key, name: key });
  const video = {
    video_id: "v",
    title: "t",
    offers: [
      { t: 10, where: "shop" as const, items: [card("j_a"), card("j_b")] },
      { t: 14, where: "shop" as const, items: [card("j_b")] },
      { t: 16, where: "pack" as const, items: [card("j_c"), card("j_d")] },
      { t: 60, where: "shop" as const, items: [card("j_a")] },
      { t: 90, where: "pack" as const, items: [card("j_e")] },
    ],
    screens: [
      { t: 0, screen: "hand" },
      { t: 9, screen: "shop" },
      { t: 15, screen: "pack" },
      { t: 18, screen: "shop" },
      { t: 30, screen: "hand" },
      { t: 59, screen: "shop" },
      { t: 89, screen: "pack" },
    ],
    hud: [{ t: 8, money: 10, ante: 2, round: 4 }],
    joker_lineups: [{ t: 0, jokers: [] }],
    packs: [
      { t: 16, pack: "Buffoon" },
      { t: 90, pack: "Arcana" },
    ],
  };
  const decision = (t: number, type: string, key: string): Decision => ({ video_id: "v", t_seconds: t, type, item: card(key), jokers_before: [], jokers_after: [], ante: 2, money_before: null, money_after: null });
  const p = computePriors([video], [decision(12, "buy_joker", "j_a"), decision(17, "pack_pick_joker", "j_d")]);
  assert.equal(p.source.visits, 3, "two shops and one Buffoon pack; the Arcana 'joker' is a misread");
  assert.deepEqual([p.jokers.j_a.offered, p.jokers.j_a.taken, p.jokers.j_b.offered], [2, 1, 1]);
  assert.deepEqual([p.jokers.j_d.taken, p.jokers.j_d.takenEarly], [1, 1]);
  assert.equal(p.jokers.j_e, undefined);
});

test("a pack pick the detector missed still counts, and hovered offers he passed on are recorded", () => {
  const card = (key: string) => ({ key, name: key });
  const video: VideoData = {
    video_id: "v",
    title: "t",
    // The pack's second card was never read, and he picked it ten seconds after the last offer read.
    offers: [
      { t: 10, where: "shop", items: [card("j_a"), card("j_b")] },
      { t: 20, where: "pack", items: [card("j_c")] },
    ],
    screens: [
      { t: 9, screen: "shop" },
      { t: 19, screen: "pack" },
      { t: 32, screen: "shop" },
      { t: 40, screen: "hand" },
    ],
    hud: [{ t: 8, money: 10, ante: 2, round: 4 }],
    joker_lineups: [{ t: 0, jokers: [] }],
    packs: [{ t: 20, pack: "Buffoon Pack" }],
  };
  const d = (t: number, type: string, key: string | null, extra: Partial<Decision> = {}): Decision => ({ video_id: "v", t_seconds: t, type, item: key ? card(key) : null, jokers_before: [], jokers_after: [], ante: 2, money_before: null, money_after: null, ...extra });
  const visits = visitsOf(video, [
    d(30, "pack_pick_joker", "j_d", { screen: "pack" }),
    d(12, "buy_voucher", "v_x", { screen: "shop", hovered: [{ key: "j_b", name: "j_b", seconds: 2 }, { key: "reroll", name: "Reroll", seconds: 1 }] }),
  ]);
  const pack = visits.find((x) => x.where === "pack")!;
  assert.deepEqual(pack.taken.map((j) => j.key), ["j_d"]);
  assert.deepEqual(pack.jokers.map((j) => j.key), ["j_c", "j_d"]);
  assert.deepEqual(visits.find((x) => x.where === "shop")!.looked, ["j_b"]);
});

test("the deck estimate counts each card once per blind and pools blinds into proportions", () => {
  const c = (rank: string, suit: string, enhancement?: string): HandCard => ({ rank, suit, ...(enhancement ? { enhancement } : {}) });
  const hand1 = [c("K", "Hearts", "Steel"), c("K", "Hearts", "Steel"), ...["2", "3", "4", "5", "6", "7"].map((r) => c(r, "Spades"))];
  // Five spades played, five hearts drawn; the two Steel kings stayed in hand.
  const hand2 = [c("K", "Hearts", "Steel"), c("K", "Hearts", "Steel"), c("7", "Spades"), ...["2", "3", "4", "5", "6"].map((r) => c(r, "Hearts"))];
  const video: VideoData = {
    video_id: "v",
    title: "t",
    offers: [],
    screens: [],
    hud: [],
    joker_lineups: [],
    packs: [],
    blinds: [
      { start_t: 0, end_t: 20, ante: 1, round: 1, boss: false },
      { start_t: 30, end_t: 50, ante: 1, round: 2, boss: false },
    ],
  };
  const hand = (t: number, cards: HandCard[]): Decision => ({ video_id: "v", t_seconds: t, type: "play_hand", item: null, jokers_before: [], jokers_after: [], ante: 1, money_before: null, money_after: null, hand: cards });
  const decisions = [hand(5, hand1), hand(10, hand2), hand(35, hand1), hand(40, hand2)];
  assert.equal(deckAt(video, decisions, 25), undefined, "13 cards seen is too few to say");
  const deck = deckAt(video, decisions, 60)!;
  assert.equal(deck.length, 52);
  // Per blind: 2 Steel kings + 6 spades + 5 hearts = 13 cards, so Steel is 2/13 of the deck.
  assert.equal(deck.filter((x) => x.enhancement === "Steel").length, 8);
  assert.equal(deck.filter((x) => x.suit === "Spades").length, 24);
});

test("once the bank is built, money jokers are worth less to keep and to buy", () => {
  const row = [joker("j_golden"), joker("j_card_sharp", { x_mult: 3 }), joker("j_joker", { mult: 4 }), joker("j_jolly", { t_mult: 8 }), joker("j_droll", { t_mult: 10 })].map((j, i) => ({ ...j, id: 900 + i }));
  const poor = profileBuild(extract(shop(row, [], 6, 12, "GOLD")));
  const rich = profileBuild(extract(shop(row, [], 6, 60, "GOLD")));
  const worth = (p: typeof poor, key: string) => p.jokers.find((j) => j.key === key)!.worth;
  assert.ok(worth(rich, "j_golden") < worth(poor, "j_golden"), `${worth(rich, "j_golden")} vs ${worth(poor, "j_golden")}`);
  assert.ok(worth(rich, "j_golden") < worth(rich, "j_card_sharp"), "the xMult joker outlasts the money joker");
  // The joker's value to the run, before what the money spent costs (that penalty is larger when poor).
  const at = (money: number) => extract(shop([], [offer("j_rocket", "Rocket", 6)], 6, money, "GOLD"));
  assert.ok(offerValue(at(60), at(60).shop[0]) < offerValue(at(12), at(12).shop[0]));
  const buy = buildCandidates(at(60), opts).candidates.find((c) => c.label.startsWith("Buy Rocket"))!;
  assert.match(buy.description, /interest is already maxed/);
});
