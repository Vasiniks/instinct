// Poker-hand detection and a joker-aware score estimate.
// This is the "exact-hand evaluator" the model leans on: code owns card math, the model owns judgment.
// Vanilla jokers with conditions are modelled by key; any other joker (modded, Cryptid, scaling) falls
// back to its live `value.stats` snapshot applied unconditionally, so estimates are marked approximate.

import { FACE_RANKS, RANKS, SUITS, rankChips, rankValue, type PCard } from "./cards.ts";

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
  /** The whole deck's make-up, for jokers that count it (Steel Joker, Stone Joker, Blue Joker, ...). */
  deck?: DeckCounts;
  /** Money held, for Bull and Bootstraps. */
  money?: number;
  /** This round's Ancient Joker suit and Idol card; unknown (a forecast rounds ahead), they score at their expectation. */
  roundCards?: RoundCards;
  /** The Arm: the played hand loses a level before it scores. */
  armDown?: boolean;
  /** The Flint: the hand's base chips and mult are halved (rounded) before the cards score. */
  halveBase?: boolean;
  /**
   * The game's rolls, when they are known (the simulator rolls them): a Lucky Card's 1 in 5 for +20
   * Mult and Bloodstone's 1 in 2 for X1.5, per card and trigger. Without it they score at their
   * expectation, Oops! All 6s doubling the odds.
   */
  chance?: (kind: "lucky" | "bloodstone", card: PCard, trigger: number) => boolean;
}

export interface RoundCards {
  ancientSuit?: string;
  idolRank?: string;
  idolSuit?: string;
}

export interface DeckCounts {
  /** Cards in the deck now, and at the start of the run. */
  size: number;
  startSize: number;
  /** Cards still to draw this round. */
  left: number;
  steel: number;
  stone: number;
  enhanced: number;
}

/** Jokers that read `ScoreContext.deck`; the counts are only worked out when one is in the row. */
const DECK_JOKERS = new Set(["j_stone", "j_steel_joker", "j_blue_joker", "j_erosion", "j_drivers_license"]);
export const countsDeck = (jokers: Joker[]) => jokers.some((j) => DECK_JOKERS.has(j.key));

/**
 * `cards` are the cards in view; mid-round that is the draw pile and the hand, not the cards
 * already played or discarded, so with the deck's real `size` (the game's run.deck_size) the
 * enhancement counts are scaled up from the ones in view.
 */
