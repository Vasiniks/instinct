import assert from "node:assert/strict";
import { test } from "node:test";
import { extract } from "../src/extract.ts";
import { simGame } from "../src/sim.ts";
import type { SimGame } from "../src/sim/game.ts";
import type { GameState, RawCard } from "../src/types.ts";

// The simulator driven through BlindDeck's methods, as the agent drives it, with the mod's own
// debug endpoints (`add`, `set`) and the test seam `world()` to set up exact situations.

type G = SimGame;
const call = (g: G, method: string, params?: Record<string, unknown>) => g.call<GameState>(method, params);

async function start(seed = "T1", deck = "RED", stake = "WHITE"): Promise<G> {
  const g = simGame(seed);
  await call(g, "start", { deck, stake, seed });
  return g;
}
/** Scores past the blind with one card. */
const win = async (g: G) => {
  await call(g, "set", { chips: 1e9 });
  return call(g, "play", { cards: [0] });
};
const toShop = async (g: G) => {
  await call(g, "select");
  await win(g);
  return call(g, "cash_out");
};
/** Rewrites the first cards in hand: "KH", "TS", "5D:GLASS". */
function setHand(g: G, codes: string[]) {
  const w = g.world();
  codes.forEach((code, i) => {
    const [card, enhancement] = code.split(":");
    Object.assign(w.hand[i], { rank: card[0], suit: card[1], enhancement, seal: undefined, edition: undefined, faceDown: false });
  });
}
const jokerStats = (s: GameState, key: string) => s.jokers?.cards.find((c) => c.key === key)?.value.stats;
/** The mod's cash out preview carries a joker line's key and the Investment payout; types.ts omits them. */
const preview = (s: GameState) => s.round?.cashout_preview as { total: number; investment_received?: number; lines: { kind: string; label: string; dollars: number; key?: string }[] } | undefined;
const raw = (s: GameState, area: "hand" | "pack" | "shop" | "packs" | "jokers" | "consumables") => s[area]?.cards ?? [];

test("a run starts as the game does and repeats move for move by seed", async () => {
  const a = await start("SEEDA");
  const b = await start("SEEDA");
  let s = a.state();
  assert.equal(s.state, "BLIND_SELECT");
  assert.equal(s.money, 4);
  assert.equal(s.blinds?.small?.score, 300);
  assert.ok(s.blinds?.small?.tag_key?.startsWith("tag_"));
  s = await call(a, "select");
  await call(b, "select");
  // Red deck: four hands, four discards, eight cards; the draw pile is sorted (its order is secret).
  assert.deepEqual([s.round?.hands_left, s.round?.discards_left, s.hand?.count, s.cards?.count, s.full_deck?.count], [4, 4, 8, 44, 52]);
  const keys = s.cards!.cards.map((c) => c.key);
  assert.deepEqual(keys, [...keys].sort());
  assert.deepEqual(a.state(), b.state());
  // The first shop always has a Buffoon Pack.
  s = await win(a);
  assert.equal(s.state, "ROUND_EVAL");
  assert.deepEqual(s.round?.cashout_preview?.lines.map((l) => [l.kind, l.dollars]), [["blind", 3], ["hands", 3]]);
  s = await call(a, "cash_out");
  assert.equal(s.state, "SHOP");
  assert.equal(s.money, 10);
  assert.match(raw(s, "packs")[0].key, /^p_buffoon_normal_/);
  assert.equal(raw(s, "packs").length, 2);
  assert.equal(raw(s, "shop").length, 2);
  assert.equal(s.vouchers?.cards.length, 1);
});

