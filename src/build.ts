// The build profile, read fresh from every snapshot: which build the jokers, hand levels and deck
// add up to (and which builds the run could pivot to), how strong it is against the blinds ahead,
// what it is missing, which joker is dead weight, where the economy stands, and how the deck
// should be fixed. The plan (plan.ts) carries the chosen build across ticks.

import { FACE_RANKS, SUITS, SUIT_NAME, cardWorth, rankValue, type PCard } from "./cards.ts";
import type { Snapshot } from "./extract.ts";
import { ARCHETYPES, DECKS, ROLE_TAGS, SUIT_TAG, TAG_HANDS, blindBase, conditions, jokerTags, stakeAtLeast, type Conditions } from "./knowledge.ts";
import { estimateScore, suitsOf, type Joker, type ScoreContext } from "./poker.ts";

export interface JokerRole {
  index: number;
  key: string;
  label: string;
  tags: string[];
  /** Share of the build hand's score this joker provides (0 when removing it costs nothing). */
  contribution: number;
  /** Worth keeping: score contribution plus economy, scaling and utility value. */
  keep: number;
  /**
   * On the same scale as an offer's value: the larger of `keep` and what this joker would be worth
   * to buy right now if the row did not have it. Swaps compare an offer against this, so a joker is
   * only sold for something clearly better than itself.
   */
  worth: number;
  fits: boolean;
  eternal: boolean;
  sell: number;
  note: string;
}

export interface ArchetypeScore {
  name: string;
  score: number;
  /** Estimated score of one typical hand of this build with the current jokers and levels. */
  power: number;
  reasons: string[];
}

export interface EconPlan {
  mode: "build" | "save" | "spend";
  interestCap: number;
  interestNow: number;
  /** Money to keep after a purchase unless the purchase is core to the build. */
  reserve: number;
  incomePerRound: number;
  /** How much the stake and deck make economy matter (Conditions.econPressure). */
  pressure: number;
  /** Money above what maxes interest (after rent): it earns nothing held, so it is free to spend. */
  surplus: number;
  /** The build scores under the next ante's boss: spending on power is urgent. */
  behind: boolean;
  note: string;
}

export interface DeckFix {
  goal: string;
  /** The suit a Flush build collects, only when there is a reason: a suit joker, or a deck that leans to it. */
  suit?: string;
  suitShare: number;
  deckSize: number;
  /** The deck's most common suit, for estimates when no suit is the build's. */
  commonSuit?: string;
}

export interface PivotOption {
  to: string;
  /** The offered joker that makes the pivot worth it, if any. */
  via?: { key: string; label: string; source: "shop" | "pack" };
  score: number;
  why: string;
  /** Owned jokers that would stop pulling weight. */
  wouldDrop: string[];
}

export interface BuildProfile {
  archetypes: ArchetypeScore[];
  primary: ArchetypeScore;
  theme?: string;
  power: number;
  chips: number;
  mult: number;
  hands: number;
  targets: { label: string; target: number }[];
  /** Typical hand x hands per round, over the next blind's target. */
  margin: number;
  /** Same, against the next ante's boss. */
  marginAhead: number;
  needs: string[];
  jokers: JokerRole[];
  weakest?: JokerRole;
  synergy: { score: number; active: string[]; dead: string[] };
  pivots: PivotOption[];
  econ: EconPlan;
  deckFix: DeckFix;
  /** Stake and deck rules that change how to play. */
  cond: Conditions;
}

/**
 * Sticker costs on a joker's value. A Rental joker drains money every round, which at the stakes
 * that have them is the economy the run depends on; a Perishable one dies after 5 rounds, which
 * hurts most for a scaling joker that needs time to grow.
 */
export function stickerPenalty(j: { rental?: number; perishable?: number }, tags: Set<string>, value: number): { penalty: number; note?: string } {
  let penalty = 0;
  const notes: string[] = [];
  if (j.rental) {
    penalty += Math.min(0.3, j.rental * 0.05) * (value >= 0.8 ? 0.5 : 1);
    notes.push(`rental: costs $${j.rental} every round`);
  }
  if (j.perishable !== undefined) {
    penalty += j.perishable <= 1 ? 0.4 : tags.has("scaling") ? 0.25 : 0.12;
    notes.push(`perishable: ${j.perishable} round${j.perishable === 1 ? "" : "s"} left`);
  }
  return { penalty, note: notes.join(", ") || undefined };
}

