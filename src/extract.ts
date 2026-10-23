// The extractor: one BlindDeck `gamestate` -> a normalized Snapshot that the rest of the agent
// (candidates, evaluator, UI, logs) reads, plus a compact view sized for a small System One model.

import { RANKS, SUITS, cardLabel, cardLongLabel, normEdition, toPCard, type PCard } from "./cards.ts";
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
  /** Gold stake: dollars this joker costs every round. */
  rental?: number;
  /** Orange stake and up: rounds before this joker is debuffed for good. */
  perishable?: number;
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
  /**
   * False when the game masked the draw pile (stock BlindDeck hides every face-down card, the
   * deck included) and `deckLeft` is the starting deck less the cards in hand: a stand-in, wrong
   * once Tarots have changed cards. The patched mod shows the pile sorted, as the deck view does.
   */
  deckKnown: boolean;
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
  /** Bosses drawn this run (key -> times), when the game reports them; undefined otherwise. */
  bossesUsed?: Record<string, number>;
  cashout?: number;
  runSummary?: RunSummary;
  /** False while BlindDeck reports a tag stack or pack deal still in flight. */
  settled: boolean;
}

/** The starting cards for decks that change them; the rest start with the standard 52. */
function startingCards(deck: string | undefined): { rank: string; suit: string }[] {
  const suits = deck === "CHECKERED" ? ["S", "H", "S", "H"] : SUITS;
  const ranks = deck === "ABANDONED" ? RANKS.filter((r) => !["J", "Q", "K"].includes(r)) : RANKS;
  return ranks.flatMap((rank) => suits.map((suit) => ({ rank, suit })));
}

const shown = (c: RawCard, i: number) => toPCard(c.value?.suit && c.value?.rank ? { ...c, state: { ...c.state, hidden: false } } : c, i);

function drawPile(gs: GameState): { deckLeft: PCard[]; deckKnown: boolean } {
  // Between rounds the next round draws from the whole deck, and part of it can still sit in the
  // discard pile; the patched mod sends the whole deck, so outside a hand that is the pile (less
  // any cards a pack has dealt into the hand).
  const full = (gs.full_deck?.cards ?? []).map(shown);
  if (gs.state !== "SELECTING_HAND" && full.length && full.some((c) => !c.hidden)) {
    const inHand = new Set((gs.hand?.cards ?? []).map((c) => c.id));
    return { deckLeft: full.filter((c) => !inHand.has(c.id)).map((c, i) => ({ ...c, index: i })), deckKnown: true };
  }
  // The patched mod sends the pile's cards face up in content but still flags them face-down
  // (they are, in the game); a card with its suit and rank is read as shown.
  const pile = (gs.cards?.cards ?? []).map(shown);
  if (!pile.length || pile.some((c) => !c.hidden)) return { deckLeft: pile, deckKnown: true };
  // Masked: the starting deck, less what is in hand (and played this round, which is gone from
  // both), trimmed to the pile's size from the end so it stays the same tick to tick.
  const inHand = (gs.hand?.cards ?? []).map(toPCard).filter((c) => !c.hidden);
  const left = startingCards(gs.deck);
  for (const c of inHand) {
    const i = left.findIndex((x) => x.rank === c.rank && x.suit === c.suit);
    if (i >= 0) left.splice(i, 1);
  }
  const deckLeft = left.slice(0, pile.length).map((c, i) => {
    const card: PCard = { index: i, id: pile[i].id, rank: c.rank, suit: c.suit, debuff: false, hidden: false, forced: false, label: "" };
    card.label = cardLabel(card);
    return card;
  });
  return { deckLeft, deckKnown: false };
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
    ...stickers(raw),
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
    ...stickers(raw),
    sell: raw.cost?.sell ?? 0,
  };
}

/** Rental and Perishable stickers; the game's rental rate is $3 a round. */
function stickers(raw: RawCard): { rental?: number; perishable?: number } {
  const m = raw.modifier ?? {};
  return {
    ...(m.rental ? { rental: m.rental_cost && m.rental_cost > 1 ? m.rental_cost : 3 } : {}),
    ...(m.perishable ? { perishable: m.perishable } : {}),
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
    ...drawPile(gs),
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
    bossesUsed: Array.isArray(gs.bosses_used) ? {} : gs.bosses_used,
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
    view.deck_remaining = { count: s.deckLeft.length, by_suit: countBy(s.deckLeft, (c) => c.suit, SUITS), ...(s.deckKnown ? {} : { note: "the game hid the deck; this assumes the starting deck" }) };
  }
  if (s.tags.length) view.held_tags = s.tags.map((t) => t.name);
  if (s.usedVouchers.length) view.vouchers = s.usedVouchers;
  return view;
}
