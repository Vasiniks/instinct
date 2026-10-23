// Poker-hand detection and a joker-aware score estimate.
// This is the "exact-hand evaluator" the model leans on: code owns card math, the model owns judgment.
// Vanilla jokers with conditions are modelled by key; any other joker (modded, Cryptid, scaling) falls
// back to its live `value.stats` snapshot applied unconditionally, so estimates are marked approximate.

import { FACE_RANKS, SUITS, rankChips, rankValue, type PCard } from "./cards.ts";

export const HAND_NAMES = [
  "Flush Five",
  "Flush House",
  "Five of a Kind",
  "Straight Flush",
  "Four of a Kind",
  "Full House",
  "Flush",
  "Straight",
  "Three of a Kind",
  "Two Pair",
  "Pair",
  "High Card",
] as const;
export type HandName = (typeof HAND_NAMES)[number];

/** Level-1 chips/mult and the per-level increase, from the base game. */
export const BASE_HANDS: Record<HandName, { chips: number; mult: number; lchips: number; lmult: number }> = {
  "Flush Five": { chips: 160, mult: 16, lchips: 50, lmult: 3 },
  "Flush House": { chips: 140, mult: 14, lchips: 40, lmult: 4 },
  "Five of a Kind": { chips: 120, mult: 12, lchips: 35, lmult: 3 },
  "Straight Flush": { chips: 100, mult: 8, lchips: 40, lmult: 4 },
  "Four of a Kind": { chips: 60, mult: 7, lchips: 30, lmult: 3 },
  "Full House": { chips: 40, mult: 4, lchips: 25, lmult: 2 },
  Flush: { chips: 35, mult: 4, lchips: 15, lmult: 2 },
  Straight: { chips: 30, mult: 4, lchips: 30, lmult: 3 },
  "Three of a Kind": { chips: 30, mult: 3, lchips: 20, lmult: 2 },
  "Two Pair": { chips: 20, mult: 2, lchips: 20, lmult: 1 },
  Pair: { chips: 10, mult: 2, lchips: 15, lmult: 1 },
  "High Card": { chips: 5, mult: 1, lchips: 10, lmult: 1 },
};

export interface Rules {
  fourFingers: boolean;
  shortcut: boolean;
  smeared: boolean;
  splash: boolean;
  pareidolia: boolean;
}

export const NO_RULES: Rules = { fourFingers: false, shortcut: false, smeared: false, splash: false, pareidolia: false };

export interface Joker {
  index: number;
  key: string;
  label: string;
  effect: string;
  stats: Record<string, number>;
  edition?: string;
  rarity?: string;
  debuff: boolean;
  eternal: boolean;
  rental?: number;
  perishable?: number;
  sell: number;
}

export interface HandLevel {
  level: number;
  chips: number;
  mult: number;
  played: number;
  played_this_round: number;
}

export interface ScoreContext {
  levels: Partial<Record<string, HandLevel>>;
  jokers: Joker[];
  /** Cards that stay in hand while the played cards score (Steel, Baron, ...). */
  held: PCard[];
  rules: Rules;
  handsLeft: number;
  discardsLeft: number;
  /** Plasma deck: chips and mult are averaged before they multiply, so the score is ((c+m)/2)^2. */
  balanced?: boolean;
}

export interface Evaluation {
  hand: HandName;
  scoring: PCard[];
  contains: Set<HandName>;
}

export interface Estimate {
  hand: HandName;
  chips: number;
  mult: number;
  score: number;
  /** Hand indices of the cards that score. */
  scoring: number[];
  approximate: boolean;
}

export function rulesFromJokers(jokers: Joker[]): Rules {
  const has = (k: string) => jokers.some((j) => j.key === k && !j.debuff);
  return {
    fourFingers: has("j_four_fingers"),
    shortcut: has("j_shortcut"),
    smeared: has("j_smeared"),
    splash: has("j_splash"),
    pareidolia: has("j_pareidolia"),
  };
}

export function suitsOf(c: PCard, rules: Rules): string[] {
  if (c.enhancement === "WILD" && !c.debuff) return [...SUITS];
  if (!c.suit) return [];
  if (rules.smeared) return c.suit === "H" || c.suit === "D" ? ["H", "D"] : ["S", "C"];
  return [c.suit];
}

