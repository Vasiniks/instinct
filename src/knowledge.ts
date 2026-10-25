// Static Balatro knowledge the planner reads: what each joker rewards, what each Tarot does, how
// decks and stakes change the game, how blind targets scale, and which boss rules change play.
// Vanilla jokers are tagged by key; modded or unknown jokers are tagged from their effect text.

import type { HandName } from "./poker.ts";

/**
 * Joker tags. Hand tags (pair, flush, ...) and card tags (hearts, face, steel, ...) say what a joker
 * rewards; role tags (chips, mult, xmult, econ, ...) say what it gives; play tags say how it wants
 * to be played (few_cards, no_face, no_discard, discards, vary_hand, ...).
 */
const T: Record<string, string> = {
  j_joker: "mult",
  j_greedy_joker: "diamonds mult",
  j_lusty_joker: "hearts mult",
  j_wrathful_joker: "spades mult",
  j_gluttenous_joker: "clubs mult",
  j_jolly: "pair mult",
  j_zany: "three mult",
  j_mad: "two_pair mult",
  j_crazy: "straight mult",
  j_droll: "flush mult",
  j_sly: "pair chips",
  j_wily: "three chips",
  j_clever: "two_pair chips",
  j_devious: "straight chips",
  j_crafty: "flush chips",
  j_half: "few_cards mult",
  j_stencil: "xmult empty_slots",
  j_four_fingers: "flush straight rule",
  j_mime: "retrigger held steel",
  // Lends up to $20 and pays nothing: no economy (the debt delays interest), so no tags.
  j_credit_card: "",
  j_ceremonial: "mult scaling destroys",
  j_banner: "chips no_discard",
  j_mystic_summit: "mult discards",
  j_marble: "stone deckfix",
  j_loyalty_card: "xmult",
  j_8_ball: "consumable",
  j_misprint: "mult",
  j_dusk: "retrigger last_hand",
  j_raised_fist: "mult held",
  j_chaos: "econ reroll",
  j_fibonacci: "fib mult",
  j_steel_joker: "xmult steel",
  j_scary_face: "face chips",
  j_abstract: "mult",
  j_delayed_grat: "econ no_discard",
  j_hack: "low retrigger",
  j_pareidolia: "face rule",
  j_gros_michel: "mult expires",
  j_even_steven: "even mult",
  j_odd_todd: "odd chips",
  j_scholar: "ace chips mult",
  j_business: "face econ",
  j_supernova: "mult repeat_hand",
  j_ride_the_bus: "mult scaling no_face",
  j_space: "levels",
  j_egg: "econ sell_value",
  j_burglar: "hands no_discard",
  j_blackboard: "spades clubs xmult held",
  j_runner: "straight chips scaling",
  j_ice_cream: "chips expires",
  j_dna: "deckfix first_hand",
  j_splash: "rule",
  j_blue_joker: "chips",
  j_sixth_sense: "consumable deckfix",
  j_constellation: "xmult scaling planets",
  j_hiker: "chips scaling",
  j_faceless: "face econ discards",
  j_green_joker: "mult scaling no_discard",
  j_superposition: "straight consumable",
  j_todo_list: "econ",
  j_cavendish: "xmult expires",
  j_card_sharp: "xmult repeat_hand",
  j_red_card: "mult scaling",
  j_madness: "xmult scaling destroys",
  j_square: "chips scaling four_cards",
  j_seance: "straight flush consumable",
  j_riff_raff: "jokers",
  j_vampire: "xmult scaling enhanced",
  j_shortcut: "straight rule",
  j_hologram: "xmult scaling deckfix",
  j_vagabond: "consumable",
  j_baron: "kings xmult held",
  j_cloud_9: "econ",
  j_rocket: "econ scaling",
  j_obelisk: "xmult scaling vary_hand",
  j_midas_mask: "face gold deckfix",
  j_luchador: "boss sell_value",
  j_photograph: "face xmult",
  j_gift: "econ sell_value",
  j_turtle_bean: "hand_size expires",
  j_erosion: "mult deckfix",
  j_reserved_parking: "face econ held",
  j_mail: "econ discards",
  j_to_the_moon: "econ",
  j_hallucination: "consumable",
  j_fortune_teller: "mult scaling tarots",
  j_juggler: "hand_size",
  j_drunkard: "discards",
  j_stone: "stone chips",
  j_golden: "econ",
  j_lucky_cat: "lucky xmult scaling",
  j_baseball: "xmult",
  j_bull: "chips money",
  j_diet_cola: "sell_value",
  j_trading: "econ deckfix discards",
  j_flash: "mult scaling reroll",
  j_popcorn: "mult expires",
  j_trousers: "two_pair mult scaling",
  j_ancient: "xmult suits",
  j_ramen: "xmult no_discard expires",
  j_walkie_talkie: "ten_four chips mult",
  j_selzer: "retrigger expires",
  j_castle: "chips scaling discards",
  j_smiley: "face mult",
  j_campfire: "xmult scaling",
  j_ticket: "gold econ",
  j_mr_bones: "survival",
  j_acrobat: "xmult last_hand",
  j_sock_and_buskin: "face retrigger",
  j_swashbuckler: "mult",
  j_troubadour: "hand_size",
  j_certificate: "deckfix",
  j_smeared: "flush rule",
  j_throwback: "xmult scaling skip",
  j_hanging_chad: "retrigger",
  j_rough_gem: "diamonds econ",
  j_bloodstone: "hearts xmult",
  j_arrowhead: "spades chips",
  j_onyx_agate: "clubs mult",
  j_glass: "glass xmult scaling",
  j_ring_master: "consumable",
  j_flower_pot: "rainbow xmult",
  j_blueprint: "copy",
  j_wee: "low chips scaling",
  j_merry_andy: "discards",
  j_oops: "lucky",
  j_idol: "xmult",
  j_seeing_double: "clubs xmult",
  j_matador: "econ boss",
  j_hit_the_road: "xmult scaling discards",
  j_duo: "pair xmult",
  j_trio: "three xmult",
  j_family: "four xmult",
  j_order: "straight xmult",
  j_tribe: "flush xmult",
  j_stuntman: "chips",
  j_invisible: "copy sell_value",
  j_brainstorm: "copy",
  j_satellite: "econ planets",
  j_shoot_the_moon: "queens mult held",
  j_drivers_license: "enhanced xmult",
  j_cartomancer: "consumable tarots",
  j_astronomer: "econ planets",
  j_burnt: "levels discards",
  j_bootstraps: "mult money",
  j_caino: "face xmult scaling",
  j_triboulet: "kings queens xmult",
  j_yorick: "xmult scaling discards",
  j_chicot: "boss",
  j_perkeo: "consumable copy",
};

