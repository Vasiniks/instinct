// The round as a decision tree. Each first move the candidates offer (a play or a discard) is
// followed by many simulated finishes of the round: the rest of the deck is shuffled, cards are
// drawn back up to the hand size, and a fixed greedy policy plays on until the blind is beaten or
// the hands run out. A move is worth the share of finishes that beat the blind, which the code can
// compare directly instead of guessing from the score of one hand.
//
// The continuation policy: play the best-scoring hand when it beats the blind, when no discard is
// left, or when it keeps pace (scores at least the chips still needed per hand left); otherwise
// discard the cards outside that hand, up to the play limit. Jokers keep their current values for
// the round and boss rules are left to the candidates, so this ranks moves; it does not predict
// the exact score.

import { cardWorth, type PCard } from "./cards.ts";
import type { Snapshot } from "./extract.ts";
import { playOptions, scoreContext } from "./options.ts";
import { BASE_HANDS, estimateScore, rulesFromJokers, type HandName, type Joker } from "./poker.ts";

export interface Move {
  kind: "play" | "discard";
  /** Indices into `s.hand`. */
  cards: number[];
}

export interface Outcome {
  /** Share of simulated finishes that beat the blind. */
  clear: number;
  /** Mean share of the chips still needed that the round reaches, capped at 1. */
  reach: number;
  /** Mean hands left over when the blind is beaten (each pays $1 at cash out). */
  spare: number;
  samples: number;
}

interface State {
  hand: PCard[];
  deck: PCard[];
  handsLeft: number;
  discardsLeft: number;
  remaining: number;
  /** Hand types played so far, for The Eye and The Mouth. */
  played: string[];
  rand: () => number;
}

/**
 * What a boss blind changes in a simulated round. Only the rules that change scoring are modelled:
 * suit and face debuffs, halved base (The Flint), fewer hands, discards or hand size, no repeated
 * hand type (The Eye), one hand type (The Mouth), two cards discarded after each hand (The Hook),
 * five cards a hand (The Psychic). The rest (money, levels, face-down cards) play as a plain blind.
 */
export interface BossEffects {
  name: string;
  debuff?: (c: PCard) => boolean;
  halveBase?: boolean;
  hands?: number;
  discards?: number;
  handSize?: number;
  noRepeat?: boolean;
  oneType?: boolean;
  hook?: boolean;
  playFive?: boolean;
  /** The Serpent: after a play or discard draw exactly 3, so the hand can grow past its size. */
  drawThree?: boolean;
}

const SUIT_BOSS: Record<string, string> = { "the club": "C", "the goad": "S", "the head": "H", "the window": "D" };

export function bossEffects(name: string, handSize: number): BossEffects | undefined {
  const n = name.toLowerCase();
  const suit = SUIT_BOSS[n];
  if (suit) return { name, debuff: (c) => c.suit === suit };
  if (n === "the plant") return { name, debuff: (c) => Boolean(c.rank && ["J", "Q", "K"].includes(c.rank)) };
  if (n === "the flint") return { name, halveBase: true };
  if (n === "the needle") return { name, hands: 1 };
  if (n === "the water") return { name, discards: 0 };
  if (n === "the manacle") return { name, handSize: handSize - 1 };
  if (n === "the eye") return { name, noRepeat: true };
  if (n === "the mouth") return { name, oneType: true };
  if (n === "the hook") return { name, hook: true };
  if (n === "the psychic") return { name, playFive: true };
  if (n === "the serpent") return { name, drawThree: true };
  return undefined;
}

/** A hand type the boss lets score now. */
function allowed(boss: BossEffects | undefined, st: State, hand: string): boolean {
  if (boss?.noRepeat && st.played.includes(hand)) return false;
  if (boss?.oneType && st.played.length && st.played[0] !== hand) return false;
  return true;
}

/** A small seeded generator, so the same position always simulates the same way. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function view(s: Snapshot, st: State): Snapshot {
  return { ...s, hand: st.hand.map((c, i) => ({ ...c, index: i })), handsLeft: st.handsLeft, discardsLeft: st.discardsLeft, remaining: st.remaining };
}

function apply(s: Snapshot, st: State, kind: Move["kind"], ids: Set<number>, boss?: BossEffects): void {
  if (kind === "play") {
    const v = view(s, st);
    const played = v.hand.filter((c) => ids.has(c.id));
    const e = estimateScore(played, scoreContext(v, played));
    if (allowed(boss, st, e.hand)) st.remaining -= e.score;
    st.played.push(e.hand);
    st.handsLeft--;
  } else st.discardsLeft--;
  st.hand = st.hand.filter((c) => !ids.has(c.id));
  // The Hook throws two random cards from the hand after each hand played.
  if (boss?.hook && kind === "play") for (let k = 0; k < 2 && st.hand.length; k++) st.hand.splice(Math.floor(st.rand() * st.hand.length), 1);
  if (boss?.drawThree) for (let k = 0; k < 3 && st.deck.length; k++) st.hand.push(st.deck.pop()!);
  else while (st.hand.length < s.handSize && st.deck.length) st.hand.push(st.deck.pop()!);
}

function greedy(s: Snapshot, st: State, boss?: BossEffects): { kind: Move["kind"]; ids: Set<number> } {
  const v = view(s, st);
  const best = playOptions(v, boss?.noRepeat || boss?.oneType ? 6 : 1).find((o) => allowed(boss, st, o.estimate.hand)) ?? playOptions(v, 1)[0];
  if (!best) return { kind: "play", ids: new Set(st.hand.slice(0, 1).map((c) => c.id)) };
  const score = best.estimate.score;
  const pace = st.remaining / Math.max(1, st.handsLeft);
  const keep = new Set(best.cards.map((c) => c.id));
  const toss = st.hand
    .filter((c) => !keep.has(c.id) && !c.forced)
    .sort((a, b) => cardWorth(a) - cardWorth(b))
    .slice(0, Math.max(1, s.playLimit));
  if (score >= st.remaining || st.discardsLeft <= 0 || score >= pace || !toss.length) return { kind: "play", ids: keep };
  return { kind: "discard", ids: new Set(toss.map((c) => c.id)) };
}

/** Hand levels with `hand` one level up, as a Planet leaves them. */
export function levelUp(levels: Snapshot["levels"], hand: HandName): Snapshot["levels"] {
  const b = BASE_HANDS[hand];
  const now = levels[hand] ?? { level: 1, chips: b.chips, mult: b.mult, played: 0, played_this_round: 0 };
  return { ...levels, [hand]: { ...now, level: now.level + 1, chips: now.chips + b.lchips, mult: now.mult + b.lmult } };
}

