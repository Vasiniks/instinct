// The simulator's run state and the helpers every part of it shares: seeded random streams,
// prices and sell values, slot and hand-size limits, and the rules that decide which cards and
// jokers are debuffed. Shapes mirror the game's own (card.ability, G.GAME.current_round, ...) so
// the code that reports them to the agent can copy the mod's logic line for line.

import { RpcError } from "../blinddeck.ts";
import type { HandLevel, HandName } from "../poker.ts";
import { mulberry32 } from "../systemone.ts";
import type { Blind } from "../types.ts";

export type Edition = "FOIL" | "HOLO" | "POLYCHROME" | "NEGATIVE";

/** A playing card. Ranks and suits use the agent's letters (T for ten). */
export interface SimCard {
  id: number;
  rank: string;
  suit: string;
  enhancement?: string;
  edition?: Edition;
  seal?: string;
  /** Drawn face down this round (The House, The Wheel, The Mark, The Fish). */
  faceDown?: boolean;
  /** Played this ante (The Pillar). */
  playedThisAnte?: boolean;
  /** Cerulean Bell: always selected. */
  forced?: boolean;
}

/**
 * A joker's state, laid out like the game's `card.ability`: `mult` and `x_mult` at the top
 * (defaults 0 and 1), `extra` a number or a table, and `n` for counters the game keeps elsewhere.
 */
export interface Ability {
  mult: number;
  x_mult: number;
  extra?: number | Record<string, number>;
  n: Record<string, number>;
}

export type ItemSet = "JOKER" | "TAROT" | "PLANET" | "SPECTRAL" | "VOUCHER" | "BOOSTER" | "DEFAULT" | "ENHANCED";

/** Anything that is not a playing card in hand: jokers, consumables, vouchers, packs, shop cards. */
export interface Item {
  id: number;
  key: string;
  set: ItemSet;
  label: string;
  /** The center's base price, before editions and discounts. */
  base: number;
  /** The price asked (shop) or paid (owned); sell value is half of it. */
  cost: number;
  /** Sell value Egg and Gift Card add. */
  extraValue: number;
  edition?: Edition;
  eternal?: boolean;
  /** Orange stake: rounds before it is debuffed for good. */
  perishable?: number;
  rental?: boolean;
  /** Free from a tag (Coupon, Uncommon, Rare, edition tags). */
  couponed?: boolean;
  ab: Ability;
  /** Perishable ran out, or Crimson Heart for this hand. */
  debuff?: boolean;
  /** Amber Acorn: face down for the round. */
  hidden?: boolean;
  /** A playing card for sale (Magic Trick) or in a Standard pack. */
  card?: SimCard;
}

export interface Level extends HandLevel {
  visible: boolean;
}

export interface HeldTag {
  key: string;
  /** Orbital Tag: the hand it levels. */
  hand?: HandName;
}

export interface OpenPack {
  key: string;
  kind: "Arcana" | "Celestial" | "Standard" | "Buffoon" | "Spectral";
  items: Item[];
  choices: number;
  /** Where closing it returns to: a shop purchase or a skip tag. */
  from: "SHOP" | "BLIND_SELECT";
}

export interface CashLine {
  kind: string;
  label: string;
  dollars: number;
  key?: string;
}

export interface World {
  seed: string;
  /** The next number of a named random stream; each stream is seeded from the run seed. */
  rng: (stream: string) => number;
  id: () => number;
  phase: string;
  stake: string;
  deck: string;
  ante: number;
  round: number;
  money: number;
  won: boolean;
  result: string;
  /** The blind on deck: 0 small, 1 big, 2 boss. */
  blindIdx: number;
  status: Blind["status"][];
  boss: string;
  bossDisabled: boolean;
  bossRerolled: boolean;
  bossesUsed: Record<string, number>;
  /** Tags offered for skipping the small and big blinds. */
  blindTags: HeldTag[];
  tags: HeldTag[];
  skips: number;
  /** The whole deck (G.playing_cards); the draw pile and hand are subsets. */
  cards: SimCard[];
  startSize: number;
  draw: SimCard[];
  hand: SimCard[];
  handsLeft: number;
  discardsLeft: number;
  handsPlayed: number;
  discardsUsed: number;
  chips: number;
  handsPlayedRun: number;
  unusedDiscardsRun: number;
  levels: Record<string, Level>;
  jokers: Item[];
  consumables: Item[];
  shop: Item[];
  shopVouchers: Item[];
  shopPacks: Item[];
  pack?: OpenPack;
  vouchers: string[];
  /** This ante's voucher, until bought. */
  anteVoucher?: string;
  rerollIncrease: number;
  freeRerolls: number;
  /** D6 Tag: rerolls in this shop start at $0. */
  rerollStart?: number;
  tarotUsed: number;
  planetsUsed: Set<string>;
  lastTarotPlanet?: string;
  ancientSuit: string;
  idol: { rank: string; suit: string };
  castleSuit: string;
  mailRank: string;
  todoHand: HandName;
  /** The most played hand when the round began (The Ox). */
  mostPlayed: HandName;
  /** The Eye: hand types played this round; The Mouth: the one type allowed. */
  eyeHands: Set<string>;
  mouthHand?: string;
  /** Verdant Leaf: lifted once a joker is sold. */
  leafLifted: boolean;
  /** The Fish: the next draw comes face down. */
  fishPrepped: boolean;
  /** Juggle Tag hand size for the coming round, and permanent changes (Ouija, Ectoplasm). */
  roundHandSize: number;
  handSizeDelta: number;
  ectoMinus: number;
  grosExtinct: boolean;
  lastHand?: HandName;
  cashout: { total: number; lines: CashLine[]; investment: number };
}