test("booster packs open, pick and skip with the mod's flow, states and prices", async () => {
  const g = await start("PACKS");
  await toShop(g);
  const w = g.world();
  w.shopPacks = [];
  await call(g, "add", { key: "p_arcana_normal_1" });
  await call(g, "add", { key: "p_celestial_mega_1" });
  await assert.rejects(call(g, "add", { key: "p_buffoon_normal_1" }), /slots are full/);
  await call(g, "set", { money: 50 });
  let s = g.state();
  assert.deepEqual(raw(s, "packs").map((p) => [p.label, p.cost.buy]), [["Arcana Pack", 4], ["Mega Celestial Pack", 8]]);
  // An Arcana pack deals a hand to use its Tarots on, and every card in it is free.
  s = await call(g, "buy", { pack: 0 });
  assert.equal(s.state, "SMODS_BOOSTER_OPENED");
  assert.equal(s.money, 46);
  assert.equal(s.pack?.choices_remaining, 1);
  assert.equal(raw(s, "pack").length, 3);
  assert.ok(raw(s, "pack").every((c) => c.set === "TAROT" || c.set === "SPECTRAL"));
  assert.ok(raw(s, "pack").every((c) => c.cost.buy === 0 && (c.cost as Record<string, unknown>).free === true));
  assert.equal(s.hand?.count, 8);
  assert.ok(s.pack_ready && s.pack_hand_ready);
  await assert.rejects(call(g, "pack", {}), /must provide one of: card, skip/i);
  await assert.rejects(call(g, "pack", { card: 0, skip: true }), /Cannot provide both/);
  w.pack!.items[0] = { ...w.pack!.items[0], key: "c_star", set: "TAROT", label: "The Star" };
  await assert.rejects(call(g, "pack", { card: 0 }), /requires 1-3 target card\(s\)/);
  const target = w.hand[2];
  s = await call(g, "pack", { card: 0, targets: [2] });
  assert.equal(s.state, "SHOP");
  assert.equal(target.suit, "D");
  assert.equal(s.hand?.count, 0);
  assert.equal(raw(s, "packs").length, 1);
  // A Mega pack takes two picks; Planets are used at once.
  await call(g, "add", { key: "j_red_card" });
  s = await call(g, "buy", { pack: 0 });
  assert.equal(s.pack?.choices_remaining, 2);
  assert.equal(raw(s, "pack").length, 5);
  const planet = raw(s, "pack").find((c) => c.set === "PLANET")!;
  const hand = Object.entries({ c_pluto: "High Card", c_mercury: "Pair", c_uranus: "Two Pair", c_venus: "Three of a Kind", c_saturn: "Straight", c_jupiter: "Flush", c_earth: "Full House", c_mars: "Four of a Kind", c_neptune: "Straight Flush" }).find(([k]) => k === planet.key)?.[1];
  s = await call(g, "pack", { card: raw(s, "pack").indexOf(planet) });
  assert.equal(s.state, "SMODS_BOOSTER_OPENED");
  assert.equal(s.pack?.choices_remaining, 1);
  if (hand) assert.equal(s.hands?.[hand].level, 2);
  // Skipping the rest closes it; Red Card gains +3 Mult.
  s = await call(g, "pack", { skip: true });
  assert.equal(s.state, "SHOP");
  assert.deepEqual(jokerStats(s, "j_red_card"), { mult: 3 });
  // A Buffoon pick needs a free joker slot.
  for (const k of ["j_joker", "j_jolly", "j_zany", "j_mad"]) await call(g, "add", { key: k });
  await call(g, "add", { key: "p_buffoon_normal_1" });
  s = await call(g, "buy", { pack: 0 });
  await assert.rejects(call(g, "pack", { card: 0 }), /joker slots are full/);
});

test("a Standard pack card joins the deck, and Hologram grows when it does", async () => {
  const g = await start("STD");
  await toShop(g);
  g.world().shopPacks = [];
  await call(g, "add", { key: "j_hologram" });
  await call(g, "add", { key: "p_standard_jumbo_1" });
  await call(g, "set", { money: 20 });
  let s = await call(g, "buy", { pack: 0 });
  assert.equal(raw(s, "pack").length, 5);
  assert.ok(raw(s, "pack").every((c) => c.set === "DEFAULT" || c.set === "ENHANCED"));
  assert.equal(extract(s).packCards.length, 5);
  s = await call(g, "pack", { card: 0 });
  assert.equal(s.full_deck?.count, 53);
  assert.deepEqual(jokerStats(s, "j_hologram"), { x_mult: 1.25 });
});

