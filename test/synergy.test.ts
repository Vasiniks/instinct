import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildCandidates } from "../src/candidates.ts";
import { extract } from "../src/extract.ts";
import { profileBuild } from "../src/build.ts";
import { ENABLERS, SYNERGY_KEYS, conflictsOf, enablerLift, partnersOf, synergyOf } from "../src/synergy.ts";
import type { RawCard } from "../src/types.ts";
import { handState, joker } from "./helpers.ts";

const catalog = JSON.parse(readFileSync(new URL("../data/roffle/catalog/jokers.json", import.meta.url), "utf8"));
const jokerKeys = new Set((Array.isArray(catalog) ? catalog : Object.values(catalog)).map((j: { key: string }) => j.key));
const others = new Set(Object.keys(JSON.parse(readFileSync(new URL("../data/roffle/catalog/consumables.json", import.meta.url), "utf8"))));

test("every joker, consumable, voucher and pack the synergy tables name exists in the game", () => {
  for (const k of SYNERGY_KEYS) assert.ok(jokerKeys.has(k), `${k} is not a joker`);
  for (const [k, row] of Object.entries(ENABLERS)) {
    assert.ok(jokerKeys.has(k), `${k} is not a joker`);
    for (const item of Object.keys(row)) assert.ok(others.has(item) || /^p_(arcana|celestial|standard|spectral|buffoon)$/.test(item), `${item} (for ${k}) is not a consumable, voucher or pack`);
  }
});

test("pairs read the same both ways; the strongest partner counts whole, further ones less", () => {
  assert.deepEqual(partnersOf("j_mime", ["j_baron"]), [{ key: "j_baron", strength: 1 }]);
  assert.deepEqual(partnersOf("j_baron", ["j_mime"]), [{ key: "j_mime", strength: 1 }]);
  assert.equal(conflictsOf("j_ride_the_bus", ["j_pareidolia"])[0]?.strength, 1);
  const many = synergyOf("j_pareidolia", ["j_scary_face", "j_smiley", "j_photograph", "j_business"]);
  assert.ok(many.lift > 0.6 && many.lift < 1.2, `four mild partners: ${many.lift}`);
  assert.ok(enablerLift("c_chariot", ["j_steel_joker"]).lift === 1);
  assert.equal(enablerLift("c_chariot", ["j_joker"]).lift, 0);
});

const deck = [..."23456789TJQKA"].flatMap((r) => [..."SHDC"].map((su) => `${r}${su}`));
const named = (key: string, label: string, id: number, stats: Record<string, number> = {}): RawCard => ({ ...joker(key, stats), id, label });
const offer = (key: string, label: string, id: number, buy: number, rarity = "COMMON"): RawCard => ({ id, key, set: "JOKER", label, value: { effect: "", rarity }, modifier: {}, state: {}, cost: { buy, sell: Math.floor(buy / 2) } });

function shopState(jokers: RawCard[], cards: RawCard[]) {
  const g = handState([], { deck, jokers });
  g.state = "SHOP";
  g.ante_num = 3;
  g.money = 30;
  g.blinds = { small: { type: "SMALL", status: "UPCOMING", name: "Small Blind", effect: "", score: 1200 } };
  g.shop = { count: cards.length, limit: 2, cards };
  g.packs = { count: 0, limit: 2, cards: [] };
  return extract(g);
}

test("a joker is worth more next to its partner, less next to one it works against", () => {
  const buyOf = (held: RawCard[], item: RawCard) => buildCandidates(shopState(held, [item]), { endless: false, maxOptions: 24 }).candidates.find((c) => c.kind === "buy")?.utility ?? 0;
  const smiley = offer("j_smiley", "Smiley Face", 501, 4);
  const withPareidolia = buyOf([named("j_pareidolia", "Pareidolia", 901)], smiley);
  const alone = buyOf([named("j_joker", "Joker", 902, { mult: 4 })], smiley);
  assert.ok(withPareidolia > alone, `Smiley Face: ${withPareidolia.toFixed(2)} with Pareidolia, ${alone.toFixed(2)} without`);
  const bus = offer("j_ride_the_bus", "Ride the Bus", 502, 6);
  const busWithPareidolia = buyOf([named("j_pareidolia", "Pareidolia", 901)], bus);
  const busAlone = buyOf([named("j_joker", "Joker", 902, { mult: 4 })], bus);
  assert.ok(busWithPareidolia < busAlone, `Ride the Bus: ${busWithPareidolia.toFixed(2)} with Pareidolia, ${busAlone.toFixed(2)} without`);
});

test("a held joker whose partner is held is kept over one with none", () => {
  const s = shopState([named("j_baron", "Baron", 901), named("j_mime", "Mime", 902), named("j_egg", "Egg", 903)], []);
  const p = profileBuild(s);
  const keep = (k: string) => p.jokers.find((j) => j.key === k)!.keep;
  assert.ok(keep("j_mime") > keep("j_egg"), `Mime ${keep("j_mime").toFixed(2)}, Egg ${keep("j_egg").toFixed(2)}`);
});
