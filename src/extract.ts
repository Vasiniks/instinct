// The extractor: one BlindDeck `gamestate` -> a normalized Snapshot that the rest of the agent
// (candidates, evaluator, UI, logs) reads, plus a compact view sized for a small System One model.

import { RANKS, SUITS, cardLongLabel, normEdition, toPCard, type PCard } from "./cards.ts";
import { HAND_NAMES, rulesFromJokers, type HandLevel, type Joker, type Rules } from "./poker.ts";
import type { Blind, GameState, HeldTag, RawCard, RunSummary } from "./types.ts";

export interface Item {
  index: number;
  key: string;
  set: string;
  label: string;
  effect: string;
  cost: number;
  sell: number;
  rarity?: string;
  edition?: string;
  eternal: boolean;
  targetMin: number;
  targetMax: number;
  requiresJokers: number;
  randomJoker: boolean;
}

export interface ShopItem extends Item {
  /** Which BlindDeck `buy` parameter addresses this item. */
  area: "card" | "voucher" | "pack";
}

export interface BlindView {
  type: Blind["type"];
  status: Blind["status"];
  name: string;
  effect: string;
  target: number;
  tag?: { key: string; name: string; effect: string };
}

export interface Snapshot {
  phase: string;
  ante: number;
  round: number;
  money: number;
  buyingPower: number;
  deck?: string;
  stake?: string;
  seed?: string;
  won: boolean;
  victoryOverlay: boolean;
  /** The blind being played (SELECTING_HAND), offered (BLIND_SELECT), or next up. */
  blind?: BlindView;
  blinds: BlindView[];
  scored: number;
  remaining: number;
  handsLeft: number;
  handsPlayed: number;
  discardsLeft: number;
  rerollCost: number;
  bossRerollAvailable: boolean;
  hand: PCard[];
  handSize: number;
  playLimit: number;
  deckLeft: PCard[];
  jokers: Joker[];
  jokerSlots: number;
  consumables: Item[];
  consumableSlots: number;
  shop: ShopItem[];
  pack: Item[];
  /** Playing cards in an open pack, indexed by their position in `pack`. */
  packCards: PCard[];
  packChoicesRemaining: number;
  levels: Record<string, HandLevel>;
  tags: HeldTag[];
  rules: Rules;
  usedVouchers: string[];
  cashout?: number;
  runSummary?: RunSummary;
  /** False while BlindDeck reports a tag stack or pack deal still in flight. */
  settled: boolean;
}

function toItem(raw: RawCard, index: number): Item {
  return {
    index,
    key: raw.key,
    set: raw.set,
    label: raw.label || raw.key || "(hidden)",
    effect: raw.value?.effect ?? "",
    cost: raw.cost?.buy ?? 0,
    sell: raw.cost?.sell ?? 0,
    rarity: raw.value?.rarity,
    edition: normEdition(raw.modifier?.edition),
    eternal: Boolean(raw.modifier?.eternal),
    targetMin: raw.value?.target_min ?? 0,
    targetMax: raw.value?.target_max ?? 0,
    requiresJokers: raw.value?.requires_jokers_min ?? 0,
    randomJoker: Boolean(raw.value?.random_joker_effect),
  };
}

function toJoker(raw: RawCard, index: number): Joker {
  return {
    index,
    key: raw.key,
    label: raw.label || raw.key,
    effect: raw.value?.effect ?? "",
    stats: raw.value?.stats ?? {},
    edition: normEdition(raw.modifier?.edition),
    rarity: raw.value?.rarity,
    debuff: Boolean(raw.state?.debuff),
    eternal: Boolean(raw.modifier?.eternal),
    sell: raw.cost?.sell ?? 0,
  };
}

function toBlind(b: Blind): BlindView {
  return {
    type: b.type,
    status: b.status,
    name: b.name,
    effect: b.effect,
    target: b.score,
    tag: b.tag_key ? { key: b.tag_key, name: b.tag_name ?? b.tag_key, effect: b.tag_effect ?? "" } : undefined,
  };
}

const isPlayingCard = (raw: RawCard) => raw.set === "DEFAULT" || raw.set === "ENHANCED";

