import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCandidates } from "../src/candidates.ts";
import { extract } from "../src/extract.ts";
import type { GameState, RawCard } from "../src/types.ts";
import { joker, raw } from "./helpers.ts";

const opts = { endless: false, maxOptions: 24 };
const named = (key: string, label: string, stats: Record<string, number> = {}, sell = 2): RawCard => ({ ...joker(key, stats), label, cost: { buy: 0, sell } });
const evenDeck = [..."23456789TJQKA"].flatMap((r) => [`${r}H`, `${r}S`, `${r}C`, `${r}D`]);
const tarot = (key: string, label: string, target = 0, id = 600, set = "TAROT"): RawCard => ({ id, key, set, label, value: { effect: "", target_min: target ? 1 : 0, target_max: target }, modifier: {}, state: {}, cost: { buy: 3, sell: 1 } });

function state(o: { phase?: string; money?: number; jokers?: RawCard[]; shop?: RawCard[]; pack?: RawCard[]; hand?: string[]; consumables?: RawCard[]; vouchers?: string[] }): GameState {
  return {
    state: o.phase ?? "SHOP",
    ante_num: 2,
    round_num: 5,
    money: o.money ?? 3,
    bankrupt_at: 0,
    deck: "RED",
    stake: "WHITE",
    seed: "CONSUMABLES",
    round: { reroll_cost: 5 },
    blinds: { small: { type: "SMALL", status: "UPCOMING", name: "Small Blind", effect: "No special effect", score: 800 } },
    hand: { count: o.hand?.length ?? 0, limit: 8, cards: (o.hand ?? []).map((c, i) => raw(c, 50 + i)) },
    cards: { count: evenDeck.length, limit: 52, cards: evenDeck.map((c, i) => raw(c, 100 + i)) },
    jokers: { count: o.jokers?.length ?? 0, limit: 5, cards: (o.jokers ?? []).map((j, i) => ({ ...j, id: 900 + i })) },
    consumables: { count: o.consumables?.length ?? 0, limit: 2, cards: o.consumables ?? [] },
    shop: { count: o.shop?.length ?? 0, limit: 2, cards: o.shop ?? [] },
    ...(o.pack ? { pack: { count: o.pack.length, limit: o.pack.length, cards: o.pack, choices_remaining: 1 } as GameState["pack"], pack_ready: true } : {}),
    ...(o.vouchers ? { used_vouchers: Object.fromEntries(o.vouchers.map((v) => [v, v])) } : {}),
    held_tags_ready: true,
  };
}

test("The Hermit at low money: taken from a pack over skipping, bought from the shop, held rather than used", () => {
  const pack = extract(state({ phase: "SMODS_BOOSTER_OPENED", money: 3, hand: ["2S", "5H", "9C", "KD", "3S", "7H", "JC", "4D"], pack: [tarot("c_hermit", "The Hermit"), tarot("c_world", "The World", 3, 601)] }));
  const list = buildCandidates(pack, opts).candidates;
  const hermit = list.find((c) => c.label.startsWith("Take The Hermit"))!;
  const skip = list.find((c) => c.kind === "pack_skip")!;
  assert.ok(hermit.utility > skip.utility, list.map((c) => `${c.label} ${c.utility.toFixed(2)}`).join("; "));
  // In the shop it is bought for its later use, up to +$20.
  const shop = buildCandidates(extract(state({ money: 3, shop: [tarot("c_hermit", "The Hermit")] })), opts).candidates;
  const buy = shop.find((c) => c.label.startsWith("Buy The Hermit"))!;
  assert.ok(buy.utility > shop.find((c) => c.kind === "next_round")!.utility, shop.map((c) => `${c.label} ${c.utility.toFixed(2)}`).join("; "));
  assert.match(buy.description, /doubles money, up to \+\$20/);
  // Held at $3, using it now ranks low; at $20 it's worth using.
  const held = (money: number) => buildCandidates(extract(state({ money, consumables: [tarot("c_hermit", "The Hermit")] })), opts).candidates.find((c) => c.kind === "use")!;
  assert.ok(held(3).utility < held(20).utility);
  assert.match(held(3).description, /Held, it is worth more/);
});

test("a suit Tarot is worth more when a joker pays for that suit, in any build", () => {
  const value = (jokers: RawCard[]) => buildCandidates(extract(state({ money: 20, jokers, shop: [tarot("c_sun", "The Sun", 3)] })), opts).candidates.find((c) => c.label.startsWith("Buy The Sun"))!;
  const plain = value([named("j_jolly", "Jolly Joker")]);
  const lusty = value([named("j_jolly", "Jolly Joker"), named("j_lusty_joker", "Lusty Joker")]);
  assert.ok(lusty.utility > plain.utility + 0.1, `${lusty.utility} vs ${plain.utility}`);
  assert.match(lusty.description, /the suit a joker pays for/);
});

test("a Planet is worth more with Constellation, and kept rather than used with Observatory", () => {
  const value = (jokers: RawCard[]) => buildCandidates(extract(state({ money: 20, jokers, shop: [tarot("c_mars", "Mars", 0, 600, "PLANET")] })), opts).candidates.find((c) => c.label.startsWith("Buy Mars"))!;
  assert.ok(value([named("j_constellation", "Constellation", { x_mult: 1.2 })]).utility > value([named("j_joker", "Joker", { mult: 4 })]).utility);
  const pair = [named("j_jolly", "Jolly Joker"), named("j_sly", "Sly Joker")];
  const use = (vouchers?: string[]) => buildCandidates(extract(state({ money: 20, jokers: pair, consumables: [tarot("c_mercury", "Mercury", 0, 600, "PLANET")], vouchers })), opts).candidates.find((c) => c.kind === "use")!;
  assert.ok(use(["v_observatory"]).utility < use().utility);
});

test("Temperance is worth the jokers' sell value", () => {
  const value = (sell: number) =>
    buildCandidates(extract(state({ money: 20, jokers: [named("j_joker", "Joker", { mult: 4 }, sell), named("j_jolly", "Jolly Joker", {}, sell)], shop: [tarot("c_temperance", "Temperance")] })), opts).candidates.find((c) => c.label.startsWith("Buy Temperance"))!;
  assert.ok(value(12).utility > value(1).utility + 0.2);
  assert.match(value(12).description, /\+\$24, the jokers' sell value/);
});
