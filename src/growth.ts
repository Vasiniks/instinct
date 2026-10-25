// Jokers that change from round to round: the ones that grow with play (Green Joker, Runner,
// Constellation, ...) and the ones that run down (Ice Cream, Popcorn, Gros Michel). A forecast at
// a boss some rounds ahead plays them at the value they will most likely have by then, so a
// scaling joker bought now is worth what it becomes, not what it starts at, and a decaying one is
// worth less the further ahead the boss is. Rates are rough per-round expectations from how the
// joker grows; owned jokers start from the game's live value, offers from the joker's base. A
// Perishable joker past its rounds is debuffed by then.

import type { Snapshot } from "./extract.ts";
import type { Joker } from "./poker.ts";

type Stat = "chips" | "mult" | "x_mult" | "h_size";

interface Growth {
  stat: Stat;
  /** The value a fresh copy starts at. */
  base: number;
  /** Expected change per round of play, given the run. */
  perRound: (r: RunCues) => number;
  /** Change per Small or Big Blind played instead (Madness grows when one is selected). */
  perBlind?: number;
  /** Bounds the value can't pass (decaying jokers stop at their floor). */
  min?: number;
}

export interface RunCues {
  /** The hand type played most so far. */
  mostPlayed?: string;
  /** Share of face cards in the deck. */
  faceShare: number;
  /** Shares of Lucky, Glass and any enhanced cards in the deck. */
  luckyShare: number;
  glassShare: number;
  enhancedShare: number;
}

const GROWTH: Record<string, Growth> = {
  // +1 Mult per hand played, -1 per discard: about two hands more than discards a round.
  j_green_joker: { stat: "mult", base: 0, perRound: () => 2 },
  // +1 Mult per hand without a scoring face card; resets on one.
  j_ride_the_bus: { stat: "mult", base: 0, perRound: (r) => (r.faceShare < 0.1 ? 3 : r.faceShare < 0.2 ? 1.5 : 0.5) },
  // +15 Chips per Straight played.
  j_runner: { stat: "chips", base: 0, perRound: (r) => (r.mostPlayed === "Straight" ? 40 : 5) },
  // +4 Chips per four-card hand.
  j_square: { stat: "chips", base: 0, perRound: () => 2 },
  // +2 Mult per Two Pair played.
  j_trousers: { stat: "mult", base: 0, perRound: (r) => (r.mostPlayed === "Two Pair" ? 6 : 1) },
  // +8 Chips per scored 2.
  j_wee: { stat: "chips", base: 0, perRound: () => 6 },
  // +3 Chips per discarded card of its suit.
  j_castle: { stat: "chips", base: 0, perRound: () => 6 },
  // +X0.1 per Planet used.
  j_constellation: { stat: "x_mult", base: 1, perRound: () => 0.1 },
  // +X0.25 per card added to the deck.
  j_hologram: { stat: "x_mult", base: 1, perRound: () => 0.05 },
  // The next three grow only on cards the deck holds. About 12 cards score a round.
  // +X0.25 per Lucky card trigger (1 in 5): 12 x share x 0.2 x 0.25.
  j_lucky_cat: { stat: "x_mult", base: 1, perRound: (r) => 0.6 * r.luckyShare },
  // +X0.75 per Glass card destroyed (1 in 4 as it scores): 12 x share x 0.25 x 0.75.
  j_glass: { stat: "x_mult", base: 1, perRound: (r) => 2.25 * r.glassShare },
  // +X0.2 per hand that isn't the most played.
  j_obelisk: { stat: "x_mult", base: 1, perRound: () => 0.05 },
  // +X0.1 per enhanced card scored (and eats the enhancement): 12 x share x 0.1.
  j_vampire: { stat: "x_mult", base: 1, perRound: (r) => 1.2 * r.enhancedShare },
  // +X0.5 per Small or Big Blind selected; it destroys a random other joker each time (round.ts).
  j_madness: { stat: "x_mult", base: 1, perRound: () => 0, perBlind: 0.5 },
  // +X1 per 23 cards discarded.
  j_yorick: { stat: "x_mult", base: 1, perRound: () => 0.15 },
  // +2 Mult per reroll, +3 per pack skipped, +1 per Tarot used.
  j_flash: { stat: "mult", base: 0, perRound: () => 2 },
  j_red_card: { stat: "mult", base: 0, perRound: () => 1.5 },
  j_fortune_teller: { stat: "mult", base: 0, perRound: () => 0.5 },
  // Run down: -5 Chips a hand, -4 Mult a round, -X0.01 per discarded card.
  j_ice_cream: { stat: "chips", base: 100, perRound: () => -15, min: 0 },
  j_popcorn: { stat: "mult", base: 20, perRound: () => -4, min: 0 },
  j_ramen: { stat: "x_mult", base: 2, perRound: () => -0.03, min: 1 },
  // +5 hand size, one less every round.
  j_turtle_bean: { stat: "h_size", base: 5, perRound: () => -1, min: 0 },
};

