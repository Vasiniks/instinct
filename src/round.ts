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

import { SUITS, cardWorth, type PCard } from "./cards.ts";
import type { Snapshot } from "./extract.ts";
import { FEATURES } from "./features.ts";
import { fanOut, parallelism } from "./parallel.ts";
import { bestPlay, playOptions, scoreContext } from "./options.ts";
import { projectJokers, runCues, smallBigBlinds } from "./growth.ts";
import { BASE_HANDS, estimateScore, levelDown, levelOf, rulesFromJokers, type HandName, type Joker } from "./poker.ts";

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
  /** The Arm: hand levels as its plays have left them. */
  levels?: Snapshot["levels"];
  /** Crimson Heart: the joker disabled for the coming hand. */
  off?: number;
  /** Hands played in this simulated finish, for Loyalty Card's count. */
  plays?: number;
}

/**
 * What a boss blind changes in a simulated round. Only the rules that change scoring are modelled:
 * suit and face debuffs, halved base (The Flint), fewer hands, discards or hand size, no repeated
 * hand type (The Eye), one hand type (The Mouth), two cards discarded after each hand (The Hook),
 * five cards a hand (The Psychic), a level lost per hand (The Arm), a random joker off each hand
 * (Crimson Heart), a bigger blind (The Wall, Violet Vessel). The rest (money, face-down cards)
 * play as a plain blind. Chicot turns them all off.
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
  /** The Arm: each hand played loses a level before it scores. */
  armDown?: boolean;
  /** Crimson Heart: one random joker is disabled for every hand. */
  heart?: boolean;
  /** The Wall (X2) and Violet Vessel (X3): the blind against a plain boss of the same ante. */
  targetScale?: number;
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
  if (n === "the arm") return { name, armDown: true };
  if (n === "crimson heart") return { name, heart: true };
  if (n === "the wall") return { name, targetScale: 2 };
  if (n === "violet vessel") return { name, targetScale: 3 };
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
  const v = { ...s, hand: st.hand.map((c, i) => ({ ...c, index: i })), handsLeft: st.handsLeft, discardsLeft: st.discardsLeft, remaining: st.remaining, levels: st.levels ?? s.levels };
  const counting = st.plays && s.jokers.some((j) => j.key === "j_loyalty_card");
  if (st.off === undefined && !counting) return v;
  const jokers = s.jokers.map((j, i) => (i === st.off ? { ...j, debuff: true } : counting ? loyaltyAfter(j, st.plays!) : j));
  return { ...v, jokers, rules: rulesFromJokers(jokers) };
}

/** Loyalty Card's count after `plays` more hands: it cycles through every + 1 values. */
function loyaltyAfter(j: Joker, plays: number): Joker {
  const left = j.stats.loyalty_remaining;
  if (j.key !== "j_loyalty_card" || !Number.isFinite(left)) return j;
  const n = (j.stats.loyalty_every ?? 5) + 1;
  return { ...j, stats: { ...j.stats, loyalty_remaining: (((left - plays) % n) + n) % n } };
}

/** Crimson Heart picks the joker it disables for the next hand. */
const heartPick = (s: Snapshot, st: State, boss?: BossEffects) => {
  if (boss?.heart && s.jokers.length) st.off = Math.floor(st.rand() * s.jokers.length);
};

function apply(s: Snapshot, st: State, kind: Move["kind"], ids: Set<number>, boss?: BossEffects): void {
  if (kind === "play") {
    const v = view(s, st);
    const played = v.hand.filter((c) => ids.has(c.id));
    const e = estimateScore(played, { ...scoreContext(v, played), armDown: boss?.armDown });
    if (allowed(boss, st, e.hand)) st.remaining -= e.score;
    st.played.push(e.hand);
    st.handsLeft--;
    st.plays = (st.plays ?? 0) + 1;
    if (boss?.armDown) st.levels = { ...v.levels, [e.hand]: levelDown(levelOf(v.levels, e.hand as HandName), e.hand as HandName) };
    heartPick(s, st, boss);
  } else st.discardsLeft--;
  st.hand = st.hand.filter((c) => !ids.has(c.id));
  // The Hook throws two random cards from the hand after each hand played.
  if (boss?.hook && kind === "play") for (let k = 0; k < 2 && st.hand.length; k++) st.hand.splice(Math.floor(st.rand() * st.hand.length), 1);
  if (boss?.drawThree) for (let k = 0; k < 3 && st.deck.length; k++) st.hand.push(st.deck.pop()!);
  else while (st.hand.length < s.handSize && st.deck.length) st.hand.push(st.deck.pop()!);
}

