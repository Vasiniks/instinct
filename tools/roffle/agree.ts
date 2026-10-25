// How often the agent's joker choices match Roffle's, rebuilt from the dataset's shop and pack
// visits. Leave-one-video-out: each video is scored with priors built from the other videos, so
// the expert nudge is never graded on the choices it was counted from.
//
// Usage: node tools/roffle/agree.ts [--weights 0,0.5,1] [--misses] [--takes] [--start-deck] [--videos id,id] [--debug VIDEO:SECOND [--why]] [--off switch,list] [--set key=value,...]
//
// Measures the code's utilities (the fallback policy and the hints the model sees), not the model.
// Decks are estimated from the hands he was dealt over the last three blinds (`--start-deck` uses
// the deck's starting cards instead). Hand levels aren't read off the screen, but he beat every
// blind these visits lead to, so the hand he was playing gets the lowest level at which the build
// clears the next ante's boss (`--level-one` leaves every hand at level 1).

import { profileBuild } from "../../src/build.ts";
import { buildCandidates, offerValue, type Candidate } from "../../src/candidates.ts";
import { EXPERT_WEIGHT } from "../../src/expert.ts";
import { FEATURES } from "../../src/features.ts";
import { applyOverrides } from "../../src/tuning.ts";
import { extract, type Snapshot } from "../../src/extract.ts";
import { cardLabel, normEdition, normRank, type PCard } from "../../src/cards.ts";
import { blindBase } from "../../src/knowledge.ts";
import { BASE_HANDS, HAND_NAMES, evaluateHand, type HandName } from "../../src/poker.ts";
import type { GameState, RawCard } from "../../src/types.ts";
import { type Card, type CatalogJoker, type Decision, type HandCard, type Visit, computePriors, deckAt, loadDataset, visitsOf } from "./visits.ts";

const argv = process.argv.slice(2);
const arg = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : (argv[i + 1] ?? "true");
};
/** --off turns single stage switches off (features.ts); --set moves TUNING numbers or switches (tuning.ts). */
for (const k of (arg("off") ?? "").split(",").filter(Boolean)) {
  if (!(k in FEATURES)) throw new Error(`no switch named ${k}; switches: ${Object.keys(FEATURES).join(", ")}`);
  (FEATURES as Record<string, boolean>)[k] = false;
}
applyOverrides(arg("set") ?? "", FEATURES as Record<string, boolean>);
const weights = (arg("weights") ?? `0,0.25,${EXPERT_WEIGHT},1,1.5`).split(",").map(Number);
/** --margin overrides TUNING.swapMargin, to sweep it. */
const swapMargin = arg("margin") === undefined ? undefined : Number(arg("margin"));
const showMisses = arg("misses") !== undefined;
const showTakes = arg("takes") !== undefined;
/** Score only these videos (priors still come from all the others), e.g. the ones the numbers were not tuned on. */
const only = arg("videos")?.split(",");

const { videos, decisions, catalog, settings } = loadDataset();
const EDITION_COST: Record<string, number> = { FOIL: 2, HOLO: 3, HOLOGRAPHIC: 3, POLYCHROME: 5, NEGATIVE: 5 };
const RANKS13 = [..."23456789TJQKA"];
/** The starting deck: Checkered has 26 Spades and 26 Hearts. */
const startingDeck = (deck: string): HandCard[] => RANKS13.flatMap((r) => (deck === "CHECKERED" ? ["Spades", "Spades", "Hearts", "Hearts"] : ["Spades", "Hearts", "Diamonds", "Clubs"]).map((suit) => ({ rank: r, suit })));
const upper = (x: string | undefined) => (x ? x.toUpperCase() : undefined);
/** Without --start-deck the deck is the one estimated from his recent hands, when there is one. */
const seenDecks = arg("start-deck") === undefined;