/** Tags from effect text, for jokers this table does not know (modded, Cryptid, new releases). */
export function tagsFromEffect(effect: string): Set<string> {
  const e = effect.toLowerCase();
  const tags = new Set<string>();
  const add = (re: RegExp, ...t: string[]) => {
    if (re.test(e)) for (const x of t) tags.add(x);
  };
  add(/\bx\s?\d|×\s?\d|\d\s?x mult|xmult|x mult/, "xmult");
  add(/\+\s?\d+ mult|mult\b/, "mult");
  add(/\+\s?\d+ chips|chips/, "chips");
  add(/retrigger/, "retrigger");
  add(/\$\d|money|dollar|sell value|interest/, "econ");
  add(/\bgains?\b|permanently|increases by/, "scaling");
  add(/flush/, "flush");
  add(/straight/, "straight");
  add(/two pair/, "two_pair");
  add(/three of a kind/, "three");
  add(/four of a kind/, "four");
  add(/\bpair\b/, "pair");
  add(/heart/, "hearts");
  add(/diamond/, "diamonds");
  add(/spade/, "spades");
  add(/club/, "clubs");
  add(/face card|king|queen|jack/, "face");
  add(/\bace/, "ace");
  add(/discard/, "discards");
  add(/held in hand/, "held");
  add(/tarot|planet|spectral/, "consumable");
  add(/copies/, "copy");
  return tags;
}