/** Shuffles `cards` in place with `rand`. */
function shuffle<T>(cards: T[], rand: () => number): T[] {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

export interface Setup {
  jokers: Joker[];
  levels: Snapshot["levels"];
  /** The whole deck as it would be (after a Tarot or Spectral); the snapshot's deck otherwise. */
  deck?: PCard[];
}

/**
 * The chance of beating a blind of `target` chips over a whole round, dealt fresh from the full
 * deck, with these jokers and hand levels: the same greedy play as above, from the first draw. Shop
 * and pack choices compare it with and without a card, which ranks a joker by what it does for
 * this deck's hands rather than by what kind of joker it is.
 */
export function roundOdds(s: Snapshot, setups: Setup[], target: number, hands: number, discards: number, samples = 60, boss?: BossEffects): number[] {
  const debuff = boss?.debuff;
  const prepare = (cards: PCard[]) => cards.filter((c) => !c.hidden || c.rank).map((c) => (debuff?.(c) ? { ...c, debuff: true } : c));
  const deck = prepare([...s.deckLeft, ...s.hand]);
  if (!deck.length || target <= 0) return setups.map(() => 1);
  // One seed for every setup: the same deals, so differences come from the cards and jokers.
  const seed = s.round * 6007 + s.ante * 131 + deck.length;
  const handSize = boss?.handSize ?? s.handSize;
  return setups.map((setup) => {
    const full = setup.deck ? prepare(setup.deck) : deck;
    const rand = mulberry32(seed);
    const jokers = setup.jokers.map((j, i) => ({ ...j, index: i }));
    const levels = boss?.halveBase ? Object.fromEntries(Object.entries(setup.levels).map(([h, l]) => [h, { ...l, chips: Math.ceil(l.chips / 2), mult: Math.max(1, Math.ceil(l.mult / 2)) }])) : setup.levels;
    const blind = boss?.playFive ? { type: "BOSS" as const, status: "CURRENT" as const, name: boss.name, effect: "Must play 5 cards", target } : undefined;
    const base: Snapshot = { ...s, phase: "SELECTING_HAND", jokers, levels, rules: rulesFromJokers(jokers), blind, handsPlayed: 0, handSize };
    let clear = 0;
    for (let k = 0; k < samples; k++) {
      const deck = shuffle([...full], rand);
      const st: State = { hand: deck.splice(deck.length - Math.min(handSize, deck.length)), deck, handsLeft: boss?.hands ?? hands, discardsLeft: boss?.discards ?? discards, remaining: target, played: [], rand };
      while (st.remaining > 0 && st.handsLeft > 0 && st.hand.length) {
        const next = greedy(base, st, boss);
        apply(base, st, next.kind, next.ids, boss);
      }
      if (st.remaining <= 0) clear++;
    }
    return clear / samples;
  });
}

/** Simulates `samples` finishes of the round after each move. */
export function roundOutcomes(s: Snapshot, moves: Move[], samples = 80): Outcome[] {
  const deck = s.deckLeft.filter((c) => !c.hidden || c.rank);
  const seed = s.round * 7919 + s.hand.reduce((a, c) => a + c.id, 0) + s.handsLeft * 31 + s.discardsLeft;
  // The live boss's hand-type rules and The Hook; its debuffs and hand counts are already in the state.
  const rule = s.blind?.type === "BOSS" ? bossEffects(s.blind.name, s.handSize) : undefined;
  const boss = rule && (rule.noRepeat || rule.oneType || rule.hook) ? rule : undefined;
  const playedBefore = Object.entries(s.levels).filter(([, l]) => (l?.played_this_round ?? 0) > 0).map(([h]) => h);
  return moves.map((move, m) => {
    const rand = mulberry32(seed + m * 104729);
    let clear = 0;
    let reach = 0;
    let spare = 0;
    const ids = new Set(move.cards.map((i) => s.hand[i]?.id).filter((id): id is number => id !== undefined));
    for (let k = 0; k < samples; k++) {
      const shuffled = shuffle([...deck], rand);
      const st: State = { hand: [...s.hand], deck: shuffled, handsLeft: s.handsLeft, discardsLeft: s.discardsLeft, remaining: s.remaining, played: [...playedBefore], rand };
      apply(s, st, move.kind, ids, boss);
      while (st.remaining > 0 && st.handsLeft > 0 && st.hand.length) {
        const next = greedy(s, st, boss);
        apply(s, st, next.kind, next.ids, boss);
      }
      if (st.remaining <= 0) {
        clear++;
        spare += st.handsLeft;
      }
      reach += Math.min(1, (s.remaining - Math.max(0, st.remaining)) / Math.max(1, s.remaining));
    }
    return { clear: clear / samples, reach: reach / samples, spare: clear ? spare / clear : 0, samples };
  });
}
