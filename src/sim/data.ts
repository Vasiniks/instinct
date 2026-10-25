// What the simulator deals: the vanilla jokers (name, rarity and price from the catalog, starting
// ability and in-game text here), Planets, Tarots, Spectrals, vouchers, booster packs, skip tags
// and boss blinds, with the texts the mod reports for them (taken from real run logs).

import { readFileSync } from "node:fs";
import { SUIT_NAME } from "../cards.ts";
import { BASE_HANDS, type HandName } from "../poker.ts";
import { ex, odds, type Ability, type Item, type World } from "./world.ts";

interface CatalogJoker {
  key: string;
  name: string;
  rarity: "common" | "uncommon" | "rare" | "legendary";
  cost: number;
}

const CATALOG: CatalogJoker[] = JSON.parse(readFileSync(new URL("../../data/roffle/catalog/jokers.json", import.meta.url), "utf8"));
export const CATALOG_BY_KEY = new Map(CATALOG.map((j) => [j.key, j]));

const RANK_WORD: Record<string, string> = { T: "10", J: "Jack", Q: "Queen", K: "King", A: "Ace" };
export const rankWord = (r: string) => RANK_WORD[r] ?? r;
const suitWord = (s: string) => SUIT_NAME[s].slice(0, -1);

type Text = string | ((j: Item, w: World) => string);

export interface JokerSpec {
  /** The game's center config: `mult` and `Xmult` seed the ability, `extra` is copied. */
  cfg?: { mult?: number; Xmult?: number; extra?: number | Record<string, number> };
  text: Text;
  /** Can't take the Eternal sticker (it destroys or sells itself). */
  noEternal?: boolean;
  /** Can't take the Perishable sticker (it grows). */
  noPerish?: boolean;
}

const cur = (v: number) => Math.round(v * 100) / 100;
const pin = (w: World, n: number) => `${odds(w)} in ${n}`;

/**
 * Loyalty Card's count, as the game works it out: (every - 1 - hands since bought) mod (every + 1).
 * At 0 it reads "Active!" and the next hand gets the X4 (the count wraps to `every`).
 */
export const loyaltyRemaining = (j: Item, w: World, ahead = 0) => {
  const every = ex(j, "every") || 5;
  return ((((every - 1 - (w.handsPlayedRun + ahead - (j.ab.n.created ?? 0))) % (every + 1)) + every + 1) % (every + 1));
};

/**
 * Jokers the simulator can deal. The evaluator scores most of them by key; the rest it scores from
 * the live stats the simulator reports, and the simulator itself pays their money and grows them.
 * Hiker (permanent card chips the evaluator doesn't read) and the Legendaries are left out.
 */