function playingCard(c: HandCard, id: number): RawCard {
  const suit = c.suit?.[0] ?? "S";
  const rank = c.rank === "10" ? "T" : (c.rank ?? "2");
  const edition = upper(c.edition);
  return {
    id,
    key: `${suit}_${rank}`,
    set: "DEFAULT",
    label: `${rank}${suit}`,
    value: { suit, rank, effect: "" },
    modifier: { ...(c.enhancement ? { enhancement: upper(c.enhancement) } : {}), ...(edition ? { edition } : {}), ...(c.seal ? { seal: upper(c.seal) } : {}) },
    state: {},
    cost: { buy: 0, sell: 1 },
  };
}

/** Catalog configs whose numbers the catalog reader missed. */
const FRESH_STATS: Record<string, Record<string, number>> = { j_gros_michel: { mult: 15 }, j_cavendish: { x_mult: 3 }, j_hologram: { x_mult: 1 }, j_lucky_cat: { x_mult: 1 } };

/**
 * What the game reports in `value.stats` for a freshly bought joker, read from its catalog config.
 * Scaling jokers held for a while have grown past this; the dataset can't say by how much.
 */
function freshStats(c: CatalogJoker | undefined, key: string): Record<string, number> {
  if (FRESH_STATS[key]) return FRESH_STATS[key];
  const cfg = (c as { config?: string | null } | undefined)?.config ?? "";
  const num = (re: RegExp) => {
    const m = re.exec(cfg);
    return m ? Number(m[1]) : undefined;
  };
  const out: Record<string, number> = {};
  const mult = num(/(?<![\w])mult\s*=\s*([\d.]+)/);
  const chips = num(/(?<![\w])chips\s*=\s*([\d.]+)/);
  const xmult = num(/Xmult\s*=\s*([\d.]+)/);
  if (mult !== undefined) out.mult = mult;
  if (chips !== undefined) out.chips = chips;
  if (xmult !== undefined) out.x_mult = xmult;
  return out;
}

