import type { PCard } from "../src/cards.ts";
import { cardLabel } from "../src/cards.ts";
import type { GameState, RawCard } from "../src/types.ts";

/** "AS" -> Ace of Spades, "TH" -> Ten of Hearts. Extra tokens: "AS:GLASS", "KD:STONE". */
export function raw(code: string, id = 0): RawCard {
  const [cardCode, enhancement] = code.split(":");
  const rank = cardCode.slice(0, -1);
  const suit = cardCode.slice(-1);
  return {
    id,
    key: `${suit}_${rank}`,
    set: enhancement ? "ENHANCED" : "DEFAULT",
    label: code,
    value: { suit, rank, effect: "" },
    modifier: enhancement ? { enhancement } : {},
    state: {},
    cost: { sell: 1, buy: 0 },
  };
}

export function pc(code: string, index = 0): PCard {
  const [cardCode, enhancement] = code.split(":");
  const c: PCard = {
    index,
    id: index,
    rank: enhancement === "STONE" ? undefined : cardCode.slice(0, -1),
    suit: enhancement === "STONE" ? undefined : cardCode.slice(-1),
    enhancement,
    debuff: false,
    hidden: false,
    forced: false,
    label: "",
  };
  c.label = cardLabel(c);
  return c;
}

export const pcs = (codes: string) => codes.split(" ").map((code, i) => pc(code, i));

export function joker(key: string, stats: Record<string, number> = {}): RawCard {
  return { id: 900, key, set: "JOKER", label: key, value: { effect: "", stats }, modifier: {}, state: {}, cost: { sell: 2, buy: 0 } };
}

export function handState(codes: string[], opts: { remaining?: number; hands?: number; discards?: number; jokers?: RawCard[]; deck?: string[]; limit?: number } = {}): GameState {
  return {
    state: "SELECTING_HAND",
    ante_num: 1,
    round_num: 1,
    money: 10,
    bankrupt_at: 0,
    round: { hands_left: opts.hands ?? 4, discards_left: opts.discards ?? 3, chips: 0, reroll_cost: 5 },
    blinds: { small: { type: "SMALL", status: "CURRENT", name: "Small Blind", effect: "No special effect", score: opts.remaining ?? 300 } },
    hand: { count: codes.length, limit: 8, highlighted_limit: opts.limit ?? 5, cards: codes.map((c, i) => raw(c, i)) },
    cards: { count: 0, limit: 52, cards: (opts.deck ?? []).map((c, i) => raw(c, 100 + i)) },
    jokers: { count: opts.jokers?.length ?? 0, limit: 5, cards: opts.jokers ?? [] },
    consumables: { count: 0, limit: 2, cards: [] },
    held_tags_ready: true,
  };
}