export function isFace(c: PCard, rules: Rules): boolean {
  if (c.hidden || c.enhancement === "STONE") return false;
  return rules.pareidolia || FACE_RANKS.has(c.rank ?? "");
}

function findFlush(cards: PCard[], rules: Rules): PCard[] | null {
  const need = rules.fourFingers ? 4 : 5;
  let best: PCard[] | null = null;
  for (const s of SUITS) {
    const members = cards.filter((c) => suitsOf(c, rules).includes(s));
    if (members.length >= need && (!best || members.length > best.length)) best = members;
  }
  return best;
}

function findStraight(cards: PCard[], rules: Rules): PCard[] | null {
  const need = rules.fourFingers ? 4 : 5;
  const maxGap = rules.shortcut ? 2 : 1;
  const ranked = cards.filter((c) => c.rank);
  const values = new Set<number>();
  for (const c of ranked) {
    const v = rankValue(c.rank!);
    values.add(v);
    if (v === 14) values.add(1);
  }
  const sorted = [...values].sort((a, b) => a - b);
  let run: number[] = [];
  let best: number[] = [];
  for (const v of sorted) {
    if (run.length && v - run[run.length - 1] <= maxGap) run.push(v);
    else run = [v];
    if (run.length > best.length) best = [...run];
  }
  if (best.length < need) return null;
  const inRun = new Set(best.map((v) => (v === 1 ? 14 : v)));
  return ranked.filter((c) => inRun.has(rankValue(c.rank!)));
}

export function evaluateHand(cards: PCard[], rules: Rules = NO_RULES): Evaluation {
  const ranked = cards.filter((c) => c.rank);
  const byRank = new Map<string, PCard[]>();
  for (const c of ranked) byRank.set(c.rank!, [...(byRank.get(c.rank!) ?? []), c]);
  const groups = [...byRank.values()].sort((a, b) => b.length - a.length || rankValue(b[0].rank!) - rankValue(a[0].rank!));
  const top = groups[0]?.length ?? 0;
  const second = groups[1]?.length ?? 0;
  const flush = findFlush(cards, rules);
  const straight = findStraight(cards, rules);

  const contains = new Set<HandName>(["High Card"]);
  if (top >= 2) contains.add("Pair");
  if (top >= 2 && second >= 2) contains.add("Two Pair");
  if (top >= 3) contains.add("Three of a Kind");
  if (top >= 4) contains.add("Four of a Kind");
  if (top >= 5) contains.add("Five of a Kind");
  if (top >= 3 && second >= 2) contains.add("Full House");
  if (flush) contains.add("Flush");
  if (straight) contains.add("Straight");
  if (flush && straight) contains.add("Straight Flush");

  const union = (...sets: PCard[][]) => cards.filter((c) => sets.some((s) => s.includes(c)));
  let hand: HandName;
  let scoring: PCard[];
  if (top >= 5 && flush) [hand, scoring] = ["Flush Five", union(groups[0], flush)];
  else if (top >= 3 && second >= 2 && flush) [hand, scoring] = ["Flush House", union(groups[0], groups[1], flush)];
  else if (top >= 5) [hand, scoring] = ["Five of a Kind", groups[0]];
  else if (straight && flush) [hand, scoring] = ["Straight Flush", union(straight, flush)];
  else if (top >= 4) [hand, scoring] = ["Four of a Kind", groups[0]];
  else if (top >= 3 && second >= 2) [hand, scoring] = ["Full House", union(groups[0], groups[1])];
  else if (flush) [hand, scoring] = ["Flush", flush];
  else if (straight) [hand, scoring] = ["Straight", straight];
  else if (top >= 3) [hand, scoring] = ["Three of a Kind", groups[0]];
  else if (top >= 2 && second >= 2) [hand, scoring] = ["Two Pair", union(groups[0], groups[1])];
  else if (top >= 2) [hand, scoring] = ["Pair", groups[0]];
  else {
    const high = [...ranked].sort((a, b) => rankValue(b.rank!) - rankValue(a.rank!))[0];
    [hand, scoring] = ["High Card", high ? [high] : []];
  }
  contains.add(hand);

  if (rules.splash) scoring = [...cards];
  else {
    const stones = cards.filter((c) => c.enhancement === "STONE" && !scoring.includes(c));
    if (stones.length) scoring = union(scoring, stones);
  }
  return { hand, scoring, contains };
}

