import assert from "node:assert/strict";
import { test } from "node:test";
import { assess } from "../src/assess.ts";
import { profileBuild } from "../src/build.ts";
import { buildCandidates } from "../src/candidates.ts";
import { extract } from "../src/extract.ts";
import { buildRequest } from "../src/strategy.ts";
import type { GameState, RawCard } from "../src/types.ts";
import { handState, joker, raw } from "./helpers.ts";

const opts = { endless: false, maxOptions: 24 };
const named = (key: string, label: string, stats: Record<string, number> = {}): RawCard => ({ ...joker(key, stats), label });
// A Flush deck: mostly Hearts.
const heartsDeck = [..."23456789TJQKA"].flatMap((r) => [`${r}H`, `${r}H`, `${r}H`, `${r}S`]);
const flushRow = () => [named("j_droll", "Droll Joker"), named("j_tribe", "The Tribe"), named("j_lusty_joker", "Lusty Joker")].map((j, i) => ({ ...j, id: 900 + i }));

function blindSelect(boss: string, effect: string, reroll = false): GameState {
  return {
    state: "BLIND_SELECT",
    ante_num: 3,
    round_num: 9,
    money: 30,
    bankrupt_at: 0,
    deck: "RED",
    stake: "WHITE",
    seed: "ASSESS",
    round: { reroll_cost: 5, boss_reroll_available: reroll } as GameState["round"],
    blinds: {
      small: { type: "SMALL", status: "DEFEATED", name: "Small Blind", effect: "No special effect", score: 2000 },
      big: { type: "BIG", status: "DEFEATED", name: "Big Blind", effect: "No special effect", score: 3000 },
      boss: { type: "BOSS", status: "SELECT", name: boss, effect, score: 4000 },
    },
    hand: { count: 0, limit: 8, cards: [] },
    cards: { count: heartsDeck.length, limit: 52, cards: heartsDeck.map((c, i) => raw(c, 100 + i)) },
    jokers: { count: 3, limit: 5, cards: flushRow() },
    consumables: { count: 0, limit: 2, cards: [] },
    held_tags_ready: true,
  };
}

test("the assess stage reads a boss that debuffs the build's suit as a threat, and a harmless one as none", () => {
  const head = extract(blindSelect("The Head", "All Heart cards are debuffed"));
  const club = extract(blindSelect("The Club", "All Club cards are debuffed"));
  const a = assess(head, profileBuild(head), { samples: 40 });
  const b = assess(club, profileBuild(club), { samples: 40 });
  assert.ok(a.boss && (a.boss.threat === "serious" || a.boss.threat === "severe"), a.boss?.text);
  assert.ok(a.boss!.withRule < a.boss!.plain);
  assert.equal(b.boss?.threat, "none", b.boss?.text);
  assert.match(a.synergy.text, /Flush/);
  assert.ok(a.outlook.bosses.length === 3);
});

test("with a boss reroll available, a threatening boss is rerolled, and the tree says why", () => {
  const s = extract(blindSelect("The Head", "All Heart cards are debuffed", true));
  const set = buildCandidates(s, opts);
  const top = [...set.candidates].sort((x, y) => y.utility - x.utility)[0];
  assert.equal(top.kind, "reroll_boss", set.candidates.map((c) => `${c.label} ${c.utility.toFixed(2)}`).join("; "));
  const fork = set.path!.find((b) => b.node === "Boss")!;
  assert.match(fork.branch, /Reroll The Head/);
  assert.match(fork.why, /beaten in \d+% of simulated rounds/);
  // The model gets the reading as facts.
  const { request } = buildRequest(s, set, "jev-test");
  const view = (request.state as { assessment: Record<string, string> }).assessment;
  assert.match(view.coming_boss, /The Head/);
  assert.ok(view.joker_synergy && view.run_outlook && view.economy);
});

test("a shop walks three forks: outlook, joker row, targets", () => {
  const g = blindSelect("The Club", "All Club cards are debuffed");
  g.state = "SHOP";
  g.shop = { count: 1, limit: 2, cards: [{ id: 501, key: "j_crafty", set: "JOKER", label: "Crafty Joker", value: { effect: "", rarity: "COMMON" }, modifier: {}, state: {}, cost: { buy: 4, sell: 2 } }] };
  const set = buildCandidates(extract(g), opts);
  assert.deepEqual(set.path!.map((b) => b.node), ["Outlook", "Joker row", "Targets"]);
  assert.match(set.path![1].branch, /2 open: fill/);
  assert.ok(set.assessment && set.assessment.targets.length > 0, "the code names jokers the build is missing");
});

test("a hand walks free card, then clear now", () => {
  const s = extract(handState(["AS", "AH", "AD", "KS", "KH", "2C", "7D", "9C"], { remaining: 300 }));
  const set = buildCandidates(s, opts);
  assert.deepEqual(set.path!.map((b) => b.node), ["Free card first?", "Clear now?"]);
  assert.match(set.path![1].branch, /Yes: take a clearing play/);
});
