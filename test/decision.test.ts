import assert from "node:assert/strict";
import { test } from "node:test";
import { assess, bossesUsed } from "../src/assess.ts";
import { profileBuild } from "../src/build.ts";
import { buildCandidates } from "../src/candidates.ts";
import { extract } from "../src/extract.ts";
import { FEATURES } from "../src/features.ts";
import { bossPool } from "../src/knowledge.ts";
import { bossEffects, roundOdds } from "../src/round.ts";
import type { GameState, RawCard } from "../src/types.ts";
import { joker, raw } from "./helpers.ts";

const opts = { endless: false, maxOptions: 24 };
const named = (key: string, label: string, stats: Record<string, number> = {}): RawCard => ({ ...joker(key, stats), label });
// Half Hearts, half off-suit: a Flush build that deck fixing can help.
const mixedDeck = [..."23456789TJQKA"].flatMap((r) => [`${r}H`, `${r}H`, `${r}S`, `${r}C`]);
const flushRow = () => [named("j_droll", "Droll Joker"), named("j_tribe", "The Tribe"), named("j_lusty_joker", "Lusty Joker")].map((j, i) => ({ ...j, id: 900 + i }));

function state(o: { phase?: string; ante?: number; money?: number; shop?: RawCard[]; packs?: RawCard[]; boss?: { name: string; effect: string }; reroll?: boolean; bossesUsed?: Record<string, number>; jokers?: RawCard[]; deck?: string[] }): GameState {
  const ante = o.ante ?? 3;
  return {
    state: o.phase ?? "SHOP",
    ante_num: ante,
    round_num: ante * 3,
    money: o.money ?? 30,
    bankrupt_at: 0,
    deck: "RED",
    stake: "WHITE",
    seed: "DECISION",
    round: { reroll_cost: 5, boss_reroll_available: o.reroll ?? false } as GameState["round"],
    blinds: {
      small: { type: "SMALL", status: "DEFEATED", name: "Small Blind", effect: "No special effect", score: 2000 },
      big: { type: "BIG", status: "DEFEATED", name: "Big Blind", effect: "No special effect", score: 3000 },
      boss: { type: "BOSS", status: o.phase === "BLIND_SELECT" ? "SELECT" : "UPCOMING", name: o.boss?.name ?? "The Club", effect: o.boss?.effect ?? "All Club cards are debuffed", score: 4000 },
    },
    hand: { count: 0, limit: 8, cards: [] },
    cards: { count: (o.deck ?? mixedDeck).length, limit: 52, cards: (o.deck ?? mixedDeck).map((c, i) => raw(c, 100 + i)) },
    jokers: { count: (o.jokers ?? flushRow()).length, limit: 5, cards: o.jokers ?? flushRow() },
    consumables: { count: 0, limit: 2, cards: [] },
    shop: { count: o.shop?.length ?? 0, limit: 2, cards: o.shop ?? [] },
    packs: { count: o.packs?.length ?? 0, limit: 2, cards: o.packs ?? [] },
    ...(o.bossesUsed ? { bosses_used: o.bossesUsed } : {}),
    held_tags_ready: true,
  };
}

const card = (key: string, set: string, label: string, buy = 3, target = 0): RawCard => ({ id: 600, key, set, label, value: { effect: "", target_min: target ? 1 : 0, target_max: target }, modifier: {}, state: {}, cost: { buy, sell: 1 } });