/** What jokers and consumables can do to the run; the game loop implements these. */
export interface Fx {
  earn(dollars: number): void;
  /** Creates a consumable if there is room; false when there isn't. */
  createConsumable(set: "TAROT" | "PLANET" | "SPECTRAL", key?: string): boolean;
  /** Creates a joker if there is room (or `force`: Ankh, Invisible Joker copies). */
  createJoker(opts: { rarity?: string; key?: string; edition?: Edition; from?: Item; force?: boolean }): Item | undefined;
  destroyJoker(j: Item): void;
  /** A playing card joins the deck, into the hand or the draw pile; Hologram notices. */
  addCard(c: SimCard, where: "hand" | "draw"): void;
  destroyCards(cs: SimCard[]): void;
  levelUp(hand: HandName, n: number): void;
  /** A random card for Standard packs, Marble, Certificate and the Spectrals that add cards. */
  newCard(opts?: { rank?: string; suit?: string; enhancement?: string; enhanced?: boolean; seal?: string }): SimCard;
}

export function hashSeed(s: string): number {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** Independent seeded streams, so a choice in one part of the run doesn't shift the others. */
export function streams(seed: string): (name: string) => number {
  const cache = new Map<string, () => number>();
  return (name) => {
    let r = cache.get(name);
    if (!r) cache.set(name, (r = mulberry32(hashSeed(`${seed}:${name}`))));
    return r();
  };
}

export function fail(kind: "INVALID_STATE" | "BAD_REQUEST" | "NOT_ALLOWED", msg: string): never {
  throw new RpcError(kind === "BAD_REQUEST" ? -32001 : kind === "INVALID_STATE" ? -32002 : -32003, kind, msg);
}

export const pick = <T>(w: World, stream: string, xs: readonly T[]): T => xs[Math.floor(w.rng(stream) * xs.length)];

export function shuffle<T>(w: World, stream: string, xs: readonly T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(w.rng(stream) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Numerator of every "1 in N": Oops! All 6s doubles it, per copy. */
export const odds = (w: World) => 2 ** w.jokers.filter((j) => j.key === "j_oops" && !j.debuff).length;
export const chance = (w: World, stream: string, n: number) => w.rng(stream) < odds(w) / n;

export const has = (w: World, key: string) => w.jokers.some((j) => j.key === key && !j.debuff);
export const count = (w: World, key: string) => w.jokers.filter((j) => j.key === key && !j.debuff).length;
export const used = (w: World, voucher: string) => w.vouchers.includes(voucher);

/** A joker's `extra` field, as a number or one entry of its table. */
export function ex(j: Item, k?: string): number {
  const e = j.ab.extra;
  if (k === undefined) return typeof e === "number" ? e : 0;
  return typeof e === "object" ? (e[k] ?? 0) : 0;
}

export function setEx(j: Item, k: string, v: number) {
  if (typeof j.ab.extra === "object") j.ab.extra[k] = v;
  else j.ab.extra = { [k]: v };
}

const EDITION_COST: Record<Edition, number> = { FOIL: 2, HOLO: 3, POLYCHROME: 5, NEGATIVE: 5 };

export function discount(w: World): number {
  return used(w, "v_liquidation") ? 50 : used(w, "v_clearance_sale") ? 25 : 0;
}

/** The game's Card:set_cost: editions add, discounts take off, Rentals cost $1, Astronomer frees Planets. */
export function price(w: World, it: Item): Item {
  const extra = it.edition ? EDITION_COST[it.edition] : 0;
  let cost = Math.max(1, Math.floor(((it.base + extra + 0.5) * (100 - discount(w))) / 100));
  if ((it.set === "PLANET" || (it.set === "BOOSTER" && it.key.includes("celestial"))) && has(w, "j_astronomer")) cost = 0;
  if (it.rental) cost = 1;
  it.cost = cost;
  return it;
}

/** Sell value: half the price paid, at least $1, plus what Egg and Gift Card added. */
export const sellValue = (it: Item) => Math.max(1, Math.floor(it.cost / 2)) + it.extraValue;

/** Asking price: 0 for a couponed card (its sell value still comes from the real price). */
export const askPrice = (it: Item) => (it.couponed ? 0 : it.cost);

const DECK_HANDS: Record<string, number> = { BLUE: 1, BLACK: -1 };
const DECK_DISCARDS: Record<string, number> = { RED: 1 };

export function jokerSlots(w: World): number {
  const base = 5 + (w.deck === "BLACK" ? 1 : 0) - (w.deck === "PAINTED" ? 1 : 0) + (used(w, "v_antimatter") ? 1 : 0);
  return base + w.jokers.filter((j) => j.edition === "NEGATIVE").length;
}

export function consumableSlots(w: World): number {
  return 2 + (used(w, "v_crystal_ball") ? 1 : 0) - (w.deck === "NEBULA" ? 1 : 0);
}

export function shopSlots(w: World): number {
  return 2 + (used(w, "v_overstock_norm") ? 1 : 0) + (used(w, "v_overstock_plus") ? 1 : 0);
}

/** Hand size from the deck, vouchers, Spectrals and the jokers held (a debuffed joker's is lost). */
export function handSize(w: World): number {
  let n = 8 + (w.deck === "PAINTED" ? 2 : 0) + (used(w, "v_paint_brush") ? 1 : 0) + (used(w, "v_palette") ? 1 : 0) + w.handSizeDelta;
  for (const j of w.jokers) {
    if (j.debuff) continue;
    if (j.key === "j_juggler") n += 1;
    else if (j.key === "j_troubadour") n += 2;
    else if (j.key === "j_merry_andy") n -= 1;
    else if (j.key === "j_stuntman") n -= 2;
    else if (j.key === "j_turtle_bean") n += ex(j, "h_size");
  }
  return Math.max(1, n);
}

export function roundHands(w: World): number {
  const n = 4 + (DECK_HANDS[w.deck] ?? 0) + (used(w, "v_grabber") ? 1 : 0) + (used(w, "v_nacho_tong") ? 1 : 0) - (used(w, "v_hieroglyph") ? 1 : 0) - count(w, "j_troubadour");
  return Math.max(1, n);
}

export function roundDiscards(w: World): number {
  const n =
    3 +
    (DECK_DISCARDS[w.deck] ?? 0) +
    (used(w, "v_wasteful") ? 1 : 0) +
    (used(w, "v_recyclomancy") ? 1 : 0) -
    (used(w, "v_petroglyph") ? 1 : 0) -
    (stakeIndex(w.stake) >= stakeIndex("BLUE") ? 1 : 0) +
    count(w, "j_drunkard") +
    3 * count(w, "j_merry_andy");
  return Math.max(0, n);
}

const STAKES = ["WHITE", "RED", "GREEN", "BLACK", "BLUE", "PURPLE", "ORANGE", "GOLD"];
export const stakeIndex = (s: string) => STAKES.indexOf(s);

export const FACES = new Set(["J", "Q", "K"]);
export const isFace = (w: World, c: SimCard) => c.enhancement !== "STONE" && (FACES.has(c.rank) || has(w, "j_pareidolia"));

/** Card:is_suit: Wild Cards are every suit, Stone Cards none, Smeared Joker pairs the colours. */
export function isSuit(w: World, c: SimCard, suit: string): boolean {
  if (c.enhancement === "STONE") return false;
  if (c.enhancement === "WILD") return true;
  if (has(w, "j_smeared")) return (c.suit === "H" || c.suit === "D") === (suit === "H" || suit === "D");
  return c.suit === suit;
}

export const BOSS_SUIT: Record<string, string> = { bl_club: "C", bl_goad: "S", bl_head: "H", bl_window: "D" };

/** Whether the boss in play debuffs a card (Blind:debuff_card). */
export function bossDebuffs(w: World, c: SimCard): boolean {
  if (w.blindIdx !== 2 || w.bossDisabled || !["SELECTING_HAND", "ROUND_EVAL"].includes(w.phase)) return false;
  const suit = BOSS_SUIT[w.boss];
  if (suit) return isSuit(w, c, suit);
  if (w.boss === "bl_plant") return isFace(w, c);
  if (w.boss === "bl_pillar") return Boolean(c.playedThisAnte);
  if (w.boss === "bl_final_leaf") return !w.leafLifted;
  return false;
}

export const levelFresh = (base: { chips: number; mult: number }, visible: boolean): Level => ({ level: 1, chips: base.chips, mult: base.mult, played: 0, played_this_round: 0, visible });