export function deckCounts(cards: PCard[], left: number, startSize = 52, size = cards.length): DeckCounts {
  const scale = cards.length && size > cards.length ? size / cards.length : 1;
  const count = (f: (c: PCard) => boolean) => Math.round(cards.filter(f).length * scale);
  return {
    size,
    startSize,
    left,
    steel: count((c) => c.enhancement === "STEEL"),
    stone: count((c) => c.enhancement === "STONE"),
    enhanced: count((c) => Boolean(c.enhancement)),
  };
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

// The evaluator runs millions of times a game inside the round simulations, so it works on small
// arrays indexed by rank value instead of maps and sets; test/evaluator.test.ts holds it to the
// plain version it replaced, hand for hand.

/** rankValue as a table: 2-14, and 1 for anything unknown (as indexOf + 2 gives). */
const RANK_VALUE: Record<string, number> = Object.fromEntries(RANKS.map((r, i) => [r, i + 2]));
const valueOf = (rank: string) => RANK_VALUE[rank] ?? 1;
const SUIT_INDEX: Record<string, number> = { S: 0, H: 1, C: 2, D: 3 };

/** Each card's suits as indices into SUITS (suitsOf without the arrays). */
function suitMask(c: PCard, rules: Rules): number {
  if (c.enhancement === "WILD" && !c.debuff) return 15;
  if (!c.suit) return 0;
  if (rules.smeared) return c.suit === "H" || c.suit === "D" ? 0b1010 : 0b0101;
  const i = SUIT_INDEX[c.suit];
  return i === undefined ? 0 : 1 << i;
}

function findFlush(cards: PCard[], rules: Rules): PCard[] | null {
  const need = rules.fourFingers ? 4 : 5;
  if (cards.length < need) return null;
  const masks = cards.map((c) => suitMask(c, rules));
  let bestSuit = -1;
  let bestCount = 0;
  for (let si = 0; si < 4; si++) {
    let n = 0;
    for (const m of masks) if (m & (1 << si)) n++;
    if (n >= need && n > bestCount) {
      bestSuit = si;
      bestCount = n;
    }
  }
  return bestSuit < 0 ? null : cards.filter((_, i) => masks[i] & (1 << bestSuit));
}

function findStraight(cards: PCard[], rules: Rules): PCard[] | null {
  const need = rules.fourFingers ? 4 : 5;
  const maxGap = rules.shortcut ? 2 : 1;
  let present = 0;
  let ranked = 0;
  for (const c of cards) {
    if (!c.rank) continue;
    ranked++;
    const v = valueOf(c.rank);
    present |= 1 << v;
    if (v === 14) present |= 2;
  }
  if (ranked < need) return null;
  // The longest run of present values, gaps up to maxGap, the first longest kept.
  let runStart = -1;
  let runLast = -1;
  let runLen = 0;
  let bestStart = -1;
  let bestLast = -1;
  let bestLen = 0;
  for (let v = 1; v <= 14; v++) {
    if (!(present & (1 << v))) continue;
    if (runLen && v - runLast <= maxGap) {
      runLast = v;
      runLen++;
    } else {
      runStart = v;
      runLast = v;
      runLen = 1;
    }
    if (runLen > bestLen) {
      bestStart = runStart;
      bestLast = runLast;
      bestLen = runLen;
    }
  }
  if (bestLen < need) return null;
  // The run's values (a low ace counts as 14 again), and the cards that have them.
  let inRun = 0;
  for (let v = bestStart; v <= bestLast; v++) if (present & (1 << v)) inRun |= 1 << (v === 1 ? 14 : v);
  return cards.filter((c) => c.rank && inRun & (1 << valueOf(c.rank)));
}

export function evaluateHand(cards: PCard[], rules: Rules = NO_RULES): Evaluation {
  // Rank groups, in card order within each, sorted by size then rank, high first.
  const byValue: PCard[][] = [];
  let high: PCard | undefined;
  for (const c of cards) {
    if (!c.rank) continue;
    const v = valueOf(c.rank);
    (byValue[v] ??= []).push(c);
    if (!high || v > valueOf(high.rank!)) high = c;
  }
  const groups: PCard[][] = [];
  for (let v = 14; v >= 1; v--) if (byValue[v]) groups.push(byValue[v]);
  groups.sort((a, b) => b.length - a.length);
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

  const union = (...sets: PCard[][]) => {
    const inAny = new Set<PCard>();
    for (const set of sets) for (const c of set) inAny.add(c);
    return cards.filter((c) => inAny.has(c));
  };
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
  else [hand, scoring] = ["High Card", high ? [high] : []];
  contains.add(hand);

  if (rules.splash) scoring = [...cards];
  else if (cards.some((c) => c.enhancement === "STONE")) {
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
  /** Extra triggers for every card held in hand (Mime). */
  heldRetrigger?: number;
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
  // The game counts the hand being played.
  j_supernova: { main: (p) => ({ mult: (p.ctx.levels[p.ev.hand]?.played ?? 0) + 1 }) },
  // Scaling jokers step before the hand scores: the live value is the one before this hand.
  j_green_joker: { main: (_p, j) => ({ mult: stat(j, "mult", 0) + 1 }) },
  j_ride_the_bus: { main: (p, j) => (p.ev.scoring.some((c) => isFace(c, p.ctx.rules)) ? null : { mult: stat(j, "mult", 0) + 1 }) },
  j_runner: { main: (p, j) => ({ chips: stat(j, "chips", 0) + (p.ev.contains.has("Straight") ? 15 : 0) }) },
  j_square: { main: (p, j) => ({ chips: stat(j, "chips", 0) + (p.played.length === 4 ? 4 : 0) }) },
  j_trousers: { main: (p, j) => ({ mult: stat(j, "mult", 0) + (p.ev.contains.has("Two Pair") ? 2 : 0) }) },
  // Resets to X1 on the most played hand (counting this one: more plays than every other hand).
  j_obelisk: {
    main: (p, j) => {
      const mine = (p.ctx.levels[p.ev.hand]?.played ?? 0) + 1;
      const most = Object.entries(p.ctx.levels).every(([h, l]) => h === p.ev.hand || (l?.played ?? 0) < mine);
      return most ? null : { xmult: stat(j, "x_mult", 1) + 0.2 };
    },
  },
  // X4 on the hand its count reaches: the game reports 0 remaining just before it.
  j_loyalty_card: {
    main: (_p, j) => {
      const left = j.stats.loyalty_remaining;
      const x = stat(j, "loyalty_x_mult", 4);
      if (!Number.isFinite(left)) return { xmult: 1 + (x - 1) / (stat(j, "loyalty_every", 5) + 1) };
      return left === 0 ? { xmult: x } : null;
    },
  },
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
  j_bloodstone: {
    card: (c, _i, p) => {
      if (!suitsOf(c, p.ctx.rules).includes("H")) return null;
      if (p.ctx.chance) return p.ctx.chance("bloodstone", c, 0) ? { xmult: 1.5 } : null;
      return { xmult: 1 + 0.5 * Math.min(1, oddsOf(p.ctx.jokers) / 2) };
    },
  },
  j_baron: { held: (h) => (h.rank === "K" ? { xmult: 1.5 } : null) },
  j_shoot_the_moon: { held: (h) => (h.rank === "Q" ? { mult: 13 } : null) },
  // The game picks the lowest held card (Stone cards aside), debuffed or not, and a debuffed one
  // gives nothing; it acts in the held-card pass, so Mime and Red Seals retrigger it.
  j_raised_fist: {
    held: (h, p) => {
      const low = p.ctx.held.filter((c) => c.rank && c.enhancement !== "STONE").reduce<PCard | undefined>((a, c) => (!a || rankValue(c.rank!) <= rankValue(a.rank!) ? c : a), undefined);
      return low === h ? { mult: 2 * rankChips(h.rank!) } : null;
    },
  },
  j_hack: { retrigger: (c) => (c.rank && ["2", "3", "4", "5"].includes(c.rank) ? 1 : 0) },
  j_sock_and_buskin: { retrigger: (c, _i, p) => (isFace(c, p.ctx.rules) ? 1 : 0) },
  j_hanging_chad: { retrigger: (_c, i) => (i === 0 ? 2 : 0) },
  // The game's own key is misspelled.
  j_selzer: { retrigger: () => 1 },
  j_dusk: { retrigger: (_c, _i, p) => (p.ctx.handsLeft <= 1 ? 1 : 0) },
  // Flat or counted bonuses. Misprint is +0 to +23 Mult: its expectation.
  j_misprint: { main: () => ({ mult: 11.5 }) },
  j_stuntman: { main: (_p, j) => ({ chips: stat(j, "chips", 250) }) },
  j_gros_michel: { main: (_p, j) => ({ mult: stat(j, "mult", 15) }) },
  j_cavendish: { main: (_p, j) => ({ xmult: stat(j, "x_mult", 3) }) },
  j_bull: { main: (p, j) => ({ chips: stat(j, "chips", 2 * Math.max(0, p.ctx.money ?? 0)) }) },
  // The mod reports its rate (+2 per $5), not the bonus.
  j_bootstraps: { main: (p, j) => ({ mult: stat(j, "mult", 2) * Math.floor(Math.max(0, p.ctx.money ?? 0) / 5) }) },
  j_stone: { main: (p, j) => ({ chips: stat(j, "chips", 25 * (p.ctx.deck?.stone ?? 0)) }) },
  j_steel_joker: { main: (p, j) => ({ xmult: stat(j, "x_mult", 1 + 0.2 * (p.ctx.deck?.steel ?? 0)) }) },
  j_blue_joker: { main: (p, j) => ({ chips: stat(j, "chips", 2 * (p.ctx.deck?.left ?? 0)) }) },
  j_erosion: { main: (p, j) => ({ mult: stat(j, "mult", 4 * Math.max(0, (p.ctx.deck?.startSize ?? 52) - (p.ctx.deck?.size ?? 52))) }) },
  j_drivers_license: { main: (p) => ((p.ctx.deck?.enhanced ?? 0) >= 16 ? { xmult: 3 } : null) },
  j_swashbuckler: { main: (p, j) => ({ mult: stat(j, "mult", p.ctx.jokers.filter((x) => x !== j).reduce((a, x) => a + (x.sell ?? 0), 0)) }) },
  j_baseball: { main: (p) => ({ xmult: 1.5 ** p.ctx.jokers.filter((x) => x.rarity === "UNCOMMON").length }) },
  // X1.5 per scoring card of a suit that changes each round: a quarter of cards on average.
  // X1.5 per scored card of the round's suit; unknown, one card in four on average.
  j_ancient: {
    card: (c, _i, p) => {
      const suit = p.ctx.roundCards?.ancientSuit;
      if (!suit) return { xmult: 1.125 };
      return suitsOf(c, p.ctx.rules).includes(suit) ? { xmult: 1.5 } : null;
    },
  },
  // X2 per scored card of the round's rank and suit; unknown, it's one card in the deck.
  j_idol: {
    card: (c, _i, p) => {
      const r = p.ctx.roundCards;
      if (!r?.idolRank || !r.idolSuit) return null;
      return c.rank === r.idolRank && suitsOf(c, p.ctx.rules).includes(r.idolSuit) ? { xmult: 2 } : null;
    },
  },
  // Retriggers every card held in hand.
  j_mime: { heldRetrigger: 1 },
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

/**
 * A joker row's resolved rules, its chance multiplier and whether any joker is scored from live
 * stats only. Rows are never changed once built, so each is resolved once: the round simulations
 * score thousands of hands with the same row.
 */
const resolved = new WeakMap<Joker[], { rules: { joker: Joker; rule: JokerRule }[]; odds: number; approximate: boolean }>();
function rulesFor(jokers: Joker[]) {
  let r = resolved.get(jokers);
  if (!r) {
    r = { rules: activeRules(jokers), odds: oddsOf(jokers), approximate: jokers.some((j) => !j.debuff && !isModelledJoker(j.key) && j.key !== "j_blueprint" && j.key !== "j_brainstorm") };
    resolved.set(jokers, r);
  }
  return r;
}

/** Oops! All 6s doubles every listed chance, once per copy. */
const oddsOf = (jokers: Joker[]) => 2 ** jokers.filter((j) => j.key === "j_oops" && !j.debuff).length;

/** One level lower, as The Arm leaves it; level 1 is the floor. */
export function levelDown(l: HandLevel, hand: HandName): HandLevel {
  if (l.level <= 1) return l;
  const b = BASE_HANDS[hand];
  return { ...l, level: l.level - 1, chips: Math.max(b.chips, l.chips - b.lchips), mult: Math.max(b.mult, l.mult - b.lmult) };
}

export function levelOf(levels: ScoreContext["levels"], hand: HandName): HandLevel {
  const l = levels[hand];
  if (l) return l;
  const b = BASE_HANDS[hand];
  return { level: 1, chips: b.chips, mult: b.mult, played: 0, played_this_round: 0 };
}

/** `ev`: the played cards' evaluation under `ctx.rules`, when the caller already has it. */
export function estimateScore(played: PCard[], ctx: ScoreContext, ev: Evaluation = evaluateHand(played, ctx.rules)): Estimate {
  const lvl = ctx.armDown ? levelDown(levelOf(ctx.levels, ev.hand), ev.hand) : levelOf(ctx.levels, ev.hand);
  let chips = ctx.halveBase ? Math.max(0, Math.floor(lvl.chips * 0.5 + 0.5)) : lvl.chips;
  let mult = ctx.halveBase ? Math.max(1, Math.floor(lvl.mult * 0.5 + 0.5)) : lvl.mult;
  const apply = (d: Delta | null) => {
    if (!d) return;
    chips += d.chips ?? 0;
    mult += d.mult ?? 0;
    if (d.xmult) mult *= d.xmult;
  };
  const { rules, odds, approximate } = rulesFor(ctx.jokers);
  const info: PlayInfo = { ev, played, ctx, jokers: ctx.jokers };

  ev.scoring.forEach((c, i) => {
    if (c.debuff || c.hidden) return;
    let triggers = 1 + (c.seal === "RED" ? 1 : 0);
    for (const { rule } of rules) triggers += rule.retrigger?.(c, i, info) ?? 0;
    for (let t = 0; t < triggers; t++) {
      chips += c.enhancement === "STONE" ? 50 : rankChips(c.rank ?? "2");
      if (c.enhancement === "BONUS") chips += 30;
      if (c.enhancement === "MULT") mult += 4;
      if (c.enhancement === "LUCKY") mult += ctx.chance ? (ctx.chance("lucky", c, t) ? 20 : 0) : 20 * Math.min(1, odds / 5);
      if (c.edition === "FOIL") chips += 50;
      if (c.edition === "HOLO") mult += 10;
      if (c.enhancement === "GLASS") mult *= 2;
      for (const { joker, rule } of rules) apply(rule.card?.(c, i, info, joker) ?? null);
      if (c.edition === "POLYCHROME") mult *= 1.5;
    }
  });

  for (const h of ctx.held) {
    if (h.debuff || h.hidden) continue;
    const triggers = 1 + (h.seal === "RED" ? 1 : 0) + rules.reduce((n, { rule }) => n + (rule.heldRetrigger ?? 0), 0);
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
  return {
    hand: ev.hand,
    chips: Math.round(chips),
    mult: Math.round(mult * 100) / 100,
    score: Math.floor(chips * mult),
    scoring: ev.scoring.map((c) => c.index),
    approximate,
  };
}