// ---------------------------------------------------------------------------------------------
// Joker effects
// ---------------------------------------------------------------------------------------------

interface Delta {
  chips?: number;
  mult?: number;
  xmult?: number;
}

interface PlayInfo {
  ev: Evaluation;
  played: PCard[];
  ctx: ScoreContext;
  jokers: Joker[];
}

interface JokerRule {
  /** Per scoring card, each trigger. */
  card?: (c: PCard, i: number, p: PlayInfo, j: Joker) => Delta | null;
  /** Extra triggers for a scoring card. */
  retrigger?: (c: PCard, i: number, p: PlayInfo) => number;
  /** Per card held in hand. */
  held?: (h: PCard, p: PlayInfo, j: Joker) => Delta | null;
  /** The joker's own trigger after the cards score. */
  main?: (p: PlayInfo, j: Joker) => Delta | null;
}

const stat = (j: Joker, k: string, fallback: number) => (Number.isFinite(j.stats[k]) ? j.stats[k] : fallback);
const containsMult = (hand: HandName, n: number): JokerRule => ({
  main: (p, j) => (p.ev.contains.has(hand) ? { mult: stat(j, "mult", n) } : null),
});
const containsChips = (hand: HandName, n: number): JokerRule => ({
  main: (p, j) => (p.ev.contains.has(hand) ? { chips: stat(j, "chips", n) } : null),
});
const containsX = (hand: HandName, n: number): JokerRule => ({
  main: (p, j) => (p.ev.contains.has(hand) ? { xmult: stat(j, "x_mult", n) } : null),
});
const suitMult = (suit: string, n: number): JokerRule => ({
  card: (c, _i, p) => (suitsOf(c, p.ctx.rules).includes(suit) ? { mult: n } : null),
});
const rankIn = (ranks: string[], d: Delta): JokerRule => ({
  card: (c) => (c.rank && ranks.includes(c.rank) ? d : null),
});