export const JOKERS: Record<string, JokerSpec> = {
  j_joker: { cfg: { mult: 4 }, text: "+4 Mult" },
  j_greedy_joker: { text: "Played cards with Diamond suit give +3 Mult when scored" },
  j_lusty_joker: { text: "Played cards with Heart suit give +3 Mult when scored" },
  j_wrathful_joker: { text: "Played cards with Spade suit give +3 Mult when scored" },
  j_gluttenous_joker: { text: "Played cards with Club suit give +3 Mult when scored" },
  j_jolly: { text: "+8 Mult if played hand contains a Pair" },
  j_zany: { text: "+12 Mult if played hand contains a Three of a Kind" },
  j_mad: { text: "+10 Mult if played hand contains a Two Pair" },
  j_crazy: { text: "+12 Mult if played hand contains a Straight" },
  j_droll: { text: "+10 Mult if played hand contains a Flush" },
  j_sly: { text: "+50 Chips if played hand contains a Pair" },
  j_wily: { text: "+100 Chips if played hand contains a Three of a Kind" },
  j_clever: { text: "+80 Chips if played hand contains a Two Pair" },
  j_devious: { text: "+100 Chips if played hand contains a Straight" },
  j_crafty: { text: "+80 Chips if played hand contains a Flush" },
  j_half: { cfg: { extra: { mult: 20, size: 3 } }, text: "+20 Mult if played hand contains 3 or fewer cards" },
  j_stencil: { text: (j) => `X1 Mult for each empty Joker slot Joker Stencil included (Currently X${cur(j.ab.x_mult)})` },
  j_four_fingers: { text: "All Flushes and Straights can be made with 4 cards" },
  j_mime: { cfg: { extra: 1 }, text: "Retrigger all card held in hand abilities" },
  j_credit_card: { cfg: { extra: 20 }, text: "Go up to -$20 in debt" },
  j_ceremonial: { text: (j) => `When Blind is selected, destroy Joker to the right and permanently add double its sell value to this Mult (Currently +${j.ab.mult} Mult)`, noPerish: true },
  j_banner: { cfg: { extra: 30 }, text: "+30 Chips for each remaining discard" },
  j_mystic_summit: { cfg: { extra: { mult: 15, d_remaining: 0 } }, text: "+15 Mult when 0 discards remaining" },
  j_marble: { cfg: { extra: 1 }, text: "Adds one Stone card to deck when Blind is selected" },
  j_loyalty_card: {
    cfg: { extra: { Xmult: 4, every: 5 } },
    text: (j, w) => {
      const left = loyaltyRemaining(j, w);
      return `X4 Mult every 6 hands played ${left === 0 ? "Active!" : `${left} remaining`}`;
    },
  },
  j_8_ball: { cfg: { extra: 4 }, text: (_j, w) => `${pin(w, 4)} chance for each played 8 to create a Tarot card when scored (Must have room)` },
  j_misprint: { cfg: { extra: { max: 23, min: 0 } }, text: "+0 to +23 Mult (random each hand)" },
  j_dusk: { cfg: { extra: 1 }, text: "Retrigger all played cards in final hand of round" },
  j_raised_fist: { text: "Adds double the rank of lowest ranked card held in hand to Mult" },
  j_chaos: { cfg: { extra: 1 }, text: "1 free Reroll per shop" },
  j_fibonacci: { cfg: { extra: 8 }, text: "Each played Ace, 2, 3, 5, or 8 gives +8 Mult when scored" },
  j_steel_joker: { cfg: { extra: 0.2 }, text: (j) => `Gives X0.2 Mult for each Steel Card in your full deck (Currently X${cur(1 + 0.2 * (j.ab.n.tally ?? 0))} Mult)` },
  j_scary_face: { cfg: { extra: 30 }, text: "Played face cards give +30 Chips when scored" },
  j_abstract: { cfg: { extra: 3 }, text: (_j, w) => `+3 Mult for each Joker card (Currently +${3 * w.jokers.length} Mult)` },
  j_delayed_grat: { cfg: { extra: 2 }, text: "Earn $2 per discard if no discards are used by end of the round" },
  j_hack: { cfg: { extra: 1 }, text: "Retrigger each played 2, 3, 4, or 5" },
  j_pareidolia: { text: "All cards are considered face cards" },
  j_gros_michel: { cfg: { extra: { odds: 6, mult: 15 } }, text: (_j, w) => `+15 Mult ${pin(w, 6)} chance this card is destroyed at end of round`, noEternal: true },
  j_even_steven: { cfg: { extra: 4 }, text: "Played cards with even rank give +4 Mult when scored (10, 8, 6, 4, 2)" },
  j_odd_todd: { cfg: { extra: 31 }, text: "Played cards with odd rank give +31 Chips when scored (A, 9, 7, 5, 3)" },
  j_scholar: { cfg: { extra: { mult: 4, chips: 20 } }, text: "Played Aces give +20 Chips and +4 Mult when scored" },
  j_business: { cfg: { extra: 2 }, text: (_j, w) => `Played face cards have a ${pin(w, 2)} chance to give $2 when scored` },
  j_supernova: { cfg: { extra: 1 }, text: "Adds the number of times poker hand has been played this run to Mult" },
  j_ride_the_bus: { cfg: { extra: 1 }, text: (j) => `This Joker gains +1 Mult per consecutive hand played without a scoring face card (Currently +${j.ab.mult} Mult)`, noPerish: true },
  j_space: { cfg: { extra: 4 }, text: (_j, w) => `${pin(w, 4)} chance to upgrade level of played poker hand` },
  j_egg: { cfg: { extra: 3 }, text: "Gains $3 of sell value at end of round" },
  j_burglar: { cfg: { extra: 3 }, text: "When Blind is selected, gain +3 Hands and lose all discards" },
  j_blackboard: { cfg: { extra: 3 }, text: "X3 Mult if all cards held in hand are Spades or Clubs" },
  j_runner: { cfg: { extra: { chips: 0, chip_mod: 15 } }, text: (j) => `Gains +15 Chips if played hand contains a Straight (Currently +${ex(j, "chips")} Chips)`, noPerish: true },
  j_ice_cream: { cfg: { extra: { chips: 100, chip_mod: 5 } }, text: (j) => `+${ex(j, "chips")} Chips -5 Chips for every hand played`, noEternal: true },
  j_dna: { text: "If first hand of round has only 1 card, add a permanent copy to deck and draw it to hand" },
  j_splash: { text: "Every played card counts in scoring" },
  j_blue_joker: { cfg: { extra: 2 }, text: (_j, w) => `+2 Chips for each remaining card in deck (Currently +${2 * w.draw.length} Chips)` },
  j_sixth_sense: { text: "If first hand of round is a single 6, destroy it and create a Spectral card (Must have room)" },
  j_constellation: { cfg: { extra: 0.1, Xmult: 1 }, text: (j) => `This Joker gains X0.1 Mult every time a Planet card is used (Currently X${cur(j.ab.x_mult)} Mult)`, noPerish: true },
  j_faceless: { cfg: { extra: { dollars: 5, faces: 3 } }, text: "Earn $5 if 3 or more face cards are discarded at the same time" },
  j_green_joker: { cfg: { extra: { hand_add: 1, discard_sub: 1 } }, text: (j) => `+1 Mult per hand played -1 Mult per discard (Currently +${j.ab.mult} Mult)`, noPerish: true },
  j_superposition: { text: "Create a Tarot card if poker hand contains an Ace and a Straight (Must have room)" },
  j_todo_list: { cfg: { extra: { dollars: 4 } }, text: (_j, w) => `Earn $4 if poker hand is a ${w.todoHand}, poker hand changes at end of round` },
  j_cavendish: { cfg: { extra: { odds: 1000, Xmult: 3 } }, text: (_j, w) => `X3 Mult ${pin(w, 1000)} chance this card is destroyed at end of round`, noEternal: true },
  j_card_sharp: { cfg: { extra: { Xmult: 3 } }, text: "X3 Mult if played poker hand has already been played this round" },
  j_red_card: { cfg: { extra: 3 }, text: (j) => `This Joker gains +3 Mult when any Booster Pack is skipped (Currently +${j.ab.mult} Mult)`, noPerish: true },
  j_madness: { cfg: { extra: 0.5 }, text: (j) => `When Small Blind or Big Blind is selected, gain X0.5 Mult and destroy a random Joker (Currently X${cur(j.ab.x_mult)} Mult)`, noPerish: true },
  j_square: { cfg: { extra: { chips: 0, chip_mod: 4 } }, text: (j) => `This Joker gains +4 Chips if played hand has exactly 4 cards (Currently ${ex(j, "chips")} Chips)`, noPerish: true },
  j_seance: { text: "If poker hand is a Straight Flush, create a random Spectral card (Must have room)" },
  j_riff_raff: { cfg: { extra: 2 }, text: "When Blind is selected, create 2 Common Jokers (Must have room)" },
  j_vampire: { cfg: { extra: 0.1, Xmult: 1 }, text: (j) => `This Joker gains X0.1 Mult per scoring Enhanced card played, removes card Enhancement (Currently X${cur(j.ab.x_mult)} Mult)`, noPerish: true },
  j_shortcut: { text: "Allows Straights to be made with gaps of 1 rank (ex: 10 8 6 5 3)" },
  j_hologram: { cfg: { extra: 0.25, Xmult: 1 }, text: (j) => `This Joker gains X0.25 Mult every time a playing card is added to your deck (Currently X${cur(j.ab.x_mult)} Mult)`, noPerish: true },
  j_vagabond: { cfg: { extra: 4 }, text: "Create a Tarot card if hand is played with $4 or less" },
  j_baron: { cfg: { extra: 1.5 }, text: "Each King held in hand gives X1.5 Mult" },
  j_cloud_9: { cfg: { extra: 1 }, text: (_j, w) => `Earn $1 for each 9 in your full deck at end of round (Currently $${w.cards.filter((c) => c.rank === "9" && c.enhancement !== "STONE").length})` },
  j_rocket: { cfg: { extra: { dollars: 1, increase: 2 } }, text: (j) => `Earn $${ex(j, "dollars")} at end of round Payout increases by $2 when Boss Blind is defeated` },
  j_obelisk: { cfg: { extra: 0.2, Xmult: 1 }, text: (j) => `This Joker gains X0.2 Mult per consecutive hand played without playing your most played poker hand (Currently X${cur(j.ab.x_mult)} Mult)`, noPerish: true },
  j_midas_mask: { text: "All played face cards become Gold cards when scored" },
  j_luchador: { text: "Sell this card to disable the current Boss Blind", noEternal: true },
  j_photograph: { cfg: { extra: 2 }, text: "First played face card gives X2 Mult when scored" },
  j_gift: { cfg: { extra: 1 }, text: "Add $1 of sell value to every Joker and Consumable card at end of round" },
  j_turtle_bean: { cfg: { extra: { h_size: 5, h_mod: 1 } }, text: (j) => `+${ex(j, "h_size")} hand size, reduces by 1 every round`, noEternal: true },
  j_erosion: { cfg: { extra: 4 }, text: (_j, w) => `+4 Mult for each card below ${w.startSize} in your full deck (Currently +${4 * Math.max(0, w.startSize - w.cards.length)} Mult)` },
  j_reserved_parking: { cfg: { extra: { odds: 2, dollars: 1 } }, text: (_j, w) => `Each face card held in hand has a ${pin(w, 2)} chance to give $1` },
  j_mail: { cfg: { extra: 5 }, text: (_j, w) => `Earn $5 for each discarded ${rankWord(w.mailRank)}, rank changes every round` },
  j_to_the_moon: { cfg: { extra: 1 }, text: "Earn an extra $1 of interest for every $5 you have at end of round" },
  j_hallucination: { cfg: { extra: 2 }, text: (_j, w) => `${pin(w, 2)} chance to create a Tarot card when any Booster Pack is opened (Must have room)` },
  j_fortune_teller: { cfg: { extra: 1 }, text: (_j, w) => `+1 Mult per Tarot card used this run (Currently +${w.tarotUsed})` },
  j_juggler: { text: "+1 hand size" },
  j_drunkard: { text: "+1 discard each round" },
  j_stone: { cfg: { extra: 25 }, text: (j) => `Gives +25 Chips for each Stone Card in your full deck (Currently +${25 * (j.ab.n.tally ?? 0)} Chips)` },
  j_golden: { cfg: { extra: 4 }, text: "Earn $4 at end of round" },
  j_lucky_cat: { cfg: { Xmult: 1, extra: 0.25 }, text: (j) => `This Joker gains X0.25 Mult every time a Lucky card successfully triggers (Currently X${cur(j.ab.x_mult)} Mult)`, noPerish: true },
  j_baseball: { cfg: { extra: 1.5 }, text: "Uncommon Jokers each give X1.5 Mult" },
  j_bull: { cfg: { extra: 2 }, text: (_j, w) => `+2 Chips for each $1 you have (Currently +${2 * Math.max(0, w.money)} Chips)` },
  j_diet_cola: { text: "Sell this card to create a free Double Tag", noEternal: true },
  j_trading: { cfg: { extra: 3 }, text: "If first discard of round has only 1 card, destroy it and earn $3" },
  j_flash: { cfg: { extra: 2, mult: 0 }, text: (j) => `This Joker gains +2 Mult per reroll in the shop (Currently +${j.ab.mult} Mult)`, noPerish: true },
  j_popcorn: { cfg: { mult: 20, extra: 4 }, text: (j) => `+${j.ab.mult} Mult -4 Mult per round played`, noEternal: true },
  j_trousers: { cfg: { extra: 2 }, text: (j) => `This Joker gains +2 Mult if played hand contains a Two Pair (Currently +${j.ab.mult} Mult)`, noPerish: true },
  j_ancient: { cfg: { extra: 1.5 }, text: (_j, w) => `Each played card with ${suitWord(w.ancientSuit)} suit gives X1.5 Mult when scored, suit changes at end of round` },
  j_ramen: { cfg: { Xmult: 2, extra: 0.01 }, text: (j) => `X${cur(j.ab.x_mult)} Mult, loses X0.01 Mult per card discarded`, noEternal: true },
  j_walkie_talkie: { cfg: { extra: { chips: 10, mult: 4 } }, text: "Each played 10 or 4 gives +10 Chips and +4 Mult when scored" },
  j_selzer: { cfg: { extra: 10 }, text: (j) => `Retrigger all cards played for the next ${ex(j)} hands`, noEternal: true },
  j_castle: { cfg: { extra: { chips: 0, chip_mod: 3 } }, text: (j, w) => `This Joker gains +3 Chips per discarded ${suitWord(w.castleSuit)} card, suit changes every round (Currently +${ex(j, "chips")} Chips)`, noPerish: true },
  j_smiley: { cfg: { extra: 5 }, text: "Played face cards give +5 Mult when scored" },
  j_campfire: { cfg: { extra: 0.25 }, text: (j) => `This Joker gains X0.25 Mult for each card sold, resets when Boss Blind is defeated (Currently X${cur(j.ab.x_mult)} Mult)`, noPerish: true },
  j_ticket: { cfg: { extra: 4 }, text: "Played Gold cards earn $4 when scored" },
  j_mr_bones: { text: "Prevents Death if chips scored are at least 25% of required chips self destructs", noEternal: true },
  j_acrobat: { cfg: { extra: 3 }, text: "X3 Mult on final hand of round" },
  j_sock_and_buskin: { cfg: { extra: 1 }, text: "Retrigger all played face cards" },
  j_swashbuckler: { cfg: { mult: 1 }, text: (j, w) => `Adds the sell value of all other owned Jokers to Mult (Currently +${w.jokers.filter((x) => x !== j).reduce((a, x) => a + Math.max(1, Math.floor(x.cost / 2)) + x.extraValue, 0)} Mult)` },
  j_troubadour: { cfg: { extra: { h_size: 2, h_plays: -1 } }, text: "+2 hand size, -1 hand each round" },
  j_certificate: { text: "When round begins, add a random playing card with a random seal to your hand" },
  j_smeared: { text: "Hearts and Diamonds count as the same suit, Spades and Clubs count as the same suit" },
  j_throwback: { cfg: { extra: 0.25 }, text: (_j, w) => `X0.25 Mult for each Blind skipped this run (Currently X${cur(1 + 0.25 * w.skips)} Mult)` },
  j_hanging_chad: { cfg: { extra: 2 }, text: "Retrigger first played card used in scoring 2 additional times" },
  j_rough_gem: { cfg: { extra: 1 }, text: "Played cards with Diamond suit earn $1 when scored" },
  j_bloodstone: { cfg: { extra: { odds: 2, Xmult: 1.5 } }, text: (_j, w) => `${pin(w, 2)} chance for played cards with Heart suit to give X1.5 Mult when scored` },
  j_arrowhead: { cfg: { extra: 50 }, text: "Played cards with Spade suit give +50 Chips when scored" },
  j_onyx_agate: { cfg: { extra: 7 }, text: "Played cards with Club suit give +7 Mult when scored" },
  j_glass: { cfg: { extra: 0.75, Xmult: 1 }, text: (j) => `This Joker gains X0.75 Mult for every Glass Card that is destroyed (Currently X${cur(j.ab.x_mult)} Mult)`, noPerish: true },
  j_ring_master: { text: "Joker, Tarot, Planet, and Spectral cards may appear multiple times" },
  j_flower_pot: { cfg: { extra: 3 }, text: "X3 Mult if poker hand contains a Diamond card, Club card, Heart card, and Spade card" },
  j_blueprint: { text: "Copies ability of Joker to the right" },
  j_wee: { cfg: { extra: { chips: 0, chip_mod: 8 } }, text: (j) => `This Joker gains +8 Chips when each played 2 is scored (Currently +${ex(j, "chips")} Chips)`, noPerish: true },
  j_merry_andy: { text: "+3 discards each round, -1 hand size" },
  j_oops: { text: "Doubles all listed probabilities (ex: 1 in 3 -> 2 in 3)" },
  j_idol: { cfg: { extra: 2 }, text: (_j, w) => `Each played ${rankWord(w.idol.rank)} of ${SUIT_NAME[w.idol.suit]} gives X2 Mult when scored Card changes every round` },
  j_seeing_double: { cfg: { extra: 2 }, text: "X2 Mult if played hand has a scoring Club card and a scoring card of any other suit" },
  j_matador: { cfg: { extra: 8 }, text: "Earn $8 if played hand triggers the Boss Blind ability" },
  j_hit_the_road: { cfg: { extra: 0.5 }, text: (j) => `This Joker gains X0.5 Mult for every Jack discarded this round (Currently X${cur(j.ab.x_mult)} Mult)`, noPerish: true },
  j_duo: { cfg: { Xmult: 2 }, text: "X2 Mult if played hand contains a Pair" },
  j_trio: { cfg: { Xmult: 3 }, text: "X3 Mult if played hand contains a Three of a Kind" },
  j_family: { cfg: { Xmult: 4 }, text: "X4 Mult if played hand contains a Four of a Kind" },
  j_order: { cfg: { Xmult: 3 }, text: "X3 Mult if played hand contains a Straight" },
  j_tribe: { cfg: { Xmult: 2 }, text: "X2 Mult if played hand contains a Flush" },
  j_stuntman: { cfg: { extra: { h_size: 2, chip_mod: 250 } }, text: "+250 Chips, -2 hand size" },
  j_invisible: { cfg: { extra: 2 }, text: (j) => `After 2 rounds, sell this card to Duplicate a random Joker (Currently ${j.ab.n.rounds ?? 0}/2)`, noEternal: true },
  j_brainstorm: { text: "Copies the ability of leftmost Joker" },
  j_satellite: { cfg: { extra: 1 }, text: (_j, w) => `Earn $1 at end of round per unique Planet card used this run (Currently $${w.planetsUsed.size})` },
  j_shoot_the_moon: { cfg: { extra: 13 }, text: "Each Queen held in hand gives +13 Mult" },
  j_drivers_license: { cfg: { extra: 3 }, text: (_j, w) => `X3 Mult if you have at least 16 Enhanced cards in your full deck (Currently ${w.cards.filter((c) => c.enhancement).length})` },
  j_cartomancer: { text: "Create a Tarot card when Blind is selected (Must have room)" },
  j_astronomer: { text: "All Planet cards and Celestial Packs in the shop are free" },
  j_burnt: { cfg: { extra: 4 }, text: "Upgrade the level of the first discarded poker hand each round" },
  j_bootstraps: { cfg: { extra: { mult: 2, dollars: 5 } }, text: (_j, w) => `+2 Mult for every $5 you have (Currently +${2 * Math.floor(Math.max(0, w.money) / 5)} Mult)` },
};

