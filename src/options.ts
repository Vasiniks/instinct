// Play and discard options for SELECTING_HAND.
// A hand can hold 100+ cards (Perkeo + Cryptid), so nothing here enumerates subsets: options are
// built per poker-hand family from rank and suit groups (linear in hand size), then scored by the
// joker-aware estimator and pruned to a short, diverse list.

import { RANKS, SUITS, SUIT_NAME, cardWorth, pAtLeast, rankValue, type PCard } from "./cards.ts";
import type { Snapshot } from "./extract.ts";
import { FEATURES } from "./features.ts";
import { countsDeck, deckCounts, estimateScore, evaluateHand, suitsOf, type Estimate, type Evaluation, type HandName, type ScoreContext } from "./poker.ts";

export interface PlayOption {
  cards: PCard[];
  estimate: Estimate;
}

export interface DiscardOption {
  cards: PCard[];
  /** Plain-words description of what is kept. */
  keep: string;
  target?: HandName;
  /** Chance the draw completes `target`. */
  chance?: number;
  /** Estimated score of the target hand if it lands. */
  targetScore?: number;
}

const byWorthDesc = (a: PCard, b: PCard) => cardWorth(b) - cardWorth(a) || b.index - a.index;
const byWorthAsc = (a: PCard, b: PCard) => cardWorth(a) - cardWorth(b) || a.index - b.index;
const inHandOrder = (cards: PCard[]) => [...cards].sort((a, b) => a.index - b.index);
const keyOf = (cards: PCard[]) => cards.map((c) => c.index).sort((a, b) => a - b).join(",");

export function scoreContext(s: Snapshot, played: PCard[]): ScoreContext {
  const playedIdx = new Set(played.map((c) => c.index));
  return {
    levels: s.levels,
    jokers: s.jokers,
    held: s.hand.filter((c) => !playedIdx.has(c.index)),
    rules: s.rules,
    handsLeft: s.handsLeft,
    discardsLeft: s.discardsLeft,
    balanced: s.deck === "PLASMA",
    deck: countsDeck(s.jokers) ? deckCounts([...s.deckLeft, ...s.hand], s.deckLeft.length, s.startDeckSize ?? (s.deck === "ABANDONED" ? 40 : 52), s.deckSize) : undefined,
    money: s.money,
    roundCards: s.roundCards,
    armDown: s.blind?.type === "BOSS" && s.blind.name === "The Arm" && !s.jokers.some((j) => j.key === "j_chicot" && !j.debuff),
    halveBase: s.blind?.type === "BOSS" && s.blind.name === "The Flint" && !s.jokers.some((j) => j.key === "j_chicot" && !j.debuff),
  };
}

function groupByRank(cards: PCard[]): Map<string, PCard[]> {
  const m = new Map<string, PCard[]>();
  for (const c of cards) {
    if (!c.rank) continue;
    const g = m.get(c.rank);
    if (g) g.push(c);
    else m.set(c.rank, [c]);
  }
  for (const g of m.values()) g.sort(byWorthDesc);
  return m;
}

/** Rank windows for straights, low to high; values use 1 for a low ace. */
const WINDOWS = new Map<number, number[][]>();
function straightWindows(len: number): number[][] {
  let out = WINDOWS.get(len);
  if (out) return out;
  out = [];
  for (let lo = 1; lo + len - 1 <= 14; lo++) out.push(Array.from({ length: len }, (_, i) => lo + i));
  WINDOWS.set(len, out);
  return out;
}

const rankOfValue = (v: number) => (v === 1 ? "A" : RANKS[v - 2]);

function flushNeed(s: Snapshot) {
  return s.rules.fourFingers ? 4 : 5;
}

/** Hands that leave free slots in a play: kickers there score nothing but go to the discard pile. */
const PADDABLE = new Set<HandName>(["High Card", "Pair", "Two Pair", "Three of a Kind", "Four of a Kind"]);