export function jokerTags(key: string, effect = ""): Set<string> {
  const known = T[key];
  return known !== undefined ? new Set(known.split(" ").filter(Boolean)) : tagsFromEffect(effect);
}

/** Which poker hands each hand tag supports, strongest first. Pair jokers also fire on two pair, full house, ... */
export const TAG_HANDS: Record<string, HandName[]> = {
  pair: ["Pair", "Two Pair", "Full House", "Three of a Kind", "Four of a Kind"],
  two_pair: ["Two Pair", "Full House"],
  three: ["Three of a Kind", "Full House", "Four of a Kind"],
  four: ["Four of a Kind"],
  straight: ["Straight", "Straight Flush"],
  flush: ["Flush", "Straight Flush", "Flush House", "Flush Five"],
  few_cards: ["Pair", "Three of a Kind", "High Card"],
  four_cards: ["Two Pair", "Four of a Kind"],
};

export const SUIT_TAG: Record<string, string> = { hearts: "H", diamonds: "D", spades: "S", clubs: "C" };
export const ROLE_TAGS = ["xmult", "mult", "chips", "retrigger", "copy", "econ", "scaling"] as const;

/** The builds the planner compares. `hands` are the poker hands the build plays. */
export const ARCHETYPES: Record<string, { hands: HandName[]; describe: string }> = {
  Pair: { hands: ["Pair"], describe: "play pairs: small, reliable hands, strong with pair jokers and Mercury levels" },
  "Two Pair": { hands: ["Two Pair"], describe: "play two pair: reliable four-card hands, Uranus levels" },
  "Three of a Kind": { hands: ["Three of a Kind"], describe: "play three of a kind: needs duplicate ranks, Venus levels" },
  "Full House": { hands: ["Full House"], describe: "play full houses: pair and three-of-a-kind jokers both fire, Earth levels" },
  "Four of a Kind": { hands: ["Four of a Kind"], describe: "play four of a kind: needs a deck thinned to few ranks, Mars levels" },
  Straight: { hands: ["Straight"], describe: "play straights: needs connected ranks, Saturn levels" },
  Flush: { hands: ["Flush"], describe: "play flushes: needs one dominant suit, Jupiter levels, suit-converting Tarots" },
  "High Card": { hands: ["High Card"], describe: "play single strong cards: relies entirely on jokers" },
};

// ---------------------------------------------------------------------------------------------
// Consumables
// ---------------------------------------------------------------------------------------------

export type TarotKind = "suit" | "enhance" | "rank" | "destroy" | "copy" | "money" | "joker" | "create" | "edition" | "other";

export const TAROTS: Record<string, { kind: TarotKind; detail?: string }> = {
  c_fool: { kind: "other", detail: "copies the last Tarot or Planet used" },
  c_magician: { kind: "enhance", detail: "LUCKY" },
  c_high_priestess: { kind: "create", detail: "two Planets" },
  c_empress: { kind: "enhance", detail: "MULT" },
  c_emperor: { kind: "create", detail: "two Tarots" },
  c_heirophant: { kind: "enhance", detail: "BONUS" },
  c_lovers: { kind: "enhance", detail: "WILD" },
  c_chariot: { kind: "enhance", detail: "STEEL" },
  c_justice: { kind: "enhance", detail: "GLASS" },
  c_hermit: { kind: "money", detail: "doubles money, up to $20" },
  c_wheel_of_fortune: { kind: "edition", detail: "1 in 4: a random joker gains an edition" },
  c_strength: { kind: "rank", detail: "raises rank by one" },
  c_hanged_man: { kind: "destroy", detail: "destroys up to two cards" },
  c_death: { kind: "copy", detail: "left card becomes a copy of the right card" },
  c_temperance: { kind: "money", detail: "money equal to jokers' sell value, up to $50" },
  c_devil: { kind: "enhance", detail: "GOLD" },
  c_tower: { kind: "enhance", detail: "STONE" },
  c_star: { kind: "suit", detail: "D" },
  c_moon: { kind: "suit", detail: "C" },
  c_sun: { kind: "suit", detail: "H" },
  c_judgement: { kind: "joker", detail: "creates a random joker" },
  c_world: { kind: "suit", detail: "S" },
};