/** The text a joker shows now. */
export const jokerText = (j: Item, w: World) => {
  const t = JOKERS[j.key]?.text ?? "";
  return typeof t === "function" ? t(j, w) : t;
};

/** A fresh ability, as Card:set_ability builds it from the center config. */
export function freshAbility(key: string): Ability {
  const c = JOKERS[key]?.cfg ?? {};
  const extra = typeof c.extra === "object" ? { ...c.extra } : c.extra;
  return { mult: c.mult ?? 0, x_mult: c.Xmult ?? 1, extra, n: {} };
}

export const JOKER_RARITY: Record<string, string> = Object.fromEntries(CATALOG.map((j) => [j.key, j.rarity.toUpperCase()]));

// ---------------------------------------------------------------------------------------------
// Consumables
// ---------------------------------------------------------------------------------------------

export const PLANETS: { key: string; label: string; hand: HandName; secret?: boolean }[] = [
  { key: "c_pluto", label: "Pluto", hand: "High Card" },
  { key: "c_mercury", label: "Mercury", hand: "Pair" },
  { key: "c_uranus", label: "Uranus", hand: "Two Pair" },
  { key: "c_venus", label: "Venus", hand: "Three of a Kind" },
  { key: "c_saturn", label: "Saturn", hand: "Straight" },
  { key: "c_jupiter", label: "Jupiter", hand: "Flush" },
  { key: "c_earth", label: "Earth", hand: "Full House" },
  { key: "c_mars", label: "Mars", hand: "Four of a Kind" },
  { key: "c_neptune", label: "Neptune", hand: "Straight Flush" },
  { key: "c_planet_x", label: "Planet X", hand: "Five of a Kind", secret: true },
  { key: "c_ceres", label: "Ceres", hand: "Flush House", secret: true },
  { key: "c_eris", label: "Eris", hand: "Flush Five", secret: true },
];
export const PLANET_BY_KEY = new Map(PLANETS.map((p) => [p.key, p]));

