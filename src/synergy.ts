// What jokers do for each other, and what feeds them, from how the game plays them. Round
// simulations already price synergy inside one hand's score (a retrigger on a joker that pays per
// card, a rule-changer that makes the build's hand easier) whenever both jokers are held. This
// table carries what they can't see: a joker offered next to the one it completes, a payoff that
// arrives over many rounds (a deck being built, a consumable stream, money), and the pairs that
// work against each other. Strength is how much the pair adds: 1 a core combo a run is built on,
// 0.5 a strong lift, 0.25 a mild one.

type Pair = [a: string, b: string, strength: number];

const SUITS = { H: ["j_lusty_joker", "j_bloodstone"], D: ["j_greedy_joker", "j_rough_gem"], S: ["j_wrathful_joker", "j_arrowhead"], C: ["j_gluttenous_joker", "j_onyx_agate"] };
const SUIT_JOKERS = Object.values(SUITS).flat();
const FACE_PAYOFF = ["j_scary_face", "j_smiley", "j_photograph", "j_business", "j_reserved_parking", "j_faceless", "j_midas_mask"];
const FLUSH_PAYOFF = ["j_droll", "j_crafty", "j_tribe"];
const STRAIGHT_PAYOFF = ["j_crazy", "j_devious", "j_order", "j_runner"];
const DISCARD_PAYOFF = ["j_yorick", "j_castle", "j_hit_the_road", "j_mail", "j_faceless", "j_trading", "j_burnt", "j_banner", "j_delayed_grat"];
const HELD_PAYOFF = ["j_baron", "j_shoot_the_moon", "j_raised_fist", "j_reserved_parking"];
const CHANCE = ["j_lucky_cat", "j_bloodstone", "j_space", "j_8_ball", "j_business", "j_hallucination", "j_reserved_parking", "j_glass"];
const TAROT_MAKERS = ["j_cartomancer", "j_8_ball", "j_hallucination", "j_vagabond", "j_superposition", "j_sixth_sense"];
const MONEY_STACK = ["j_golden", "j_cloud_9", "j_rocket", "j_to_the_moon", "j_egg", "j_gift", "j_delayed_grat", "j_satellite"];

const each = (a: string, bs: string[], strength: number): Pair[] => bs.filter((b) => b !== a).map((b) => [a, b, strength]);