/** The value a Gros Michel or Cavendish is expected to keep: each round it may be destroyed. */
const SURVIVAL: Record<string, { stat: Stat; base: number; perRound: number }> = {
  j_gros_michel: { stat: "mult", base: 15, perRound: 5 / 6 },
  j_cavendish: { stat: "x_mult", base: 3, perRound: 999 / 1000 },
};

export const grows = (key: string) => key in GROWTH;

export function runCues(s: Snapshot): RunCues {
  const cards = [...s.deckLeft, ...s.hand].filter((c) => c.rank);
  const faces = cards.filter((c) => c.rank === "J" || c.rank === "Q" || c.rank === "K").length;
  const top = Object.entries(s.levels).sort((a, b) => (b[1]?.played ?? 0) - (a[1]?.played ?? 0))[0];
  const share = (f: (c: (typeof cards)[number]) => boolean) => (cards.length ? cards.filter(f).length / cards.length : 0);
  return {
    mostPlayed: top && (top[1]?.played ?? 0) > 0 ? top[0] : undefined,
    faceShare: cards.length ? faces / cards.length : 0.23,
    luckyShare: share((c) => c.enhancement === "LUCKY"),
    glassShare: share((c) => c.enhancement === "GLASS"),
    enhancedShare: share((c) => Boolean(c.enhancement)),
  };
}

/**
 * Small and Big Blinds among the next `rounds` rounds: `roundsTo` counts this ante's blinds left
 * before its boss (0-2), then three a round per ante, two of them before each boss.
 */
export const smallBigBlinds = (rounds: number) => (rounds % 3) + 2 * Math.floor(rounds / 3);

/** Rounds of play before the boss of the ante `k` antes from now (0: this ante's boss). */
export function roundsTo(s: Snapshot, k: number): number {
  const left = s.blinds.filter((b) => b.status !== "DEFEATED" && b.status !== "SKIPPED").length;
  return Math.max(0, left - 1) + 3 * k;
}

/**
 * The jokers as they will most likely be `rounds` rounds of play from now. At 0 rounds this only
 * gives an offered copy (no live value yet) its starting value.
 */
export function projectJokers(jokers: Joker[], rounds: number, cues: RunCues): Joker[] {
  const r = Math.max(0, rounds);
  return jokers.map((j) => {
    // Perishable: debuffed once its rounds run out (the sticker counts down at each round's end).
    if (j.perishable !== undefined && r > 0 && r >= j.perishable) return { ...j, debuff: true };
    const g = GROWTH[j.key];
    const sv = SURVIVAL[j.key];
    if (!g && !sv) return j;
    if (g) {
      const now = Number.isFinite(j.stats[g.stat]) ? j.stats[g.stat] : g.base;
      const step = g.perBlind !== undefined ? g.perBlind * smallBigBlinds(r) : g.perRound(cues) * r;
      const value = Math.max(g.min ?? -Infinity, now + step);
      return { ...j, stats: { ...j.stats, [g.stat]: value } };
    }
    const now = Number.isFinite(j.stats[sv!.stat]) ? j.stats[sv!.stat] : sv!.base;
    // Expected value: the bonus times the chance it is still there (X-mult decays toward X1).
    const keep = sv!.perRound ** r;
    const value = sv!.stat === "x_mult" ? 1 + (now - 1) * keep : now * keep;
    return { ...j, stats: { ...j.stats, [sv!.stat]: value } };
  });
}