export function planetText(hand: HandName, level: number): string {
  const b = BASE_HANDS[hand];
  return `(lvl.${level}) Level up ${hand} +${b.lmult} Mult and +${b.lchips} chips`;
}

export interface ConsumableSpec {
  label: string;
  text: string | ((w: World) => string);
  /** Cards it needs selected (the center's min/max_highlighted). */
  min?: number;
  max?: number;
  /** Ankh and Hex need a joker; Ectoplasm, Ankh and Hex pick one at random. */
  needsJoker?: boolean;
  randomJoker?: boolean;
}

const enhanceText = (n: number, what: string) => `Enhances ${n} selected card${n > 1 ? "s to" : " into a"} ${what}`;

export const TAROTS: Record<string, ConsumableSpec> = {
  // The mod strips the trailing "None" when nothing has been used yet.
  c_fool: { label: "The Fool", text: (w) => `Creates the last Tarot or Planet card used during this run The Fool excluded ${w.lastTarotPlanet ? ` ${labelOf(w.lastTarotPlanet)}` : ""}` },
  c_magician: { label: "The Magician", text: enhanceText(2, "Lucky Cards 1 in 5 chancefor +20 Mult1 in 15 chanceto win $20"), max: 2 },
  c_high_priestess: { label: "The High Priestess", text: "Creates up to 2 random Planet cards (Must have room)" },
  c_empress: { label: "The Empress", text: enhanceText(2, "Mult Cards +4 Mult"), max: 2 },
  c_emperor: { label: "The Emperor", text: "Creates up to 2 random Tarot cards (Must have room)" },
  c_heirophant: { label: "The Hierophant", text: enhanceText(2, "Bonus Cards +30 extra chips"), max: 2 },
  c_lovers: { label: "The Lovers", text: enhanceText(1, "Wild Card Can be usedas any suit"), max: 1 },
  c_chariot: { label: "The Chariot", text: enhanceText(1, "Steel Card X1.5 Multwhile this cardstays in hand"), max: 1 },
  c_justice: { label: "Justice", text: enhanceText(1, "Glass Card X2 Mult1 in 4 chance todestroy card"), max: 1 },
  c_hermit: { label: "The Hermit", text: "Doubles money (Max of $20)" },
  c_wheel_of_fortune: { label: "The Wheel of Fortune", text: (w) => `${odds(w)} in 4 chance to add Foil, Holographic, or Polychrome edition to a random Joker +50 chips +10 Mult X1.5 Mult` },
  c_strength: { label: "Strength", text: "Increases rank of up to 2 selected cards by 1", max: 2 },
  c_hanged_man: { label: "The Hanged Man", text: "Destroys up to 2 selected cards", max: 2 },
  c_death: { label: "Death", text: "Select 2 cards, convert the left card into the right card (Drag to rearrange)", min: 2, max: 2 },
  c_temperance: { label: "Temperance", text: (w) => `Gives the total sell value of all current Jokers (Max of $50) (Currently $${Math.min(50, w.jokers.reduce((a, j) => a + Math.max(1, Math.floor(j.cost / 2)) + j.extraValue, 0))})` },
  c_devil: { label: "The Devil", text: enhanceText(1, "Gold Card $3 if thiscard is held in handat end of round"), max: 1 },
  c_tower: { label: "The Tower", text: enhanceText(1, "Stone Card +50 chipsno rank or suit"), max: 1 },
  c_star: { label: "The Star", text: "Converts up to 3 selected cards to Diamonds", max: 3 },
  c_moon: { label: "The Moon", text: "Converts up to 3 selected cards to Clubs", max: 3 },
  c_sun: { label: "The Sun", text: "Converts up to 3 selected cards to Hearts", max: 3 },
  c_judgement: { label: "Judgement", text: "Creates a random Joker card (Must have room)" },
  c_world: { label: "The World", text: "Converts up to 3 selected cards to Spades", max: 3 },
};

