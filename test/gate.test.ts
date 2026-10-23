import assert from "node:assert/strict";
import { test } from "node:test";
import { profileBuild } from "../src/build.ts";
import { buildCandidates } from "../src/candidates.ts";
import { extract, type Snapshot } from "../src/extract.ts";
import { conditions } from "../src/knowledge.ts";
import { applyBuildAnswer, buildOptions, updatePlan, type BuildOption, type Plan } from "../src/plan.ts";
import type { ChoiceAnswer } from "../src/systemone.ts";
import type { GameState, RawCard } from "../src/types.ts";
import { joker, raw } from "./helpers.ts";

const named = (key: string, label: string, mod: RawCard["modifier"] = {}) => ({ ...joker(key), label, value: { effect: "", stats: {} }, modifier: mod });
const heartsDeck = [..."23456789TJQKA"].flatMap((r) => [`${r}H`, `${r}H`]).concat(["2S", "5C", "9D", "KS"]);
const flushRow = () => [named("j_droll", "Droll Joker"), named("j_tribe", "The Tribe"), named("j_jolly", "Jolly Joker")];

function state(o: { jokers: RawCard[]; phase?: string; ante?: number; round?: number; stake?: string; money?: number; shop?: RawCard[]; deck?: string[]; consumables?: RawCard[]; packs?: RawCard[]; small?: number }): Snapshot {
  const g: GameState = {
    state: o.phase ?? "SHOP",
    ante_num: o.ante ?? 2,
    round_num: o.round ?? 4,
    money: o.money ?? 12,
    bankrupt_at: 0,
    deck: "RED",
    stake: o.stake ?? "WHITE",
    seed: "GATE",
    round: { reroll_cost: 5 },
    blinds: { small: { type: "SMALL", status: "SELECT", name: "Small Blind", effect: "No special effect", score: o.small ?? 800 } },
    hand: { count: 0, limit: 8, cards: [] },
    cards: { count: 0, limit: 52, cards: (o.deck ?? heartsDeck).map((c, i) => raw(c, 100 + i)) },
    jokers: { count: o.jokers.length, limit: 5, cards: o.jokers },
    consumables: { count: o.consumables?.length ?? 0, limit: 2, cards: o.consumables ?? [] },
    shop: { count: o.shop?.length ?? 0, limit: 2, cards: o.shop ?? [] },
    packs: { count: o.packs?.length ?? 0, limit: 2, cards: o.packs ?? [] },
    held_tags_ready: true,
  };
  return extract(g);
}

const answer = (choice: string, confidence: number): ChoiceAnswer => ({ type: "choice", choice, confidence, probabilities: {} });
const pairOption: BuildOption = { id: "pivot_pair", build: "Pair", why: "test" };

/** One tick as the loop runs it: the code's check, then the model's answer. */
function tick(plan: Plan, s: Snapshot, a?: ChoiceAnswer, extra: BuildOption[] = [pairOption]): Plan {
  plan = updatePlan(plan, s, profileBuild(s, plan.build));
  return applyBuildAnswer(plan, s, a, [...buildOptions(plan, profileBuild(s, plan.build)), ...extra]);
}

test("a model pivot is not undone by the code in the same ante, so the build stops flapping", () => {
  const s = state({ jokers: flushRow() });
  let plan = updatePlan(undefined, s, profileBuild(s));
  assert.equal(plan.build, "Flush");
  for (let i = 0; i < 4; i++) plan = tick(plan, s, answer("pivot_pair", 0.65));
  assert.equal(plan.build, "Pair");
  assert.equal(plan.pivots.length, 1, plan.pivots.map((p) => `${p.from}->${p.to} (${p.by})`).join(", "));
  // Next ante the code may take it back once, and that locks again.
  const next = state({ jokers: flushRow(), ante: 3, round: 7 });
  for (let i = 0; i < 3; i++) plan = tick(plan, next, answer("pivot_pair", 0.65));
  assert.equal(plan.pivots.length, 2);
  assert.equal(plan.build, "Flush");
});

