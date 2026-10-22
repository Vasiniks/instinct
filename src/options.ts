// Play and discard options for SELECTING_HAND.
// A hand can hold 100+ cards (Perkeo + Cryptid), so nothing here enumerates subsets: options are
// built per poker-hand family from rank and suit groups (linear in hand size), then scored by the
// joker-aware estimator and pruned to a short, diverse list.

import { RANKS, SUITS, SUIT_NAME, cardWorth, pAtLeast, rankValue, type PCard } from "./cards.ts";
import type { Snapshot } from "./extract.ts";
import { estimateScore, evaluateHand, suitsOf, type Estimate, type HandName, type ScoreContext } from "./poker.ts";

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
  };
}

function groupByRank(cards: PCard[]): Map<string, PCard[]> {
  const m = new Map<string, PCard[]>();
  for (const c of cards) if (c.rank) m.set(c.rank, [...(m.get(c.rank) ?? []), c]);
  for (const g of m.values()) g.sort(byWorthDesc);
  return m;
}

/** Rank windows for straights, low to high; values use 1 for a low ace. */
function straightWindows(len: number): number[][] {
  const out: number[][] = [];
  for (let lo = 1; lo + len - 1 <= 14; lo++) out.push(Array.from({ length: len }, (_, i) => lo + i));
  return out;
}

const rankOfValue = (v: number) => (v === 1 ? "A" : RANKS[v - 2]);

function flushNeed(s: Snapshot) {
  return s.rules.fourFingers ? 4 : 5;
}

/** Candidate card sets, one family at a time. */
function playSets(s: Snapshot): PCard[][] {
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
    if (mustPlayFive) for (const junk of [...s.hand].sort(byWorthAsc)) if (out.length < Math.min(5, limit) && !out.includes(junk)) out.push(junk);
    return inHandOrder(out);
  });
}

export function playOptions(s: Snapshot, max = 5): PlayOption[] {
  let sets = playSets(s);
  if (!sets.length && s.hand.length) sets = [inHandOrder(s.hand.slice(0, Math.max(1, s.playLimit)))];
  const seen = new Set<string>();
  const scored: PlayOption[] = [];
  for (const cards of sets) {
    const k = keyOf(cards);
    if (seen.has(k)) continue;
    seen.add(k);
    scored.push({ cards, estimate: estimateScore(cards, scoreContext(s, cards)) });
  }
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
