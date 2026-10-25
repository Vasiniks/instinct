// Joker behaviour the evaluator doesn't own: how scaling jokers grow and run down, the money
// economy jokers pay, what jokers create or destroy, and the `value.stats` the mod reports for
// each (a port of its extract_joker_stats). Scoring itself stays with poker.ts: `scoreStats` hands
// it the live values, and stands in for the few jokers whose mod stats it would read wrongly.

import type { HandName } from "../poker.ts";
import { loyaltyRemaining } from "./data.ts";
import { bossDebuffs, chance, ex, isFace, isSuit, jokerSlots, pick, sellValue, setEx, type Fx, type Item, type SimCard, type World } from "./world.ts";

/** One played hand, as the hooks see it. */
export interface Play {
  played: SimCard[];
  scoring: SimCard[];
  hand: HandName;
  contains: Set<HandName>;
  held: SimCard[];
  /** First hand of the round. */
  first: boolean;
  /** Hands left before this one. */
  handsLeft: number;
  /** Scoring triggers per scoring card (1 + Red Seal + retrigger jokers). */
  triggers: Map<SimCard, number>;
  /** Lucky Card triggers that hit, this hand. */
  luckyHits: number;
}

export interface Hooks {
  /** A blind is selected (setting_blind). */
  blind?(j: Item, w: World, fx: Fx, boss: boolean): void;
  /** The hand is known, before anything scores (context.before). */
  before?(j: Item, w: World, fx: Fx, p: Play): void;
  /** One scoring trigger of a played card. */
  scored?(j: Item, w: World, fx: Fx, c: SimCard, p: Play): void;
  /** One trigger of a card held in hand while the hand scores. */
  held?(j: Item, w: World, fx: Fx, c: SimCard): void;
  /** After the hand scored. */
  after?(j: Item, w: World, fx: Fx, p: Play): void;
  /** Cards discarded: `first` when no discard was used yet, `hook` for The Hook's. */
  discard?(j: Item, w: World, fx: Fx, cards: SimCard[], first: boolean, hook: boolean): void;
  /** End of the round (context.end_of_round). */
  endRound?(j: Item, w: World, fx: Fx, boss: boolean): void;
  /** Money paid at cash out (calc_dollar_bonus). */
  dollars?(j: Item, w: World): number;
  /** This joker is sold. */
  sold?(j: Item, w: World, fx: Fx): void;
  /** Any card is sold (Campfire). */
  anySold?(j: Item, w: World): void;
  planet?(j: Item, w: World): void;
  cardAdded?(j: Item, w: World, n: number): void;
  reroll?(j: Item, w: World): void;
  packSkipped?(j: Item, w: World): void;
  packOpened?(j: Item, w: World, fx: Fx): void;
  glassBroken?(j: Item, w: World, n: number): void;
  /** Playing cards destroyed, however (remove_playing_cards). */
  destroyed?(j: Item, w: World, cards: SimCard[]): void;
  /** Leaving the shop (ending_shop). */
  endShop?(j: Item, w: World, fx: Fx): void;
}

const mult = (j: Item, d: number) => (j.ab.mult = Math.max(0, j.ab.mult + d));
const xmult = (j: Item, d: number) => (j.ab.x_mult = Math.round((j.ab.x_mult + d) * 100) / 100);
const grow = (j: Item, k: string, d: number) => setEx(j, k, ex(j, k) + d);
/** Debuffed cards trigger nothing (Card:is_face and friends return nil for them). */
const live = (w: World, cs: SimCard[]) => cs.filter((c) => !bossDebuffs(w, c));

/** Most played visible hand, strictly ahead of every other (Obelisk resets on it). */
function mostPlayedStrict(w: World, hand: HandName): boolean {
  const mine = w.levels[hand].played;
  return Object.entries(w.levels).every(([k, l]) => k === hand || !l.visible || l.played < mine);
}