const ROLE_WEIGHT: Record<string, number> = { xmult: 3, mult: 2, chips: 1.5, retrigger: 1.5 };

const phantom = (rank: string, suit: string, i: number): PCard => ({ index: -100 - i, id: -100 - i, rank, suit, debuff: false, hidden: false, forced: false, label: `${rank}${suit}` });

export function interestCap(s: Snapshot): number {
  if (!(DECKS[s.deck ?? ""]?.interest ?? true)) return 0;
  const v = s.usedVouchers.join(" ").toLowerCase();
  return v.includes("money_tree") || v.includes("money tree") ? 20 : v.includes("seed_money") || v.includes("seed money") ? 10 : 5;
}

/** Rent the Rental jokers charge at the end of each round. */
export const rentDue = (s: Snapshot) => s.jokers.reduce((a, j) => a + (j.rental ?? 0), 0);

/**
 * Interest at the next cash out if the round ends holding `dollars`. Rent is charged first (the
 * game runs calculate_rental at end of round, before the interest row), so it comes off the top.
 */
/**
 * The bank is built: past ante 3 with enough money that interest is already maxed after rent. In
 * the Roffle runs, mid and late sells were money jokers at twice their share of the row, at a median
 * of $47 in the bank, while xMult and copy jokers were kept: once interest is capped, a slot that
 * makes money is worth less than one that scores.
 */
export function bankBuilt(s: Snapshot): boolean {
  const cap = interestCap(s);
  return s.ante >= 4 && cap > 0 && s.money - rentDue(s) >= 5 * cap;
}

export function interestOn(s: Snapshot, dollars: number): number {
  return Math.max(0, Math.min(interestCap(s), Math.floor((dollars - rentDue(s)) / 5)));
}