const JOKER_RULES: Record<string, JokerRule> = {
  j_joker: { main: (_p, j) => ({ mult: stat(j, "mult", 4) }) },
  j_greedy_joker: suitMult("D", 3),
  j_lusty_joker: suitMult("H", 3),
  j_wrathful_joker: suitMult("S", 3),
  j_gluttenous_joker: suitMult("C", 3),
  j_jolly: containsMult("Pair", 8),
  j_zany: containsMult("Three of a Kind", 12),
  j_mad: containsMult("Two Pair", 10),
  j_crazy: containsMult("Straight", 12),
  j_droll: containsMult("Flush", 10),
  j_sly: containsChips("Pair", 50),
  j_wily: containsChips("Three of a Kind", 100),
  j_clever: containsChips("Two Pair", 80),
  j_devious: containsChips("Straight", 100),
  j_crafty: containsChips("Flush", 80),
  j_duo: containsX("Pair", 2),
  j_trio: containsX("Three of a Kind", 3),
  j_family: containsX("Four of a Kind", 4),
  j_order: containsX("Straight", 3),
  j_tribe: containsX("Flush", 2),
  j_half: { main: (p, j) => (p.played.length <= 3 ? { mult: stat(j, "mult", 20) } : null) },
  j_banner: { main: (p) => ({ chips: 30 * p.ctx.discardsLeft }) },
  j_mystic_summit: { main: (p) => (p.ctx.discardsLeft === 0 ? { mult: 15 } : null) },
  j_abstract: { main: (p) => ({ mult: 3 * p.ctx.jokers.length }) },
  j_supernova: { main: (p) => ({ mult: p.ctx.levels[p.ev.hand]?.played ?? 0 }) },
  j_acrobat: { main: (p) => (p.ctx.handsLeft <= 1 ? { xmult: 3 } : null) },
  j_card_sharp: { main: (p) => ((p.ctx.levels[p.ev.hand]?.played_this_round ?? 0) > 0 ? { xmult: 3 } : null) },
  j_blackboard: {
    main: (p) => (p.ctx.held.every((h) => h.enhancement === "STONE" || suitsOf(h, p.ctx.rules).some((s) => s === "S" || s === "C")) ? { xmult: 3 } : null),
  },
  j_flower_pot: {
    main: (p) => {
      const seen = new Set(p.ev.scoring.flatMap((c) => suitsOf(c, p.ctx.rules)));
      return SUITS.every((s) => seen.has(s)) ? { xmult: 3 } : null;
    },
  },
  j_seeing_double: {
    main: (p) => {
      const club = p.ev.scoring.some((c) => suitsOf(c, p.ctx.rules).includes("C"));
      const other = p.ev.scoring.some((c) => suitsOf(c, p.ctx.rules).some((s) => s !== "C"));
      return club && other ? { xmult: 2 } : null;
    },
  },
  j_scholar: rankIn(["A"], { chips: 20, mult: 4 }),
  j_even_steven: rankIn(["2", "4", "6", "8", "T"], { mult: 4 }),
  j_odd_todd: rankIn(["A", "3", "5", "7", "9"], { chips: 31 }),
  j_fibonacci: rankIn(["A", "2", "3", "5", "8"], { mult: 8 }),
  j_walkie_talkie: rankIn(["T", "4"], { chips: 10, mult: 4 }),
  j_triboulet: rankIn(["K", "Q"], { xmult: 2 }),
  j_scary_face: { card: (c, _i, p) => (isFace(c, p.ctx.rules) ? { chips: 30 } : null) },
  j_smiley: { card: (c, _i, p) => (isFace(c, p.ctx.rules) ? { mult: 5 } : null) },
  j_photograph: {
    card: (c, _i, p) => (isFace(c, p.ctx.rules) && p.ev.scoring.find((s) => isFace(s, p.ctx.rules)) === c ? { xmult: 2 } : null),
  },
  j_arrowhead: { card: (c, _i, p) => (suitsOf(c, p.ctx.rules).includes("S") ? { chips: 50 } : null) },
  j_onyx_agate: { card: (c, _i, p) => (suitsOf(c, p.ctx.rules).includes("C") ? { mult: 7 } : null) },
  // 1 in 2 chance of X1.5: use the expectation.
  j_bloodstone: { card: (c, _i, p) => (suitsOf(c, p.ctx.rules).includes("H") ? { xmult: 1.25 } : null) },
  j_baron: { held: (h) => (h.rank === "K" ? { xmult: 1.5 } : null) },
  j_shoot_the_moon: { held: (h) => (h.rank === "Q" ? { mult: 13 } : null) },
  j_raised_fist: {
    main: (p) => {
      const low = p.ctx.held.filter((h) => h.rank && !h.debuff).sort((a, b) => rankValue(a.rank!) - rankValue(b.rank!))[0];
      return low ? { mult: 2 * rankChips(low.rank!) } : null;
    },
  },
  j_hack: { retrigger: (c) => (c.rank && ["2", "3", "4", "5"].includes(c.rank) ? 1 : 0) },
  j_sock_and_buskin: { retrigger: (c, _i, p) => (isFace(c, p.ctx.rules) ? 1 : 0) },
  j_hanging_chad: { retrigger: (_c, i) => (i === 0 ? 2 : 0) },
  // The game's own key is misspelled.
  j_selzer: { retrigger: () => 1 },
  j_dusk: { retrigger: (_c, _i, p) => (p.ctx.handsLeft <= 1 ? 1 : 0) },
  // Rule-changers handled by `rulesFromJokers`; they add no score themselves.
  j_four_fingers: {},
  j_shortcut: {},
  j_smeared: {},
  j_splash: {},
  j_pareidolia: {},
};

/** Unknown jokers: trust the live stats snapshot (scaling jokers carry their current value there). */
function statsRule(j: Joker): JokerRule {
  return {
    main: () => {
      const d: Delta = {};
      if (j.stats.chips) d.chips = j.stats.chips;
      if (j.stats.mult) d.mult = j.stats.mult;
      const x = j.stats.x_mult ?? j.stats.caino_xmult;
      if (x && x > 1) d.xmult = x;
      return d.chips || d.mult || d.xmult ? d : null;
    },
  };
}