test("every pivot raises the bar for the next one", () => {
  const s = state({ jokers: flushRow() });
  let plan: Plan = { ...updatePlan(undefined, s, profileBuild(s)), pivots: [{ ante: 1, round: 1, from: "Pair", to: "Flush", why: "", by: "model" }, { ante: 1, round: 2, from: "Flush", to: "Pair", why: "", by: "model" }], build: "Flush" };
  plan = applyBuildAnswer(plan, s, answer("pivot_pair", 0.75), [pairOption]);
  assert.equal(plan.build, "Flush", "0.75 is under the 0.8 needed after two pivots");
  plan = applyBuildAnswer(plan, s, answer("pivot_pair", 0.85), [pairOption]);
  assert.equal(plan.build, "Pair");
});

test("a pivot that needs a joker waits for it, and lapses when the shop closes without it", () => {
  const s = state({ jokers: flushRow() });
  const start = updatePlan(undefined, s, profileBuild(s));
  const via: BuildOption = { id: "pivot_pair", build: "Pair", why: "Pivot to Pair via Spare Trousers", via: { key: "j_trousers", label: "Spare Trousers" } };
  const waiting = applyBuildAnswer(start, s, answer("pivot_pair", 0.7), [via]);
  assert.equal(waiting.build, "Flush");
  assert.equal(waiting.pending?.via.key, "j_trousers");
  // The pending joker is favoured in the shop.
  const offer: RawCard = { id: 600, key: "j_trousers", set: "JOKER", label: "Spare Trousers", value: { effect: "", rarity: "UNCOMMON" }, modifier: {}, state: {}, cost: { buy: 6, sell: 3 } };
  const withOffer = state({ jokers: flushRow(), shop: [offer] });
  const buy = (plan: Plan) => buildCandidates(withOffer, { endless: false, maxOptions: 24, plan }).candidates.find((c) => c.label.startsWith("Buy Spare Trousers"))!;
  assert.ok(buy(waiting).utility > buy(start).utility);
  // Bought: the pivot commits.
  const bought = state({ jokers: [...flushRow(), named("j_trousers", "Spare Trousers")] });
  assert.equal(updatePlan(waiting, bought, profileBuild(bought, "Flush")).build, "Pair");
  // Left the shop without it: the pivot lapses and the build stays.
  const left = state({ jokers: flushRow(), phase: "BLIND_SELECT", round: 5 });
  const lapsed = updatePlan(waiting, left, profileBuild(left, "Flush"));
  assert.equal(lapsed.build, "Flush");
  assert.equal(lapsed.pending, undefined);
});

test("stakes raise economy pressure; Gold prices rentals in and saves sooner", () => {
  assert.equal(conditions("WHITE", "RED").econPressure, 0);
  assert.ok(conditions("GOLD", "RED").econPressure > conditions("GREEN", "RED").econPressure);
  assert.equal(conditions("GOLD", "GREEN").econPressure, 0, "Green deck pays no interest");
  assert.equal(conditions("GOLD", "RED").rentalRate, 3);

  const two = [named("j_droll", "Droll Joker"), named("j_tribe", "The Tribe"), named("j_lusty_joker", "Lusty Joker")];
  const white = profileBuild(state({ jokers: two, stake: "WHITE", money: 30, ante: 3 }));
  const gold = profileBuild(state({ jokers: two, stake: "GOLD", money: 30, ante: 3 }));
  assert.equal(white.econ.mode, "build");
  assert.equal(gold.econ.mode, "save");
  assert.equal(gold.econ.reserve, 25);
  assert.doesNotMatch(gold.econ.note, /leave|hold|spend/i, "the note states facts, not advice");

  const offer = (mod: RawCard["modifier"]): RawCard => ({ id: 601, key: "j_greedy_joker", set: "JOKER", label: "Greedy Joker", value: { effect: "", rarity: "COMMON" }, modifier: mod, state: {}, cost: { buy: 5, sell: 2 } });
  const value = (mod: RawCard["modifier"]) =>
    buildCandidates(state({ jokers: two, stake: "GOLD", money: 30, shop: [offer(mod)] }), { endless: false, maxOptions: 24 }).candidates.find((c) => c.label.startsWith("Buy Greedy"))?.utility ?? 0;
  assert.ok(value({ rental: true, rental_cost: 3 }) < value({}));
  const rentalRow = profileBuild(state({ jokers: [...two, named("j_joker", "Joker", { rental: true, rental_cost: 3 })], stake: "GOLD" }));
  assert.match(rentalRow.econ.note, /Rentals cost \$3 a round, charged before interest\./);
});