export const PLANET_HAND: Record<string, HandName> = {
  c_pluto: "High Card",
  c_mercury: "Pair",
  c_uranus: "Two Pair",
  c_venus: "Three of a Kind",
  c_saturn: "Straight",
  c_jupiter: "Flush",
  c_earth: "Full House",
  c_mars: "Four of a Kind",
  c_neptune: "Straight Flush",
  c_planet_x: "Five of a Kind",
  c_ceres: "Flush House",
  c_eris: "Flush Five",
};

/** Spectrals that destroy or weaken jokers or cards: never used blind. */
export const RISKY_SPECTRALS = new Set(["c_ankh", "c_hex", "c_wraith", "c_ectoplasm", "c_immolate", "c_ouija"]);

// ---------------------------------------------------------------------------------------------
// Decks and stakes
// ---------------------------------------------------------------------------------------------

export interface DeckProfile {
  notes: string[];
  /** Interest is paid at all (Green deck pays per hand/discard left instead). */
  interest: boolean;
  /** Extra weight per archetype or theme. */
  favor?: Partial<Record<string, number>>;
  /** Tags whose jokers are useless with this deck. */
  dead?: string[];
  /** Plasma: chips and mult are averaged, so +chips is worth as much as +mult. */
  balanced?: boolean;
  blindScale?: number;
  /** Economy leaning on top of the stake's: positive saves harder, negative spends sooner. */
  econBias?: number;
  /** Extra weight per archetype in antes 1-2 only. */
  earlyFavor?: Partial<Record<string, number>>;
}

export const DECKS: Record<string, DeckProfile> = {
  RED: { interest: true, notes: ["Red deck: one extra discard each round."] },
  BLUE: { interest: true, notes: ["Blue deck: one extra hand each round."] },
  YELLOW: { interest: true, econBias: 0.15, notes: ["Yellow deck: starts with $10 more."] },
  GREEN: {
    interest: false,
    notes: ["Green deck: no interest. Each unused hand pays $2 and each unused discard $1 at cash out."],
  },
  BLACK: { interest: true, econBias: -0.1, notes: ["Black deck: one extra joker slot and one fewer hand each round."] },
  MAGIC: { interest: true, notes: ["Magic deck: starts with the Crystal Ball voucher and two copies of The Fool."] },
  NEBULA: { interest: true, notes: ["Nebula deck: starts with the Telescope voucher; one fewer consumable slot."] },
  GHOST: {
    interest: true,
    notes: [
      "Ghost deck: Spectral cards can appear in the shop, and the run starts with a Hex (makes a random joker Polychrome and destroys the others).",
    ],
  },
  ABANDONED: { interest: true, dead: ["face"], notes: ["Abandoned deck: no face cards."] },
  CHECKERED: {
    interest: true,
    favor: { Flush: 1, Pair: 0.3, spades: 1.5, hearts: 1.5 },
    earlyFavor: { Flush: 1.5 },
    notes: [
      "Checkered deck: 26 Spades and 26 Hearts, no Clubs or Diamonds.",
    ],
  },
  ZODIAC: { interest: true, notes: ["Zodiac deck: starts with the Tarot Merchant, Planet Merchant and Overstock vouchers."] },
  PAINTED: {
    interest: true,
    favor: { Flush: 1, "Four of a Kind": 1 },
    notes: ["Painted deck: two more hand size and one fewer joker slot."],
  },
  ANAGLYPH: { interest: true, econBias: -0.05, notes: ["Anaglyph deck: a Double Tag after every boss blind."] },
  PLASMA: {
    interest: true,
    balanced: true,
    blindScale: 2,
    notes: ["Plasma deck: chips and mult are balanced (averaged) before scoring; blind targets are doubled."],
  },
  ERRATIC: { interest: true, notes: ["Erratic deck: the starting ranks and suits are random."] },
};