/** Jokers that are worth more together. Symmetric: each pair is listed once. */
const PAIRS: Pair[] = [
  // Cards held in hand: Mime retriggers what Baron, Shoot the Moon and Raised Fist pay for.
  ["j_baron", "j_mime", 1],
  ["j_shoot_the_moon", "j_mime", 0.75],
  ["j_raised_fist", "j_mime", 0.5],
  ["j_reserved_parking", "j_mime", 0.4],
  ["j_steel_joker", "j_mime", 0.6],
  ["j_steel_joker", "j_baron", 0.5],
  ["j_baron", "j_shoot_the_moon", 0.25],
  // More cards in hand for the held-card jokers.
  ...each("j_juggler", [...HELD_PAYOFF, "j_mime"], 0.25),
  ...each("j_turtle_bean", [...HELD_PAYOFF, "j_mime"], 0.25),
  // Face cards: Pareidolia makes every card one, Sock and Buskin retriggers them, Hanging Chad and
  // Photograph's first face card.
  ...each("j_pareidolia", FACE_PAYOFF, 0.6),
  ["j_pareidolia", "j_sock_and_buskin", 0.6],
  ["j_pareidolia", "j_midas_mask", 0.9],
  ...each("j_sock_and_buskin", ["j_scary_face", "j_smiley", "j_photograph", "j_business"], 0.5),
  ["j_photograph", "j_hanging_chad", 0.75],
  ["j_photograph", "j_smiley", 0.25],
  ["j_photograph", "j_scary_face", 0.25],
  ["j_smiley", "j_scary_face", 0.25],
  ["j_photograph", "j_even_steven", 0.25],
  // Low ranks: Hack retriggers 2-5, which Wee Joker, Fibonacci, Even Steven, Odd Todd and Walkie Talkie pay for.
  ["j_hack", "j_wee", 1],
  ...each("j_hack", ["j_fibonacci", "j_even_steven", "j_odd_todd", "j_walkie_talkie"], 0.4),
  ["j_hanging_chad", "j_hack", 0.25],
  ["j_hanging_chad", "j_wee", 0.4],
  ["j_scholar", "j_fibonacci", 0.25],
  ["j_scholar", "j_odd_todd", 0.25],
  ["j_scholar", "j_superposition", 0.25],
  // Retriggers on per-card payoffs.
  ...each("j_dusk", ["j_hack", "j_sock_and_buskin", "j_hanging_chad", "j_photograph", "j_bloodstone", "j_hiker", "j_wee"], 0.3),
  ...each("j_selzer", ["j_photograph", "j_bloodstone", "j_hiker", "j_wee", "j_lucky_cat"], 0.25),
  ...each("j_hiker", ["j_hanging_chad", "j_sock_and_buskin", "j_hack", "j_splash"], 0.25),
  // Flushes: a suit's two jokers, the flush jokers, Four Fingers and Smeared Joker to make them.
  ...Object.values(SUITS).map(([a, b]): Pair => [a, b, 0.5]),
  ...each("j_smeared", [...SUIT_JOKERS, "j_seeing_double", "j_blackboard", "j_ancient", ...FLUSH_PAYOFF], 0.4),
  ...each("j_four_fingers", [...FLUSH_PAYOFF, ...STRAIGHT_PAYOFF, "j_shortcut", "j_seance"], 0.5),
  ...SUIT_JOKERS.flatMap((s) => each(s, FLUSH_PAYOFF, 0.25)),
  ["j_droll", "j_crafty", 0.25],
  ["j_droll", "j_tribe", 0.25],
  ["j_crafty", "j_tribe", 0.25],
  ...each("j_blackboard", ["j_wrathful_joker", "j_arrowhead", "j_gluttenous_joker", "j_onyx_agate"], 0.4),
  ["j_seeing_double", "j_gluttenous_joker", 0.4],
  ["j_seeing_double", "j_onyx_agate", 0.4],
  ["j_bloodstone", "j_oops", 0.5],
  // Straights.
  ...each("j_shortcut", [...STRAIGHT_PAYOFF, "j_superposition", "j_seance"], 0.5),
  ["j_runner", "j_crazy", 0.25],
  ["j_runner", "j_devious", 0.25],
  ["j_runner", "j_order", 0.25],
  ["j_runner", "j_superposition", 0.25],
  ["j_crazy", "j_devious", 0.25],
  ["j_order", "j_crazy", 0.25],
  // Ranks: the hand-type pairs and their X jokers.
  ["j_jolly", "j_sly", 0.25],
  ["j_jolly", "j_duo", 0.25],
  ["j_zany", "j_wily", 0.25],
  ["j_zany", "j_trio", 0.25],
  ["j_mad", "j_clever", 0.25],
  ["j_mad", "j_trousers", 0.25],
  ["j_clever", "j_trousers", 0.25],
  ["j_duo", "j_trio", 0.25],
  ["j_trio", "j_family", 0.25],
  // One hand played again and again.
  ["j_supernova", "j_card_sharp", 0.4],
  ["j_supernova", "j_space", 0.25],
  // Enhancements: the jokers that pay for them and the ones that make them.
  ["j_stone", "j_marble", 0.75],
  ["j_ticket", "j_midas_mask", 0.75],
  ["j_vampire", "j_midas_mask", 0.75],
  ["j_vampire", "j_marble", 0.4],
  ["j_lucky_cat", "j_oops", 0.75],
  ["j_glass", "j_oops", 0.5],
  ...each("j_oops", CHANCE.filter((k) => !["j_lucky_cat", "j_glass", "j_bloodstone"].includes(k)), 0.3),
  ["j_mime", "j_golden", 0.1],
  // Cards added to the deck grow Hologram.
  ...each("j_hologram", ["j_dna", "j_certificate", "j_marble"], 0.75),
  // Planets used grow Constellation.
  ...each("j_constellation", ["j_astronomer", "j_satellite", "j_perkeo"], 0.5),
  // Tarots used grow Fortune Teller.
  ...each("j_fortune_teller", TAROT_MAKERS, 0.5),
  ["j_fortune_teller", "j_perkeo", 0.4],
  // Consumables to sell grow Campfire.
  ...each("j_campfire", TAROT_MAKERS, 0.3),
  ["j_campfire", "j_astronomer", 0.25],
  // Rerolls grow Flash Card; Chaos the Clown gives one a shop.
  ["j_flash", "j_chaos", 0.5],
  // Money: Bull and Bootstraps turn it into chips and Mult.
  ...each("j_bull", MONEY_STACK, 0.3),
  ...each("j_bootstraps", MONEY_STACK, 0.3),
  ["j_bull", "j_bootstraps", 0.25],
  // Sell value: Swashbuckler adds it as Mult; Egg and Gift Card raise it; Ceremonial Dagger eats it.
  ["j_swashbuckler", "j_egg", 0.5],
  ["j_swashbuckler", "j_gift", 0.75],
  ["j_ceremonial", "j_egg", 0.5],
  ["j_ceremonial", "j_gift", 0.25],
  // Discards: Drunkard and Merry Andy give more of them to the jokers that pay per discard.
  ...each("j_drunkard", DISCARD_PAYOFF, 0.3),
  ...each("j_merry_andy", DISCARD_PAYOFF, 0.3),
  ["j_faceless", "j_pareidolia", 0.5],
  ["j_hit_the_road", "j_pareidolia", 0.1],
  // Hands: Burglar swaps discards for hands, which Green Joker and Mystic Summit like.
  ["j_burglar", "j_green_joker", 0.5],
  ["j_burglar", "j_mystic_summit", 0.5],
  ["j_burglar", "j_supernova", 0.25],
  ["j_burglar", "j_ride_the_bus", 0.25],
  // Skips: Throwback grows with each.
  ["j_throwback", "j_diet_cola", 0.25],
  // Copies: Blueprint and Brainstorm copy each other's target, and Showman lets duplicates show.
  ["j_blueprint", "j_brainstorm", 0.5],
  ["j_invisible", "j_blueprint", 0.25],
  ["j_invisible", "j_brainstorm", 0.25],
];