/**
 * Fills a small hand's spare slots with junk, so the junk cycles out like a free discard. Roffle
 * played his Pairs, Two Pairs, Trips and High Cards with five cards 74% of the time in antes 1-3
 * and 59% in antes 4-8, and almost never bare (3-4%); he used no discard at all in half his blinds.
 * Only plain cards go: never Steel, Gold or other enhanced, sealed or edition cards, never cards
 * that pair up in hand, never the suit a Flush build is collecting, never cards Baron or Shoot the
 * Moon want held, and nothing that changes the hand played. Off under The Tooth ($1 a card) and
 * with Half Joker (3 cards or fewer) or Square Joker (exactly 4).
 */
export function padWithJunk(s: Snapshot, set: PCard[], prefer?: ReadonlySet<string>): PCard[] {
  const limit = Math.max(1, s.playLimit);
  if (set.length >= limit) return set;
  const hand = evaluateHand(set, s.rules).hand;
  if (!PADDABLE.has(hand)) return set;
  const pool = junkPool(s, prefer);
  if (!pool) return set;
  const out = [...set];
  // A junk card's rank is alone in the hand, so below a Flush's or Straight's length it can't
  // change the hand: only the cards that bring the play to that length are checked.
  const need = s.rules.fourFingers ? 4 : 5;
  for (const c of pool) {
    if (out.length >= limit) break;
    if (set.includes(c)) continue;
    if (out.length + 1 >= need && evaluateHand([...out, c], s.rules).hand !== hand) continue;
    out.push(c);
  }
  return out;
}

/**
 * The cards padding may use, cheapest first, before taking out the play's own cards; undefined
 * when padding is off. Kept per state: one state's plays all pad from the same hand.
 */
const junkPools = new WeakMap<Snapshot, Map<ReadonlySet<string> | undefined, PCard[] | undefined>>();
function junkPool(s: Snapshot, prefer?: ReadonlySet<string>): PCard[] | undefined {
  let byPrefer = junkPools.get(s);
  if (!byPrefer) junkPools.set(s, (byPrefer = new Map()));
  if (byPrefer.has(prefer)) return byPrefer.get(prefer);
  let pool: PCard[] | undefined;
  const keys = new Set(s.jokers.map((j) => j.key));
  if (!(keys.has("j_half") || keys.has("j_square")) && !(/the tooth/i.test(s.blind?.name ?? "") || /lose \$1 per card/i.test(s.blind?.effect ?? ""))) {
    const visible = s.hand.filter((c) => !c.hidden);
    const rankCount = groupByRank(visible);
    let flushSuit: string | undefined;
    if (prefer?.has("Flush")) {
      const bySuit = SUITS.map((x) => ({ x, n: visible.filter((c) => suitsOf(c, s.rules).includes(x)).length })).sort((a, b) => b.n - a.n)[0];
      if (bySuit && bySuit.n >= 3) flushSuit = bySuit.x;
    }
    pool = visible
      .filter((c) => !c.forced && c.rank)
      .filter((c) => !c.enhancement && !c.edition && !c.seal)
      .filter((c) => (rankCount.get(c.rank!)?.length ?? 0) < 2)
      .filter((c) => !(keys.has("j_baron") && c.rank === "K") && !(keys.has("j_shoot_the_moon") && c.rank === "Q"))
      .filter((c) => !flushSuit || !suitsOf(c, s.rules).includes(flushSuit))
      .sort(byWorthAsc);
  }
  byPrefer.set(prefer, pool);
  return pool;
}

/**
 * playSets for a hand seen before. The round simulations deal every setup the same cards, so the
 * same hand comes up once per setup; what playSets reads is all in the key (the cards in order,
 * the rules, the play limit, the jokers and boss that change padding), and the cards it returns
 * match the new hand's field for field.
 */