export const STAKE_ORDER = ["WHITE", "RED", "GREEN", "BLACK", "BLUE", "PURPLE", "ORANGE", "GOLD"];

const STAKE_NOTES: Record<string, string> = {
  RED: "Red stake or higher: the small blind pays no money; skipping it still skips that round's interest and shop.",
  GREEN: "Green stake or higher: blind targets grow faster.",
  BLACK: "Black stake or higher: shop jokers can be Eternal (can't be sold or destroyed).",
  BLUE: "Blue stake or higher: one fewer discard each round.",
  PURPLE: "Purple stake or higher: blind targets grow faster still.",
  ORANGE: "Orange stake or higher: shop jokers can be Perishable (debuffed after 5 rounds).",
  GOLD: "Gold stake: shop jokers can be Rental ($1 to buy, then $3 every round, charged before interest).",
};

/**
 * What the stake and deck change about how to play. Higher stakes make blinds grow faster, take
 * away a discard, and add Eternal, Perishable and Rental jokers, so runs are won on economy: the
 * interest cap early, economy jokers early, fewer marginal buys. `econPressure` carries that
 * into every money decision (0 at White, about 1 at Gold).
 */
export interface Conditions {
  stake: string;
  deck: string;
  econPressure: number;
  /** Dollars a Rental joker costs each round (0 below Gold). */
  rentalRate: number;
  perishable: boolean;
  eternal: boolean;
  notes: string[];
}

const STAKE_PRESSURE: Record<string, number> = { WHITE: 0, RED: 0.1, GREEN: 0.3, BLACK: 0.4, BLUE: 0.5, PURPLE: 0.65, ORANGE: 0.8, GOLD: 1 };

export function conditions(stake: string | undefined, deck: string | undefined): Conditions {
  const st = stake && STAKE_PRESSURE[stake] !== undefined ? stake : "WHITE";
  const d = DECKS[deck ?? ""];
  const econPressure = d && !d.interest ? 0 : Math.max(0, Math.min(1.2, STAKE_PRESSURE[st] + (d?.econBias ?? 0)));
  return {
    stake: st,
    deck: deck ?? "RED",
    econPressure,
    rentalRate: stakeAtLeast(st, "GOLD") ? 3 : 0,
    perishable: stakeAtLeast(st, "ORANGE"),
    eternal: stakeAtLeast(st, "BLACK"),
    notes: [...(d?.notes ?? []), ...stakeNotes(st)],
  };
}

/** Notes for every stake at or below this one (stakes stack). */
export function stakeNotes(stake: string | undefined): string[] {
  const i = STAKE_ORDER.indexOf(stake ?? "WHITE");
  return STAKE_ORDER.slice(1, i + 1).map((s) => STAKE_NOTES[s]);
}

export const stakeAtLeast = (stake: string | undefined, min: string) => STAKE_ORDER.indexOf(stake ?? "WHITE") >= STAKE_ORDER.indexOf(min);

// ---------------------------------------------------------------------------------------------
// Blind targets
// ---------------------------------------------------------------------------------------------

const BASE_AMOUNTS = [
  [300, 800, 2000, 5000, 11000, 20000, 35000, 50000],
  [300, 900, 2600, 8000, 20000, 36000, 60000, 100000],
  [300, 1000, 3200, 9000, 25000, 60000, 110000, 200000],
];