/** Jokers that work against each other. */
const CONFLICTS: Pair[] = [
  // Every card is a face card under Pareidolia, so Ride the Bus never grows.
  ["j_pareidolia", "j_ride_the_bus", 1],
  ...each("j_ride_the_bus", ["j_photograph", "j_scary_face", "j_smiley", "j_sock_and_buskin", "j_hanging_chad"], 0.25),
  // Vampire eats the enhancements these pay for.
  ...each("j_vampire", ["j_steel_joker", "j_glass", "j_lucky_cat", "j_stone", "j_ticket"], 0.75),
  // Obelisk resets on the most played hand, which these want repeated.
  ["j_obelisk", "j_supernova", 0.5],
  ["j_obelisk", "j_card_sharp", 0.5],
  ["j_obelisk", "j_trousers", 0.25],
  // Burglar takes every discard away from the jokers that pay for them.
  ...each("j_burglar", DISCARD_PAYOFF, 0.75),
  // Mystic Summit wants no discards left; the discard jokers spend them.
  ...each("j_mystic_summit", ["j_yorick", "j_castle", "j_hit_the_road", "j_mail", "j_faceless", "j_trading", "j_burnt"], 0.25),
  // Oops! All 6s doubles the bananas' chance to die too.
  ["j_oops", "j_gros_michel", 0.5],
  ["j_oops", "j_cavendish", 0.25],
  // Midas Mask turns face cards Gold, over the Steel, Glass and Lucky they held.
  ...each("j_midas_mask", ["j_steel_joker", "j_glass", "j_lucky_cat"], 0.25),
  // Four-card hands for Square Joker against one-card hands for DNA.
  ["j_square", "j_dna", 0.25],
  // Joker Stencil wants empty slots; Abstract Joker wants them full.
  ["j_stencil", "j_abstract", 0.25],
];