export const SPECTRALS: Record<string, ConsumableSpec> = {
  c_familiar: { label: "Familiar", text: "Destroy 1 random card in your hand, add 3 random Enhanced face cards to your hand" },
  c_grim: { label: "Grim", text: "Destroy 1 random card in your hand, add 2 random Enhanced Aces to your hand" },
  c_incantation: { label: "Incantation", text: "Destroy 1 random card in your hand, add 4 random Enhanced numbered cards to your hand" },
  c_talisman: { label: "Talisman", text: "Add a Gold Seal to 1 selected card in your hand Earn $3 when thiscard is playedand scores", max: 1 },
  c_aura: { label: "Aura", text: "Add Foil, Holographic, or Polychrome effect to 1 selected card in hand +50 chips +10 Mult X1.5 Mult", min: 1, max: 1 },
  c_wraith: { label: "Wraith", text: "Creates a random Rare Joker, sets money to $0" },
  c_sigil: { label: "Sigil", text: "Converts all cards in hand to a single random suit" },
  c_ouija: { label: "Ouija", text: "Converts all cards in hand to a single random rank -1 hand size" },
  c_ectoplasm: { label: "Ectoplasm", text: "Add Negative to a random Joker, -1 hand size +1 Joker slot", randomJoker: true },
  c_immolate: { label: "Immolate", text: "Destroys 5 random cards in hand, gain $20" },
  c_ankh: { label: "Ankh", text: "Create a copy of a random Joker, destroy all other Jokers", needsJoker: true, randomJoker: true },
  c_deja_vu: { label: "Deja Vu", text: "Add a Red Seal to 1 selected card in your hand Retrigger thiscard 1 time", max: 1 },
  c_hex: { label: "Hex", text: "Add Polychrome to a random Joker, and destroy all others X1.5 Mult", needsJoker: true, randomJoker: true },
  c_trance: { label: "Trance", text: "Add a Blue Seal to 1 selected card in your hand Creates the Planet cardfor final played poker handof round if held in hand(Must have room)", max: 1 },
  c_medium: { label: "Medium", text: "Add a Purple Seal to 1 selected card in your hand Creates a Tarot cardwhen discarded(Must have room)", max: 1 },
  c_cryptid: { label: "Cryptid", text: "Create 2 copies of 1 selected card in your hand", max: 1 },
};
/** Black Hole only turns up in a pack's rare 0.3% roll. */
export const BLACK_HOLE: ConsumableSpec = { label: "Black Hole", text: "Upgrade every poker hand by 1 level" };