/** Base chips for an ante's small blind (big = 1.5x, boss = 2x), by stake scaling. */
export function blindBase(ante: number, stake?: string, deck?: string): number {
  const row = BASE_AMOUNTS[stakeAtLeast(stake, "PURPLE") ? 2 : stakeAtLeast(stake, "GREEN") ? 1 : 0];
  const a = Math.max(1, ante);
  // Past ante 8 the base grows roughly 1.6x per ante in the base game; good enough for planning.
  const amount = a <= 8 ? row[a - 1] : row[7] * 1.6 ** (a - 8);
  return amount * (DECKS[deck ?? ""]?.blindScale ?? 1);
}

// ---------------------------------------------------------------------------------------------
// Boss blinds that change how to play
// ---------------------------------------------------------------------------------------------

export interface BossRule {
  /** Penalize playing the most played hand (The Ox sets money to $0; Obelisk-like). */
  avoidMostPlayed?: boolean;
  /** Each hand type may score only once this round (The Eye). */
  noRepeat?: boolean;
  /** Only the first hand type played this round scores (The Mouth). */
  oneType?: boolean;
  /** Playing a hand lowers its level (The Arm): spend low-value hand types. */
  lowersLevel?: boolean;
  /** $1 lost per card played (The Tooth). */
  costPerCard?: number;
  /** All cards are debuffed until a joker is sold (Verdant Leaf). */
  sellToLift?: boolean;
  /** Base chips and mult halved (The Flint). */
  halvesBase?: boolean;
}

/**
 * Every boss blind, with the first ante it can appear in (from the game's blind definitions).
 * Showdown bosses come only at multiples of the winning ante (8).
 */
export const BOSSES: { key: string; name: string; min: number; showdown?: boolean }[] = [
  { key: "bl_ox", name: "The Ox", min: 6 },
  { key: "bl_hook", name: "The Hook", min: 1 },
  { key: "bl_mouth", name: "The Mouth", min: 2 },
  { key: "bl_fish", name: "The Fish", min: 2 },
  { key: "bl_club", name: "The Club", min: 1 },
  { key: "bl_manacle", name: "The Manacle", min: 1 },
  { key: "bl_tooth", name: "The Tooth", min: 3 },
  { key: "bl_wall", name: "The Wall", min: 2 },
  { key: "bl_house", name: "The House", min: 2 },
  { key: "bl_mark", name: "The Mark", min: 2 },
  { key: "bl_final_bell", name: "Cerulean Bell", min: 10, showdown: true },
  { key: "bl_wheel", name: "The Wheel", min: 2 },
  { key: "bl_arm", name: "The Arm", min: 2 },
  { key: "bl_psychic", name: "The Psychic", min: 1 },
  { key: "bl_goad", name: "The Goad", min: 1 },
  { key: "bl_water", name: "The Water", min: 2 },
  { key: "bl_eye", name: "The Eye", min: 3 },
  { key: "bl_plant", name: "The Plant", min: 4 },
  { key: "bl_needle", name: "The Needle", min: 2 },
  { key: "bl_head", name: "The Head", min: 1 },
  { key: "bl_final_leaf", name: "Verdant Leaf", min: 10, showdown: true },
  { key: "bl_final_vessel", name: "Violet Vessel", min: 10, showdown: true },
  { key: "bl_window", name: "The Window", min: 1 },
  { key: "bl_serpent", name: "The Serpent", min: 5 },
  { key: "bl_pillar", name: "The Pillar", min: 1 },
  { key: "bl_flint", name: "The Flint", min: 2 },
  { key: "bl_final_acorn", name: "Amber Acorn", min: 10, showdown: true },
  { key: "bl_final_heart", name: "Crimson Heart", min: 10, showdown: true },
];

/**
 * The bosses the game can draw at `ante`: the eligible ones (showdown bosses on multiples of 8,
 * the rest from their first ante on, never on those antes) used the fewest times so far this run,
 * so each boss comes up once before any comes up twice.
 */