/** Jokers whose effect the estimator scores from their key, without the game's live stats. */
export const MODELLED_JOKERS = Object.keys(JOKER_RULES);

export function isModelledJoker(key: string): boolean {
  return key in JOKER_RULES;
}

/** Resolve Blueprint/Brainstorm copies and drop debuffed jokers; order is preserved. */
function activeRules(jokers: Joker[]): { joker: Joker; rule: JokerRule }[] {
  const ruleOf = (j: Joker | undefined, depth = 0): JokerRule | null => {
    if (!j || j.debuff || depth > jokers.length) return null;
    if (j.key === "j_blueprint") return ruleOf(jokers[j.index + 1], depth + 1);
    if (j.key === "j_brainstorm") return j.index === 0 ? null : ruleOf(jokers[0], depth + 1);
    return JOKER_RULES[j.key] ?? statsRule(j);
  };
  const out: { joker: Joker; rule: JokerRule }[] = [];
  for (const j of jokers) {
    const rule = ruleOf(j);
    if (rule) out.push({ joker: j, rule });
  }
  return out;
}

export function levelOf(levels: ScoreContext["levels"], hand: HandName): HandLevel {
  const l = levels[hand];
  if (l) return l;
  const b = BASE_HANDS[hand];
  return { level: 1, chips: b.chips, mult: b.mult, played: 0, played_this_round: 0 };
}

export function estimateScore(played: PCard[], ctx: ScoreContext): Estimate {
  const ev = evaluateHand(played, ctx.rules);
  const lvl = levelOf(ctx.levels, ev.hand);
  let chips = lvl.chips;
  let mult = lvl.mult;
  const apply = (d: Delta | null) => {
    if (!d) return;
    chips += d.chips ?? 0;
    mult += d.mult ?? 0;
    if (d.xmult) mult *= d.xmult;
  };
  const rules = activeRules(ctx.jokers);
  const info: PlayInfo = { ev, played, ctx, jokers: ctx.jokers };

  ev.scoring.forEach((c, i) => {
    if (c.debuff || c.hidden) return;
    let triggers = 1 + (c.seal === "RED" ? 1 : 0);
    for (const { rule } of rules) triggers += rule.retrigger?.(c, i, info) ?? 0;
    for (let t = 0; t < triggers; t++) {
      chips += c.enhancement === "STONE" ? 50 : rankChips(c.rank ?? "2");
      if (c.enhancement === "BONUS") chips += 30;
      if (c.enhancement === "MULT") mult += 4;
      if (c.enhancement === "LUCKY") mult += 4; // 1 in 5 for +20
      if (c.edition === "FOIL") chips += 50;
      if (c.edition === "HOLO") mult += 10;
      if (c.enhancement === "GLASS") mult *= 2;
      for (const { joker, rule } of rules) apply(rule.card?.(c, i, info, joker) ?? null);
      if (c.edition === "POLYCHROME") mult *= 1.5;
    }
  });

  for (const h of ctx.held) {
    if (h.debuff || h.hidden) continue;
    const triggers = 1 + (h.seal === "RED" ? 1 : 0);
    for (let t = 0; t < triggers; t++) {
      if (h.enhancement === "STEEL") mult *= 1.5;
      for (const { joker, rule } of rules) apply(rule.held?.(h, info, joker) ?? null);
    }
  }

  for (const { joker, rule } of rules) {
    if (joker.edition === "FOIL") chips += 50;
    if (joker.edition === "HOLO") mult += 10;
    apply(rule.main?.(info, joker) ?? null);
    if (joker.edition === "POLYCHROME") mult *= 1.5;
  }

  if (ctx.balanced) chips = mult = (chips + mult) / 2;
  const approximate = ctx.jokers.some((j) => !j.debuff && !isModelledJoker(j.key) && j.key !== "j_blueprint" && j.key !== "j_brainstorm");
  return {
    hand: ev.hand,
    chips: Math.round(chips),
    mult: Math.round(mult * 100) / 100,
    score: Math.floor(chips * mult),
    scoring: ev.scoring.map((c) => c.index),
    approximate,
  };
}