test("vouchers: one per ante, upgrades only after their base, and what each does", async () => {
  const g = await start("VOUCH");
  let s = await toShop(g);
  const w = g.world();
  const first = raw(s, "vouchers" as never)[0] ?? s.vouchers!.cards[0];
  await call(g, "set", { money: 100 });
  s = await call(g, "buy", { voucher: 0 });
  assert.ok(first.key in (s.used_vouchers ?? {}));
  assert.equal(s.vouchers?.cards.length, 0);
  // Upgrades need their base: Overstock Plus can't be dealt before Overstock.
  assert.notEqual(w.anteVoucher, "v_overstock_plus");
  // Overstock adds a shop slot at once; Clearance Sale takes 25% off (rounded the game's way).
  w.shop = w.shop.slice(0, 2);
  await call(g, "add", { key: "v_overstock_norm" });
  s = await call(g, "buy", { voucher: 0 });
  assert.equal(raw(s, "shop").length, 3);
  assert.equal(s.shop?.limit, 3);
  w.shopPacks = [];
  await call(g, "add", { key: "p_arcana_jumbo_1" });
  await call(g, "add", { key: "v_clearance_sale" });
  s = await call(g, "buy", { voucher: 0 });
  assert.equal(raw(s, "packs")[0].cost.buy, 4);
  // Crystal Ball: a third consumable slot. Grabber and Wasteful: next round's hands and discards.
  for (const v of ["v_crystal_ball", "v_grabber", "v_wasteful", "v_paint_brush"]) await call(g, "set", { grant_voucher: v });
  s = await call(g, "next_round");
  assert.equal(s.consumables?.limit, 3);
  s = await call(g, "select");
  assert.deepEqual([s.round?.hands_left, s.round?.discards_left, s.hand?.limit], [5, 5, 9]);
});