export const HOOKS: Record<string, Hooks> = {
  // --- Grow with play --------------------------------------------------------------------------
  j_green_joker: {
    before: (j) => void mult(j, 1),
    discard: (j, _w, _fx, _c, _f, hook) => void (!hook && mult(j, -1)),
  },
  j_ride_the_bus: {
    before: (j, w, _fx, p) => void (p.scoring.some((c) => p.triggers.get(c) && isFace(w, c)) ? (j.ab.mult = 0) : mult(j, 1)),
  },
  j_runner: { before: (j, _w, _fx, p) => void (p.contains.has("Straight") && grow(j, "chips", 15)) },
  j_square: { before: (j, _w, _fx, p) => void (p.played.length === 4 && grow(j, "chips", 4)) },
  j_trousers: { before: (j, _w, _fx, p) => void ((p.contains.has("Two Pair") || p.contains.has("Full House")) && mult(j, 2)) },
  j_obelisk: { before: (j, w, _fx, p) => void (mostPlayedStrict(w, p.hand) ? (j.ab.x_mult = 1) : xmult(j, 0.2)) },
  j_space: { before: (_j, w, fx, p) => void (chance(w, "space", 4) && fx.levelUp(p.hand, 1)) },
  j_vampire: {
    before: (j, _w, _fx, p) => {
      for (const c of p.scoring) {
        if (!c.enhancement || p.triggers.get(c) === 0) continue;
        c.enhancement = undefined;
        xmult(j, 0.1);
      }
    },
  },
  j_midas_mask: { before: (_j, w, _fx, p) => p.scoring.filter((c) => isFace(w, c) && p.triggers.get(c)).forEach((c) => (c.enhancement = "GOLD")) },
  j_dna: {
    before: (_j, _w, fx, p) => {
      if (!p.first || p.played.length !== 1) return;
      const c = p.played[0];
      fx.addCard({ ...c, id: 0, faceDown: false, forced: false }, "hand");
    },
  },
  j_wee: { scored: (j, _w, _fx, c) => void (c.rank === "2" && c.enhancement !== "STONE" && grow(j, "chips", 8)) },
  j_constellation: { planet: (j) => void xmult(j, 0.1) },
  j_hologram: { cardAdded: (j, _w, n) => void xmult(j, 0.25 * n) },
  j_flash: { reroll: (j) => void mult(j, 2) },
  j_red_card: { packSkipped: (j) => void mult(j, 3) },
  j_glass: { glassBroken: (j, _w, n) => void xmult(j, 0.75 * n) },
  j_campfire: {
    anySold: (j) => void xmult(j, 0.25),
    endRound: (j, _w, _fx, boss) => void (boss && (j.ab.x_mult = 1)),
  },
  j_hit_the_road: {
    discard: (j, w, _fx, cards) => void xmult(j, 0.5 * live(w, cards).filter((c) => c.rank === "J" && c.enhancement !== "STONE").length),
    endRound: (j) => void (j.ab.x_mult = 1),
  },
  j_castle: { discard: (j, w, _fx, cards) => void grow(j, "chips", 3 * live(w, cards).filter((c) => isSuit(w, c, w.castleSuit)).length) },
  j_caino: { destroyed: (j, w, cards) => void (j.ab.n.caino_xmult = (j.ab.n.caino_xmult ?? 1) + ex(j) * live(w, cards).filter((c) => isFace(w, c)).length) },
  // Every discarded card counts, debuffed or thrown by The Hook; the 23rd pays and the count restarts.
  j_yorick: {
    discard: (j, _w, _fx, cards) => {
      for (let i = 0; i < cards.length; i++) {
        const left = j.ab.n.yorick_discards ?? ex(j, "discards");
        if (left <= 1) {
          j.ab.n.yorick_discards = ex(j, "discards");
          xmult(j, ex(j, "xmult"));
        } else j.ab.n.yorick_discards = left - 1;
      }
    },
  },
  j_madness: {
    blind: (j, w, fx, boss) => {
      if (boss) return;
      xmult(j, 0.5);
      const others = w.jokers.filter((x) => x !== j && !x.eternal);
      if (others.length) fx.destroyJoker(pick(w, "madness", others));
    },
  },
  j_ceremonial: {
    blind: (j, w, fx) => {
      const right = w.jokers[w.jokers.indexOf(j) + 1];
      if (!right || right.eternal) return;
      j.ab.mult += 2 * sellValue(right);
      fx.destroyJoker(right);
    },
  },
  // --- Run down ----------------------------------------------------------------------------------
  j_ice_cream: {
    after: (j, _w, fx) => {
      if (ex(j, "chips") - 5 <= 0) fx.destroyJoker(j);
      else grow(j, "chips", -5);
    },
  },
  j_selzer: {
    after: (j, _w, fx) => {
      if (ex(j) - 1 <= 0) fx.destroyJoker(j);
      else j.ab.extra = ex(j) - 1;
    },
  },
  j_ramen: {
    discard: (j, _w, fx, cards) => {
      if (j.ab.x_mult - 0.01 * cards.length <= 1) fx.destroyJoker(j);
      else xmult(j, -0.01 * cards.length);
    },
  },
  j_popcorn: {
    endRound: (j, _w, fx) => {
      if (j.ab.mult - 4 <= 0) fx.destroyJoker(j);
      else j.ab.mult -= 4;
    },
  },
  j_gros_michel: {
    endRound: (j, w, fx) => {
      if (!chance(w, "gros_michel", 6)) return;
      fx.destroyJoker(j);
      w.grosExtinct = true;
    },
  },
  j_cavendish: { endRound: (j, w, fx) => void (chance(w, "cavendish", 1000) && fx.destroyJoker(j)) },
  j_turtle_bean: {
    endRound: (j, _w, fx) => {
      if (ex(j, "h_size") - 1 <= 0) fx.destroyJoker(j);
      else grow(j, "h_size", -1);
    },
  },
  // --- Money -------------------------------------------------------------------------------------
  j_golden: { dollars: () => 4 },
  j_rocket: {
    dollars: (j) => ex(j, "dollars"),
    endRound: (j, _w, _fx, boss) => void (boss && grow(j, "dollars", 2)),
  },
  j_cloud_9: { dollars: (_j, w) => w.cards.filter((c) => c.rank === "9" && c.enhancement !== "STONE").length || 0 },
  j_satellite: { dollars: (_j, w) => w.planetsUsed.size || 0 },
  j_delayed_grat: { dollars: (_j, w) => (w.discardsUsed === 0 && w.discardsLeft > 0 ? 2 * w.discardsLeft : 0) },
  j_egg: { endRound: (j) => void (j.extraValue += 3) },
  j_gift: {
    endRound: (_j, w) => {
      for (const x of [...w.jokers, ...w.consumables]) x.extraValue += 1;
    },
  },
  j_business: { scored: (_j, w, fx, c) => void (isFace(w, c) && chance(w, "business", 2) && fx.earn(2)) },
  j_rough_gem: { scored: (_j, w, fx, c) => void (isSuit(w, c, "D") && fx.earn(1)) },
  j_ticket: { scored: (_j, _w, fx, c) => void (c.enhancement === "GOLD" && fx.earn(4)) },
  j_reserved_parking: { held: (_j, w, fx, c) => void (isFace(w, c) && chance(w, "parking", 2) && fx.earn(1)) },
  j_faceless: { discard: (_j, w, fx, cards) => void (live(w, cards).filter((c) => isFace(w, c)).length >= 3 && fx.earn(5)) },
  j_mail: { discard: (_j, w, fx, cards) => void fx.earn(5 * live(w, cards).filter((c) => c.rank === w.mailRank && c.enhancement !== "STONE").length) },
  j_trading: {
    discard: (_j, _w, fx, cards, first, hook) => {
      if (!first || hook || cards.length !== 1) return;
      fx.destroyCards(cards);
      fx.earn(3);
    },
  },
  j_todo_list: { after: (_j, w, fx, p) => void (p.hand === w.todoHand && fx.earn(4)) },
  // --- Create or level up ------------------------------------------------------------------------
  j_8_ball: { scored: (_j, w, fx, c) => void (c.rank === "8" && c.enhancement !== "STONE" && chance(w, "8_ball", 4) && fx.createConsumable("TAROT")) },
  j_superposition: { after: (_j, _w, fx, p) => void (p.contains.has("Straight") && p.scoring.some((c) => c.rank === "A" && c.enhancement !== "STONE") && fx.createConsumable("TAROT")) },
  j_seance: { after: (_j, _w, fx, p) => void (p.contains.has("Straight Flush") && fx.createConsumable("SPECTRAL")) },
  j_vagabond: { after: (_j, w, fx) => void (w.money <= 4 && fx.createConsumable("TAROT")) },
  j_sixth_sense: {
    after: (_j, _w, fx, p) => {
      if (!p.first || p.played.length !== 1 || p.played[0].rank !== "6" || p.played[0].enhancement === "STONE") return;
      fx.destroyCards(p.played);
      fx.createConsumable("SPECTRAL");
    },
  },
  j_cartomancer: { blind: (_j, _w, fx) => void fx.createConsumable("TAROT") },
  j_hallucination: { packOpened: (_j, w, fx) => void (chance(w, "hallucination", 2) && fx.createConsumable("TAROT")) },
  j_perkeo: { endShop: (_j, w, fx) => void (w.consumables.length && fx.copyConsumable(pick(w, "perkeo", w.consumables))) },
  j_riff_raff: {
    blind: (_j, _w, fx) => {
      for (let i = 0; i < 2; i++) fx.createJoker({ rarity: "COMMON" });
    },
  },
  j_marble: { blind: (_j, _w, fx) => fx.addCard(fx.newCard({ enhancement: "STONE" }), "draw") },
  j_burglar: {
    blind: (_j, w) => {
      w.handsLeft += 3;
      w.discardsLeft = 0;
    },
  },
  // --- Sold for an effect ------------------------------------------------------------------------
  j_diet_cola: { sold: (_j, w) => void w.tags.push({ key: "tag_double" }) },
  j_invisible: {
    endRound: (j) => void (j.ab.n.rounds = (j.ab.n.rounds ?? 0) + 1),
    sold: (j, w, fx) => {
      if ((j.ab.n.rounds ?? 0) < 2) return;
      const others = w.jokers.filter((x) => x !== j);
      if (others.length) fx.createJoker({ from: pick(w, "invisible", others), force: true });
    },
  },
};