function greedy(s: Snapshot, st: State, boss?: BossEffects): { kind: Move["kind"]; ids: Set<number> } {
  const v = view(s, st);
  const best = boss?.noRepeat || boss?.oneType ? (playOptions(v, 6).find((o) => allowed(boss, st, o.estimate.hand)) ?? bestPlay(v)) : bestPlay(v);
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
  /** Extra hands, discards or hand size every round (a voucher such as Grabber or Paint Brush). */
  bonus?: { hands?: number; discards?: number; handSize?: number };
}

/**
 * What jokers change about a round: Juggler and Turtle Bean add hand size, Troubadour trades a
 * hand for two cards, Burglar three hands for every discard, Merry Andy three discards for a card,
 * Drunkard a discard, Stuntman costs two cards. Hands and discards here are on top of the round's
 * base (`handsPerRound`, `discardsPerRound`, which count no jokers); hand size is relative.
 */
export function roundResources(jokers: Joker[]): { hands: number; discards: number; handSize: number; noDiscards: boolean } {
  const r = { hands: 0, discards: 0, handSize: 0, noDiscards: false };
  for (const j of jokers) {
    if (j.debuff) continue;
    if (j.key === "j_juggler") r.handSize += 1;
    if (j.key === "j_troubadour") (r.handSize += 2), (r.hands -= 1);
    if (j.key === "j_burglar") (r.hands += 3), (r.noDiscards = true);
    if (j.key === "j_merry_andy") (r.discards += 3), (r.handSize -= 1);
    if (j.key === "j_drunkard") r.discards += 1;
    if (j.key === "j_turtle_bean") r.handSize += Number.isFinite(j.stats.h_size) ? j.stats.h_size : 5;
    if (j.key === "j_stuntman") r.handSize -= 2;
  }
  return r;
}

/**
 * The chance of beating a blind of `target` chips over a whole round, dealt fresh from the full
 * deck, with these jokers and hand levels: the same greedy play as above, from the first draw. Shop
 * and pack choices compare it with and without a card, which ranks a joker by what it does for
 * this deck's hands rather than by what kind of joker it is.
 *
 * `ahead` is how many rounds of play lie before this blind: growing jokers are played at the value
 * they will most likely have by then (growth.ts), decaying ones at what they keep, and what changes
 * every round is drawn per sample (`roundDraw`).
 */
export function roundOdds(s: Snapshot, setups: Setup[], target: number, hands: number, discards: number, samples = 60, boss?: BossEffects, ahead = 0): number[] {
  // A setup's odds depend only on it, the state's cards, jokers, levels and money, and the round
  // asked about (every setup gets the same deals), so each is kept: the ticks of one shop visit,
  // and the blind select after it, ask about the same setups again and again.
  // Money only scores through Bull and Bootstraps, so it is part of the key only beside them: a
  // purchase then leaves the other setups' odds standing.
  const state = JSON.stringify([s.deckLeft, s.hand, s.round, s.ante, s.handSize, s.playLimit, s.deck, s.startDeckSize, s.deckSize, s.roundCards, s.levels, s.jokers, s.rules, target, hands, discards, samples, boss, ahead, FEATURES]);
  const paid = (js: Joker[]) => js.some((j) => j.key === "j_bull" || j.key === "j_bootstraps");
  const keys = setups.map((setup) => hashKey(state + JSON.stringify(setup) + (paid(s.jokers) || paid(setup.jokers) ? `$${s.money}` : "")));
  const missing = setups.filter((_, i) => !oddsCache.has(keys[i]));
  if (missing.length) {
    const got = roundOddsUncached(s, missing, target, hands, discards, samples, boss, ahead);
    let k = 0;
    setups.forEach((_, i) => {
      if (!oddsCache.has(keys[i])) remember(keys[i], got[k++]);
    });
  }
  return keys.map((k) => oddsCache.get(k)!);
}

const oddsCache = new Map<string, number>();
function remember(key: string, value: number): void {
  if (oddsCache.size >= 20000) oddsCache.delete(oddsCache.keys().next().value!);
  oddsCache.set(key, value);
}