export function labelOf(key: string): string {
  return PLANET_BY_KEY.get(key)?.label ?? TAROTS[key]?.label ?? SPECTRALS[key]?.label ?? (key === "c_black_hole" ? BLACK_HOLE.label : key);
}

// ---------------------------------------------------------------------------------------------
// Vouchers
// ---------------------------------------------------------------------------------------------

export const VOUCHERS: Record<string, { label: string; text: string; requires?: string }> = {
  v_overstock_norm: { label: "Overstock", text: "+1 card slot available in shop" },
  v_overstock_plus: { label: "Overstock Plus", text: "+1 card slot available in shop", requires: "v_overstock_norm" },
  v_clearance_sale: { label: "Clearance Sale", text: "All cards and packs in shop are 25% off" },
  v_liquidation: { label: "Liquidation", text: "All cards and packs in shop are 50% off", requires: "v_clearance_sale" },
  v_hone: { label: "Hone", text: "Foil, Holographic, and Polychrome cards appear 2X more often" },
  v_glow_up: { label: "Glow Up", text: "Foil, Holographic, and Polychrome cards appear 4X more often", requires: "v_hone" },
  v_reroll_surplus: { label: "Reroll Surplus", text: "Rerolls cost $2 less" },
  v_reroll_glut: { label: "Reroll Glut", text: "Rerolls cost $2 less", requires: "v_reroll_surplus" },
  v_crystal_ball: { label: "Crystal Ball", text: "+1 consumable slot" },
  v_omen_globe: { label: "Omen Globe", text: "Spectral cards may appear in any of the Arcana Packs", requires: "v_crystal_ball" },
  v_telescope: { label: "Telescope", text: "Celestial Packs always contain the Planet card for your most played poker hand" },
  v_observatory: { label: "Observatory", text: "Planet cards in your consumable area give X1.5 Mult for their specified poker hand", requires: "v_telescope" },
  v_grabber: { label: "Grabber", text: "Permanently gain +1 hand per round" },
  v_nacho_tong: { label: "Nacho Tong", text: "Permanently gain +1 hand per round", requires: "v_grabber" },
  v_wasteful: { label: "Wasteful", text: "Permanently gain +1 discard each round" },
  v_recyclomancy: { label: "Recyclomancy", text: "Permanently gain +1 discard each round", requires: "v_wasteful" },
  v_tarot_merchant: { label: "Tarot Merchant", text: "Tarot cards appear 2X more frequently in the shop" },
  v_tarot_tycoon: { label: "Tarot Tycoon", text: "Tarot cards appear 4X more frequently in the shop", requires: "v_tarot_merchant" },
  v_planet_merchant: { label: "Planet Merchant", text: "Planet cards appear 2X more frequently in the shop" },
  v_planet_tycoon: { label: "Planet Tycoon", text: "Planet cards appear 4X more frequently in the shop", requires: "v_planet_merchant" },
  v_seed_money: { label: "Seed Money", text: "Raise the cap on interest earned in each round to $10" },
  v_money_tree: { label: "Money Tree", text: "Raise the cap on interest earned in each round to $20", requires: "v_seed_money" },
  v_blank: { label: "Blank", text: "Does nothing?" },
  v_antimatter: { label: "Antimatter", text: "+1 Joker slot", requires: "v_blank" },
  v_magic_trick: { label: "Magic Trick", text: "Playing cards can be purchased from the shop" },
  v_illusion: { label: "Illusion", text: "Playing cards in shop may have an Enhancement, Edition, and/or a Seal", requires: "v_magic_trick" },
  v_hieroglyph: { label: "Hieroglyph", text: "-1 Ante, -1 hand each round" },
  v_petroglyph: { label: "Petroglyph", text: "-1 Ante, -1 discard each round", requires: "v_hieroglyph" },
  v_directors_cut: { label: "Director's Cut", text: "Reroll Boss Blind 1 time per Ante, $10 per roll" },
  v_retcon: { label: "Retcon", text: "Reroll Boss Blind unlimited times, $10 per roll", requires: "v_directors_cut" },
  v_paint_brush: { label: "Paint Brush", text: "+1 hand size" },
  v_palette: { label: "Palette", text: "+1 hand size", requires: "v_paint_brush" },
};