function jokerCard(c: Card, id: number, buy = false): RawCard {
  const cat: CatalogJoker | undefined = catalog.get(c.key);
  const edition = c.edition?.toUpperCase();
  const cost = (cat?.cost ?? 5) + (EDITION_COST[edition ?? ""] ?? 0);
  return {
    id,
    key: c.key,
    set: "JOKER",
    label: cat?.name ?? c.name,
    value: { effect: cat?.effect.replace(/#\d#/g, "X") ?? "", rarity: cat?.rarity.toUpperCase(), stats: freshStats(cat, c.key) },
    // Stickers as the game reports them; a held Perishable's rounds left are unknown, so assume 3.
    modifier: {
      ...(edition ? { edition } : {}),
      ...(c.stickers?.includes("eternal") ? { eternal: true } : {}),
      ...(c.stickers?.includes("rental") ? { rental: true, rental_cost: 3 } : {}),
      ...(c.stickers?.includes("perishable") ? { perishable: buy ? 5 : 3 } : {}),
    },
    state: {},
    cost: { buy: buy ? cost : 0, sell: Math.max(1, Math.floor(cost / 2)) },
  };
}

function baseState(held: Card[], ante: number, money: number, video: string, seen?: HandCard[]): GameState {
  const { deck, stake } = settings.get(video) ?? { deck: "RED", stake: "GOLD" };
  const cards = (seenDecks && seen) || startingDeck(deck);
  const base = blindBase(ante, stake, deck);
  const slots = Math.max(5 + held.filter((j) => j.edition?.toUpperCase() === "NEGATIVE").length, held.length);
  return {
    state: "SHOP",
    ante_num: ante,
    round_num: ante * 3,
    money,
    bankrupt_at: 0,
    deck,
    stake,
    seed: "ROFFLE",
    round: { reroll_cost: 5 },
    blinds: {
      small: { type: "SMALL", status: "UPCOMING", name: "Small Blind", effect: "No special effect", score: base },
      big: { type: "BIG", status: "UPCOMING", name: "Big Blind", effect: "No special effect", score: base * 1.5 },
      boss: { type: "BOSS", status: "UPCOMING", name: "The Wall", effect: "Extra large blind", score: base * 4 },
    },
    hand: { count: 0, limit: 8, cards: [] },
    cards: { count: cards.length, limit: 52, cards: cards.map((c, i) => playingCard(c, 100 + i)) },
    jokers: { count: held.length, limit: slots, cards: held.map((j, i) => jokerCard(j, 900 + i)) },
    consumables: { count: 0, limit: 2, cards: [] },
    held_tags_ready: true,
  };
}

const levelOne = arg("level-one") !== undefined;

function pcardOf(c: HandCard, index: number): PCard {
  const stone = c.enhancement === "Stone";
  const card: PCard = { index, id: index, rank: stone ? undefined : normRank(c.rank), suit: stone ? undefined : c.suit?.[0], enhancement: c.enhancement?.toUpperCase(), edition: normEdition(c.edition), seal: c.seal?.toUpperCase(), debuff: false, hidden: false, forced: false, label: "" };
  card.label = cardLabel(card);
  return card;
}

/** The hand type he played most in the ten minutes before `t` (plays of two or more cards read). */
function mainHand(video: string, t: number): HandName | undefined {
  const counts = new Map<HandName, number>();
  for (const d of decisions) {
    if (d.video_id !== video || d.type !== "play_hand" || d.t_seconds > t || d.t_seconds < t - 600) continue;
    const cards = (d as { cards?: HandCard[] }).cards;
    if (!cards || cards.length < 2 || cards.length > 5) continue;
    const hand = evaluateHand(cards.map(pcardOf)).hand;
    counts.set(hand, (counts.get(hand) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
}

function setLevels(g: GameState, main: HandName | undefined, level: number): void {
  g.hands = Object.fromEntries(
    HAND_NAMES.map((h, i) => {
      const lv = h === main ? level : 1;
      const b = BASE_HANDS[h];
      return [h, { order: i, level: lv, chips: b.chips + (lv - 1) * b.lchips, mult: b.mult + (lv - 1) * b.lmult, played: h === main ? 10 : 0, played_this_round: 0 }];
    }),
  );
}

const calibrated = new Map<string, { main?: HandName; level: number }>();
/** Levels the main hand until the build clears the next ante's boss, as his did. */
function calibrate(g: GameState, key: string, video: string, t: number): void {
  if (levelOne) return;
  let hit = calibrated.get(key);
  if (!hit) {
    const main = mainHand(video, t) ?? (profileBuild(extract(g)).primary.name.split(" ")[0] === "Flush" ? "Flush" : undefined);
    const clears = (lv: number) => {
      setLevels(g, main, lv);
      return profileBuild(extract(g)).marginAhead >= 1;
    };
    let level = 1;
    if (main && !clears(1)) {
      let hi = 2;
      while (hi < 64 && !clears(hi)) hi *= 2;
      let lo = hi / 2;
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        if (clears(mid)) hi = mid;
        else lo = mid;
      }
      level = hi;
    }
    hit = { main, level };
    calibrated.set(key, hit);
  }
  setLevels(g, hit.main, hit.level);
}

function visitState(v: Visit, ante: number): Snapshot {
  const g = baseState(v.held, ante, v.money ?? 25, v.video, v.deck);
  calibrate(g, `${v.video}:${v.start}:${v.where}`, v.video, v.start);
  const offered = v.jokers.map((j, i) => jokerCard(j, 500 + i, true));
  if (v.where === "shop") g.shop = { count: offered.length, limit: offered.length, cards: offered };
  else {
    g.state = "SMODS_BOOSTER_OPENED";
    g.pack = { count: offered.length, limit: offered.length, cards: offered, choices_remaining: 1 } as GameState["pack"];
    g.pack_ready = true;
  }
  return extract(g);
}

/** The offered joker a candidate acquires, if any. */
function acquires(c: Candidate, s: Snapshot): string | undefined {
  if (!["buy", "swap", "pack"].includes(c.kind)) return undefined;
  const i = c.call.params?.card;
  const item = typeof i === "number" ? (c.call.method === "pack" ? s.pack[i] : s.shop.find((x) => x.index === i)) : undefined;
  return item?.set === "JOKER" ? item.key : undefined;
}

interface Row {
  video: string;
  t: number;
  phase: "early" | "mid" | "endless" | "unknown";
  /** He took one of the offered jokers / the agent would. */
  heTook?: string;
  agentTakes?: string;
  agentMove?: string;
  /** The agent's top-ranked offered joker, ignoring whether it would leave instead. */
  agentTop?: string;
  /** Offered jokers he looked over and passed on. */
  looked: string[];
  offered: number;
  moneyKnown: boolean;
  slotsFull: boolean;
  behind: boolean;
  ante?: number;
  money?: number;
  where: "shop" | "pack";
}

function scoreVisit(v: Visit, priors: ReturnType<typeof computePriors>, weight: number): Row {
  const ante = v.ante ?? 4;
  const s = visitState(v, ante);
  const set = buildCandidates(s, { endless: ante > 8, maxOptions: 24, expert: weight > 0 ? priors : undefined, expertWeight: weight, swapMargin });
  const jokerMoves = set.candidates.flatMap((c) => {
    const key = acquires(c, s);
    return key ? [{ key, u: c.utility, label: c.label }] : [];
  });
  // Rank every offered joker by its value to the run, even ones a full row or the money keeps off the list.
  const profile = profileBuild(s);
  const items = v.where === "shop" ? s.shop : s.pack;
  const value = new Map(items.map((i) => [i.key, offerValue(s, i, { profile, expert: weight > 0 ? priors : undefined, expertWeight: weight })]));
  const ranked = [...v.jokers].sort((a, b) => (value.get(b.key) ?? 0) - (value.get(a.key) ?? 0));
  const exit = set.candidates.find((c) => c.kind === "next_round" || c.kind === "pack_skip")?.utility ?? 0;
  const best = [...jokerMoves].sort((a, b) => b.u - a.u)[0];
  return {
    video: v.video,
    t: v.start,
    phase: v.ante === undefined ? "unknown" : v.ante <= 3 ? "early" : v.ante <= 8 ? "mid" : "endless",
    heTook: v.taken[0]?.key,
    agentTakes: best && best.u >= exit ? best.key : undefined,
    agentMove: best && best.u >= exit ? best.label : undefined,
    agentTop: ranked[0]?.key,
    looked: v.looked,
    slotsFull: s.jokers.length >= s.jokerSlots,
    behind: profile.econ.behind,
    offered: v.jokers.length,
    moneyKnown: v.money !== undefined,
    ante: v.ante,
    money: v.money,
    where: v.where,
  };
}

/** Sells: how often his sold joker is the one the profile rates least worth keeping. */
function scoreSell(d: Decision): { hit: boolean; n: number; sold: string; weakest: string; rank: number; ante?: number; row: string } | undefined {
  if (d.type !== "sell_joker" || !d.item || !d.jokers_before || d.jokers_before.length < 2) return undefined;
  const video = videos.find((v) => v.video_id === d.video_id);
  if (!video) return undefined;
  const g = baseState(d.jokers_before, d.ante && d.ante >= 1 ? d.ante : 4, d.money_before ?? 20, d.video_id, deckAt(video, decisions, d.t_seconds));
  calibrate(g, `${d.video_id}:${d.t_seconds}:sell`, d.video_id, d.t_seconds);
  const s = extract(g);
  const roles = profileBuild(s).jokers.filter((j) => !j.eternal);
  if (roles.length < 2 || !roles.some((r) => r.key === d.item!.key)) return undefined;
  const order = [...roles].sort((a, b) => a.worth - b.worth);
  return { hit: order[0].key === d.item.key, n: roles.length, sold: d.item.key, weakest: order[0].key, rank: order.findIndex((r) => r.key === d.item!.key), ante: d.ante ?? undefined, row: order.map((r) => `${r.key.slice(2)}:${r.worth.toFixed(2)}`).join(" ") };
}

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%`.padStart(4) : "  - ");

console.log(`${videos.length} videos (${videos.map((v) => `${v.video_id} ${settings.get(v.video_id)?.deck ?? "?"}/${settings.get(v.video_id)?.stake ?? "?"}`).join(", ")}). Leave-one-video-out; utilities only (no model calls).\n`);
const results = new Map<number, Row[]>();
for (const w of weights) {
  const rows: Row[] = [];
  for (const v of videos) {
    if (only && !only.includes(v.video_id)) continue;
    const priors = computePriors(videos.filter((x) => x !== v), decisions);
    for (const visit of visitsOf(v, decisions)) rows.push(scoreVisit(visit, priors, w));
  }
  results.set(w, rows);
}

console.log("Pick: of visits where he took a joker from 2+ offered, how often the agent ranks his pick first.");
console.log("Take: of visits with known money, how often the agent and he agree on taking a joker at all.\n");
console.log("weight | pick early    mid      endless  all      | take early    mid      endless  all");
for (const [w, rows] of results) {
  const picks = rows.filter((r) => r.heTook && r.offered >= 2);
  const takes = rows.filter((r) => r.moneyKnown);
  const pick = (f: (r: Row) => boolean) => {
    const sub = picks.filter(f);
    return `${pct(sub.filter((r) => r.agentTop === r.heTook).length, sub.length)}/${String(sub.length).padEnd(3)}`;
  };
  const take = (f: (r: Row) => boolean) => {
    const sub = takes.filter(f);
    return `${pct(sub.filter((r) => Boolean(r.agentTakes) === Boolean(r.heTook)).length, sub.length)}/${String(sub.length).padEnd(3)}`;
  };
  console.log(
    `${String(w).padStart(6)} |      ${pick((r) => r.phase === "early")} ${pick((r) => r.phase === "mid")} ${pick((r) => r.phase === "endless")} ${pick(() => true)} | ${take((r) => r.phase === "early")} ${take((r) => r.phase === "mid")} ${take((r) => r.phase === "endless")} ${take(() => true)}`,
  );
}
const picks = results.get(weights[0])!.filter((r) => r.heTook && r.offered >= 2);
const chance = picks.reduce((a, r) => a + 1 / r.offered, 0) / Math.max(1, picks.length);
const takes = results.get(weights[0])!.filter((r) => r.moneyKnown);
const heRate = takes.filter((r) => r.heTook).length / Math.max(1, takes.length);
console.log(`\nChance level: pick ${pct(chance, 1)}; take ${pct(Math.max(heRate, 1 - heRate), 1)} by always guessing his usual answer (he takes a joker in ${pct(heRate, 1)} of visits).`);

{
  const rows = results.get(weights[0])!;
  const b = rows.filter((r) => r.behind);
  console.log(`Behind the next boss by the agent's estimate in ${pct(b.length, rows.length)} of visits (he took a joker in ${pct(b.filter((r) => r.heTook).length, b.length)} of those, ${pct(rows.filter((r) => !r.behind && r.heTook).length, rows.length - b.length)} of the rest), with levels calibrated to the blinds he beat.`);
}
for (const [w, rows] of results) {
  if (w !== EXPERT_WEIGHT && w !== weights[0]) continue;
  const sub = rows.filter((r) => r.moneyKnown);
  const cell = (agent: boolean, he: boolean, full: boolean) => sub.filter((r) => Boolean(r.agentTakes) === agent && Boolean(r.heTook) === he && r.slotsFull === full).length;
  console.log(`Take at weight ${w} (open slots / full row): both take ${cell(true, true, false)}/${cell(true, true, true)}, only the agent ${cell(true, false, false)}/${cell(true, false, true)}, only he ${cell(false, true, false)}/${cell(false, true, true)}, neither ${cell(false, false, false)}/${cell(false, false, true)}`);
}
{
  // His cursor: when the agent's first choice isn't his pick, was it one he read and passed on?
  const rows = results.get(weights.includes(EXPERT_WEIGHT) ? EXPERT_WEIGHT : weights[0])!;
  const misses = rows.filter((r) => r.heTook && r.offered >= 2 && r.agentTop !== r.heTook && r.looked.length > 0);
  const lookedAt = misses.filter((r) => r.agentTop && r.looked.includes(r.agentTop)).length;
  const watched = rows.filter((r) => r.looked.length > 0 && r.heTook && r.offered >= 2);
  console.log(`Hover: in ${watched.length} picks with cursor data, the agent's first choice was his pick in ${pct(watched.filter((r) => r.agentTop === r.heTook).length, watched.length)}; in ${pct(lookedAt, misses.length)} of the ${misses.length} misses it was a joker he looked over and passed on.`);
}
const sells = decisions.flatMap((d) => scoreSell(d) ?? []);
const sellChance = sells.reduce((a, x) => a + 1 / x.n, 0) / Math.max(1, sells.length);
// Where his sold joker sits in the agent's keep order: 0% is the one it would sell first, 100% the last; random is 50%.
const sellRank = sells.reduce((a, x) => a + x.rank / (x.n - 1), 0) / Math.max(1, sells.length);
console.log(`Sell: his sold joker is the one the agent rates weakest in ${pct(sells.filter((x) => x.hit).length, sells.length)} of ${sells.length} sells (chance ${pct(sellChance, 1)}); on average it sits ${pct(sellRank, 1)} of the way up the agent's keep order (random 50%).`);

if (arg("sells") !== undefined) {
  console.log("\nSell misses (ante, he sold, rank of his pick in the agent's worth order, the row by worth):");
  for (const x of sells.filter((x) => !x.hit)) console.log(`  a${x.ante} ${x.sold.slice(2).padEnd(18)} #${x.rank + 1}/${x.n}  ${x.row}`);
}

if (showMisses) {
  const rows = results.get(weights.includes(EXPERT_WEIGHT) ? EXPERT_WEIGHT : weights[0])!;
  console.log("\nPick misses (video, second, he took, agent ranked first):");
  for (const r of rows.filter((r) => r.heTook && r.offered >= 2 && r.agentTop !== r.heTook)) console.log(`  ${r.video} ${r.t}s ${r.phase}: ${r.heTook} vs ${r.agentTop}`);
}

if (showTakes) {
  const rows = results.get(weights.includes(EXPERT_WEIGHT) ? EXPERT_WEIGHT : weights[0])!;
  console.log("\nTakes he did not make (video, second, ante phase, row, agent move | he took):");
  for (const r of rows.filter((r) => r.moneyKnown && r.agentTakes && r.agentTakes !== r.heTook)) {
    console.log(`  ${r.video} ${r.t}s ${r.phase} a${r.ante} $${r.money} ${r.where} ${r.slotsFull ? "full" : "open"}: ${r.agentMove} | ${r.heTook ?? "nothing"}`);
  }
}

// --debug VIDEO:SECOND prints one visit as the agent sees it: the row's worth and each offer's value.
const debug = arg("debug");
if (debug) {
  const [vid, sec] = debug.split(":");
  const v = videos.find((x) => x.video_id === vid)!;
  const visit = visitsOf(v, decisions).find((x) => x.start === Number(sec))!;
  const priors = computePriors(videos.filter((x) => x !== v), decisions);
  const s = visitState(visit, visit.ante ?? 4);
  const p = profileBuild(s);
  console.log(`\n${vid} ${sec}s ante ${visit.ante ?? "?"} $${visit.money ?? "?"}: build ${p.primary.name}, power ${p.power}, needs ${p.needs.join(", ") || "-"}, he took ${visit.taken.map((j) => j.key).join(", ") || "nothing"}`);
  for (const r of p.jokers) console.log(`  held ${r.label.padEnd(18)} keep ${r.keep.toFixed(2)} worth ${r.worth.toFixed(2)} (${r.note})`);
  for (const i of visit.where === "shop" ? s.shop : s.pack) console.log(`  offer ${i.label.padEnd(17)} value ${offerValue(s, i, { profile: p, expert: priors }).toFixed(2)}`);
  for (const c of buildCandidates(s, { endless: false, maxOptions: 24, expert: priors }).candidates.slice(0, 6)) console.log(`  move ${c.label.padEnd(40)} ${c.utility.toFixed(2)}${arg("why") ? `\n       ${c.description}` : ""}`);
}