/** Consumables, vouchers and packs that feed a joker: what to look for once it is held. */
export const ENABLERS: Record<string, Record<string, number>> = {
  j_steel_joker: { c_chariot: 1 },
  j_mime: { c_chariot: 0.5, c_deja_vu: 0.5, c_devil: 0.25, c_talisman: 0.25 },
  j_baron: { c_chariot: 0.5, c_strength: 0.5, c_death: 0.5, c_deja_vu: 0.25, c_cryptid: 0.4, v_paint_brush: 0.25, v_palette: 0.25 },
  j_shoot_the_moon: { c_strength: 0.25, c_death: 0.5, c_cryptid: 0.4, c_chariot: 0.25 },
  j_glass: { c_justice: 1 },
  j_lucky_cat: { c_magician: 1 },
  j_ticket: { c_devil: 1 },
  j_stone: { c_tower: 1 },
  j_vampire: { c_magician: 0.5, c_empress: 0.5, c_heirophant: 0.5, c_lovers: 0.5, c_chariot: 0.5, c_justice: 0.5, c_tower: 0.5, c_devil: 0.5, p_arcana: 0.5, p_standard: 0.25 },
  j_hologram: { c_cryptid: 0.75, c_familiar: 0.5, c_grim: 0.5, c_incantation: 0.5, p_standard: 0.5 },
  j_constellation: { v_planet_merchant: 0.75, v_planet_tycoon: 0.75, v_telescope: 0.25, p_celestial: 0.75, c_trance: 0.25 },
  j_satellite: { v_planet_merchant: 0.4, p_celestial: 0.4 },
  j_fortune_teller: { v_tarot_merchant: 0.75, v_tarot_tycoon: 0.75, p_arcana: 0.5, c_medium: 0.25 },
  j_flash: { v_reroll_surplus: 0.5, v_reroll_glut: 0.5 },
  j_campfire: { v_tarot_merchant: 0.25, v_planet_merchant: 0.25 },
  j_perkeo: { v_observatory: 0.75, v_crystal_ball: 0.5 },
  j_raised_fist: { c_strength: 0.1 },
  j_wee: { c_death: 0.25 },
  j_hack: { c_hanged_man: 0.25 },
};

function index(pairs: Pair[]): Map<string, Map<string, number>> {
  const m = new Map<string, Map<string, number>>();
  const put = (a: string, b: string, w: number) => {
    const row = m.get(a) ?? new Map<string, number>();
    row.set(b, Math.max(w, row.get(b) ?? 0));
    m.set(a, row);
  };
  for (const [a, b, w] of pairs) {
    put(a, b, w);
    put(b, a, w);
  }
  return m;
}

const PARTNERS = index(PAIRS);
const AGAINST = index(CONFLICTS);

/** Every joker key the tables name, for checks. */
export const SYNERGY_KEYS = new Set([...PAIRS, ...CONFLICTS].flatMap(([a, b]) => [a, b]));

/** The held jokers that `key` works with, strongest first, each with its strength. */
export function partnersOf(key: string, held: Iterable<string>): { key: string; strength: number }[] {
  const row = PARTNERS.get(key);
  if (!row) return [];
  return [...new Set(held)].filter((k) => k !== key && row.has(k)).map((k) => ({ key: k, strength: row.get(k)! })).sort((a, b) => b.strength - a.strength);
}

/** The held jokers that `key` works against, strongest first. */
export function conflictsOf(key: string, held: Iterable<string>): { key: string; strength: number }[] {
  const row = AGAINST.get(key);
  if (!row) return [];
  return [...new Set(held)].filter((k) => k !== key && row.has(k)).map((k) => ({ key: k, strength: row.get(k)! })).sort((a, b) => b.strength - a.strength);
}

/**
 * How much the partners lift a joker, in combo strengths: the strongest counts whole, each
 * further one half as much as the one before, so five mild partners don't outweigh one core combo.
 */
export function synergyOf(key: string, held: Iterable<string>): { lift: number; drag: number; partners: string[]; against: string[] } {
  const ps = partnersOf(key, held);
  const cs = conflictsOf(key, held);
  const sum = (xs: { strength: number }[]) => xs.reduce((a, x, i) => a + x.strength / 2 ** i, 0);
  return { lift: sum(ps), drag: sum(cs), partners: ps.map((p) => p.key), against: cs.map((c) => c.key) };
}

/** What a consumable, voucher or pack (`p_arcana`, `p_celestial`, `p_standard`, ...) does for the held jokers. */
export function enablerLift(item: string, held: Iterable<string>): { lift: number; for: string[] } {
  const fed = [...new Set(held)].map((k) => ({ k, w: ENABLERS[k]?.[item] ?? 0 })).filter((x) => x.w > 0).sort((a, b) => b.w - a.w);
  return { lift: fed.reduce((a, x, i) => a + x.w / 2 ** i, 0), for: fed.map((x) => x.k) };
}