// ---------------------------------------------------------------------------------------------
// Booster packs: the game's weights (P_CENTERS), sizes and prices
// ---------------------------------------------------------------------------------------------

export interface PackSpec {
  key: string;
  kind: "Arcana" | "Celestial" | "Standard" | "Buffoon" | "Spectral";
  size: "normal" | "jumbo" | "mega";
  cards: number;
  choose: number;
  cost: number;
  weight: number;
}

const PACK_KINDS = [
  { kind: "Arcana", id: "arcana", n: [4, 2, 2], cards: [3, 5, 5], w: [1, 1, 0.25] },
  { kind: "Celestial", id: "celestial", n: [4, 2, 2], cards: [3, 5, 5], w: [1, 1, 0.25] },
  { kind: "Standard", id: "standard", n: [4, 2, 2], cards: [3, 5, 5], w: [1, 1, 0.25] },
  { kind: "Buffoon", id: "buffoon", n: [2, 1, 1], cards: [2, 4, 4], w: [0.6, 0.6, 0.15] },
  { kind: "Spectral", id: "spectral", n: [2, 1, 1], cards: [2, 4, 4], w: [0.3, 0.3, 0.07] },
] as const;

export const PACKS: PackSpec[] = PACK_KINDS.flatMap((p) =>
  (["normal", "jumbo", "mega"] as const).flatMap((size, s) =>
    Array.from({ length: p.n[s] }, (_, i) => ({ key: `p_${p.id}_${size}_${i + 1}`, kind: p.kind, size, cards: p.cards[s], choose: s === 2 ? 2 : 1, cost: [4, 6, 8][s], weight: p.w[s] })),
  ),
);
export const PACK_BY_KEY = new Map(PACKS.map((p) => [p.key, p]));

const PACK_WHAT: Record<PackSpec["kind"], string> = {
  Arcana: "Tarot cards to be used immediately",
  Celestial: "Planet cards to be used immediately",
  Standard: "Playing cards to add to your deck",
  Buffoon: "Joker cards",
  Spectral: "Spectral cards to be used immediately",
};
export const packLabel = (p: PackSpec) => `${p.size === "normal" ? "" : p.size === "jumbo" ? "Jumbo " : "Mega "}${p.kind} Pack`;
export const packText = (p: PackSpec) => `Choose ${p.choose} of up to ${p.cards} ${PACK_WHAT[p.kind]}`;

// ---------------------------------------------------------------------------------------------
// Skip tags
// ---------------------------------------------------------------------------------------------