function deckCards(s: Snapshot): PCard[] {
  const seen = new Set<number>();
  const out: PCard[] = [];
  for (const c of [...s.deckLeft, ...s.hand]) {
    if (c.hidden || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}

function suitShares(cards: PCard[], s: Snapshot): Record<string, number> {
  const n = Math.max(1, cards.length);
  return Object.fromEntries(SUITS.map((suit) => [suit, cards.filter((c) => suitsOf(c, s.rules).includes(suit)).length / n]));
}

/** A typical hand of each build, from real deck cards where the deck has them. */
function representative(name: string, cards: PCard[], suit: string): PCard[] {
  const byRank = new Map<string, PCard[]>();
  for (const c of cards) if (c.rank) byRank.set(c.rank, [...(byRank.get(c.rank) ?? []), c]);
  const ranksWith = (n: number) => [...byRank.entries()].filter(([, cs]) => cs.length >= n).sort((a, b) => rankValue(b[0]) - rankValue(a[0]));
  const take = (n: number, i = 0, fallback = "K") => {
    const hit = ranksWith(n)[i];
    return hit ? hit[1].slice(0, n) : Array.from({ length: n }, (_, k) => phantom(fallback, SUITS[k % 4], k + i * 5));
  };
  switch (name) {
    case "Flush": {
      // Distinct ranks, so the typical flush doesn't also count as a pair for pair jokers.
      const suited: PCard[] = [];
      for (const c of cards.filter((x) => x.suit === suit).sort((a, b) => cardWorth(b) - cardWorth(a))) {
        if (suited.length < 5 && !suited.some((x) => x.rank === c.rank)) suited.push(c);
      }
      const fill = ["A", "K", "Q", "J", "9", "7"].filter((r) => !suited.some((c) => c.rank === r));
      return [...suited, ...fill.slice(0, 5 - suited.length).map((r, i) => phantom(r, suit, i))];
    }
    case "Straight":
      return ["9", "T", "J", "Q", "K"].map((r, i) => cards.find((c) => c.rank === r && c.suit === SUITS[i % 4]) ?? phantom(r, SUITS[i % 4], i));
    case "Two Pair":
      return [...take(2, 0), ...take(2, 1, "Q")];
    case "Three of a Kind":
      return take(3);
    case "Full House":
      return [...take(3), ...take(2, 1, "Q")];
    case "Four of a Kind":
      return take(4);
    case "High Card":
      return take(1, 0, "A");
    default:
      return take(2);
  }
}

function scoreContextFor(s: Snapshot, jokers: Joker[], hands: number): ScoreContext {
  // Cards that work from the hand (Steel, Baron's kings, Shoot the Moon's queens), in proportion to how often they'd be drawn.
  const cards = deckCards(s);
  const keys = new Set(jokers.map((j) => j.key));
  const heldish = cards.filter((c) => c.enhancement === "STEEL" || (keys.has("j_baron") && c.rank === "K") || (keys.has("j_shoot_the_moon") && c.rank === "Q"));
  const expected = Math.min(3, Math.round((heldish.length * Math.max(1, s.handSize - 5)) / Math.max(1, cards.length) + (heldish.length ? 0.5 : 0)));
  return { levels: s.levels, jokers, held: heldish.slice(0, expected), rules: s.rules, handsLeft: Math.max(1, Math.ceil(hands / 2)), discardsLeft: Math.max(0, s.discardsLeft), balanced: s.deck === "PLASMA" };
}

function powerOf(s: Snapshot, name: string, jokers: Joker[], hands: number, suit: string) {
  const reindexed = jokers.map((j, i) => ({ ...j, index: i }));
  return estimateScore(representative(name, deckCards(s), suit), scoreContextFor(s, reindexed, hands));
}

/** Score of the build's typical hand with these jokers, in this order (for reordering). */
export function powerWith(s: Snapshot, p: BuildProfile, jokers: Joker[]): number {
  return powerOf(s, p.primary.name, jokers, p.hands, p.deckFix.suit ?? p.deckFix.commonSuit ?? "S").score;
}

/** How much a joker's tags back a build (hand tags), counting its role (xMult backs harder). */
/** Engine tags: the joker works through the deck, held cards or consumables rather than the played hand. */
export const ENGINE_TAGS = ["deckfix", "retrigger", "held", "consumable", "levels", "planets", "rule", "hand_size"];
/** Tags that make a joker more than flat +Mult or +Chips. */
const LASTING_TAGS = ["xmult", "scaling", "econ", "copy", ...ENGINE_TAGS];

/**
 * What a joker is worth beyond what it adds to the build's hand today. A scaling joker starts
 * small and grows, a copy joker is only as good as its neighbour (reordering fixes that), and an
 * engine joker pays through the deck, so their current share undersells them. The expert data
 * showed this: the code was selling a fresh Constellation or Blueprint for a flat +Mult joker.
 */
export function upside(tags: Set<string>, ante: number): number {
  const early = ante <= 4;
  if (tags.has("copy")) return 0.6;
  if (tags.has("scaling") && tags.has("xmult")) return early ? 0.45 : 0.35;
  if (tags.has("scaling")) return early ? 0.25 : 0.12;
  if (ENGINE_TAGS.some((t) => tags.has(t))) return 0.2;
  // Conditional xMult (Card Sharp, The Idol, the hand-type X jokers) multiplies everything else when
  // it fires; the typical-hand estimate often misses it. Roffle sold xMult at half its share of the row.
  if (tags.has("xmult")) return 0.3;
  return 0;
}

/** Flat +Mult and +Chips jokers fall behind as blinds grow; this is how much, by ante. */
export function falloff(tags: Set<string>, ante: number): number {
  if (LASTING_TAGS.some((t) => tags.has(t))) return 0;
  return Math.min(0.25, 0.05 * Math.max(0, ante - 2));
}

export function support(tags: Set<string>, archetype: string, theme?: string): number {
  const hand = ARCHETYPES[archetype]?.hands[0];
  let roleW = 1;
  for (const r of Object.keys(ROLE_WEIGHT)) if (tags.has(r)) roleW = Math.max(roleW, ROLE_WEIGHT[r]);
  let total = 0;
  for (const t of tags) {
    const hands = TAG_HANDS[t];
    if (hands && hand) {
      const i = hands.indexOf(hand);
      if (i === 0) total += roleW;
      else if (i > 0) total += roleW * 0.6;
    }
    if (SUIT_TAG[t] && archetype === "Flush") total += roleW * (theme === t ? 0.9 : 0.4);
  }
  return total;
}

export function handsPerRound(s: Snapshot): number {
  if (s.phase === "SELECTING_HAND") return s.handsLeft + s.handsPlayed;
  const v = s.usedVouchers.join(" ");
  return 4 + (s.deck === "BLUE" ? 1 : 0) - (s.deck === "BLACK" ? 1 : 0) + (v.includes("grabber") ? 1 : 0) + (v.includes("nacho") ? 1 : 0);
}

/** Discards a round starts with: 3, one more on the Red deck and per Wasteful/Recyclomancy, one fewer from Blue stake. */
export function discardsPerRound(s: Snapshot): number {
  const v = s.usedVouchers.join(" ");
  return Math.max(0, 3 + (s.deck === "RED" ? 1 : 0) - (stakeAtLeast(s.stake, "BLUE") ? 1 : 0) + (v.includes("wasteful") ? 1 : 0) + (v.includes("recyclomancy") ? 1 : 0));
}

/**
 * Chip targets of the bosses of this ante and the next `count - 1`, scaled like the game shows
 * them (a boss is twice the ante's base; the shown small blind gives the scale).
 */
export function bossTargets(s: Snapshot, count = 3): number[] {
  const small = s.blinds.find((b) => b.type === "SMALL");
  const base = blindBase(s.ante, s.stake, s.deck);
  const scale = small?.target ? small.target / base : 1;
  const boss = s.blinds.find((b) => b.type === "BOSS")?.target;
  return Array.from({ length: count }, (_, k) => (k === 0 && boss ? boss : Math.round(blindBase(s.ante + k, s.stake, s.deck) * scale * 2)));
}

const title = (w: string) => w[0] + w.slice(1).toLowerCase();

const ECON_INCOME: Record<string, number> = { j_golden: 4, j_cloud_9: 3, j_rocket: 3, j_egg: 3, j_delayed_grat: 4, j_business: 2, j_to_the_moon: 2, j_faceless: 2, j_mail: 5, j_reserved_parking: 2, j_satellite: 2, j_todo_list: 2, j_rough_gem: 2, j_trading: 2, j_matador: 2, j_ticket: 2, j_gift: 1 };

/** `build` pins the build the plan has committed to; without it the strongest-looking build leads. */
export function profileBuild(s: Snapshot, build?: string, opts: { shallow?: boolean } = {}): BuildProfile {
  const cond = conditions(s.stake, s.deck);
  const deck = DECKS[s.deck ?? ""] ?? { interest: true, notes: [] };
  const cards = deckCards(s);
  const shares = suitShares(cards, s);
  const domSuit = SUITS.reduce((a, b) => (shares[b] > shares[a] ? b : a), "S" as string);
  const hands = Math.max(1, handsPerRound(s));
  const tagsOf = new Map(s.jokers.map((j) => [j.index, jokerTags(j.key, j.effect)]));
  const suitJoker = (suit: string) => s.jokers.some((j) => [...(tagsOf.get(j.index) ?? [])].some((t) => SUIT_TAG[t] === suit));
  // A suit is the build's only with a reason: a joker that pays for it (the most common such suit),
  // or a deck that clearly leans to it.
  const themeSuit = [...SUITS].filter((x) => suitJoker(x)).sort((a, b) => shares[b] - shares[a])[0] ?? (shares[domSuit] >= 0.35 ? domSuit : undefined);
  const faceJokers = s.jokers.filter((j) => tagsOf.get(j.index)?.has("face")).length;
  const theme = themeSuit ? Object.keys(SUIT_TAG).find((t) => SUIT_TAG[t] === themeSuit) : faceJokers >= 2 && !deck.dead?.includes("face") ? "face" : undefined;
  const flushSuit = themeSuit ?? domSuit;

  const totalPlayed = Object.values(s.levels).reduce((a, l) => a + (l?.played ?? 0), 0);
  const archetypes: ArchetypeScore[] = Object.keys(ARCHETYPES).map((name) => {
    const hand = ARCHETYPES[name].hands[0];
    const reasons: string[] = [];
    let score = 0;
    for (const j of s.jokers) {
      const sup = support(tagsOf.get(j.index) ?? new Set(), name, theme);
      if (sup > 0) {
        score += sup;
        reasons.push(`${j.label} backs it`);
      }
    }
    const lvl = s.levels[hand];
    if (lvl && lvl.level > 1) {
      score += (lvl.level - 1) * 1.2;
      reasons.push(`${hand} is level ${lvl.level}`);
    }
    if (lvl && totalPlayed > 0) score += (lvl.played / totalPlayed) * 2;
    if (name === "Flush") {
      score += (shares[flushSuit] - 0.25) * 8;
      if (shares[flushSuit] >= 0.35) reasons.push(`deck is ${Math.round(shares[flushSuit] * 100)}% ${SUIT_NAME[flushSuit]}`);
    }
    score += { Pair: 1, "Two Pair": 0.6, "Three of a Kind": 0.3, "Full House": 0, "Four of a Kind": cards.length && cards.length < 40 ? 0 : -1, Straight: 0, Flush: 0, "High Card": -0.5 }[name] ?? 0;
    score += s.ante <= 2 ? (deck.earlyFavor?.[name] ?? 0) : 0;
    score += deck.favor?.[name] ?? 0;
    const est = powerOf(s, name, s.jokers, hands, flushSuit);
    return { name, score, power: est.score, reasons };
  });
  const maxPower = Math.max(1, ...archetypes.map((a) => a.power));
  for (const a of archetypes) a.score += 2 * (a.power / maxPower);
  archetypes.sort((a, b) => b.score - a.score);
  const primary = (build && archetypes.find((a) => a.name === build)) || archetypes[0];
  const est = powerOf(s, primary.name, s.jokers, hands, flushSuit);

  // Targets: what is left of this ante, then the next ante's boss.
  const base = blindBase(s.ante, s.stake, s.deck);
  const small = s.blinds.find((b) => b.type === "SMALL");
  const scale = small?.target ? small.target / base : 1;
  const targets = s.blinds.filter((b) => b.status !== "DEFEATED" && b.status !== "SKIPPED").map((b) => ({ label: `${b.name}, ante ${s.ante}`, target: b.target }));
  const aheadTarget = Math.round(blindBase(s.ante + 1, s.stake, s.deck) * scale * 2);
  targets.push({ label: `Boss, ante ${s.ante + 1}`, target: aheadTarget });
  const margin = (est.score * hands) / Math.max(1, targets[0].target);
  const marginAhead = (est.score * hands) / Math.max(1, aheadTarget);

  // Each joker's share of the build hand, and what else it is worth.
  const early = s.ante <= 4;
  const banked = bankBuilt(s);
  const jokers: JokerRole[] = s.jokers.map((j) => {
    const tags = tagsOf.get(j.index) ?? new Set<string>();
    const without = powerOf(s, primary.name, s.jokers.filter((x) => x !== j), hands, flushSuit).score;
    const contribution = est.score > 0 ? Math.max(0, (est.score - without) / est.score) : 0;
    const fits = support(tags, primary.name, theme) > 0 || (theme !== undefined && tags.has(theme));
    let keep = Math.max(Math.min(1, contribution * 2), upside(tags, s.ante));
    if (tags.has("econ")) keep += early && !banked ? 0.35 : banked ? 0 : 0.15;
    if (tags.has("hand_size") || tags.has("rule")) keep += fits ? 0.3 : 0.1;
    if (tags.has("expires")) keep -= 0.05;
    if (tags.has("sell_value")) keep += 0.08;
    if (fits) keep += 0.1;
    if (deck.dead?.some((d) => tags.has(d))) keep -= 0.3;
    if (j.debuff) keep -= 0.05;
    keep -= stickerPenalty(j, tags, keep).penalty;
    const roles = ROLE_TAGS.filter((r) => tags.has(r));
    const note = contribution > 0.02
      ? `${Math.round(contribution * 100)}% of the ${primary.name} score`
      : roles.includes("econ") ? "economy" : fits ? "fits the build, no direct score" : "dead weight for this build";
    return { index: j.index, key: j.key, label: j.label, tags: [...tags], contribution, keep: Math.max(0, keep), worth: Math.max(0, keep), fits, eternal: j.eternal, sell: j.sell, note };
  });
  if (!opts.shallow) {
    for (const r of jokers) {
      const j = s.jokers.find((x) => x.index === r.index)!;
      const without = { ...s, jokers: s.jokers.filter((x) => x !== j) };
      const asOffer = jokerFit({ key: j.key, label: j.label, effect: j.effect, rarity: j.rarity, edition: j.edition, sell: j.sell, rental: j.rental, perishable: j.perishable }, without, profileBuild(without, primary.name, { shallow: true }));
      r.worth = Math.max(r.keep, asOffer.value);
    }
  }
  // Invisible Joker is never the one to sell for room: sold when ready it duplicates a joker into its own slot.
  const weakest = jokers.filter((j) => !j.eternal && j.key !== "j_invisible").sort((a, b) => a.worth - b.worth)[0];

  // Current synergy, in words.
  const active: string[] = [];
  const dead: string[] = [];
  for (const r of jokers) {
    if (r.contribution > 0.02 || r.fits) active.push(`${r.label}: ${r.note}`);
    else if (!r.tags.some((t) => t === "econ" || t === "copy" || t === "scaling")) dead.push(`${r.label}: ${r.note}`);
  }
  for (const j of s.jokers) {
    if (j.key === "j_blueprint" && s.jokers[j.index + 1]) active.push(`Blueprint copies ${s.jokers[j.index + 1].label}`);
    if (j.key === "j_brainstorm" && j.index > 0) active.push(`Brainstorm copies ${s.jokers[0].label}`);
  }
  const lvl = s.levels[ARCHETYPES[primary.name].hands[0]];
  if (lvl && lvl.level > 1) active.push(`${ARCHETYPES[primary.name].hands[0]} is level ${lvl.level}`);
  if (theme && SUIT_TAG[theme]) active.push(`deck is ${Math.round(shares[SUIT_TAG[theme]] * 100)}% ${SUIT_NAME[SUIT_TAG[theme]]}`);
  const synergyScore = jokers.length ? jokers.filter((r) => r.fits || r.contribution > 0.02 || r.tags.includes("econ") || r.tags.includes("copy")).length / jokers.length : 0;

  // Economy.
  const cap = interestCap(s);
  const interestNow = interestOn(s, s.money);
  const econJokers = s.jokers.filter((j) => tagsOf.get(j.index)?.has("econ"));
  const incomePerRound = 4 + interestNow + econJokers.reduce((a, j) => a + (ECON_INCOME[j.key] ?? 1), 0);
  const slotsOpen = s.jokerSlots - s.jokers.length;
  let mode: EconPlan["mode"];
  if (!deck.interest) mode = "spend";
  // At high stakes (Roffle's habit at Gold: antes 1-2 spend on scoring and money jokers, from ante 3
  // leave every shop with $25 or more) the switch to saving is set by the ante, unless the build is
  // in danger of losing the next blind. Below that, saving starts once the slots are mostly full.
  else if (cond.econPressure >= 0.5) mode = s.ante <= 2 || margin < 1 ? "build" : "save";
  else if (s.ante <= 1 || slotsOpen >= 2 || (margin < 1 && s.ante <= 3)) mode = "build";
  else mode = "save";
  const rent = rentDue(s);
  const reserve = mode === "save" ? (cond.econPressure >= 0.5 ? 5 * cap + rent : Math.min(5 * cap, Math.max(0, s.money))) : 0;
  // Facts only: what the money earns. How much to keep is the candidates' utilities, not advice to the model.
  const econNote = cap === 0
    ? "This deck pays no interest."
    : `Interest: $1 per $5 held at the end of a round, at most $${cap}; $${interestNow} at the current money.`;
  const rentals = rent;
  const rentalNote = rentals ? ` Rentals cost $${rentals} a round, charged before interest.` : "";

  // Deck fixing.
  // What changes the odds of the build's hand, as facts about the cards (not a to-do list).
  const pctSuit = Math.round(shares[flushSuit] * 100);
  const deckFix: DeckFix =
    primary.name === "Flush" && themeSuit
      ? { goal: `A Flush needs five cards of one suit in hand; ${pctSuit}% of the deck is ${SUIT_NAME[flushSuit]}${suitJoker(themeSuit) ? ", the suit a joker pays for" : ""}. ${({ H: "The Sun", D: "The Star", C: "The Moon", S: "The World" } as Record<string, string>)[flushSuit]} turns cards into ${SUIT_NAME[flushSuit]}, The Lovers makes a Wild card (every suit), The Hanged Man destroys cards.`, suit: flushSuit, suitShare: shares[flushSuit], deckSize: cards.length, commonSuit: domSuit }
      : primary.name === "Flush"
      ? {
          // No joker pays for a suit and none leads the deck: any suit's flush scores the same.
          goal: `A Flush needs five cards of one suit in hand; no joker pays for a suit and none leads the deck (${SUITS.map((x) => `${Math.round(shares[x] * 100)}% ${SUIT_NAME[x]}`).join(", ")}), so any suit will do. A suit Tarot turns cards into one suit, The Lovers makes a Wild card (every suit), The Hanged Man destroys cards.`,
          suitShare: shares[domSuit],
          deckSize: cards.length,
          commonSuit: domSuit,
        }
      : primary.name === "Pair"
        ? { goal: "A Pair needs two cards of a rank, which any deck deals often; enhancements, seals and editions add to the cards that score.", suitShare: shares[flushSuit], deckSize: cards.length }
        : ["Two Pair", "Three of a Kind", "Full House", "Four of a Kind"].includes(primary.name)
        ? { goal: `${primary.name} needs several cards of the same rank; Death copies a card, The Hanged Man destroys cards, and a smaller deck deals each rank more often.`, suitShare: shares[flushSuit], deckSize: cards.length }
        : primary.name === "Straight"
          ? { goal: "A Straight needs five connected ranks; Strength raises a card's rank by one, The Hanged Man destroys cards.", suitShare: shares[flushSuit], deckSize: cards.length }
          : { goal: "Enhancements, seals and editions add to the cards that score.", suitShare: shares[flushSuit], deckSize: cards.length };

  // What the build is missing.
  const needs: string[] = [];
  if (slotsOpen > 0) needs.push("open joker slots");
  const hasX = jokers.some((r) => r.tags.includes("xmult") && (r.fits || r.contribution > 0.02 || !TAG_HANDS_IN(r.tags)));
  if (!hasX && (s.ante >= 3 || (s.ante >= 2 && marginAhead < 1.5) || stakeAtLeast(s.stake, "GREEN"))) needs.push("xmult");
  if (!deck.balanced && est.mult > 0) {
    if (est.chips / est.mult > 12) needs.push("mult");
    else if (est.chips / est.mult < 3) needs.push("chips");
  }
  if (mode === "build" && s.money < 10 && econJokers.length === 0 && s.ante <= 3) needs.push("econ");
  if (primary.name === "Flush" && themeSuit && shares[themeSuit] < 0.45) needs.push(`deck fixing: more ${SUIT_NAME[themeSuit]}`);
  else if (primary.name === "Flush" && !themeSuit) needs.push("deck fixing: concentrate one suit");
  if (["Four of a Kind", "Three of a Kind"].includes(primary.name) && cards.length >= 45) needs.push("deck fixing: thinner deck");
  if (marginAhead < 1) needs.push("more power before the next ante");

  return {
    archetypes,
    primary,
    theme,
    power: est.score,
    chips: est.chips,
    mult: est.mult,
    hands,
    targets,
    margin,
    marginAhead,
    needs,
    jokers,
    weakest,
    synergy: { score: synergyScore, active, dead },
    pivots: pivotOptions(s, archetypes, primary, theme, jokers),
    econ: {
      mode,
      interestCap: cap,
      interestNow,
      reserve,
      incomePerRound: incomePerRound - rentals,
      pressure: cond.econPressure,
      surplus: cap > 0 ? Math.max(0, s.money - rent - 5 * cap) : Math.max(0, s.money),
      behind: marginAhead < 1,
      note: econNote + rentalNote,
    },
    deckFix,
    cond,
  };
}

function TAG_HANDS_IN(tags: string[]): boolean {
  return tags.some((t) => TAG_HANDS[t]);
}

/** Builds worth switching to: a close second, or one an offered joker would carry. */
function pivotOptions(s: Snapshot, archetypes: ArchetypeScore[], primary: ArchetypeScore, theme: string | undefined, roles: JokerRole[]): PivotOption[] {
  const out: PivotOption[] = [];
  const offered = [
    ...s.shop.filter((i) => i.set === "JOKER").map((i) => ({ item: i, source: "shop" as const })),
    ...s.pack.filter((i) => i.set === "JOKER").map((i) => ({ item: i, source: "pack" as const })),
  ];
  const dropFor = (to: string) => roles.filter((r) => r.fits && support(new Set(r.tags), to, theme) === 0 && !r.tags.includes("econ") && !r.tags.includes("copy")).map((r) => r.label);
  for (const a of archetypes) {
    if (a.name === primary.name) continue;
    if (a.score >= primary.score * 0.8 && a.score > 1) {
      out.push({ to: a.name, score: a.score, why: `${a.name} is close behind (${a.reasons.slice(0, 2).join(", ") || "deck and levels"})`, wouldDrop: dropFor(a.name) });
    }
    for (const { item, source } of offered) {
      const sup = support(jokerTags(item.key, item.effect), a.name, theme);
      if (sup >= 2 && a.score + sup >= primary.score * 0.85) {
        out.push({
          to: a.name,
          via: { key: item.key, label: item.label, source },
          score: a.score + sup,
          why: `${item.label} would carry a ${a.name} build (${item.effect || "no description"})`,
          wouldDrop: dropFor(a.name),
        });
      }
    }
  }
  return out.sort((x, y) => y.score - x.score).slice(0, 3);
}

/**
 * How much an offered joker is worth to this run, 0..~1.3: what it adds to the build hand now,
 * how its tags fit the build and its needs, its rarity and edition. `pivot` names a build it
 * would carry instead, when that build is a real option.
 */
export function jokerFit(
  item: { key: string; label: string; effect: string; rarity?: string; edition?: string; sell?: number; rental?: number; perishable?: number },
  s: Snapshot,
  p: BuildProfile,
): { value: number; note: string; pivot?: string } {
  const tags = jokerTags(item.key, item.effect);
  const deck = DECKS[s.deck ?? ""];
  const asJoker: Joker = { index: s.jokers.length, key: item.key, label: item.label, effect: item.effect, stats: {}, edition: item.edition, rarity: item.rarity, debuff: false, eternal: false, sell: item.sell ?? 0 };
  const suit = p.deckFix.suit ?? p.deckFix.commonSuit ?? "S";
  const after = powerOf(s, p.primary.name, [...s.jokers, asJoker], p.hands, suit).score;
  const gain = p.power > 0 ? (after - p.power) / p.power : 0;
  // A flat joker's boost today is worth less the later it is bought: it never grows, and the slot
  // could hold one that does.
  const fall = falloff(tags, s.ante);
  let value = 0.3 + Math.min(0.6, gain * 0.8) * (1 - 2 * fall);
  const notes: string[] = [];
  if (gain > 0.05) notes.push(`+${Math.round(gain * 100)}% on ${p.primary.name}`);
  const sup = support(tags, p.primary.name, p.theme);
  if (sup > 0) {
    value += Math.min(0.35, sup * 0.1);
    notes.push(`fits ${p.primary.name}`);
  }
  if (p.theme && tags.has(p.theme)) value += 0.15;
  if (tags.has("xmult") && p.needs.includes("xmult")) {
    value += 0.25;
    notes.push("adds needed xMult");
  }
  if (tags.has("econ")) {
    const banked = bankBuilt(s);
    value += (s.ante <= 2 ? 0.3 : s.ante <= 4 ? 0.18 : 0.08) * (1 + 0.5 * p.cond.econPressure) * (banked ? 0.5 : 1);
    notes.push(banked ? "economy, but interest is already maxed" : "economy");
  }
  if (tags.has("copy")) value += 0.35;
  if (tags.has("scaling")) value += (tags.has("xmult") ? 2 : 1) * (s.ante <= 3 ? 0.15 : s.ante <= 5 ? 0.1 : 0.04);
  if (fall > 0) {
    value -= fall;
    notes.push("flat bonus that falls behind later");
  }
  if (tags.has("hand_size")) value += 0.15;
  if (p.needs.includes("mult") && tags.has("mult")) value += 0.1;
  if (p.needs.includes("chips") && tags.has("chips")) value += 0.1;
  if (deck?.balanced && tags.has("chips")) value += 0.1;
  if (deck?.dead?.some((d) => tags.has(d))) {
    value -= 0.5;
    notes.push("useless with this deck");
  }
  value += { RARE: 0.08, LEGENDARY: 0.3 }[item.rarity ?? ""] ?? 0;
  // An edition on a Perishable joker only lasts its 5 rounds.
  value += ({ NEGATIVE: 0.3, POLYCHROME: 0.15, HOLO: 0.08, FOIL: 0.04 }[item.edition ?? ""] ?? 0) * (item.perishable !== undefined ? 0.5 : 1);
  const pivot = p.pivots.find((o) => o.via?.key === item.key);
  if (pivot && sup === 0) {
    value = Math.max(value, 0.45 + Math.min(0.3, (pivot.score - p.primary.score) * 0.05));
    notes.push(`would carry a pivot to ${pivot.to}`);
  }
  const sticker = stickerPenalty(item, tags, value);
  value -= sticker.penalty;
  if (sticker.note) notes.push(sticker.note);
  return { value: Math.max(0, Math.min(1.3, value)), note: notes.join(", ") || "no clear fit", pivot: pivot?.to };
}

/** Face cards for Ride the Bus and Abandoned-deck checks. */
export const isFaceRank = (c: PCard) => Boolean(c.rank && FACE_RANKS.has(c.rank));