export function bossPool(ante: number, used: Record<string, number>, winAnte = 8): { key: string; name: string }[] {
  const a = Math.max(1, ante);
  const showdown = a % winAnte === 0 && a >= 2;
  const eligible = BOSSES.filter((b) => (b.showdown ? showdown : !showdown && b.min <= a));
  const fewest = Math.min(...eligible.map((b) => used[b.key] ?? 0));
  return eligible.filter((b) => (used[b.key] ?? 0) === fewest).map(({ key, name }) => ({ key, name }));
}

export const bossKeyOf = (name: string) => BOSSES.find((b) => b.name.toLowerCase() === name.toLowerCase())?.key;

export function bossRule(name: string | undefined, effect = ""): BossRule {
  const n = (name ?? "").toLowerCase();
  const e = effect.toLowerCase();
  if (n.includes("the ox") || /sets money to \$0/.test(e)) return { avoidMostPlayed: true };
  if (n.includes("the eye") || /no repeat hand/.test(e)) return { noRepeat: true };
  if (n.includes("the mouth") || /only 1 hand type/.test(e)) return { oneType: true };
  if (n.includes("the arm") || /decrease level/.test(e)) return { lowersLevel: true };
  if (n.includes("the tooth") || /lose \$1 per card/.test(e)) return { costPerCard: 1 };
  if (n.includes("verdant leaf") || /until 1 joker sold/.test(e)) return { sellToLift: true };
  if (n.includes("the flint") || /base chips and mult are halved/.test(e)) return { halvesBase: true };
  return {};
}

// ---------------------------------------------------------------------------------------------
// Vouchers and tags
// ---------------------------------------------------------------------------------------------

export const VOUCHER_VALUE: Record<string, number> = {
  v_seed_money: 0.62,
  v_money_tree: 0.6,
  v_grabber: 0.65,
  v_nacho_tong: 0.62,
  v_wasteful: 0.55,
  v_recyclomancy: 0.5,
  v_antimatter: 0.8,
  v_paint_brush: 0.58,
  v_palette: 0.55,
  v_overstock_norm: 0.52,
  v_overstock_plus: 0.5,
  v_clearance_sale: 0.52,
  v_liquidation: 0.5,
  v_reroll_surplus: 0.45,
  v_reroll_glut: 0.42,
  v_crystal_ball: 0.45,
  v_telescope: 0.5,
  v_observatory: 0.62,
  v_hone: 0.45,
  v_glow_up: 0.48,
  v_tarot_merchant: 0.4,
  v_tarot_tycoon: 0.38,
  v_planet_merchant: 0.42,
  v_planet_tycoon: 0.4,
  v_magic_trick: 0.35,
  v_illusion: 0.38,
  v_directors_cut: 0.4,
  v_retcon: 0.4,
  v_hieroglyph: 0.5,
  v_petroglyph: 0.48,
  v_blank: 0.25,
  v_omen_globe: 0.35,
};

/** Value of taking a skip tag, before weighing what skipping costs. */
export const TAG_VALUE: Record<string, number> = {
  tag_negative: 0.75,
  tag_investment: 0.72,
  tag_polychrome: 0.65,
  tag_rare: 0.65,
  tag_double: 0.55,
  tag_voucher: 0.6,
  tag_holo: 0.55,
  tag_foil: 0.5,
  tag_uncommon: 0.52,
  tag_economy: 0.5,
  tag_coupon: 0.5,
  tag_d_six: 0.45,
  tag_orbital: 0.5,
  tag_charm: 0.5,
  tag_meteor: 0.45,
  tag_buffoon: 0.55,
  tag_standard: 0.4,
  tag_ethereal: 0.38,
  tag_juggle: 0.35,
  tag_handy: 0.4,
  tag_garbage: 0.38,
  tag_speed: 0.42,
  tag_top_up: 0.4,
  tag_boss: 0.4,
};