interface PlaySets {
  /** The distinct card sets, in playSets' order. */
  sets: PCard[][];
  /** Each set's poker hand under the state's rules (it depends on nothing else). */
  evals: Evaluation[];
}
const setsCache = new Map<string, PlaySets>();
const PAD_JOKERS = ["j_half", "j_square", "j_baron", "j_shoot_the_moon"];
function cachedPlaySets(s: Snapshot, prefer?: ReadonlySet<string>): PlaySets {
  let key = `${s.playLimit}|${+s.rules.fourFingers}${+s.rules.shortcut}${+s.rules.smeared}${+s.rules.splash}${+s.rules.pareidolia}|${+FEATURES.padding}|${s.blind?.name ?? ""}|${s.blind?.effect ?? ""}|${prefer ? [...prefer].join(",") : "-"}|`;
  for (const k of PAD_JOKERS) if (s.jokers.some((j) => j.key === k)) key += k;
  for (const c of s.hand) key += `|${c.index}:${c.id}:${c.rank ?? ""}${c.suit ?? ""}:${c.enhancement ?? ""}:${c.edition ?? ""}:${c.seal ?? ""}:${+c.debuff}${+c.hidden}${+c.forced}`;
  const hit = setsCache.get(key);
  if (hit) return hit;
  let all = playSets(s, prefer);
  if (!all.length && s.hand.length) all = [inHandOrder(s.hand.slice(0, Math.max(1, s.playLimit)))];
  const seen = new Set<string>();
  const sets = all.filter((cards) => {
    const k = keyOf(cards);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const out = { sets, evals: sets.map((cards) => evaluateHand(cards, s.rules)) };
  if (setsCache.size >= 50000) setsCache.clear();
  setsCache.set(key, out);
  return out;
}

/** Candidate card sets, one family at a time. */
function playSets(s: Snapshot, prefer?: ReadonlySet<string>): PCard[][] {
  const limit = Math.max(1, s.playLimit);
  const pool = s.hand.filter((c) => !c.hidden);
  const ranked = pool.filter((c) => c.rank);
  const byRank = groupByRank(ranked);
  const sets: PCard[][] = [];

  const high = [...ranked].sort((a, b) => rankValue(b.rank!) - rankValue(a.rank!) || byWorthDesc(a, b))[0];
  if (high) sets.push([high]);

  for (const g of byRank.values()) if (g.length >= 2) sets.push(g.slice(0, limit));

  const groupWorth = (g: PCard[]) => g.slice(0, 2).reduce((n, c) => n + cardWorth(c), 0);
  const multi = [...byRank.values()].filter((g) => g.length >= 2).sort((a, b) => groupWorth(b) - groupWorth(a));
  if (limit >= 4) {
    const top = multi.slice(0, 3);
    for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) sets.push([...top[i].slice(0, 2), ...top[j].slice(0, 2)]);
  }
  if (limit >= 5) {
    for (const t of multi.filter((g) => g.length >= 3).slice(0, 2)) {
      for (const p of multi.filter((g) => g !== t).slice(0, 2)) sets.push([...t.slice(0, 3), ...p.slice(0, 2)]);
    }
  }

  const need = flushNeed(s);
  for (const suit of SUITS) {
    const members = pool.filter((c) => suitsOf(c, s.rules).includes(suit)).sort(byWorthDesc);
    if (members.length >= need) sets.push(members.slice(0, limit));
  }

  const len = s.rules.fourFingers ? 4 : 5;
  if (limit >= len) {
    for (const win of straightWindows(len)) {
      const picks = win.map((v) => byRank.get(rankOfValue(v)));
      if (picks.some((p) => !p)) continue;
      sets.push(picks.map((p) => p![0]));
      for (const suit of SUITS) {
        const suited = picks.map((p) => p!.find((c) => suitsOf(c, s.rules).includes(suit)));
        if (suited.every(Boolean)) sets.push(suited as PCard[]);
      }
    }
  }

  // Stone cards always score, so spare slots carry them.
  const stones = pool.filter((c) => c.enhancement === "STONE").sort(byWorthDesc);
  if (!sets.length && stones.length) sets.push(stones.slice(0, limit));
  const filled = sets.map((set) => {
    const out = [...set];
    for (const st of stones) if (out.length < limit && !out.includes(st)) out.push(st);
    return out;
  });

  // Boss rules that change what a legal play looks like.
  const forced = s.hand.filter((c) => c.forced);
  const mustPlayFive = /must play 5 cards/i.test(s.blind?.effect ?? "");
  return filled.map((set) => {
    let out = [...set];
    for (const f of forced) {
      if (out.includes(f)) continue;
      if (out.length >= limit) out = [...out].sort(byWorthDesc).slice(0, limit - 1);
      out.push(f);
    }
    if (mustPlayFive) {
      for (const junk of [...s.hand].sort(byWorthAsc)) if (out.length < Math.min(5, limit) && !out.includes(junk)) out.push(junk);
    } else if (FEATURES.padding) out = padWithJunk(s, out, prefer);
    return inHandOrder(out);
  });
}

/**
 * playOptions(s, 1)[0], without building and sorting the whole list: the round simulations ask
 * for it at every step. Ties go as the stable sort leaves them: the shorter play, then the earlier.
 */
export function bestPlay(s: Snapshot): PlayOption | undefined {
  const { sets, evals } = cachedPlaySets(s);
  let best: PlayOption | undefined;
  for (let i = 0; i < sets.length; i++) {
    const estimate = estimateScore(sets[i], scoreContext(s, sets[i]), evals[i]);
    if (!best || estimate.score > best.estimate.score || (estimate.score === best.estimate.score && sets[i].length < best.cards.length)) best = { cards: sets[i], estimate };
  }
  return best;
}

/** The best plays by estimated score, at most two per hand type, always including the best play of each `prefer` hand. */
export function playOptions(s: Snapshot, max = 5, prefer?: ReadonlySet<string>): PlayOption[] {
  const { sets, evals } = cachedPlaySets(s, prefer);
  const scored: PlayOption[] = sets.map((cards, i) => ({ cards, estimate: estimateScore(cards, scoreContext(s, cards), evals[i]) }));
  scored.sort((a, b) => b.estimate.score - a.estimate.score || a.cards.length - b.cards.length);
  const perHand = new Map<string, number>();
  const out: PlayOption[] = [];
  for (const o of scored) {
    const n = perHand.get(o.estimate.hand) ?? 0;
    if (n >= 2) continue;
    perHand.set(o.estimate.hand, n + 1);
    out.push(o);
    if (out.length >= max) break;
  }
  // The build's own hand stays on the list even when other hands score more right now.
  for (const hand of prefer ?? []) {
    if (out.some((o) => o.estimate.hand === hand)) continue;
    const pick = scored.find((o) => o.estimate.hand === hand);
    if (pick) out.push(pick);
  }
  return out;
}

const phantom = (rank: string, suit: string): PCard => ({ index: -1, id: -1, rank, suit, debuff: false, hidden: false, forced: false, label: `${rank}${suit}` });

/** Up to `limit` throwaway cards, never touching `keep` or forced cards. */
function throwaways(s: Snapshot, keep: Set<PCard>): PCard[] {
  return s.hand.filter((c) => !keep.has(c) && !c.forced).sort(byWorthAsc).slice(0, Math.max(1, s.playLimit));
}

function deckCount(s: Snapshot, pred: (c: PCard) => boolean): number {
  return s.deckLeft.filter((c) => !c.hidden && pred(c)).length;
}

export function discardOptions(s: Snapshot, best: PlayOption | undefined, max = 3): DiscardOption[] {
  if (s.discardsLeft <= 0 || !s.hand.length) return [];
  const deckSize = Math.max(s.deckLeft.length, 1);
  const out: DiscardOption[] = [];
  const estimateOf = (cards: PCard[]) => estimateScore(cards, scoreContext(s, cards.filter((c) => c.index >= 0))).score;

  // Chase a flush.
  const need = flushNeed(s);
  for (const suit of SUITS) {
    const members = s.hand.filter((c) => suitsOf(c, s.rules).includes(suit));
    const missing = need - members.length;
    if (members.length < 3 || missing <= 0) continue;
    const toss = throwaways(s, new Set(members));
    if (toss.length < missing) continue;
    const outs = deckCount(s, (c) => suitsOf(c, s.rules).includes(suit));
    const fillers = RANKS.filter((r) => !members.some((m) => m.rank === r)).slice(0, missing);
    out.push({
      cards: toss,
      keep: `${members.length} ${SUIT_NAME[suit]}`,
      target: "Flush",
      chance: pAtLeast(missing, toss.length, deckSize, outs),
      targetScore: estimateOf([...members.sort(byWorthDesc).slice(0, need - missing), ...fillers.map((r) => phantom(r, suit))]),
    });
  }

  // Chase a straight (unless one is already in hand): the window missing the fewest ranks, at most two.
  const len = s.rules.fourFingers ? 4 : 5;
  const visible = s.hand.filter((c) => !c.hidden);
  const byRank = groupByRank(visible);
  const straightMade = evaluateHand(visible, s.rules).contains.has("Straight");
  let bestStraight: DiscardOption | undefined;
  for (const win of straightMade ? [] : straightWindows(len)) {
    const ranks = win.map(rankOfValue);
    const missingRanks = ranks.filter((r) => !byRank.has(r));
    if (missingRanks.length < 1 || missingRanks.length > 2) continue;
    const kept = ranks.filter((r) => byRank.has(r)).map((r) => byRank.get(r)![0]);
    const toss = throwaways(s, new Set(kept));
    if (toss.length < missingRanks.length) continue;
    const chance = missingRanks.reduce((p, r) => p * pAtLeast(1, toss.length, deckSize, deckCount(s, (c) => c.rank === r)), 1);
    const offSuit = ["S", "H", "C", "D"];
    const targetScore = estimateOf([...kept, ...missingRanks.map((r, i) => phantom(r, offSuit[i % 4]))]);
    const option = { cards: toss, keep: `${kept.map((c) => c.label).join(" ")} toward ${ranks[0]}-${ranks[ranks.length - 1]}`, target: "Straight" as HandName, chance, targetScore };
    if (!bestStraight || chance * targetScore > (bestStraight.chance ?? 0) * (bestStraight.targetScore ?? 0)) bestStraight = option;
  }
  if (bestStraight) out.push(bestStraight);

  // Build on pairs and sets.
  const groups = [...byRank.values()].filter((g) => g.length >= 2).sort((a, b) => b.length - a.length || cardWorth(b[0]) - cardWorth(a[0]));
  if (groups.length) {
    const kept = groups.slice(0, 2).flat();
    const toss = throwaways(s, new Set(kept));
    if (toss.length) {
      const ranks = new Set(kept.map((c) => c.rank));
      const top = groups[0];
      out.push({
        cards: toss,
        keep: groups.slice(0, 2).map((g) => g.map((c) => c.label).join(" ")).join(" + "),
        target: estimateScoreHand([...kept, phantom(top[0].rank!, "S")], s),
        chance: pAtLeast(1, toss.length, deckSize, deckCount(s, (c) => ranks.has(c.rank))),
        targetScore: estimateOf([...kept, phantom(top[0].rank!, "S")]),
      });
    }
  }

  // Cycle junk around the current best play.
  if (best) {
    const keep = new Set(s.hand.filter((c) => best.cards.some((b) => b.index === c.index)));
    const toss = throwaways(s, keep);
    if (toss.length) out.push({ cards: toss, keep: `the current ${best.estimate.hand}` });
  }

  const seen = new Set<string>();
  const value = (o: DiscardOption) => (o.chance ?? 0.25) * (o.targetScore ?? best?.estimate.score ?? 0);
  return out
    .filter((o) => {
      const k = keyOf(o.cards);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => value(b) - value(a))
    .slice(0, max)
    .map((o) => ({ ...o, cards: inHandOrder(o.cards) }));
}

function estimateScoreHand(cards: PCard[], s: Snapshot): HandName {
  return estimateScore(cards, scoreContext(s, [])).hand;
}