/** cyrb53: a 53-bit string hash, as a short cache key for a long description. */
function hashKey(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(36)}.${(h1 >>> 0).toString(36)}.${str.length}`;
}

function roundOddsUncached(s: Snapshot, setups: Setup[], target: number, hands: number, discards: number, samples: number, boss: BossEffects | undefined, ahead: number): number[] {
  // Several setups: split them over worker threads (src/parallel.ts). Each setup is seeded on its
  // own, so the numbers are the same as here.
  if (parallelism() > 1 && setups.length >= 2 && setups.length * samples >= 120) {
    const k = Math.min(parallelism(), setups.length);
    const per = Math.ceil(setups.length / k);
    const parts = Array.from({ length: k }, (_, i) => setups.slice(i * per, (i + 1) * per)).filter((p) => p.length);
    // A boss rule travels as its name: its debuff test is a function. Manacle's size gives the hand size back.
    const rule = boss ? { name: boss.name, handSize: boss.handSize !== undefined ? boss.handSize + 1 : s.handSize } : undefined;
    const res = fanOut("odds", parts.map((p) => ({ args: { s, setups: p, target, hands, discards, samples, boss: rule, ahead }, width: p.length })));
    if (res) return res.flat();
  }
  const cues = runCues(s);
  const now = roundResources(s.jokers);
  const prepare = (cards: PCard[], rule?: BossEffects) => cards.filter((c) => !c.hidden || c.rank).map((c) => (rule?.debuff?.(c) ? { ...c, debuff: true } : c));
  const live = [...s.deckLeft, ...s.hand];
  const deck = prepare(live, boss);
  if (!deck.length || target <= 0) return setups.map(() => 1);
  // One seed for every setup: the same deals, so differences come from the cards and jokers.
  const seed = s.round * 6007 + s.ante * 131 + deck.length;
  return setups.map((setup) => {
    const jokers = projectJokers(setup.jokers, FEATURES.growth ? ahead : 0, cues).map((j, i) => ({ ...j, index: i }));
    // Chicot disables the boss, The Wall's size included.
    const rule = jokers.some((j) => j.key === "j_chicot" && !j.debuff) ? undefined : boss;
    const full = setup.deck ? prepare(setup.deck, rule) : rule === boss ? deck : prepare(live, rule);
    const goal = target * (rule?.targetScale ?? 1);
    const res = roundResources(jokers);
    const bonus = setup.bonus ?? {};
    const size = Math.max(1, (rule?.handSize ?? s.handSize) - now.handSize + res.handSize + (bonus.handSize ?? 0));
    const roundHands = Math.max(1, (rule?.hands ?? hands) + (rule?.hands ? 0 : res.hands + (bonus.hands ?? 0)));
    const roundDiscards = res.noDiscards ? 0 : Math.max(0, (rule?.discards ?? discards) + (rule?.discards !== undefined ? 0 : res.discards + (bonus.discards ?? 0)));
    const levels = rule?.halveBase ? Object.fromEntries(Object.entries(setup.levels).map(([h, l]) => [h, { ...l, chips: Math.ceil(l.chips / 2), mult: Math.max(1, Math.ceil(l.mult / 2)) }])) : setup.levels;
    const blind = rule?.playFive ? { type: "BOSS" as const, status: "CURRENT" as const, name: rule.name, effect: "Must play 5 cards", target: goal } : undefined;
    const base: Snapshot = { ...s, phase: "SELECTING_HAND", jokers, levels, rules: rulesFromJokers(jokers), blind, handsPlayed: 0, handSize: size };
    const draws = ahead > 0 && jokers.some((j) => ROUND_DRAWN.has(j.key) && !j.debuff);
    let clear = 0;
    for (let k = 0; k < samples; k++) {
      // Each sample has its own streams, so every setup is dealt the same cards in sample k even
      // when an earlier sample drew more random numbers for one setup than for another.
      const rand = mulberry32(seed + k * 7919);
      const round = draws ? roundDraw(base, full, ahead, mulberry32(seed + 0x5bd1e995 + k * 7919)) : base;
      const cards = shuffle([...full], rand);
      const st: State = { hand: cards.splice(cards.length - Math.min(size, cards.length)), deck: cards, handsLeft: roundHands, discardsLeft: roundDiscards, remaining: goal, played: [], rand };
      heartPick(round, st, rule);
      while (st.remaining > 0 && st.handsLeft > 0 && st.hand.length) {
        const next = greedy(round, st, rule);
        apply(round, st, next.kind, next.ids, rule);
      }
      if (st.remaining <= 0) clear++;
    }
    return clear / samples;
  });
}

/** Jokers whose round is drawn per sample in a forecast: their pick changes, or they destroy jokers. */
const ROUND_DRAWN = new Set(["j_ancient", "j_idol", "j_madness", "j_loyalty_card"]);

/**
 * One draw of what a round `ahead` rounds away holds: Ancient Joker's suit and The Idol's card are
 * picked again every round (the Idol's from the deck), and each Madness has destroyed a random
 * other joker, Eternal ones spared, at every Small and Big Blind until then.
 */
function roundDraw(base: Snapshot, deck: PCard[], ahead: number, rand: () => number): Snapshot {
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  const idol = pick(deck.filter((c) => c.rank && c.suit && c.enhancement !== "STONE"));
  const roundCards = { ancientSuit: pick(SUITS), idolRank: idol?.rank, idolSuit: idol?.suit };
  const madness = base.jokers.filter((j) => j.key === "j_madness" && !j.debuff).length;
  // Loyalty Card: where its count stands by then is anyone's guess.
  const loyal = base.jokers.some((j) => j.key === "j_loyalty_card");
  if (!madness && !loyal) return { ...base, roundCards };
  const jokers = base.jokers.map((j) => (j.key === "j_loyalty_card" ? { ...j, stats: { ...j.stats, loyalty_remaining: Math.floor(rand() * ((j.stats.loyalty_every ?? 5) + 1)) } } : j));
  for (let n = madness * smallBigBlinds(ahead); n > 0; n--) {
    const prey = jokers.map((j, i) => (j.key === "j_madness" || j.eternal ? -1 : i)).filter((i) => i >= 0);
    if (!prey.length) break;
    jokers.splice(pick(prey), 1);
  }
  const kept = jokers.map((j, i) => ({ ...j, index: i }));
  return { ...base, jokers: kept, rules: rulesFromJokers(kept), roundCards };
}

/** Simulates `samples` finishes of the round after each move. */
export function roundOutcomes(s: Snapshot, moves: Move[], samples = 80): Outcome[] {
  if (parallelism() > 1 && moves.length >= 4) {
    const k = Math.min(parallelism(), moves.length);
    const per = Math.ceil(moves.length / k);
    const parts = Array.from({ length: k }, (_, i) => moves.slice(i * per, (i + 1) * per)).filter((p) => p.length);
    const res = fanOut("outcomes", parts.map((p) => ({ args: { s, moves: p, samples }, width: 4 * p.length })));
    if (res) return res.flatMap((r) => Array.from({ length: r.length / 4 }, (_, i) => ({ clear: r[4 * i], reach: r[4 * i + 1], spare: r[4 * i + 2], samples: r[4 * i + 3] })));
  }
  const deck = s.deckLeft.filter((c) => !c.hidden || c.rank);
  const seed = s.round * 7919 + s.hand.reduce((a, c) => a + c.id, 0) + s.handsLeft * 31 + s.discardsLeft;
  // The live boss's rules that act hand by hand; its debuffs, hand counts and size are already in the state.
  const chicot = s.jokers.some((j) => j.key === "j_chicot" && !j.debuff);
  const rule = s.blind?.type === "BOSS" && !chicot ? bossEffects(s.blind.name, s.handSize) : undefined;
  const boss = rule && (rule.noRepeat || rule.oneType || rule.hook || rule.armDown || rule.heart) ? rule : undefined;
  const playedBefore = Object.entries(s.levels).filter(([, l]) => (l?.played_this_round ?? 0) > 0).map(([h]) => h);
  return moves.map((move) => {
    let clear = 0;
    let reach = 0;
    let spare = 0;
    const ids = new Set(move.cards.map((i) => s.hand[i]?.id).filter((id): id is number => id !== undefined));
    for (let k = 0; k < samples; k++) {
      // Every move meets the same futures: sample k shuffles the deck the same way after each, so
      // the moves differ by what they do, not by the luck of their own draws.
      const rand = mulberry32(seed + k * 104729);
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