export const TAGS: Record<string, { name: string; minAnte: number; text: string | ((w: World, hand?: HandName) => string) }> = {
  tag_uncommon: { name: "Uncommon Tag", minAnte: 1, text: "Shop has a free Uncommon Joker" },
  tag_rare: { name: "Rare Tag", minAnte: 1, text: "Shop has a free Rare Joker" },
  tag_negative: { name: "Negative Tag", minAnte: 2, text: "Next base edition shop Joker is free and becomes Negative" },
  tag_foil: { name: "Foil Tag", minAnte: 1, text: "Next base edition shop Joker is free and becomes Foil" },
  tag_holo: { name: "Holographic Tag", minAnte: 1, text: "Next base edition shop Joker is free and becomes Holographic" },
  tag_polychrome: { name: "Polychrome Tag", minAnte: 1, text: "Next base edition shop Joker is free and becomes Polychrome" },
  tag_investment: { name: "Investment Tag", minAnte: 1, text: "After defeating the Boss Blind, gain $25" },
  tag_voucher: { name: "Voucher Tag", minAnte: 1, text: "Adds one Voucher to the next shop" },
  tag_boss: { name: "Boss Tag", minAnte: 1, text: "Rerolls the Boss Blind" },
  tag_standard: { name: "Standard Tag", minAnte: 2, text: "Gives a free Mega Standard Pack" },
  tag_charm: { name: "Charm Tag", minAnte: 1, text: "Gives a free Mega Arcana Pack" },
  tag_meteor: { name: "Meteor Tag", minAnte: 2, text: "Gives a free Mega Celestial Pack" },
  tag_buffoon: { name: "Buffoon Tag", minAnte: 2, text: "Gives a free Mega Buffoon Pack" },
  tag_handy: { name: "Handy Tag", minAnte: 2, text: (w) => `Gives $1 per played hand this run (Will give $${w.handsPlayedRun})` },
  tag_garbage: { name: "Garbage Tag", minAnte: 2, text: (w) => `Gives $1 per unused discard this run (Will give $${w.unusedDiscardsRun})` },
  tag_ethereal: { name: "Ethereal Tag", minAnte: 2, text: "Gives a free Spectral Pack" },
  tag_coupon: { name: "Coupon Tag", minAnte: 1, text: "Initial cards and booster packs in next shop are free" },
  tag_double: { name: "Double Tag", minAnte: 1, text: "Gives a copy of the next selected Tag Double Tag excluded" },
  tag_juggle: { name: "Juggle Tag", minAnte: 1, text: "+3 hand size next round" },
  tag_d_six: { name: "D6 Tag", minAnte: 1, text: "Rerolls in next shop start at $0" },
  tag_top_up: { name: "Top-up Tag", minAnte: 2, text: "Create up to 2 Common Jokers (Must have room)" },
  tag_skip: { name: "Speed Tag", minAnte: 1, text: (w) => `Gives $5 per skipped Blind this run (Will give $${5 * (w.skips + 1)})` },
  tag_orbital: { name: "Orbital Tag", minAnte: 2, text: (_w, hand) => `Upgrade ${hand ?? "Poker Hand"} by 3 levels` },
  tag_economy: { name: "Economy Tag", minAnte: 1, text: "Doubles your money (Max of $40)" },
};

/** Tags that open a pack on the blind select screen, and the pack. */
export const PACK_TAGS: Record<string, string> = {
  tag_standard: "p_standard_mega_1",
  tag_charm: "p_arcana_mega_1",
  tag_meteor: "p_celestial_mega_1",
  tag_buffoon: "p_buffoon_mega_1",
  tag_ethereal: "p_spectral_normal_1",
};

// ---------------------------------------------------------------------------------------------
// Boss blinds: the mod's effect texts and the game's blind sizes
// ---------------------------------------------------------------------------------------------

export const BOSS_TEXT: Record<string, string | ((w: World) => string)> = {
  bl_ox: (w) => `Playing a ${w.mostPlayed} sets money to $0`,
  bl_hook: "Discards 2 random cards per hand played",
  bl_mouth: "Play only 1 hand type this round",
  bl_fish: "Cards drawn face down after each hand played",
  bl_club: "All Club cards are debuffed",
  bl_manacle: "-1 Hand Size",
  bl_tooth: "Lose $1 per card played",
  bl_wall: "Extra large blind",
  bl_house: "First hand is drawn face down",
  bl_mark: "All face cards are drawn face down",
  bl_final_bell: "Forces 1 card to always be selected",
  bl_wheel: (w) => `${odds(w)} in 7 cards get drawn face down`,
  bl_arm: "Decrease level of played poker hand",
  bl_psychic: "Must play 5 cards",
  bl_goad: "All Spade cards are debuffed",
  bl_water: "Start with 0 discards",
  bl_eye: "No repeat hand types this round",
  bl_plant: "All face cards are debuffed",
  bl_needle: "Play only 1 hand",
  bl_head: "All Heart cards are debuffed",
  bl_final_leaf: "All cards debuffed until 1 Joker sold",
  bl_final_vessel: "Very large blind",
  bl_window: "All Diamond cards are debuffed",
  bl_serpent: "After Play or Discard, always draw 3 cards",
  bl_pillar: "Cards played previously this Ante are debuffed",
  bl_flint: "Base Chips and Mult are halved",
  bl_final_acorn: "Flips and shuffles all Joker cards",
  bl_final_heart: "One random Joker disabled every hand",
};

/** Blind size against the ante's small blind (blinds.json). */
export const BOSS_MULT: Record<string, number> = { bl_wall: 4, bl_needle: 1, bl_final_vessel: 6 };