test("Gold-stake habits from the playbook: rent before interest, play every blind, Hex on a lone joker", async () => {
  const { interestOn } = await import("../src/build.ts");
  const rented = state({ jokers: [named("j_joker", "Joker", { rental: true, rental_cost: 3 })], stake: "GOLD", money: 27 });
  assert.equal(interestOn(rented, 27), 4, "$27 less $3 rent is $24: four dollars, not five");

  // Skipping at Gold with $25 loses $5 of interest; at White with $4 it costs nothing extra.
  const skip = (stake: string, money: number) => {
    const g = state({ jokers: [named("j_droll", "Droll Joker")], phase: "BLIND_SELECT", stake, money, ante: 3 });
    return buildCandidates(g, { endless: false, maxOptions: 24 }).candidates.find((c) => c.kind === "skip")!;
  };
  assert.ok(skip("GOLD", 25).utility < skip("WHITE", 4).utility - 0.3);
  assert.match(skip("GOLD", 25).description, /\$5 of interest/);

  // Hex picks a random joker and destroys the rest: worth using only with a single joker.
  const hex: RawCard = { id: 700, key: "c_hex", set: "SPECTRAL", label: "Hex", value: { effect: "", target_min: 0, target_max: 0 }, modifier: {}, state: {}, cost: { buy: 4, sell: 2 } };
  const useHex = (jokers: RawCard[]) =>
    buildCandidates(state({ jokers, stake: "GOLD", consumables: [hex] }), { endless: false, maxOptions: 24 }).candidates.find((c) => c.kind === "use" && c.label.includes("Hex"));
  const lone = useHex([named("j_mail", "Mail-In Rebate")]);
  const many = useHex(flushRow());
  assert.ok(lone && lone.utility > 0.4, `lone ${lone?.utility}`);
  assert.ok(!many || many.utility < lone.utility - 0.3);
});

test("money past the interest cap goes into the shop when the build is behind (the live runs died with $57-90)", () => {
  // Ante 5, five flat jokers that score a fraction of the next boss, $57: $32 above the cap.
  const flat = [named("j_joker", "Joker"), named("j_jolly", "Jolly Joker"), named("j_sly", "Sly Joker"), named("j_droll", "Droll Joker"), named("j_crafty", "Crafty Joker")];
  const pack: RawCard = { id: 800, key: "p_celestial_normal_1", set: "BOOSTER", label: "Celestial Pack", value: { effect: "" }, modifier: {}, state: {}, cost: { buy: 4, sell: 0 } };
  const s = state({ jokers: flat, ante: 5, round: 13, money: 57, packs: [pack], small: 11000 });
  assert.ok(profileBuild(s).econ.behind);
  const list = buildCandidates(s, { endless: false, maxOptions: 24 }).candidates;
  const top = [...list].sort((a, b) => b.utility - a.utility)[0];
  assert.notEqual(top.kind, "next_round", list.map((c) => `${c.label} ${c.utility.toFixed(2)}`).join("; "));
  const leave = list.find((c) => c.kind === "next_round")!;
  assert.ok(list.find((c) => c.label.startsWith("Buy Celestial"))!.utility > leave.utility);
  assert.ok(list.find((c) => c.kind === "reroll")!.utility > leave.utility);
});