test("Director's Cut rerolls the boss once an ante for $10; Retcon any number of times", async () => {
  const g = await start("CUT");
  const w = g.world();
  w.status = ["DEFEATED", "DEFEATED", "SELECT"];
  w.blindIdx = 2;
  let s = g.state();
  assert.equal(s.round?.boss_reroll_available, false);
  await assert.rejects(call(g, "reroll_boss"), /requires Director's Cut/);
  await call(g, "set", { grant_voucher: "v_directors_cut", money: 25 });
  s = g.state();
  assert.equal(s.round?.boss_reroll_available, true);
  const before = s.blinds?.boss?.name;
  s = await call(g, "reroll_boss");
  assert.notEqual(s.blinds?.boss?.name, before);
  assert.equal(s.money, 15);
  assert.equal(s.round?.boss_rerolled, true);
  await assert.rejects(call(g, "reroll_boss"), /already used this ante/);
  // Retcon, and each boss comes up once before any comes up twice: the 8 ante-1 bosses.
  await call(g, "set", { grant_voucher: "v_retcon", money: 200 });
  const seen = new Set([before, g.state().blinds?.boss?.name]);
  for (let i = 0; i < 6; i++) seen.add((await call(g, "reroll_boss")).blinds?.boss?.name);
  assert.equal(seen.size, 8);
  assert.deepEqual([...seen].sort(), ["The Club", "The Goad", "The Head", "The Hook", "The Manacle", "The Pillar", "The Psychic", "The Window"]);
});

test("scaling jokers grow by the game's rules and report their live values as the mod does", async () => {
  const g = await start("GROW");
  await call(g, "set", { ante: 8 });
  await call(g, "select");
  for (const k of ["j_green_joker", "j_ride_the_bus", "j_ice_cream", "j_runner", "j_obelisk", "j_square"]) await call(g, "add", { key: k });
  let s = g.state();
  assert.deepEqual(jokerStats(s, "j_green_joker"), { mult: 0, green_hand_add: 1 });
  assert.deepEqual(jokerStats(s, "j_ride_the_bus"), { ride_the_bus_step: 1 });
  assert.deepEqual(jokerStats(s, "j_ice_cream"), { chips: 100 });
  assert.equal(jokerStats(s, "j_runner"), undefined);
  setHand(g, ["2S", "3H", "4D", "5C", "6S", "KH", "KD", "9C"]);
  s = await call(g, "play", { cards: [0, 1, 2, 3, 4] });
  assert.deepEqual(jokerStats(s, "j_green_joker"), { mult: 1, green_hand_add: 1 });
  assert.deepEqual(jokerStats(s, "j_ride_the_bus"), { ride_the_bus_step: 1, mult: 1 });
  assert.deepEqual(jokerStats(s, "j_runner"), { chips: 15 });
  assert.deepEqual(jokerStats(s, "j_ice_cream"), { chips: 95 });
  // Straight was the only hand played: Obelisk resets on the most played hand.
  assert.deepEqual(jokerStats(s, "j_obelisk"), { obelisk_step: 0.2 });
  // A scoring face card resets Ride the Bus; a different hand grows Obelisk; four cards grow Square.
  setHand(g, ["KH", "KD", "9C", "9D"]);
  s = await call(g, "play", { cards: [0, 1, 2, 3] });
  assert.deepEqual(jokerStats(s, "j_ride_the_bus"), { ride_the_bus_step: 1 });
  assert.deepEqual(jokerStats(s, "j_obelisk"), { obelisk_step: 0.2, x_mult: 1.2 });
  assert.deepEqual(jokerStats(s, "j_square"), { chips: 4 });
  // Discards take Green Joker down, never below 0.
  s = await call(g, "discard", { cards: [0] });
  s = await call(g, "discard", { cards: [0] });
  s = await call(g, "discard", { cards: [0] });
  assert.deepEqual(jokerStats(s, "j_green_joker"), { mult: 0, green_hand_add: 1 });
});

test("jokers that run down, destroy, or pay at the end of the round", async () => {
  const g = await start("ROUNDEND");
  await call(g, "select");
  for (const k of ["j_popcorn", "j_egg", "j_golden", "j_rocket", "j_madness", "j_joker"]) await call(g, "add", { key: k });
  const w = g.world();
  const egg = w.jokers.find((j) => j.key === "j_egg")!;
  const eggSell = Math.max(1, Math.floor(egg.cost / 2));
  let s = await win(g);
  assert.deepEqual(jokerStats(s, "j_popcorn"), { mult: 16 });
  assert.equal(s.jokers?.cards.find((c) => c.key === "j_egg")?.cost.sell, eggSell + 3);
  const lines = preview(s)?.lines ?? [];
  assert.deepEqual(lines.find((l) => l.key === "j_golden"), { kind: "joker", label: "Golden Joker", dollars: 4, key: "j_golden" });
  assert.equal(lines.find((l) => l.key === "j_rocket")?.dollars, 1);
  await call(g, "cash_out");
  await call(g, "next_round");
  // Madness gains X0.5 when the Big Blind is selected and destroys another joker.
  s = await call(g, "select");
  assert.equal(s.jokers?.cards.length, 5);
  assert.deepEqual(jokerStats(s, "j_madness"), { x_mult: 1.5 });
});

test("scoring uses the true values: Supernova counts this hand, Bootstraps pays per $5", async () => {
  const g = await start("SCORE");
  await call(g, "set", { ante: 8 });
  await call(g, "select");
  await call(g, "add", { key: "j_supernova" });
  setHand(g, ["2S", "2H", "9C", "7D", "4S"]);
  // Pair of 2s: (10 + 2 + 2) x (2 + 1): the game raises `played` before Supernova reads it.
  let s = await call(g, "play", { cards: [0, 1] });
  assert.equal(s.round?.chips, 42);
  const h = await start("BOOT");
  await call(h, "set", { ante: 8 });
  await call(h, "select");
  await call(h, "add", { key: "j_bootstraps" });
  await call(h, "set", { money: 25 });
  s = h.state();
  // The mod reports the rate, not the current bonus.
  assert.deepEqual(jokerStats(s, "j_bootstraps"), { mult: 2 });
  setHand(h, ["2S", "2H", "9C", "7D", "4S"]);
  s = await call(h, "play", { cards: [0, 1] });
  assert.equal(s.round?.chips, 14 * (2 + 10));
});

test("Tarots change the cards in hand the way the game does", async () => {
  const g = await start("TAROT");
  await call(g, "select");
  const w = g.world();
  setHand(g, ["2S", "3H", "4D", "KC", "6S", "7H", "8D", "9C"]);
  const card = (i: number) => w.hand[i];
  const use = (key: string, cards?: number[]) => call(g, "add", { key }).then(() => call(g, "use", { consumable: w.consumables.length - 1, ...(cards ? { cards } : {}) }));
  // The Fool needs a Tarot or Planet used before it.
  await call(g, "add", { key: "c_fool" });
  await assert.rejects(call(g, "use", { consumable: 0 }), /cannot be used/);
  w.consumables = [];
  await assert.rejects(call(g, "add", { key: "c_star" }).then(() => call(g, "use", { consumable: 0 })), /requires card selection/);
  await assert.rejects(call(g, "use", { consumable: 0, cards: [0, 1, 2, 3] }), /cannot be used/);
  let s = await call(g, "use", { consumable: 0, cards: [0, 1, 2] });
  assert.deepEqual([card(0).suit, card(1).suit, card(2).suit], ["D", "D", "D"]);
  s = await use("c_justice", [3]);
  assert.deepEqual([s.hand?.cards[3].set, s.hand?.cards[3].label, s.hand?.cards[3].modifier.enhancement], ["ENHANCED", "Glass Card", "GLASS"]);
  await use("c_strength", [3]);
  assert.equal(card(3).rank, "A");
  // Death: the left card becomes a copy of the right one.
  await use("c_death", [4, 3]);
  assert.deepEqual([card(4).rank, card(4).suit, card(4).enhancement], ["A", "C", "GLASS"]);
  s = await use("c_hanged_man", [0, 1]);
  assert.deepEqual([s.hand?.count, s.full_deck?.count], [6, 50]);
  // The Fool now makes another copy of the last one used (The Hanged Man).
  await call(g, "add", { key: "c_fool" });
  s = await call(g, "use", { consumable: 0 });
  assert.equal(raw(s, "consumables")[0].key, "c_hanged_man");
  w.consumables = [];
  await call(g, "set", { money: 15 });
  s = await use("c_hermit");
  assert.equal(s.money, 30);
  s = await use("c_hermit");
  assert.equal(s.money, 50);
  s = await use("c_emperor");
  assert.deepEqual(raw(s, "consumables").map((c) => c.set), ["TAROT", "TAROT"]);
  w.consumables = [];
  s = await use("c_high_priestess");
  assert.deepEqual(raw(s, "consumables").map((c) => c.set), ["PLANET", "PLANET"]);
  w.consumables = [];
  s = await use("c_judgement");
  assert.equal(s.jokers?.cards.length, 1);
  s = await use("c_mercury");
  assert.deepEqual([s.hands?.Pair.level, s.hands?.Pair.chips, s.hands?.Pair.mult], [2, 25, 3]);
  assert.equal(s.run?.tarot_used, 11);
  // Targeted Tarots need a visible hand.
  await win(g);
  await call(g, "cash_out");
  await call(g, "add", { key: "c_lovers" });
  await assert.rejects(call(g, "use", { consumable: 0, cards: [0] }), /visible hand/);
});

test("seals and enhancements pay and break as the game's do", async () => {
  const g = await start("SEALS");
  await call(g, "select");
  const w = g.world();
  setHand(g, ["AS", "KH:GOLD", "QD", "JC"]);
  w.hand[0].seal = "GOLD";
  const money = w.money;
  let s = await call(g, "play", { cards: [0] });
  assert.equal(s.money, money + 3);
  // A Gold Card held at the end of the round pays $3 (before the cash out).
  const gold = w.hand.find((c) => c.enhancement === "GOLD")!;
  assert.ok(gold);
  await call(g, "set", { chips: 1e9 });
  const before = w.money;
  s = await call(g, "play", { cards: [w.hand.findIndex((c) => c !== gold)] });
  assert.equal(s.money, before + 3);
});

test("boss blinds follow their rules", async () => {
  const boss = async (key: string, seed = "BOSS") => {
    const g = await start(seed);
    const w = g.world();
    w.boss = key;
    w.status = ["DEFEATED", "DEFEATED", "SELECT"];
    w.blindIdx = 2;
    return g;
  };
  let g = await boss("bl_psychic");
  let s = await call(g, "select");
  s = await call(g, "play", { cards: [0, 1] });
  assert.deepEqual([s.round?.chips, s.round?.hands_left], [0, 3]);
  g = await boss("bl_eye");
  await call(g, "select");
  setHand(g, ["2S", "2H", "3D", "3C", "9S", "8H", "7D", "6C"]);
  s = await call(g, "play", { cards: [0, 1] });
  const first = s.round?.chips ?? 0;
  setHand(g, ["3D", "3C"]);
  s = await call(g, "play", { cards: [0, 1] });
  assert.ok(first > 0);
  assert.equal(s.round?.chips, first);
  g = await boss("bl_needle");
  s = g.state();
  assert.equal(s.blinds?.boss?.score, 300);
  s = await call(g, "select");
  assert.equal(s.round?.hands_left, 1);
  g = await boss("bl_water");
  s = await call(g, "select");
  assert.equal(s.round?.discards_left, 0);
  g = await boss("bl_manacle");
  s = await call(g, "select");
  assert.deepEqual([s.hand?.limit, s.hand?.count], [7, 7]);
  g = await boss("bl_wall");
  assert.equal(g.state().blinds?.boss?.score, 1200);
  // The Arm takes a level off the hand played; The Ox empties the purse for the most played hand.
  g = await boss("bl_arm");
  g.world().levels.Pair = { ...g.world().levels.Pair, level: 2, chips: 25, mult: 3 };
  await call(g, "select");
  setHand(g, ["2S", "2H"]);
  s = await call(g, "play", { cards: [0, 1] });
  assert.deepEqual([s.hands?.Pair.level, s.round?.chips], [1, 28]);
  g = await boss("bl_ox");
  g.world().levels.Flush = { ...g.world().levels.Flush, played: 3 };
  await call(g, "set", { money: 30 });
  s = await call(g, "select");
  assert.equal(s.blinds?.boss?.effect, "Playing a Flush sets money to $0");
  setHand(g, ["2S", "5S", "7S", "9S", "JS"]);
  s = await call(g, "play", { cards: [0, 1, 2, 3, 4] });
  assert.equal(s.money, 0);
  g = await boss("bl_tooth");
  s = await call(g, "select");
  s = await call(g, "play", { cards: [0, 1, 2] });
  assert.equal(s.money, 1);
  // The Hook throws two held cards before the hand scores; three cards come off the pile to refill.
  g = await boss("bl_hook");
  s = await call(g, "select");
  const pile = s.cards!.count;
  s = await call(g, "play", { cards: [0] });
  assert.equal(s.cards?.count, pile - 3);
});

test("bosses that hide, debuff and force cards show it in the state the mod sends", async () => {
  const boss = async (key: string) => {
    const g = await start("HIDE");
    const w = g.world();
    w.boss = key;
    w.status = ["DEFEATED", "DEFEATED", "SELECT"];
    w.blindIdx = 2;
    return g;
  };
  let g = await boss("bl_house");
  let s = await call(g, "select");
  assert.ok(raw(s, "hand").every((c) => c.key === "" && c.state.hidden));
  assert.ok(extract(s).hand.every((c) => c.hidden));
  s = await call(g, "play", { cards: [0] });
  assert.ok(raw(s, "hand").some((c: RawCard) => c.key !== ""));
  g = await boss("bl_club");
  s = await call(g, "select");
  const clubs = raw(s, "hand").filter((c) => c.value.suit === "C");
  assert.ok(clubs.every((c) => c.state.debuff));
  assert.ok(raw(s, "hand").filter((c) => c.value.suit !== "C" && c.modifier.enhancement !== "WILD").every((c) => !c.state.debuff));
  g = await boss("bl_final_bell");
  s = await call(g, "select");
  assert.equal(raw(s, "hand").filter((c) => c.state.forced_selection).length, 1);
  // Verdant Leaf debuffs every card until a joker is sold.
  g = await boss("bl_final_leaf");
  await call(g, "select");
  await call(g, "add", { key: "j_joker" });
  s = g.state();
  assert.ok(raw(s, "hand").every((c) => c.state.debuff));
  s = await call(g, "sell", { joker: 0 });
  assert.ok(raw(s, "hand").every((c) => !c.state.debuff));
  // Crimson Heart disables a joker from the second hand on; Amber Acorn turns them face down.
  g = await boss("bl_final_heart");
  await call(g, "select");
  for (const k of ["j_joker", "j_jolly"]) await call(g, "add", { key: k });
  s = await call(g, "play", { cards: [0] });
  assert.equal(raw(s, "jokers").filter((c) => c.state.debuff).length, 1);
  // Amber Acorn: the jokers bought in the shop before it come face down (the mod masks them).
  g = await start("ACORN");
  await toShop(g);
  for (const k of ["j_joker", "j_jolly"]) await call(g, "add", { key: k });
  Object.assign(g.world(), { boss: "bl_final_acorn", status: ["DEFEATED", "DEFEATED", "UPCOMING"], blindIdx: 1 });
  await call(g, "next_round");
  s = await call(g, "select");
  assert.deepEqual(raw(s, "jokers").map((c) => [c.key, c.state.hidden]), [["", true], ["", true]]);
  assert.ok(extract(s).jokers.every((j) => j.key === ""));
  // The Pillar debuffs the cards played earlier in the ante.
  g = await start("PILLAR");
  await call(g, "select");
  const played = g.world().hand[0];
  await win(g);
  Object.assign(g.world(), { boss: "bl_pillar", blindTags: [{ key: "tag_economy" }, { key: "tag_economy" }] });
  await call(g, "cash_out");
  await call(g, "next_round");
  await call(g, "skip");
  s = await call(g, "select");
  assert.equal(s.full_deck?.cards.find((c) => c.id === played.id)?.state.debuff, true);
});

test("the ante 8 boss is a finisher", async () => {
  const g = await start("FINAL");
  const w = g.world();
  w.ante = 7;
  w.status = ["DEFEATED", "DEFEATED", "SELECT"];
  w.blindIdx = 2;
  await call(g, "select");
  const s = await win(g);
  assert.equal(s.ante_num, 8);
  assert.ok(["Cerulean Bell", "Verdant Leaf", "Violet Vessel", "Amber Acorn", "Crimson Heart"].includes(s.blinds?.boss?.name ?? ""), s.blinds?.boss?.name);
});

test("skip tags pay, open packs and wait for the shop as the game's do", async () => {
  let g = await start("TAGS");
  const w = g.world();
  await call(g, "set", { money: 15 });
  w.blindTags = [{ key: "tag_economy" }, { key: "tag_charm" }];
  let s = await call(g, "skip");
  assert.equal(s.money, 30);
  assert.equal(s.blinds?.small?.status, "SKIPPED");
  assert.equal(s.run?.skips, 1);
  // Charm Tag opens a free Mega Arcana Pack on the blind select screen, and comes back to it.
  s = await call(g, "skip");
  assert.equal(s.state, "SMODS_BOOSTER_OPENED");
  assert.equal(s.pack?.choices_remaining, 2);
  assert.equal(s.hand?.count, 8);
  s = await call(g, "pack", { skip: true });
  assert.equal(s.state, "BLIND_SELECT");
  assert.equal(s.blinds?.boss?.status, "SELECT");
  // Investment pays after the boss; a Double Tag copies the next tag; Rare Tag's joker is free.
  g = await start("TAGS2");
  const v = g.world();
  v.tags = [{ key: "tag_double" }];
  v.blindTags = [{ key: "tag_investment" }, { key: "tag_rare" }];
  await call(g, "skip");
  s = await call(g, "skip");
  assert.deepEqual(s.held_tags?.map((t) => t.key), ["tag_investment", "tag_investment", "tag_rare"]);
  await call(g, "select");
  const money = v.money;
  s = await win(g);
  assert.equal(s.money, money + 50);
  assert.equal(preview(s)?.investment_received, 50);
  s = await call(g, "cash_out");
  const rare = raw(s, "shop")[0];
  assert.deepEqual([rare.value.rarity, rare.cost.buy], ["RARE", 0]);
  assert.ok(rare.cost.sell > 0);
});

test("stakes and decks change the run the way the game's do", async () => {
  // Red stake and up: the Small Blind pays nothing. Blue stake and up: one discard fewer.
  let g = await start("STAKE", "RED", "BLUE");
  let s = await call(g, "select");
  assert.equal(s.round?.discards_left, 3);
  s = await win(g);
  assert.equal(s.round?.cashout_preview?.lines[0].dollars, 0);
  // Green and Purple stake grow the blinds faster.
  assert.equal((await start("STAKE", "RED", "GREEN")).world().ante, 1);
  g = await start("STAKE", "RED", "PURPLE");
  g.world().ante = 3;
  assert.equal(g.state().blinds?.small?.score, 3200);
  // Gold stake: Rentals cost $1 and $3 a round; Black stake: Eternals can't be sold.
  g = await start("RENT", "RED", "GOLD");
  await toShop(g);
  await call(g, "set", { money: 500 });
  let rental: RawCard | undefined;
  let eternal: RawCard | undefined;
  for (let i = 0; i < 40 && !(rental && eternal); i++) {
    s = await call(g, "reroll");
    rental ??= raw(s, "shop").find((c) => c.modifier.rental);
    eternal ??= raw(s, "shop").find((c) => c.modifier.eternal);
  }
  assert.ok(rental && eternal);
  assert.equal(rental.cost.buy, 1);
  assert.equal(rental.modifier.rental_cost, 3);
  // Decks.
  const deck = async (name: string) => {
    const d = await start("DECK", name);
    return call(d, "select");
  };
  s = await deck("PAINTED");
  assert.deepEqual([s.hand?.limit, s.jokers?.limit], [10, 4]);
  s = await deck("ABANDONED");
  assert.equal(s.full_deck?.count, 40);
  s = await deck("CHECKERED");
  assert.ok(s.full_deck?.cards.every((c) => c.value.suit === "S" || c.value.suit === "H"));
  s = await deck("BLACK");
  assert.deepEqual([s.round?.hands_left, s.jokers?.limit], [3, 6]);
  assert.equal((await start("DECK", "YELLOW")).state().money, 14);
  assert.equal((await start("DECK", "PLASMA")).state().blinds?.small?.score, 600);
  s = (await start("DECK", "MAGIC")).state();
  assert.deepEqual([raw(s, "consumables").map((c) => c.key), s.consumables?.limit], [["c_fool", "c_fool"], 3]);
  // Green deck: no interest, $2 a hand left and $1 a discard.
  g = await start("DECK", "GREEN");
  await call(g, "select");
  await call(g, "set", { money: 50 });
  s = await win(g);
  assert.deepEqual(s.round?.cashout_preview?.lines.map((l) => l.kind), ["blind", "hands", "discards"]);
});

test("shop jokers come at the game's rarity odds and prices, and sell for half", async () => {
  const g = await start("ODDS");
  await toShop(g);
  await call(g, "set", { money: 100000 });
  const rarity: Record<string, number> = {};
  let jokers = 0;
  let cards = 0;
  for (let i = 0; i < 400; i++) {
    const s = await call(g, "reroll");
    for (const c of raw(s, "shop")) {
      cards++;
      if (c.set !== "JOKER") continue;
      jokers++;
      rarity[c.value.rarity!] = (rarity[c.value.rarity!] ?? 0) + 1;
      if (!c.modifier.edition) assert.equal(c.cost.sell, Math.max(1, Math.floor(c.cost.buy / 2)));
    }
  }
  // Joker 20, Tarot 4, Planet 4: five cards in seven are jokers; rarities 70/25/5.
  assert.ok(Math.abs(jokers / cards - 20 / 28) < 0.05, `${jokers}/${cards}`);
  assert.ok(Math.abs(rarity.COMMON / jokers - 0.7) < 0.06 && Math.abs(rarity.RARE / jokers - 0.05) < 0.03, JSON.stringify(rarity));
});