/**
 * `value.stats`, the way the mod's extract_joker_stats builds it: `mult` and `x_mult` from the
 * ability, then `extra`'s chips, mult and Xmult, then the per-joker cases. Empty means omitted.
 */
export function modStats(j: Item, w: World): Record<string, number> | undefined {
  const a = j.ab;
  const s: Record<string, number> = {};
  if (a.mult !== 0) s.mult = a.mult;
  if (a.x_mult > 1) s.x_mult = a.x_mult;
  if (typeof a.extra === "object") {
    if (a.extra.chips) s.chips = a.extra.chips;
    if (a.extra.mult && s.mult === undefined) s.mult = a.extra.mult;
    if ((a.extra.Xmult ?? 0) > 1 && s.x_mult === undefined) s.x_mult = a.extra.Xmult;
  }
  const tally = (pred: (c: SimCard) => boolean) => w.cards.filter(pred).length;
  switch (j.key) {
    case "j_fortune_teller":
      s.mult = w.tarotUsed;
      break;
    case "j_steel_joker": {
      const t = tally((c) => c.enhancement === "STEEL");
      if (t > 0) Object.assign(s, { steel_tally: t, x_mult: 1 + 0.2 * t });
      break;
    }
    case "j_stone": {
      const t = tally((c) => c.enhancement === "STONE");
      if (t > 0) Object.assign(s, { stone_tally: t, chips: 25 * t });
      break;
    }
    case "j_selzer":
      if (ex(j) > 0) s.seltzer_remaining = ex(j);
      break;
    case "j_drivers_license": {
      const t = tally((c) => Boolean(c.enhancement));
      if (t > 0) s.driver_tally = t;
      if (t >= 16) s.x_mult = 3;
      break;
    }
    case "j_obelisk":
      s.obelisk_step = ex(j);
      break;
    case "j_ride_the_bus":
      s.ride_the_bus_step = ex(j);
      break;
    case "j_green_joker":
      Object.assign(s, { mult: a.mult, green_hand_add: ex(j, "hand_add") });
      break;
    case "j_cloud_9": {
      const t = tally((c) => c.rank === "9" && c.enhancement !== "STONE");
      if (t > 0) s.nine_tally = t;
      break;
    }
    case "j_rocket":
      s.rocket_dollars = ex(j, "dollars");
      break;
    case "j_popcorn":
    case "j_flash":
    case "j_trousers":
      s.mult = a.mult;
      break;
    case "j_swashbuckler":
      s.mult = w.jokers.filter((x) => x !== j).reduce((n, x) => n + sellValue(x), 0);
      break;
    case "j_stencil": {
      const x = jokerSlots(w) - w.jokers.length + w.jokers.filter((o) => o.key === "j_stencil").length;
      delete s.x_mult;
      if (x > 1) s.x_mult = x;
      break;
    }
    case "j_loyalty_card":
      Object.assign(s, { loyalty_every: 5, loyalty_remaining: loyaltyRemaining(j, w), loyalty_x_mult: 4 });
      break;
    case "j_caino":
      if ((a.n.caino_xmult ?? 1) > 1) s.caino_xmult = a.n.caino_xmult;
      break;
  }
  return Object.keys(s).length ? s : undefined;
}

