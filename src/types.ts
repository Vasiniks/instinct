// BlindDeck GameState, mirrored from the mod's src/lua/utils/openrpc.json (v1.5.2).
// Every field the mod may omit is optional; extract.ts is the only place that reads these raw shapes.

export type Phase =
  | "MENU"
  | "BLIND_SELECT"
  | "SELECTING_HAND"
  | "ROUND_EVAL"
  | "SHOP"
  | "SMODS_BOOSTER_OPENED"
  | "GAME_OVER";

export interface CardValue {
  suit?: string;
  rank?: string;
  effect?: string;
  stats?: Record<string, number>;
  rarity?: string;
  target_min?: number;
  target_max?: number;
  requires_jokers_min?: number;
  random_joker_effect?: boolean;
  copy_key?: string;
  copy_label?: string;
}

export interface CardModifier {
  seal?: string | null;
  edition?: string | null;
  enhancement?: string | null;
  eternal?: boolean;
  perishable?: number | null;
  rental?: boolean;
  rental_cost?: number;
  pinned?: boolean;
}

export interface CardState {
  debuff?: boolean;
  hidden?: boolean;
  highlight?: boolean;
  forced_selection?: boolean;
}

export interface RawCard {
  id: number;
  key: string;
  set: string;
  label: string;
  value: CardValue;
  modifier: CardModifier;
  state: CardState;
  cost: { sell: number; buy: number };
}

export interface Area {
  count: number;
  limit: number;
  highlighted_limit?: number;
  choices_remaining?: number;
  cards: RawCard[];
}

export interface Blind {
  type: "SMALL" | "BIG" | "BOSS";
  status: "SELECT" | "CURRENT" | "UPCOMING" | "DEFEATED" | "SKIPPED";
  name: string;
  effect: string;
  score: number;
  tag_key?: string;
  tag_name?: string;
  tag_effect?: string;
}

export interface HandInfo {
  order: number;
  level: number;
  chips: number;
  mult: number;
  played: number;
  played_this_round: number;
  visible?: boolean;
}

export interface Round {
  hands_left?: number;
  hands_played?: number;
  discards_left?: number;
  discards_used?: number;
  reroll_cost?: number;
  boss_reroll_cost?: number;
  boss_reroll_available?: boolean;
  boss_rerolled?: boolean;
  chips?: number;
  ancient_suit?: string;
  idol_rank?: string;
  idol_suit?: string;
  castle_suit?: string;
  cashout_preview?: { total: number; lines: { kind: string; label: string; dollars: number }[] };
}

export interface RunSummary {
  best_hand?: number;
  most_played_hand?: { name: string; count: number };
  cards_played?: number;
  cards_discarded?: number;
  cards_purchased?: number;
  reroll_count?: number;
  result?: string;
}

export interface HeldTag {
  key: string;
  name: string;
  effect: string;
}

export interface GameState {
  state: Phase | string;
  round_num?: number;
  ante_num?: number;
  money?: number;
  bankrupt_at?: number;
  deck?: string;
  stake?: string;
  seed?: string;
  won?: boolean;
  victory_overlay?: boolean;
  used_vouchers?: Record<string, string>;
  hands?: Record<string, HandInfo>;
  round?: Round;
  blinds?: { small?: Blind; big?: Blind; boss?: Blind };
  jokers?: Area;
  consumables?: Area;
  hand?: Area;
  cards?: Area;
  pack?: Area;
  shop?: Area;
  vouchers?: Area;
  packs?: Area;
  run?: { skips?: number; deck_size?: number; starting_deck_size?: number; tarot_used?: number };
  run_summary?: RunSummary;
  held_tags?: HeldTag[];
  held_tags_ready?: boolean;
  pack_ready?: boolean;
  pack_hand_ready?: boolean;
  challenge?: { id: string; name: string };
}
