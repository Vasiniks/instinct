// Deck fixing as the simulation sees it: what a Tarot or Spectral does to the cards, applied to a
// copy of the deck so round.ts can compare the run with and without it. Cards it acts on come from
// a hand: the real one when there is one (an Arcana pack, a hand in play), otherwise a hand dealt
// from the deck, since a card bought in the shop is used on some later hand.

import { RANKS, cardWorth, type PCard } from "./cards.ts";
import type { Item } from "./extract.ts";
import { TAROTS } from "./knowledge.ts";

const SUIT_OF: Record<string, string> = { c_star: "D", c_moon: "C", c_sun: "H", c_world: "S" };
const SEAL_OF: Record<string, string> = { c_talisman: "GOLD", c_deja_vu: "RED", c_trance: "BLUE", c_medium: "PURPLE" };
/** Enhancements the Spectrals that add cards give them, in rough proportion. */
const RANDOM_ENH = ["BONUS", "MULT", "WILD", "GLASS", "STEEL", "GOLD", "LUCKY", "STONE"];

/** Consumables whose effect on the deck the simulation can play out. */
export function changesDeck(key: string): boolean {
  const t = TAROTS[key];
  return Boolean(
    (t && ["suit", "enhance", "rank", "destroy", "copy"].includes(t.kind)) ||
      SEAL_OF[key] ||
      ["c_sigil", "c_cryptid", "c_immolate", "c_familiar", "c_grim", "c_incantation", "c_aura"].includes(key),
  );
}

let nextId = -1000;
const fresh = (c: Omit<PCard, "id" | "index">): PCard => ({ ...c, id: nextId--, index: -1 });

/**
 * The deck after using `item` on `targets` (cards of `deck`, by id). Random parts (Sigil's suit,
 * the cards Familiar adds) draw from `rand`. Undefined when the card doesn't change the deck.
 */
export function applyToDeck(item: Pick<Item, "key">, deck: PCard[], targets: PCard[], rand: () => number): PCard[] | undefined {
  const key = item.key;
  const ids = new Set(targets.map((c) => c.id));
  const on = (f: (c: PCard) => PCard) => deck.map((c) => (ids.has(c.id) ? f(c) : c));
  const t = TAROTS[key];
  if (SUIT_OF[key]) return on((c) => ({ ...c, suit: SUIT_OF[key] }));
  if (t?.kind === "enhance") return on((c) => ({ ...c, enhancement: t.detail! }));
  if (t?.kind === "rank") return on((c) => ({ ...c, rank: c.rank && c.rank !== "A" ? RANKS[RANKS.indexOf(c.rank as (typeof RANKS)[number]) + 1] : c.rank }));
  if (t?.kind === "destroy") return deck.filter((c) => !ids.has(c.id));
  if (t?.kind === "copy" && targets.length === 2) {
    const [left, right] = [...targets].sort((a, b) => a.index - b.index);
    return deck.map((c) => (c.id === left.id ? { ...right, id: left.id, index: left.index } : c));
  }
  if (SEAL_OF[key]) return on((c) => ({ ...c, seal: SEAL_OF[key] }));
  if (key === "c_aura") return on((c) => ({ ...c, edition: ["FOIL", "HOLO", "POLYCHROME"][Math.floor(rand() * 3)] }));
  if (key === "c_sigil") {
    const suit = ["S", "H", "C", "D"][Math.floor(rand() * 4)];
    return on((c) => ({ ...c, suit }));
  }
  if (key === "c_cryptid" && targets[0]) return [...deck, fresh(targets[0]), fresh(targets[0])];
  const destroyRandom = (n: number) => {
    const gone = new Set([...targets].sort(() => rand() - 0.5).slice(0, n).map((c) => c.id));
    return deck.filter((c) => !gone.has(c.id));
  };
  const added = (ranks: string[], n: number) =>
    Array.from({ length: n }, () => fresh({ rank: ranks[Math.floor(rand() * ranks.length)], suit: ["S", "H", "C", "D"][Math.floor(rand() * 4)], enhancement: RANDOM_ENH[Math.floor(rand() * RANDOM_ENH.length)], debuff: false, hidden: false, forced: false, label: "" }));
  if (key === "c_immolate") return destroyRandom(5);
  if (key === "c_familiar") return [...destroyRandom(1), ...added(["J", "Q", "K"], 3)];
  if (key === "c_grim") return [...destroyRandom(1), ...added(["A"], 2)];
  if (key === "c_incantation") return [...destroyRandom(1), ...added(["2", "3", "4", "5", "6", "7", "8", "9", "T"], 4)];
  return undefined;
}

/** A hand dealt from `deck` for a card used later: the `size` cards a shuffle puts on top. */
export function dealtHand(deck: PCard[], size: number, rand: () => number): PCard[] {
  const copy = [...deck];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, size).map((c, i) => ({ ...c, index: i }));
}


/** Hand cards a consumable should target, or null when it needs targets the hand can't give. */
export function pickTargets(item: Pick<Item, "key" | "targetMin" | "targetMax">, hand: PCard[], buildSuit?: string): number[] | null {
  if (item.targetMax <= 0) return [];
  const pool = hand.filter((c) => !c.hidden);
  if (pool.length < Math.max(1, item.targetMin)) return null;
  const n = Math.min(item.targetMax, pool.length);
  const asc = [...pool].sort((a, b) => cardWorth(a) - cardWorth(b));
  const desc = [...asc].reverse();
  let picks: PCard[];
  if (item.key === "c_hanged_man") {
    // Deck fixing: destroy off-suit cards first in a flush build, otherwise the weakest.
    picks = buildSuit ? [...asc.filter((c) => c.suit !== buildSuit), ...asc.filter((c) => c.suit === buildSuit)].slice(0, n) : asc.slice(0, n);
  } else if (item.key === "c_death") {
    // Left card becomes a copy of the right card: lowest-worth card left of the best one.
    let bestPair: [PCard, PCard] | null = null;
    let low: PCard | null = null;
    for (const c of [...pool].sort((a, b) => a.index - b.index)) {
      if (low && (!bestPair || cardWorth(c) - cardWorth(low) > cardWorth(bestPair[1]) - cardWorth(bestPair[0]))) bestPair = [low, c];
      if (!low || cardWorth(c) < cardWorth(low)) low = c;
    }
    if (!bestPair || cardWorth(bestPair[1]) <= cardWorth(bestPair[0])) return null;
    picks = bestPair;
  } else if (SUIT_OF[item.key]) picks = asc.filter((c) => c.suit !== SUIT_OF[item.key]).slice(0, n);
  else if (item.key === "c_strength") picks = desc.filter((c) => c.rank && c.rank !== "A").slice(0, n);
  else picks = desc.slice(0, n);
  if (picks.length < Math.max(1, item.targetMin)) return null;
  return picks.map((c) => c.index).sort((a, b) => a - b);
}