test("deck fixing: The Sun is valued by simulating the deck after it, and the assessment lists the fixes", () => {
  const s = extract(state({ shop: [card("c_sun", "TAROT", "The Sun", 3, 3)] }));
  const sun = buildCandidates(s, opts).candidates.find((c) => c.label.startsWith("Buy The Sun"))!;
  assert.match(sun.description, /with the deck after it \(on /);
  const off = (() => {
    FEATURES.deckFixSim = false;
    try {
      return buildCandidates(extract(state({ shop: [card("c_sun", "TAROT", "The Sun", 3, 3)] })), opts).candidates.find((c) => c.label.startsWith("Buy The Sun"))!;
    } finally {
      FEATURES.deckFixSim = true;
    }
  })();
  assert.ok(sun.utility >= off.utility, `${sun.utility} vs ${off.utility}`);
  const a = assess(s, profileBuild(s), { samples: 30 });
  assert.ok(a.deck && a.deck.size === mixedDeck.length && a.deck.suit === "H");
  assert.ok(a.deck.fixes.some((f) => f.key === "c_sun"), a.deck.text);
  assert.match(a.deck.text, /50% Hearts/);
});

test("boss cycle: the pool is the eligible bosses used the fewest times; showdowns only on ante 8", () => {
  const first = bossPool(1, {}).map((b) => b.name).sort();
  assert.deepEqual(first, ["The Club", "The Goad", "The Head", "The Hook", "The Manacle", "The Pillar", "The Psychic", "The Window"]);
  const later = bossPool(1, { bl_club: 1, bl_goad: 1 }).map((b) => b.name);
  assert.ok(!later.includes("The Club") && !later.includes("The Goad") && later.includes("The Head"));
  assert.ok(bossPool(8, {}).every((b) => ["Cerulean Bell", "Verdant Leaf", "Violet Vessel", "Amber Acorn", "Crimson Heart"].includes(b.name)));
  assert.ok(bossPool(6, {}).some((b) => b.name === "The Ox") && !bossPool(5, {}).some((b) => b.name === "The Ox"));
  // Without the game's count, the bosses seen stand in.
  const s = extract(state({ boss: { name: "The Head", effect: "All Heart cards are debuffed" } }));
  assert.deepEqual(bossesUsed(s, ["The Club"]), { bl_head: 1, bl_club: 1 });
  assert.deepEqual(extract(state({ bossesUsed: { bl_hook: 2 } })).bossesUsed, { bl_hook: 2 });
});

test("The Serpent draws three after every play or discard", () => {
  const s = extract(state({}));
  const serpent = bossEffects("The Serpent", 8)!;
  assert.equal(serpent.drawThree, true);
  const plain = roundOdds(s, [{ jokers: s.jokers, levels: s.levels }], 4000, 4, 3, 30)[0];
  const withIt = roundOdds(s, [{ jokers: s.jokers, levels: s.levels }], 4000, 4, 3, 30, serpent)[0];
  assert.notEqual(plain, withIt);
});

test("Director's Cut: a boss worse than what a reroll would draw is rerolled; a harmless one is faced", () => {
  const used = { bl_head: 1, bl_club: 1, bl_goad: 1, bl_window: 1 };
  const head = extract(state({ phase: "BLIND_SELECT", boss: { name: "The Head", effect: "All Heart cards are debuffed" }, reroll: true, bossesUsed: used }));
  const set = buildCandidates(head, opts);
  const reroll = set.candidates.find((c) => c.kind === "reroll_boss")!;
  assert.ok(reroll.utility > 0.6, `${reroll.utility}: ${reroll.description}`);
  assert.match(reroll.description, /A reroll draws one of \d+ bosses not yet met this cycle/);
  assert.match(set.path!.find((b) => b.node === "Boss")!.branch, /Reroll The Head/);
  const club = extract(state({ phase: "BLIND_SELECT", boss: { name: "The Club", effect: "All Club cards are debuffed" }, reroll: true, bossesUsed: used }));
  const clubReroll = buildCandidates(club, opts).candidates.find((c) => c.kind === "reroll_boss")!;
  assert.ok(clubReroll.utility < 0.6, `${clubReroll.utility}`);
});

test("Planet values and synergy against deck strength come out of the assessment as facts", () => {
  const s = extract(state({}));
  const a = assess(s, profileBuild(s), { samples: 30 });
  assert.ok(a.planets.some((x) => x.planet === "Jupiter"), JSON.stringify(a.planets));
  assert.ok(a.synergy.lift && a.synergy.lift.all >= a.synergy.lift.none);
  assert.equal(a.synergy.lift.perJoker.length, 3);
  assert.ok(a.synergy.jokerShare! > 0 && a.synergy.jokerShare! < 1);
  assert.match(a.synergy.text, /The jokers make \d+% of a typical Flush's score/);
});

test("pack odds: a Celestial pack adds what its best Planet is expected to add", () => {
  const pack: RawCard = { id: 700, key: "p_celestial_normal_1", set: "BOOSTER", label: "Celestial Pack", value: { effect: "" }, modifier: {}, state: {}, cost: { buy: 4, sell: 0 } };
  // A weaker row, so a Jupiter level shows in the simulated odds.
  const row = [named("j_droll", "Droll Joker")].map((j) => ({ ...j, id: 900 }));
  const value = (on: boolean) => {
    FEATURES.packOdds = on;
    try {
      return buildCandidates(extract(state({ ante: 2, packs: [pack], jokers: row })), opts).candidates.find((c) => c.label.startsWith("Buy Celestial"))!;
    } finally {
      FEATURES.packOdds = true;
    }
  };
  const withOdds = value(true);
  const without = value(false);
  assert.ok(withOdds.utility >= without.utility);
  if (withOdds.utility > without.utility) assert.match(withOdds.description, /points of simulated odds at the next ante's boss/);
});
