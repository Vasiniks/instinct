// Normalized card shapes shared by the extractor, the evaluator, the simulator and the UI.

import type { RawCard } from "./types.ts";

export const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"] as const;
export const SUITS = ["S", "H", "C", "D"] as const;
export const SUIT_GLYPH: Record<string, string> = { H: "♥", D: "♦", C: "♣", S: "♠" };
export const SUIT_NAME: Record<string, string> = { H: "Hearts", D: "Diamonds", C: "Clubs", S: "Spades" };
export const FACE_RANKS = new Set(["J", "Q", "K"]);

/** A playing card in hand (or deck), positioned by the 0-based index BlindDeck expects. */
export interface PCard {
  index: number;
  id: number;
  rank?: string; // undefined for Stone and face-down cards
  suit?: string; // undefined for Stone and face-down cards
  enhancement?: string; // BONUS MULT WILD GLASS STEEL STONE GOLD LUCKY
  edition?: string; // FOIL HOLO POLYCHROME NEGATIVE
  seal?: string; // RED BLUE GOLD PURPLE
  debuff: boolean;
  hidden: boolean;
  forced: boolean;
  label: string;
}

export function normRank(rank: string | undefined): string | undefined {
  if (!rank) return undefined;
  if (rank === "10") return "T";
  return rank.toUpperCase();
}

export function normEdition(edition: string | null | undefined): string | undefined {
  if (!edition) return undefined;
  const e = edition.toUpperCase();
  return e === "HOLOGRAPHIC" ? "HOLO" : e;
}

/** 2..14, ace high. */
export function rankValue(rank: string): number {
  return RANKS.indexOf(rank as (typeof RANKS)[number]) + 2;
}

/** Base chips a scoring card adds: pip value, faces 10, ace 11. */
export function rankChips(rank: string): number {
  if (rank === "A") return 11;
  if (rank === "T" || FACE_RANKS.has(rank)) return 10;
  return Number(rank);
}

export function cardLabel(c: Pick<PCard, "rank" | "suit" | "enhancement" | "hidden">): string {
  if (c.hidden) return "??";
  if (c.enhancement === "STONE") return "Stone";
  const r = c.rank === "T" ? "10" : (c.rank ?? "?");
  return `${r}${SUIT_GLYPH[c.suit ?? ""] ?? "?"}`;
}

/** Label plus the modifiers that change scoring, e.g. `K♥ glass+red seal`. */
export function cardLongLabel(c: PCard): string {
  const mods = [c.enhancement && c.enhancement !== "STONE" ? c.enhancement.toLowerCase() : "", c.edition?.toLowerCase() ?? "", c.seal ? `${c.seal.toLowerCase()} seal` : "", c.debuff ? "DEBUFFED" : ""].filter(Boolean);
  return mods.length ? `${c.label} ${mods.join("+")}` : c.label;
}

export function toPCard(raw: RawCard, index: number): PCard {
  const hidden = Boolean(raw.state?.hidden);
  const enhancement = raw.modifier?.enhancement ?? undefined;
  const stone = enhancement === "STONE";
  const card: PCard = {
    index,
    id: raw.id,
    rank: hidden || stone ? undefined : normRank(raw.value?.rank),
    suit: hidden || stone ? undefined : raw.value?.suit,
    enhancement: enhancement ?? undefined,
    edition: normEdition(raw.modifier?.edition),
    seal: raw.modifier?.seal ?? undefined,
    debuff: Boolean(raw.state?.debuff),
    hidden,
    forced: Boolean(raw.state?.forced_selection),
    label: "",
  };
  card.label = cardLabel(card);
  return card;
}

/** Rough worth of a card as a scorer, used to pick which copies to play and which to throw. */
export function cardWorth(c: PCard): number {
  if (c.hidden) return 0;
  if (c.debuff) return 0.5;
  let w = c.enhancement === "STONE" ? 50 : rankChips(c.rank ?? "2");
  if (c.enhancement === "BONUS") w += 30;
  if (c.enhancement === "MULT") w += 20;
  if (c.enhancement === "GLASS") w += 60;
  if (c.enhancement === "LUCKY") w += 15;
  if (c.edition === "FOIL") w += 25;
  if (c.edition === "HOLO") w += 30;
  if (c.edition === "POLYCHROME") w += 60;
  if (c.seal === "RED") w += 20;
  if (c.seal === "GOLD") w += 8;
  // Steel and Gold cards earn more while held, so they are worth keeping out of plays.
  if (c.enhancement === "STEEL" || c.enhancement === "GOLD") w -= 15;
  return w;
}

/** Hypergeometric P(at least `need` successes in `draws` draws from `pop` cards with `succ` successes). */
export function pAtLeast(need: number, draws: number, pop: number, succ: number): number {
  if (need <= 0) return 1;
  if (draws <= 0 || pop <= 0 || succ <= 0 || need > draws || need > succ) return 0;
  draws = Math.min(draws, pop);
  const lnC = (n: number, k: number): number => {
    if (k < 0 || k > n) return -Infinity;
    let s = 0;
    for (let i = 1; i <= k; i++) s += Math.log((n - k + i) / i);
    return s;
  };
  const total = lnC(pop, draws);
  let p = 0;
  for (let k = need; k <= Math.min(draws, succ); k++) {
    p += Math.exp(lnC(succ, k) + lnC(pop - succ, draws - k) - total);
  }
  return Math.min(1, Math.max(0, p));
}