export function extract(gs: GameState): Snapshot {
  const round = gs.round ?? {};
  const blinds = (["small", "big", "boss"] as const).map((k) => gs.blinds?.[k]).filter((b): b is Blind => Boolean(b)).map(toBlind);
  const blind =
    blinds.find((b) => b.status === "CURRENT") ?? blinds.find((b) => b.status === "SELECT") ?? blinds.find((b) => b.status === "UPCOMING");
  const jokers = (gs.jokers?.cards ?? []).map(toJoker);
  const scored = round.chips ?? 0;
  const shop: ShopItem[] = [
    ...(gs.shop?.cards ?? []).map((c, i) => ({ ...toItem(c, i), area: "card" as const })),
    ...(gs.vouchers?.cards ?? []).map((c, i) => ({ ...toItem(c, i), area: "voucher" as const })),
    ...(gs.packs?.cards ?? []).map((c, i) => ({ ...toItem(c, i), area: "pack" as const })),
  ];
  const levels: Record<string, HandLevel> = {};
  for (const [name, h] of Object.entries(gs.hands ?? {})) {
    levels[name] = { level: h.level, chips: h.chips, mult: h.mult, played: h.played, played_this_round: h.played_this_round };
  }
  const packRaw = gs.pack?.cards ?? [];
  const phase = gs.state;
  const settled =
    gs.held_tags_ready !== false && (phase !== "SMODS_BOOSTER_OPENED" || (gs.pack_ready !== false && gs.pack_hand_ready !== false));

  return {
    phase,
    ante: gs.ante_num ?? 0,
    round: gs.round_num ?? 0,
    money: gs.money ?? 0,
    buyingPower: (gs.money ?? 0) - (gs.bankrupt_at ?? 0),
    deck: gs.deck,
    stake: gs.stake,
    seed: gs.seed,
    won: Boolean(gs.won),
    victoryOverlay: Boolean(gs.victory_overlay),
    blind,
    blinds,
    scored,
    remaining: Math.max(0, (blind?.target ?? 0) - scored),
    handsLeft: round.hands_left ?? 0,
    handsPlayed: round.hands_played ?? 0,
    discardsLeft: round.discards_left ?? 0,
    rerollCost: round.reroll_cost ?? 5,
    bossRerollAvailable: Boolean(round.boss_reroll_available),
    hand: (gs.hand?.cards ?? []).map(toPCard),
    handSize: gs.hand?.limit ?? 8,
    playLimit: gs.hand?.highlighted_limit ?? 5,
    deckLeft: (gs.cards?.cards ?? []).map(toPCard),
    jokers,
    jokerSlots: gs.jokers?.limit ?? 5,
    consumables: (gs.consumables?.cards ?? []).map(toItem),
    consumableSlots: gs.consumables?.limit ?? 2,
    shop,
    pack: packRaw.map(toItem),
    packCards: packRaw.flatMap((c, i) => (isPlayingCard(c) ? [toPCard(c, i)] : [])),
    packChoicesRemaining: gs.pack?.choices_remaining ?? 0,
    levels,
    tags: gs.held_tags ?? [],
    rules: rulesFromJokers(jokers),
    usedVouchers: Object.keys(gs.used_vouchers ?? {}),
    cashout: round.cashout_preview?.total,
    runSummary: gs.run_summary,
    settled,
  };
}

// ---------------------------------------------------------------------------------------------
// Model view: what goes into System One `state`. Small on purpose: an Instant model reads the
// whole state once per question, and huge hands (Perkeo + Cryptid) are summarized, not listed.
// ---------------------------------------------------------------------------------------------

const LIST_LIMIT = 16;

function countBy(cards: PCard[], key: (c: PCard) => string | undefined, order: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of order) {
    const n = cards.filter((c) => key(c) === k).length;
    if (n) out[k] = n;
  }
  return out;
}

export function summarizeCards(cards: PCard[]): unknown {
  if (cards.length <= LIST_LIMIT) return cards.map(cardLongLabel);
  const special = cards.filter((c) => c.enhancement || c.edition || c.seal || c.debuff).map(cardLongLabel);
  return {
    count: cards.length,
    by_rank: countBy(cards, (c) => c.rank, RANKS),
    by_suit: countBy(cards, (c) => c.suit, SUITS),
    stone: cards.filter((c) => c.enhancement === "STONE").length,
    face_down: cards.filter((c) => c.hidden).length,
    notable: special.slice(0, 24),
  };
}

export function modelState(s: Snapshot): Record<string, unknown> {
  const view: Record<string, unknown> = {
    game: "Balatro",
    phase: s.phase,
    run: { ante: s.ante, round: s.round, money: s.money, buying_power: s.buyingPower, deck: s.deck, stake: s.stake },
  };
  if (s.blind) {
    view.blind = {
      kind: s.blind.type,
      name: s.blind.name,
      effect: s.blind.effect,
      target_chips: s.blind.target,
      ...(s.phase === "SELECTING_HAND"
        ? { scored_so_far: s.scored, still_needed: s.remaining, hands_left: s.handsLeft, discards_left: s.discardsLeft }
        : {}),
    };
  }
  if (s.phase === "BLIND_SELECT") {
    view.upcoming_blinds = s.blinds.filter((b) => b.status !== "DEFEATED" && b.status !== "SKIPPED").map((b) => ({ kind: b.type, name: b.name, effect: b.effect, target_chips: b.target, skip_tag: b.tag?.name }));
  }
  if (s.hand.length) view.hand = summarizeCards(s.hand);
  view.jokers = s.jokers.map((j) => ({ name: j.label, effect: j.effect, ...(j.edition ? { edition: j.edition } : {}), ...(j.debuff ? { debuffed: true } : {}) }));
  view.joker_slots = `${s.jokers.length}/${s.jokerSlots}`;
  if (s.consumables.length) view.consumables = s.consumables.map((c) => ({ name: c.label, effect: c.effect }));
  const leveled = HAND_NAMES.filter((h) => s.levels[h] && (s.levels[h]!.level > 1 || s.levels[h]!.played > 0));
  if (leveled.length) {
    view.hand_levels = Object.fromEntries(leveled.map((h) => { const l = s.levels[h]!; return [h, `level ${l.level}: ${l.chips} chips x ${l.mult} mult, played ${l.played}`]; }));
  }
  if (s.phase === "SELECTING_HAND" && s.deckLeft.length) {
    view.deck_remaining = { count: s.deckLeft.length, by_suit: countBy(s.deckLeft, (c) => c.suit, SUITS) };
  }
  if (s.tags.length) view.held_tags = s.tags.map((t) => t.name);
  if (s.usedVouchers.length) view.vouchers = s.usedVouchers;
  return view;
}