/**
 * What the evaluator should score for a joker this hand: the reported stats, except where they would
 * mislead it. Misprint rolls (the evaluator assumes 11.5), Bootstraps pays per $5 (the mod reports
 * the rate), Loyalty Card fires one hand in six (the mod always reports X4), Throwback counts skips.
 * A new key routes the joker to the evaluator's stats rule.
 */
export function scoreStats(j: Item, w: World, roll: () => number): { key: string; stats: Record<string, number> } {
  const stats = modStats(j, w) ?? {};
  switch (j.key) {
    case "j_misprint":
      return { key: "j_misprint~", stats: { mult: Math.floor(roll() * 24) } };
    case "j_bootstraps":
      return { key: j.key, stats: { mult: 2 * Math.floor(Math.max(0, w.money) / 5) } };
    case "j_loyalty_card":
      // The hand being scored is already counted (hands_played rises on play).
      return { key: j.key, stats: loyaltyRemaining(j, w, 1) === 5 ? { x_mult: 4 } : {} };
    case "j_throwback":
      return { key: j.key, stats: w.skips ? { x_mult: 1 + 0.25 * w.skips } : {} };
  }
  return { key: j.key, stats };
}

/** Rank one higher, Ace wrapping to 2 (Strength). */
export function nextRank(r: string): string {
  const order = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
  return order[(order.indexOf(r) + 1) % order.length];
}
