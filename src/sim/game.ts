// The simulator's game loop: BlindDeck's methods over the run state in world.ts. Phases, error
// kinds and the GameState shape follow the mod (src/lua/endpoints and utils/gamestate.lua); the
// rules follow the game (state_events.lua, common_events.lua, card.lua, blind.lua, tag.lua).
// Scores come from the agent's own evaluator, fed the true cards and the jokers' live values.

import { RpcError, type Game } from "../blinddeck.ts";
import { RANKS, SUITS, rankChips, type PCard } from "../cards.ts";
import { BOSSES, blindBase, bossPool, stakeAtLeast } from "../knowledge.ts";
import { BASE_HANDS, HAND_NAMES, deckCounts, estimateScore, evaluateHand, rulesFromJokers, type HandName, type Joker } from "../poker.ts";
import type { Area, Blind, GameState, RawCard } from "../types.ts";
import { cannotUse, specOf, useConsumable } from "./consumables.ts";
import {
  BOSS_MULT,
  BOSS_TEXT,
  CATALOG_BY_KEY,
  JOKERS,
  JOKER_RARITY,
  PACKS,
  PACK_BY_KEY,
  PACK_TAGS,
  PLANETS,
  PLANET_BY_KEY,
  SPECTRALS,
  TAGS,
  TAROTS,
  VOUCHERS,
  freshAbility,
  jokerText,
  labelOf,
  packLabel,
  packText,
  planetText,
  type PackSpec,
} from "./data.ts";
import { HOOKS, modStats, scoreStats, type Hooks, type Play } from "./jokers.ts";
import {
  askPrice,
  bossDebuffs,
  consumableSlots,
  count,
  fail,
  handSize,
  has,
  isFace,
  jokerSlots,
  levelFresh,
  pick,
  price,
  roundDiscards,
  roundHands,
  sellValue,
  shopSlots,
  shuffle,
  stakeIndex,
  streams,
  used,
  type Edition,
  type Fx,
  type Item,
  type ItemSet,
  type SimCard,
  type World,
} from "./world.ts";

const SECRET = new Set<string>(["Five of a Kind", "Flush House", "Flush Five"]);
const ENHANCEMENTS = ["BONUS", "MULT", "WILD", "GLASS", "STEEL", "STONE", "GOLD", "LUCKY"];
const CARD_NAME: Record<string, string> = { BONUS: "Bonus Card", MULT: "Mult Card", WILD: "Wild Card", GLASS: "Glass Card", STEEL: "Steel Card", STONE: "Stone Card", GOLD: "Gold Card", LUCKY: "Lucky Card" };
const CARD_TEXT: Record<string, string> = {
  BONUS: "+30 extra chips",
  MULT: "+4 Mult",
  WILD: "Can be used as any suit",
  GLASS: "X2 Mult 1 in 4 chance to destroy card",
  STEEL: "X1.5 Mult while this card stays in hand",
  GOLD: "$3 if this card is held in hand at end of round",
  LUCKY: "1 in 5 chance for +20 Mult 1 in 15 chance to win $20",
};
const EDITION_TEXT: Record<string, string> = { FOIL: "+50 chips", HOLO: "+10 Mult", POLYCHROME: "X1.5 Mult" };
const SEAL_TEXT: Record<string, string> = {
  RED: "Retrigger thiscard 1 time",
  GOLD: "Earn $3 when thiscard is playedand scores",
  BLUE: "Creates the Planet cardfor final played poker handof round if held in hand(Must have room)",
  PURPLE: "Creates a Tarot cardwhen discarded(Must have room)",
};
/** Hooks a Blueprint or Brainstorm copy repeats (the ones that pay or create; growth is not copied). */
const COPYABLE = new Set(["j_business", "j_rough_gem", "j_ticket", "j_8_ball", "j_reserved_parking", "j_superposition", "j_seance", "j_vagabond", "j_todo_list", "j_cartomancer", "j_riff_raff", "j_marble", "j_burglar", "j_faceless", "j_mail"]);
/** Jokers the simulator deals: every vanilla joker it implements, Legendaries excepted. */
const OFFERED = Object.keys(JOKERS).filter((k) => CATALOG_BY_KEY.has(k) && JOKER_RARITY[k] !== "LEGENDARY");

function blankWorld(seed: string, stake: string, deck: string): World {
  let next = 1;
  return {
    seed,
    rng: streams(seed),
    id: () => next++,
    phase: "BLIND_SELECT",
    stake,
    deck,
    ante: 1,
    round: 0,
    money: 4,
    won: false,
    result: "",
    blindIdx: 0,
    status: ["SELECT", "UPCOMING", "UPCOMING"],
    boss: "bl_small",
    bossDisabled: false,
    bossRerolled: false,
    bossesUsed: {},
    blindTags: [],
    tags: [],
    skips: 0,
    cards: [],
    startSize: 52,
    draw: [],
    hand: [],
    handsLeft: 0,
    discardsLeft: 0,
    handsPlayed: 0,
    discardsUsed: 0,
    chips: 0,
    handsPlayedRun: 0,
    unusedDiscardsRun: 0,
    levels: Object.fromEntries(HAND_NAMES.map((h) => [h, levelFresh(BASE_HANDS[h], !SECRET.has(h))])),
    jokers: [],
    consumables: [],
    shop: [],
    shopVouchers: [],
    shopPacks: [],
    vouchers: [],
    rerollIncrease: 0,
    freeRerolls: 0,
    tarotUsed: 0,
    planetsUsed: new Set(),
    ancientSuit: "S",
    idol: { rank: "A", suit: "S" },
    castleSuit: "S",
    mailRank: "A",
    todoHand: "High Card",
    mostPlayed: "High Card",
    eyeHands: new Set(),
    leafLifted: false,
    fishPrepped: false,
    roundHandSize: 0,
    handSizeDelta: 0,
    ectoMinus: 1,
    grosExtinct: false,
    cashout: { total: 0, lines: [], investment: 0 },
  };
}

export interface SimGame extends Game {
  state(): GameState;
  /** For tests: the run state behind the GameState (a new object each `start`). */
  world(): World;
}

/** Jokers the evaluator steps for the hand being played, from their reported value before it. */
const EVALUATOR_STEPS = new Set(["j_green_joker", "j_ride_the_bus", "j_runner", "j_square", "j_trousers", "j_obelisk", "j_loyalty_card", "j_bootstraps"]);

export function simGame(initialSeed = "SIM1"): SimGame {
  let w = blankWorld(initialSeed, "WHITE", "RED");
  w.phase = "MENU";
  /** Mods that start a run with no seed draw one; this keeps them repeatable too. */
  let menuRng = streams(initialSeed);
  /** Crimson Heart's joker for the coming hand; the target the round must reach. */
  let heartOff: number | undefined;
  let target = 0;
  /** The Fish / Cerulean Bell / Crimson Heart wait for the first hand. */
  let bossPrepped = false;

  // -------------------------------------------------------------------------------------------
  // Small helpers
  // -------------------------------------------------------------------------------------------

  const need = (...phases: string[]) => {
    if (!phases.includes(w.phase)) fail("INVALID_STATE", `requires ${phases.join("/")}, game is in ${w.phase}`);
  };
  const bossLive = () => w.blindIdx === 2 && !w.bossDisabled && (w.phase === "SELECTING_HAND" || w.phase === "ROUND_EVAL");
  const bossIs = (key: string) => bossLive() && w.boss === key;
  const bankrupt = () => (has(w, "j_credit_card") ? -20 : 0);
  const buyingPower = () => w.money - bankrupt();
  const refreshDebuffs = () => {
    for (const j of w.jokers) j.debuff = Boolean(j.ab.n.perished) || heartOff === j.id;
  };
  const blindScore = (idx: number) => {
    const base = w.ante < 1 ? 100 * (w.deck === "PLASMA" ? 2 : 1) : blindBase(w.ante, w.stake, w.deck);
    return Math.floor(base * [1, 1.5, BOSS_MULT[w.boss] ?? 2][idx]);
  };
  const interest = () => {
    if (w.deck === "GREEN" || w.money < 5) return 0;
    const cap = used(w, "v_money_tree") ? 100 : used(w, "v_seed_money") ? 50 : 25;
    return (1 + count(w, "j_to_the_moon")) * Math.min(Math.floor(w.money / 5), cap / 5);
  };
  const rerollBase = () => 5 - (used(w, "v_reroll_surplus") ? 2 : 0) - (used(w, "v_reroll_glut") ? 2 : 0);
  const rerollCost = () => (w.freeRerolls > 0 ? 0 : Math.max(0, (w.rerollStart ?? rerollBase()) + w.rerollIncrease));
  const handLimit = () => Math.max(1, handSize(w) + w.roundHandSize - (bossIs("bl_manacle") ? 1 : 0));
  const hooksOf = (j: Item): Hooks | undefined => (j.debuff ? undefined : HOOKS[j.key]);

  /** Each joker's hook, then the hooks Blueprint and Brainstorm copy, in joker order. */
  function eachHook<K extends keyof Hooks>(name: K, run: (h: NonNullable<Hooks[K]>, j: Item) => void) {
    for (const j of [...w.jokers]) {
      if (!w.jokers.includes(j)) continue;
      const h = hooksOf(j)?.[name];
      if (h) run(h as NonNullable<Hooks[K]>, j);
      const src = copied(j);
      if (src && COPYABLE.has(src.key)) {
        const ch = HOOKS[src.key]?.[name];
        if (ch) run(ch as NonNullable<Hooks[K]>, src);
      }
    }
  }
  /** The joker a Blueprint or Brainstorm copies, if any. */
  function copied(j: Item, depth = 0): Item | undefined {
    if (j.debuff || depth > w.jokers.length) return undefined;
    const target = j.key === "j_blueprint" ? w.jokers[w.jokers.indexOf(j) + 1] : j.key === "j_brainstorm" ? w.jokers[0] : undefined;
    if (!target || target === j || target.debuff) return undefined;
    return target.key === "j_blueprint" || target.key === "j_brainstorm" ? copied(target, depth + 1) : target;
  }
  /** Effective joker keys for retrigger counting, copies resolved. */
  const effectiveKeys = () => w.jokers.flatMap((j) => (j.debuff ? [] : j.key === "j_blueprint" || j.key === "j_brainstorm" ? (copied(j) ? [copied(j)!.key] : []) : [j.key]));

  // -------------------------------------------------------------------------------------------
  // Creating cards
  // -------------------------------------------------------------------------------------------

  const makeItem = (key: string, set: ItemSet, label: string, base: number, extra: Partial<Item> = {}): Item =>
    price(w, { id: w.id(), key, set, label, base, cost: base, extraValue: 0, ab: set === "JOKER" ? freshAbility(key) : { mult: 0, x_mult: 1, n: {} }, ...extra });

  const editionRate = () => (used(w, "v_glow_up") ? 4 : used(w, "v_hone") ? 2 : 1);
  /** poll_edition: Negative 0.3%, then Polychrome, Holographic and Foil scaled by Hone and Glow Up. */
  function pollEdition(stream: string, mod = 1, noNeg = false): Edition | undefined {
    const r = w.rng(stream);
    const rate = editionRate() * mod;
    if (r > 1 - 0.003 * mod && !noNeg) return "NEGATIVE";
    if (r > 1 - 0.006 * rate) return "POLYCHROME";
    if (r > 1 - 0.02 * rate) return "HOLO";
    if (r > 1 - 0.04 * rate) return "FOIL";
    return undefined;
  }

  /** get_current_pool's enhancement_gate: these jokers are offered only once the deck holds the enhancement. */
  const ENHANCEMENT_GATE: Record<string, string> = { j_steel_joker: "STEEL", j_stone: "STONE", j_lucky_cat: "LUCKY", j_ticket: "GOLD", j_glass: "GLASS" };

  function jokerPool(rarity: string): string[] {
    const taken = has(w, "j_ring_master") ? new Set<string>() : new Set([...w.jokers, ...w.shop, ...(w.pack?.items ?? [])].map((i) => i.key));
    const held = new Set(w.cards.map((c) => c.enhancement));
    return OFFERED.filter(
      (k) => JOKER_RARITY[k] === rarity && !taken.has(k) && (k !== "j_gros_michel" || !w.grosExtinct) && (k !== "j_cavendish" || w.grosExtinct) && (!ENHANCEMENT_GATE[k] || held.has(ENHANCEMENT_GATE[k])),
    );
  }

  /** create_card for a Joker: rarity 70/25/5, an edition at the game's odds, stake stickers in shops and packs. */
  function newJoker(opts: { rarity?: string; key?: string; edition?: Edition; plain?: boolean; area?: "shop" | "pack" } = {}): Item {
    let key = opts.key;
    if (!key) {
      const r = w.rng("rarity");
      const rarity = opts.rarity ?? (r > 0.95 ? "RARE" : r > 0.7 ? "UNCOMMON" : "COMMON");
      const pool = jokerPool(rarity);
      key = pool.length ? pick(w, "joker", pool) : "j_joker";
    }
    const cat = CATALOG_BY_KEY.get(key)!;
    const j = makeItem(key, "JOKER", cat.name, cat.cost, { edition: opts.edition ?? (opts.plain ? undefined : pollEdition("edition")) });
    j.ab.n.created = w.handsPlayedRun;
    if (opts.area) {
      const poll = w.rng("sticker");
      const spec = JOKERS[key];
      if (stakeAtLeast(w.stake, "BLACK") && poll > 0.7 && !spec?.noEternal) j.eternal = true;
      else if (stakeAtLeast(w.stake, "ORANGE") && poll > 0.4 && poll <= 0.7 && !spec?.noPerish) j.perishable = 5;
      if (stakeAtLeast(w.stake, "GOLD") && w.rng("rental") > 0.7) j.rental = true;
      price(w, j);
    }
    return j;
  }

  function consumablePool(set: "TAROT" | "PLANET" | "SPECTRAL", exclude: Set<string> = new Set()): string[] {
    const taken = has(w, "j_ring_master") ? exclude : new Set([...exclude, ...w.consumables.map((c) => c.key), ...w.shop.map((c) => c.key)]);
    const keys = set === "TAROT" ? Object.keys(TAROTS) : set === "SPECTRAL" ? Object.keys(SPECTRALS) : PLANETS.filter((p) => !p.secret || w.levels[p.hand].played > 0).map((p) => p.key);
    const free = keys.filter((k) => !taken.has(k));
    return free.length ? free : keys;
  }

  function newConsumable(set: "TAROT" | "PLANET" | "SPECTRAL", key?: string, exclude?: Set<string>): Item {
    const k = key ?? pick(w, set.toLowerCase(), consumablePool(set, exclude));
    const realSet: ItemSet = PLANET_BY_KEY.has(k) ? "PLANET" : TAROTS[k] ? "TAROT" : "SPECTRAL";
    return makeItem(k, realSet, labelOf(k), realSet === "SPECTRAL" ? 4 : 3);
  }

  /** A playing card: random rank and suit unless given; `enhanced` draws a random enhancement (no Stone). */
  function newCard(opts: { rank?: string; suit?: string; enhancement?: string; enhanced?: boolean; seal?: string } = {}): SimCard {
    return {
      id: w.id(),
      rank: opts.rank ?? pick(w, "card_rank", RANKS),
      suit: opts.suit ?? pick(w, "card_suit", SUITS),
      enhancement: opts.enhancement ?? (opts.enhanced ? pick(w, "card_enh", ENHANCEMENTS.filter((e) => e !== "STONE")) : undefined),
      seal: opts.seal,
    };
  }

  const cardItem = (c: SimCard, base = 1): Item => makeItem(`${c.suit}_${c.rank}`, c.enhancement ? "ENHANCED" : "DEFAULT", c.enhancement ? CARD_NAME[c.enhancement] : "Base Card", base, { edition: c.edition, card: c });

  /** A Standard pack card: 40% enhanced, editions at twice the rate, a seal one time in five. */
  function standardCard(): SimCard {
    const c = newCard({ enhancement: w.rng("std_set") > 0.6 ? pick(w, "std_enh", ENHANCEMENTS) : undefined });
    c.edition = pollEdition("std_edition", 2, true);
    if (w.rng("std_seal") > 1 - 0.02 * 10) {
      const t = w.rng("std_seal_type");
      c.seal = t > 0.75 ? "RED" : t > 0.5 ? "BLUE" : t > 0.25 ? "GOLD" : "PURPLE";
    }
    return c;
  }

  // -------------------------------------------------------------------------------------------
  // Effects jokers and consumables reach for
  // -------------------------------------------------------------------------------------------

  const fx: Fx = {
    earn: (n) => void (w.money += n),
    createConsumable(set, key) {
      if (w.consumables.length >= consumableSlots(w)) return false;
      w.consumables.push(newConsumable(set, key));
      return true;
    },
    createJoker(opts) {
      if (!opts.force && w.jokers.length >= jokerSlots(w)) return undefined;
      let j: Item;
      if (opts.from) {
        j = makeItem(opts.from.key, "JOKER", opts.from.label, opts.from.base, { edition: opts.from.edition === "NEGATIVE" ? undefined : opts.from.edition, eternal: opts.from.eternal, perishable: opts.from.perishable, rental: opts.from.rental });
        j.ab = structuredClone(opts.from.ab);
        j.ab.n.rounds = 0;
      } else j = newJoker({ rarity: opts.rarity, key: opts.key, edition: opts.edition });
      w.jokers.push(j);
      return j;
    },
    destroyJoker(j) {
      w.jokers = w.jokers.filter((x) => x !== j);
    },
    addCard(c, where) {
      if (!c.id) c.id = w.id();
      w.cards.push(c);
      (where === "hand" ? w.hand : w.draw).push(c);
      for (const j of w.jokers) hooksOf(j)?.cardAdded?.(j, w, 1);
    },
    destroyCards(cs) {
      const gone = new Set(cs);
      w.cards = w.cards.filter((c) => !gone.has(c));
      w.hand = w.hand.filter((c) => !gone.has(c));
      w.draw = w.draw.filter((c) => !gone.has(c));
      const glass = cs.filter((c) => c.enhancement === "GLASS").length;
      if (glass) for (const j of w.jokers) hooksOf(j)?.glassBroken?.(j, w, glass);
    },
    levelUp(hand, n) {
      const l = w.levels[hand];
      const b = BASE_HANDS[hand];
      const level = Math.max(1, l.level + n);
      w.levels[hand] = { ...l, level, chips: Math.max(0, b.chips + b.lchips * (level - 1)), mult: Math.max(1, b.mult + b.lmult * (level - 1)) };
    },
    newCard,
  };

  // -------------------------------------------------------------------------------------------
  // Blinds, bosses, tags
  // -------------------------------------------------------------------------------------------

  function newBoss(exclude?: string): string {
    let pool = bossPool(w.ante, w.bossesUsed);
    if (exclude && pool.length > 1) pool = pool.filter((b) => b.key !== exclude);
    const b = pick(w, "boss", pool);
    w.bossesUsed[b.key] = (w.bossesUsed[b.key] ?? 0) + 1;
    return b.key;
  }

  function newTag(): { key: string; hand?: HandName } {
    const pool = Object.keys(TAGS).filter((k) => TAGS[k].minAnte <= Math.max(1, w.ante));
    const key = pick(w, "tag", pool);
    const visible = HAND_NAMES.filter((h) => w.levels[h].visible);
    return key === "tag_orbital" ? { key, hand: pick(w, "orbital", visible) } : { key };
  }

  function newVoucher(): string | undefined {
    const inShop = new Set(w.shopVouchers.map((v) => v.key));
    const pool = Object.keys(VOUCHERS).filter((k) => !used(w, k) && !inShop.has(k) && k !== w.anteVoucher && (!VOUCHERS[k].requires || used(w, VOUCHERS[k].requires!)));
    return pool.length ? pick(w, "voucher", pool) : undefined;
  }

  /** A new ante: boss, tags and voucher; Pillar's memory clears. */
  function newAnte() {
    w.boss = newBoss();
    w.blindTags = [newTag(), newTag()];
    w.anteVoucher = newVoucher();
    w.bossRerolled = false;
    for (const c of w.cards) c.playedThisAnte = false;
  }

  /** Blind:disable: what the boss took comes back. */
  function disableBoss() {
    if (w.bossDisabled) return;
    const live = bossLive();
    const b = w.boss;
    w.bossDisabled = true;
    if (!live) return;
    if (b === "bl_water") w.discardsLeft += roundDiscards(w);
    if (b === "bl_needle") w.handsLeft += roundHands(w) - 1;
    if (b === "bl_wall") target = Math.floor(target / 2);
    if (b === "bl_final_vessel") target = Math.floor(target / 3);
    for (const c of w.hand) c.faceDown = false;
    for (const c of w.cards) c.forced = false;
    for (const j of w.jokers) j.hidden = false;
    heartOff = undefined;
    refreshDebuffs();
  }

  // -------------------------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------------------------

  /** Blind:stay_flipped for a card being drawn. */
  function drawnFaceDown(c: SimCard, firstDraw: boolean): boolean {
    if (!bossLive()) return false;
    if (w.boss === "bl_house") return firstDraw;
    if (w.boss === "bl_mark") return isFace(w, c);
    if (w.boss === "bl_fish") return bossPrepped;
    if (w.boss === "bl_wheel") return w.rng("wheel") < (2 ** count(w, "j_oops")) / 7;
    return false;
  }

  function drawCards(afterAction: boolean) {
    const firstDraw = w.handsPlayed === 0 && w.discardsUsed === 0 && !afterAction;
    const n = bossIs("bl_serpent") && afterAction ? Math.min(3, w.draw.length) : Math.max(0, handLimit() - w.hand.length);
    for (let i = 0; i < n && w.draw.length; i++) {
      const c = w.draw.shift()!;
      c.faceDown = drawnFaceDown(c, firstDraw);
      w.hand.push(c);
    }
    // Blind:drawn_to_hand: Cerulean Bell forces a card; Crimson Heart moves after each hand.
    if (bossIs("bl_final_bell") && w.hand.length && !w.hand.some((c) => c.forced)) pick(w, "cerulean_bell", w.hand).forced = true;
    if (bossIs("bl_final_heart") && bossPrepped && w.jokers.length) {
      const choices = w.jokers.filter((j) => j.id !== heartOff || w.jokers.length < 2);
      heartOff = pick(w, "crimson_heart", choices).id;
      refreshDebuffs();
    }
    bossPrepped = false;
  }

  // -------------------------------------------------------------------------------------------
  // The round
  // -------------------------------------------------------------------------------------------

  const pcardOf = (c: SimCard, index: number): PCard => {
    const stone = c.enhancement === "STONE";
    const p: PCard = { index, id: c.id, rank: stone ? undefined : c.rank, suit: stone ? undefined : c.suit, enhancement: c.enhancement, edition: c.edition, seal: c.seal, debuff: bossDebuffs(w, c), hidden: false, forced: false, label: "" };
    return p;
  };

  function scoringJokers(pre?: Map<Item, Record<string, number>>): Joker[] {
    const roll = () => w.rng("misprint");
    return w.jokers.map((j, index) => {
      const s = pre?.has(j) ? { key: j.key, stats: pre.get(j)! } : scoreStats(j, w, roll);
      return { index, key: s.key, label: j.label, effect: "", stats: s.stats, edition: j.edition, rarity: JOKER_RARITY[j.key], debuff: Boolean(j.debuff), eternal: Boolean(j.eternal), sell: sellValue(j) };
    });
  }

  function startRound() {
    w.status[w.blindIdx] = "CURRENT";
    w.round++;
    w.phase = "SELECTING_HAND";
    w.bossDisabled = false;
    bossPrepped = false;
    heartOff = undefined;
    w.handsPlayed = 0;
    w.discardsUsed = 0;
    w.chips = 0;
    w.eyeHands = new Set();
    w.mouthHand = undefined;
    for (const l of Object.values(w.levels)) l.played_this_round = 0;
    // The Ox reads the most played hand as the round begins; ties go to the higher hand.
    w.mostPlayed = HAND_NAMES.reduce((best, h) => (w.levels[h].played > w.levels[best].played ? h : best), HAND_NAMES[HAND_NAMES.length - 1] as HandName);
    for (const h of HAND_NAMES) if (w.levels[h].played === w.levels[w.mostPlayed].played && HAND_NAMES.indexOf(h) < HAND_NAMES.indexOf(w.mostPlayed)) w.mostPlayed = h;
    w.handsLeft = bossIs("bl_needle") ? 1 : roundHands(w);
    w.discardsLeft = bossIs("bl_water") ? 0 : roundDiscards(w);
    // Juggle Tags fire at the start of the round.
    const juggles = w.tags.filter((t) => t.key === "tag_juggle").length;
    w.roundHandSize = 3 * juggles;
    w.tags = w.tags.filter((t) => t.key !== "tag_juggle");
    target = blindScore(w.blindIdx);
    if (bossIs("bl_final_acorn")) {
      w.jokers = shuffle(w, "amber_acorn", w.jokers);
      for (const j of w.jokers) j.hidden = true;
    }
    refreshDebuffs();
    eachHook("blind", (h, j) => h(j, w, fx, w.blindIdx === 2));
    w.draw = shuffle(w, "shuffle", w.cards);
    w.hand = [];
    drawCards(false);
    // Certificate adds its card once the first hand is drawn.
    for (const j of w.jokers) {
      if (j.key !== "j_certificate" || j.debuff) continue;
      const t = w.rng("cert_seal");
      fx.addCard(newCard({ seal: t > 0.75 ? "RED" : t > 0.5 ? "BLUE" : t > 0.25 ? "GOLD" : "PURPLE" }), "hand");
    }
  }

  /** The Pillar, The Plant, suit bosses and Verdant Leaf: whether the boss fired on these cards. */
  const bossHit = (cards: SimCard[]) => cards.some((c) => bossDebuffs(w, c));

  function playHand(played: SimCard[]) {
    w.handsPlayedRun++;
    for (const c of played) c.faceDown = false;
    let bossFired = false;
    // Blind:press_play: The Tooth charges per card, The Hook discards two held cards first.
    if (bossIs("bl_tooth")) {
      w.money -= played.length;
      bossFired = true;
    }
    if (bossIs("bl_hook") && w.hand.length) {
      const hooked = shuffle(w, "hook", w.hand).slice(0, 2);
      w.hand = w.hand.filter((c) => !hooked.includes(c));
      discardEffects(hooked, true);
      bossFired = true;
    }
    if (bossIs("bl_fish") || bossIs("bl_final_heart")) bossPrepped = true;
    const sj = scoringJokers();
    const rules = rulesFromJokers(sj);
    const pcs = played.map(pcardOf);
    const ev = evaluateHand(pcs, rules);
    const hand = ev.hand;
    const lvl = w.levels[hand];
    const before = { played: lvl.played, thisRound: lvl.played_this_round };
    w.levels[hand] = { ...lvl, played: lvl.played + 1, played_this_round: lvl.played_this_round + 1, visible: true };
    // Blind:debuff_hand: hands the boss refuses score nothing; The Arm and The Ox act here.
    let blocked = false;
    if (bossLive()) {
      if (w.boss === "bl_psychic" && played.length < 5) blocked = true;
      if (w.boss === "bl_eye") {
        if (w.eyeHands.has(hand)) blocked = true;
        w.eyeHands.add(hand);
      }
      if (w.boss === "bl_mouth") {
        if (w.mouthHand && w.mouthHand !== hand) blocked = true;
        w.mouthHand ??= hand;
      }
      if (w.boss === "bl_arm" && w.levels[hand].level > 1) {
        fx.levelUp(hand, -1);
        bossFired = true;
      }
      if (w.boss === "bl_ox" && hand === w.mostPlayed) {
        w.money = 0;
        bossFired = true;
      }
      if (w.boss === "bl_flint" || bossHit(played)) bossFired = true;
    }
    if (blocked || bossFired) for (let i = 0; i < count(w, "j_matador"); i++) fx.earn(8);
    const scoringCards = ev.scoring.map((p) => played[p.index]);
    const triggers = new Map<SimCard, number>();
    const keys = effectiveKeys();
    scoringCards.forEach((c, i) => {
      if (bossDebuffs(w, c)) return void triggers.set(c, 0);
      let t = 1 + (c.seal === "RED" ? 1 : 0);
      for (const k of keys) {
        if (k === "j_hack" && c.enhancement !== "STONE" && ["2", "3", "4", "5"].includes(c.rank)) t++;
        if (k === "j_sock_and_buskin" && isFace(w, c)) t++;
        if (k === "j_hanging_chad" && i === 0) t += 2;
        if (k === "j_selzer") t++;
        if (k === "j_dusk" && w.handsLeft <= 1) t++;
      }
      triggers.set(c, t);
    });
    const p: Play = { played, scoring: scoringCards, hand, contains: ev.contains, held: [...w.hand], first: w.handsPlayed === 0, handsLeft: w.handsLeft, triggers, luckyHits: 0 };
    let score = 0;
    if (!blocked) {
      // The evaluator steps these itself from what the mod reports before the hand (poker.ts).
      const pre = new Map(w.jokers.filter((j) => EVALUATOR_STEPS.has(j.key)).map((j) => [j, modStats(j, w) ?? {}] as const));
      for (const j of [...w.jokers]) if (w.jokers.includes(j)) hooksOf(j)?.before?.(j, w, fx, p);
      // Each Lucky Card trigger's roll for +20 Mult, kept so the score uses the same rolls as Lucky Cat.
      const lucky = new Map<number, boolean[]>();
      // Card triggers: money, Lucky rolls and Wee's growth land before the jokers score.
      for (const c of scoringCards) {
        for (let t = 0; t < (triggers.get(c) ?? 0); t++) {
          if (c.seal === "GOLD") fx.earn(3);
          if (c.enhancement === "LUCKY") {
            const hitMult = w.rng("lucky_mult") < (2 ** count(w, "j_oops")) / 5;
            lucky.set(c.id, [...(lucky.get(c.id) ?? []), hitMult]);
            const hitMoney = w.rng("lucky_money") < (2 ** count(w, "j_oops")) / 15;
            if (hitMoney) fx.earn(20);
            if (hitMult || hitMoney) p.luckyHits++;
          }
          eachHook("scored", (h, j) => h(j, w, fx, c, p));
        }
      }
      for (const j of w.jokers) if (j.key === "j_lucky_cat" && !j.debuff) j.ab.x_mult = Math.round((j.ab.x_mult + 0.25 * p.luckyHits) * 100) / 100;
      const mimes = keys.filter((k) => k === "j_mime").length;
      for (const c of w.hand) {
        if (bossDebuffs(w, c)) continue;
        for (let t = 0; t < 1 + (c.seal === "RED" ? 1 : 0) + mimes; t++) eachHook("held", (h, j) => h(j, w, fx, c));
      }
      score = scoreOf(played, hand, before, pre, lucky);
    }
    w.chips += score;
    for (const c of played) c.playedThisAnte = true;
    if (!blocked) {
      eachHook("after", (h, j) => h(j, w, fx, p));
      // Glass Cards that scored may shatter.
      const broken = scoringCards.filter((c) => c.enhancement === "GLASS" && (triggers.get(c) ?? 0) > 0 && w.rng("glass") < (2 ** count(w, "j_oops")) / 4);
      if (broken.length) fx.destroyCards(broken);
    }
    w.handsLeft--;
    w.handsPlayed++;
    w.lastHand = hand;
  }

  /** The hand's score from the evaluator, on the true cards and the jokers' live values. */
  function scoreOf(played: SimCard[], hand: HandName, before: { played: number; thisRound: number }, pre?: Map<Item, Record<string, number>>, lucky?: Map<number, boolean[]>): number {
    const sj = scoringJokers(pre);
    const levels = { ...w.levels };
    // The counts as they stood before this hand, as the mod reports them: the evaluator adds this
    // hand for Supernova, and Card Sharp asks whether it was played earlier this round.
    const l = { ...levels[hand], played: before.played, played_this_round: before.thisRound };
    if (bossIs("bl_flint")) Object.assign(l, { chips: Math.max(0, Math.floor(l.chips * 0.5 + 0.5)), mult: Math.max(1, Math.floor(l.mult * 0.5 + 0.5)) });
    levels[hand] = l;
    const pcs = played.map(pcardOf);
    const held = w.hand.map((c, i) => pcardOf(c, i));
    const all = w.cards.map(pcardOf);
    const est = estimateScore(pcs, {
      levels,
      jokers: sj,
      held,
      rules: rulesFromJokers(sj),
      handsLeft: w.handsLeft,
      discardsLeft: w.discardsLeft,
      balanced: w.deck === "PLASMA",
      deck: deckCounts(all, w.draw.length, w.startSize),
      money: w.money,
      roundCards: { ancientSuit: w.ancientSuit, idolRank: w.idol.rank, idolSuit: w.idol.suit },
      // The real rolls, not the evaluator's expectations.
      chance: (kind, card, t) => (kind === "lucky" ? (lucky?.get(card.id)?.[t] ?? false) : w.rng("bloodstone") < (2 ** count(w, "j_oops")) / 2),
    });
    // Observatory: each held Planet for this hand gives X1.5, after the jokers.
    const obs = used(w, "v_observatory") ? w.consumables.filter((c) => PLANET_BY_KEY.get(c.key)?.hand === hand).length : 0;
    return Math.floor(est.score * 1.5 ** obs);
  }

  /** Discard context for every joker and seal; `hook` for The Hook's (no discard used). */
  function discardEffects(cards: SimCard[], hook: boolean) {
    const first = w.discardsUsed === 0;
    if (!hook && first) {
      // Burnt Joker levels the first discard's poker hand.
      const n = count(w, "j_burnt");
      if (n) fx.levelUp(evaluateHand(cards.map(pcardOf), rulesFromJokers(scoringJokers())).hand, n);
    }
    for (const j of [...w.jokers]) if (w.jokers.includes(j)) hooksOf(j)?.discard?.(j, w, fx, cards, first, hook);
    for (const j of w.jokers) {
      const src = copied(j);
      if (src && COPYABLE.has(src.key)) HOOKS[src.key]?.discard?.(src, w, fx, cards, first, hook);
    }
    for (const c of cards) if (c.seal === "PURPLE" && !bossDebuffs(w, c)) fx.createConsumable("TAROT");
  }

  function endRound(saved: boolean) {
    const boss = w.blindIdx === 2;
    w.status[w.blindIdx] = "DEFEATED";
    w.phase = "ROUND_EVAL";
    eachHook("endRound", (h, j) => h(j, w, fx, boss));
    // Rentals charge and Perishables count down before anything is paid.
    for (const j of w.jokers) {
      if (j.rental) w.money -= 3;
      if (j.perishable !== undefined && !j.ab.n.perished) {
        j.perishable--;
        if (j.perishable <= 0) j.ab.n.perished = 1;
      }
    }
    heartOff = undefined;
    refreshDebuffs();
    // Held cards: Gold Cards pay, Blue Seals make the Planet for the last hand.
    const mimes = effectiveKeys().filter((k) => k === "j_mime").length;
    for (const c of w.hand) {
      if (bossDebuffs(w, c)) continue;
      if (c.enhancement === "GOLD") fx.earn(3 * (1 + (c.seal === "RED" ? 1 : 0) + mimes));
      if (c.seal === "BLUE" && w.lastHand) {
        const planet = PLANETS.find((x) => x.hand === w.lastHand);
        if (planet) fx.createConsumable("PLANET", planet.key);
      }
    }
    w.unusedDiscardsRun += w.discardsLeft;
    // The cash out, as the round eval screen lists it.
    const lines: World["cashout"]["lines"] = [];
    const reward = saved ? 0 : w.blindIdx === 0 && stakeAtLeast(w.stake, "RED") ? 0 : [3, 4, 5][w.blindIdx];
    lines.push({ kind: "blind", label: "blind", dollars: reward });
    if (w.handsLeft > 0) lines.push({ kind: "hands", label: "hands", dollars: w.handsLeft * (w.deck === "GREEN" ? 2 : 1) });
    if (w.discardsLeft > 0 && w.deck === "GREEN") lines.push({ kind: "discards", label: "discards", dollars: w.discardsLeft });
    for (const j of w.jokers) {
      const d = hooksOf(j)?.dollars?.(j, w) ?? 0;
      if (d) lines.push({ kind: "joker", label: j.label, dollars: d, key: j.key });
    }
    const i = interest();
    if (i) lines.push({ kind: "interest", label: "interest", dollars: i });
    let investment = 0;
    if (boss) {
      investment = 25 * w.tags.filter((t) => t.key === "tag_investment").length;
      w.tags = w.tags.filter((t) => t.key !== "tag_investment");
      w.money += investment;
    }
    w.cashout = { total: lines.reduce((a, l) => a + l.dollars, 0), lines, investment };
    // The game re-picks the round's cards at the end of every round.
    const real = w.cards.filter((c) => c.enhancement !== "STONE");
    w.ancientSuit = pick(w, "ancient", SUITS.filter((s) => s !== w.ancientSuit));
    if (real.length) {
      const idol = pick(w, "idol", real);
      w.idol = { rank: idol.rank, suit: idol.suit };
      w.castleSuit = pick(w, "castle", real).suit;
      w.mailRank = pick(w, "mail", real).rank;
    }
    w.todoHand = pick(w, "todo", HAND_NAMES.filter((h) => w.levels[h].visible && h !== w.todoHand));
    // Every card goes back to the deck.
    for (const c of w.cards) {
      c.faceDown = false;
      c.forced = false;
    }
    for (const j of w.jokers) j.hidden = false;
    w.draw = [...w.cards];
    w.hand = [];
    w.roundHandSize = 0;
    if (boss) {
      if (w.ante >= 8) {
        w.won = true;
        w.result = "Victory";
        w.phase = "GAME_OVER";
        return;
      }
      w.ante++;
      newAnte();
      if (w.deck === "ANAGLYPH") addTag({ key: "tag_double" });
    }
  }

  // -------------------------------------------------------------------------------------------
  // Tags
  // -------------------------------------------------------------------------------------------

  function addTag(tag: { key: string; hand?: HandName }) {
    // Each held Double Tag copies the next tag gained (not another Double Tag).
    if (tag.key !== "tag_double") {
      const doubles = w.tags.filter((t) => t.key === "tag_double").length;
      w.tags = w.tags.filter((t) => t.key !== "tag_double");
      for (let i = 0; i < doubles; i++) w.tags.push({ ...tag });
    }
    w.tags.push({ ...tag });
  }

  /** Tags that act the moment they are gained. */
  function immediateTags() {
    const keep: World["tags"] = [];
    for (const t of w.tags) {
      if (t.key === "tag_economy") w.money += Math.min(40, Math.max(0, w.money));
      else if (t.key === "tag_handy") w.money += w.handsPlayedRun;
      else if (t.key === "tag_garbage") w.money += w.unusedDiscardsRun;
      else if (t.key === "tag_skip") w.money += 5 * w.skips;
      else if (t.key === "tag_top_up") for (let i = 0; i < 2; i++) fx.createJoker({ rarity: "COMMON" });
      else if (t.key === "tag_orbital") fx.levelUp(t.hand ?? "High Card", 3);
      else keep.push(t);
    }
    w.tags = keep;
  }

  /** new_blind_choice: the Boss Tag rerolls the boss; one pack tag opens its pack. */
  function blindChoiceTags() {
    while (w.tags.some((t) => t.key === "tag_boss")) {
      w.tags.splice(w.tags.findIndex((t) => t.key === "tag_boss"), 1);
      if (w.status[2] !== "DEFEATED") w.boss = newBoss(w.boss);
    }
    const i = w.tags.findIndex((t) => PACK_TAGS[t.key]);
    if (i < 0) return;
    const [t] = w.tags.splice(i, 1);
    openPack(PACK_BY_KEY.get(PACK_TAGS[t.key])!, "BLIND_SELECT");
  }

  // -------------------------------------------------------------------------------------------
  // Shop and packs
  // -------------------------------------------------------------------------------------------

  /** create_card_for_shop: a tag's joker first, else a card type by the shop's rates. */
  function shopCard(): Item {
    const rare = w.tags.findIndex((t) => t.key === "tag_uncommon" || t.key === "tag_rare");
    let card: Item;
    if (rare >= 0) {
      const [t] = w.tags.splice(rare, 1);
      card = newJoker({ rarity: t.key === "tag_rare" ? "RARE" : "UNCOMMON", area: "shop" });
      card.couponed = true;
    } else {
      const tarot = used(w, "v_tarot_tycoon") ? 32 : used(w, "v_tarot_merchant") ? 9.6 : 4;
      const planet = used(w, "v_planet_tycoon") ? 32 : used(w, "v_planet_merchant") ? 9.6 : 4;
      const playing = used(w, "v_magic_trick") ? 4 : 0;
      const spectral = w.deck === "GHOST" ? 2 : 0;
      const roll = w.rng("shop_type") * (20 + tarot + planet + playing + spectral);
      if (roll <= 20) card = newJoker({ area: "shop" });
      else if (roll <= 20 + tarot) card = newConsumable("TAROT");
      else if (roll <= 20 + tarot + planet) card = newConsumable("PLANET");
      else if (roll <= 20 + tarot + planet + playing) {
        const illusion = used(w, "v_illusion");
        const c = newCard({ enhancement: illusion && w.rng("illusion") > 0.6 ? pick(w, "illusion", ENHANCEMENTS) : undefined });
        if (illusion && w.rng("illusion") > 0.8) {
          const r = w.rng("illusion");
          c.edition = r > 0.85 ? "POLYCHROME" : r > 0.5 ? "HOLO" : "FOIL";
        }
        card = cardItem(c);
      } else card = newConsumable("SPECTRAL");
    }
    // Edition tags: the next base-edition joker takes the edition and is free.
    if (card.set === "JOKER" && !card.edition) {
      const e = w.tags.findIndex((t) => ["tag_foil", "tag_holo", "tag_polychrome", "tag_negative"].includes(t.key));
      if (e >= 0) {
        const [t] = w.tags.splice(e, 1);
        card.edition = ({ tag_foil: "FOIL", tag_holo: "HOLO", tag_polychrome: "POLYCHROME", tag_negative: "NEGATIVE" } as const)[t.key as "tag_foil"];
        card.couponed = true;
        price(w, card);
      }
    }
    return card;
  }

  function newPackItem(spec: PackSpec): Item {
    const c = PACK_BY_KEY.get(spec.key)!;
    return makeItem(c.key, "BOOSTER", packLabel(c), c.cost);
  }

  /** get_pack: the first shop of a run always has a Buffoon Pack; then by the packs' weights. */
  function shopPack(first: boolean): Item {
    if (first) return newPackItem(PACK_BY_KEY.get(`p_buffoon_normal_${1 + Math.floor(w.rng("pack") * 2)}`)!);
    const total = PACKS.reduce((a, p) => a + p.weight, 0);
    let r = w.rng("pack") * total;
    for (const p of PACKS) {
      r -= p.weight;
      if (r <= 0) return newPackItem(p);
    }
    return newPackItem(PACKS[0]);
  }

  let firstShop = true;
  function openShop() {
    w.phase = "SHOP";
    w.rerollIncrease = 0;
    w.freeRerolls = count(w, "j_chaos");
    w.rerollStart = undefined;
    w.shop = [];
    for (let i = 0; i < shopSlots(w); i++) w.shop.push(shopCard());
    w.shopVouchers = [];
    if (w.anteVoucher) w.shopVouchers.push(makeItem(w.anteVoucher, "VOUCHER", VOUCHERS[w.anteVoucher].label, 10));
    for (const t of w.tags.filter((t) => t.key === "tag_voucher")) {
      const v = newVoucher();
      if (v) w.shopVouchers.push(makeItem(v, "VOUCHER", VOUCHERS[v].label, 10));
      w.tags.splice(w.tags.indexOf(t), 1);
    }
    w.shopPacks = [shopPack(firstShop), shopPack(false)];
    firstShop = false;
    if (w.tags.some((t) => t.key === "tag_coupon")) {
      for (const it of [...w.shop, ...w.shopPacks]) it.couponed = true;
      w.tags = w.tags.filter((t) => t.key !== "tag_coupon");
    }
    if (w.tags.some((t) => t.key === "tag_d_six")) {
      w.rerollStart = 0;
      w.tags = w.tags.filter((t) => t.key !== "tag_d_six");
    }
  }

  const reprice = () => {
    for (const it of [...w.shop, ...w.shopVouchers, ...w.shopPacks]) price(w, it);
  };

  function packContents(spec: PackSpec): Item[] {
    const out: Item[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < spec.cards; i++) {
      let it: Item;
      if (spec.kind === "Buffoon") it = newJoker({ area: "pack" });
      else if (spec.kind === "Standard") it = cardItem(standardCard());
      else if (spec.kind === "Celestial") {
        // Telescope: the first card is the Planet of the most played hand (the stronger on a tie).
        const top = HAND_NAMES.filter((h) => w.levels[h].visible).reduce<HandName | undefined>((b, h) => (w.levels[h].played > (b ? w.levels[b].played : 0) ? h : b), undefined);
        if (i === 0 && used(w, "v_telescope") && top) it = newConsumable("PLANET", PLANETS.find((p) => p.hand === top)!.key);
        else if (w.rng("black_hole") > 0.997) it = makeItem("c_black_hole", "SPECTRAL", labelOf("c_black_hole"), 4);
        else it = newConsumable("PLANET", undefined, seen);
      } else if (spec.kind === "Spectral") {
        it = w.rng("black_hole") > 0.997 ? makeItem("c_black_hole", "SPECTRAL", labelOf("c_black_hole"), 4) : newConsumable("SPECTRAL", undefined, seen);
      } else {
        it = used(w, "v_omen_globe") && w.rng("omen_globe") > 0.8 ? newConsumable("SPECTRAL", undefined, seen) : newConsumable("TAROT", undefined, seen);
      }
      seen.add(it.key);
      out.push(it);
    }
    return out;
  }

  function openPack(spec: PackSpec, from: "SHOP" | "BLIND_SELECT") {
    w.pack = { key: spec.key, kind: spec.kind, items: [], choices: spec.choose, from };
    w.pack.items = packContents(spec);
    w.phase = "SMODS_BOOSTER_OPENED";
    // Arcana and Spectral packs deal a hand from the deck to use them on.
    if (spec.kind === "Arcana" || spec.kind === "Spectral") {
      w.draw = shuffle(w, "pack_shuffle", w.cards);
      w.hand = w.draw.splice(0, handSize(w));
    }
    eachHook("packOpened", (h, j) => h(j, w, fx));
  }

  function closePack() {
    const from = w.pack!.from;
    w.pack = undefined;
    w.draw = [...w.cards];
    w.hand = [];
    w.phase = from;
    if (from === "BLIND_SELECT") blindChoiceTags();
  }

  // -------------------------------------------------------------------------------------------
  // Run start
  // -------------------------------------------------------------------------------------------

  function deckCards(deck: string): SimCard[] {
    if (deck === "ERRATIC") return Array.from({ length: 52 }, () => newCard({ rank: pick(w, "erratic", RANKS), suit: pick(w, "erratic", SUITS) }));
    const suits = deck === "CHECKERED" ? ["S", "H", "S", "H"] : [...SUITS];
    const ranks = deck === "ABANDONED" ? RANKS.filter((r) => !["J", "Q", "K"].includes(r)) : [...RANKS];
    return suits.flatMap((suit) => ranks.map((rank) => ({ id: w.id(), rank, suit })));
  }

  function startRun(seed: string, stake: string, deck: string) {
    w = blankWorld(seed, stake, deck);
    firstShop = true;
    heartOff = undefined;
    w.cards = deckCards(deck);
    w.startSize = w.cards.length;
    w.draw = [...w.cards];
    if (deck === "YELLOW") w.money += 10;
    if (deck === "MAGIC") {
      w.vouchers.push("v_crystal_ball");
      for (let i = 0; i < 2; i++) w.consumables.push(newConsumable("TAROT", "c_fool"));
    }
    if (deck === "NEBULA") w.vouchers.push("v_telescope");
    if (deck === "ZODIAC") w.vouchers.push("v_tarot_merchant", "v_planet_merchant", "v_overstock_norm");
    if (deck === "GHOST") w.consumables.push(newConsumable("SPECTRAL", "c_hex"));
    const real = w.cards.filter((c) => c.enhancement !== "STONE");
    const idol = pick(w, "idol", real);
    w.idol = { rank: idol.rank, suit: idol.suit };
    w.ancientSuit = pick(w, "ancient", SUITS);
    w.castleSuit = pick(w, "castle", real).suit;
    w.mailRank = pick(w, "mail", real).rank;
    w.todoHand = pick(w, "todo", HAND_NAMES.filter((h) => w.levels[h].visible));
    newAnte();
    w.handsLeft = roundHands(w);
    w.discardsLeft = roundDiscards(w);
    w.phase = "BLIND_SELECT";
  }

  // -------------------------------------------------------------------------------------------
  // GameState, as the mod builds it
  // -------------------------------------------------------------------------------------------

  const cardKey = (c: SimCard) => `${c.suit}_${c.rank}`;
  const sortCards = (cs: SimCard[]) => [...cs].sort((a, b) => (cardKey(a) < cardKey(b) ? -1 : cardKey(a) > cardKey(b) ? 1 : a.id - b.id));

  function cardEffect(c: SimCard): string {
    const parts = [c.enhancement === "STONE" ? "+50 chips no rank or suit" : `+${rankChips(c.rank)} chips`];
    if (c.enhancement && CARD_TEXT[c.enhancement]) parts.push(CARD_TEXT[c.enhancement]);
    if (c.edition && EDITION_TEXT[c.edition]) parts.push(EDITION_TEXT[c.edition]);
    if (c.seal) parts.push(SEAL_TEXT[c.seal]);
    return parts.join(" ");
  }

  /** A playing card; `masked` hides it the way the mod hides a face-down card in hand. */
  function rawPlaying(c: SimCard, opts: { masked?: boolean; faceDown?: boolean; cost?: RawCard["cost"] } = {}): RawCard {
    const state: RawCard["state"] = {};
    if (bossDebuffs(w, c)) state.debuff = true;
    if (opts.faceDown || opts.masked) state.hidden = true;
    if (c.forced) state.forced_selection = true;
    const cost = opts.cost ?? { sell: 1, buy: 1 };
    if (opts.masked) return { id: c.id, key: "", set: "DEFAULT", label: "", value: { effect: "" }, modifier: {}, state, cost };
    const modifier: RawCard["modifier"] = {};
    if (c.seal) modifier.seal = c.seal;
    if (c.edition) modifier.edition = c.edition;
    if (c.enhancement) modifier.enhancement = c.enhancement;
    return {
      id: c.id,
      key: cardKey(c),
      set: c.enhancement ? "ENHANCED" : "DEFAULT",
      label: c.enhancement ? CARD_NAME[c.enhancement] : "Base Card",
      value: { suit: c.suit, rank: c.rank, effect: cardEffect(c) },
      modifier,
      state,
      cost,
    };
  }

  function itemEffect(it: Item): string {
    if (it.set === "JOKER") return jokerText(it, w);
    if (it.set === "PLANET") {
      const p = PLANET_BY_KEY.get(it.key)!;
      return planetText(p.hand, w.levels[p.hand].level);
    }
    if (it.set === "VOUCHER") return VOUCHERS[it.key]?.text ?? "";
    if (it.set === "BOOSTER") return packText(PACK_BY_KEY.get(it.key)!);
    const spec = specOf(it.key);
    const t = spec?.text ?? "";
    return typeof t === "function" ? t(w) : t;
  }

  function rawItem(it: Item, where: "owned" | "shop" | "pack"): RawCard {
    const sell = sellValue(it);
    const cost: RawCard["cost"] & Record<string, unknown> =
      where === "pack" ? { buy: 0, free: true, sell, original_buy: it.cost, reason: "booster_pick" } : { buy: where === "shop" ? askPrice(it) : it.cost, sell };
    if (it.card) return rawPlaying(it.card, { cost });
    if (it.hidden) return { id: it.id, key: "", set: "DEFAULT", label: "", value: { effect: "" }, modifier: {}, state: { hidden: true }, cost };
    const value: RawCard["value"] = { effect: itemEffect(it) };
    if (it.set === "JOKER") {
      const stats = modStats(it, w);
      if (stats) value.stats = stats;
      value.rarity = JOKER_RARITY[it.key];
    }
    const spec = it.set === "TAROT" || it.set === "SPECTRAL" ? specOf(it.key) : undefined;
    if (spec?.max) Object.assign(value, { target_min: spec.min ?? 1, target_max: spec.max });
    if (spec?.needsJoker) value.requires_jokers_min = 1;
    if (spec?.randomJoker) value.random_joker_effect = true;
    if (it.key === "c_fool") Object.assign(value, { copy_key: w.lastTarotPlanet ?? "", ...(w.lastTarotPlanet ? { copy_label: labelOf(w.lastTarotPlanet) } : {}) });
    const modifier: RawCard["modifier"] = {};
    if (it.edition) modifier.edition = it.edition;
    if (it.eternal) modifier.eternal = true;
    if (it.perishable) modifier.perishable = it.perishable;
    if (it.rental) Object.assign(modifier, { rental: true, rental_cost: 3 });
    const state: RawCard["state"] = it.debuff ? { debuff: true } : {};
    return { id: it.id, key: it.key, set: it.set, label: it.label, value, modifier, state, cost };
  }

  const area = (cards: RawCard[], limit: number, extra: Partial<Area> = {}): Area => ({ count: cards.length, limit, cards, ...extra });

  function blindRaw(idx: number): Blind {
    const name = idx === 2 ? bossName(w.boss) : idx === 1 ? "Big Blind" : "Small Blind";
    const t = w.blindTags[idx];
    const effect = idx === 2 ? (typeof BOSS_TEXT[w.boss] === "function" ? (BOSS_TEXT[w.boss] as (w: World) => string)(w) : (BOSS_TEXT[w.boss] as string)) : "";
    return {
      type: (["SMALL", "BIG", "BOSS"] as const)[idx],
      status: w.status[idx],
      name,
      effect,
      score: blindScore(idx),
      tag_key: idx < 2 && t ? t.key : "",
      tag_name: idx < 2 && t ? TAGS[t.key].name : "",
      tag_effect: idx < 2 && t ? tagText(t) : "",
    };
  }

  const tagText = (t: { key: string; hand?: HandName }, held = false) => {
    const x = TAGS[t.key].text;
    return typeof x === "function" ? x(w, held ? t.hand : undefined) : x;
  };

  function state(): GameState {
    const gs: GameState = { state: w.phase, held_tags_ready: true };
    if (w.phase === "MENU") return gs;
    const inShop = w.phase === "SHOP" || (w.phase === "SMODS_BOOSTER_OPENED" && w.pack?.from === "SHOP");
    const inHand = new Set(w.hand);
    Object.assign(gs, {
      round_num: w.round,
      ante_num: w.ante,
      money: w.money,
      bankrupt_at: bankrupt(),
      deck: w.deck,
      stake: w.stake,
      seed: w.seed,
      won: w.won,
      used_vouchers: Object.fromEntries(w.vouchers.map((v) => [v, ""])),
      bosses_used: [],
      hands: Object.fromEntries(HAND_NAMES.map((h, i) => [h, { order: i + 1, ...w.levels[h] }])),
      round: {
        hands_left: w.handsLeft,
        hands_played: w.handsPlayed,
        discards_left: w.discardsLeft,
        discards_used: w.discardsUsed,
        reroll_cost: rerollCost(),
        boss_reroll_cost: 10,
        boss_rerolled: w.bossRerolled,
        ...(w.phase === "BLIND_SELECT" ? { boss_reroll_available: bossRerollAvailable() } : {}),
        chips: w.chips,
        ancient_suit: w.ancientSuit,
        idol_rank: w.idol.rank,
        idol_suit: w.idol.suit,
        castle_suit: w.castleSuit,
        ...(w.phase === "ROUND_EVAL" ? { cashout_preview: { total: w.cashout.total, lines: w.cashout.lines, ...(w.cashout.investment ? { investment_received: w.cashout.investment } : {}) } } : {}),
      },
      run: { skips: w.skips, deck_size: w.cards.length, starting_deck_size: w.startSize, tarot_used: w.tarotUsed },
      blinds: { small: blindRaw(0), big: blindRaw(1), boss: blindRaw(2) },
      jokers: area(w.jokers.map((j) => rawItem(j, "owned")), jokerSlots(w), { highlighted_limit: 1 }),
      consumables: area(w.consumables.map((c) => rawItem(c, "owned")), consumableSlots(w), { highlighted_limit: 1 }),
      cards: area(sortCards(w.draw).map((c) => rawPlaying(c, { faceDown: true })), w.cards.length),
      full_deck: area(sortCards(w.cards).map((c) => rawPlaying(c, { faceDown: !inHand.has(c) || Boolean(c.faceDown) })), w.cards.length),
      hand: area(w.hand.map((c) => rawPlaying(c, { masked: c.faceDown })), handLimit(), { highlighted_limit: 5 }),
      held_tags: w.tags.map((t) => ({ key: t.key, name: TAGS[t.key].name, effect: tagText(t, true) })),
    } satisfies Partial<GameState>);
    if (inShop) {
      gs.shop = area(w.shop.map((o) => rawItem(o, "shop")), shopSlots(w), { highlighted_limit: 1 });
      gs.vouchers = area(w.shopVouchers.map((o) => rawItem(o, "shop")), Math.max(1, w.shopVouchers.length), { highlighted_limit: 1 });
      gs.packs = area(w.shopPacks.map((o) => rawItem(o, "shop")), 2, { highlighted_limit: 1 });
    }
    if (w.pack) {
      gs.pack = area(w.pack.items.map((o) => rawItem(o, "pack")), PACK_BY_KEY.get(w.pack.key)!.cards, { highlighted_limit: 1, ...(w.pack.choices > 0 ? { choices_remaining: w.pack.choices } : {}) });
      gs.pack_ready = true;
      gs.pack_hand_ready = true;
    }
    if (w.phase === "GAME_OVER") gs.run_summary = { result: w.result };
    return gs;
  }

  const bossName = (key: string) => BOSS_NAMES.get(key) ?? "Boss Blind";

  function bossRerollAvailable(): boolean {
    if (w.phase !== "BLIND_SELECT" || w.blindIdx !== 2 || w.status[2] === "DEFEATED") return false;
    const voucher = used(w, "v_retcon") || (used(w, "v_directors_cut") && !w.bossRerolled);
    return voucher && buyingPower() >= 10;
  }

  // -------------------------------------------------------------------------------------------
  // Methods
  // -------------------------------------------------------------------------------------------

  const intList = (params: Record<string, unknown> | undefined, key: string): number[] | undefined => {
    const v = params?.[key];
    if (v === undefined) return undefined;
    if (!Array.isArray(v)) return fail("BAD_REQUEST", `${key} must be an array`);
    return v.map(Number);
  };
  const handIndices = (xs: number[], label = "card") => {
    const seen = new Set<number>();
    for (const i of xs) {
      if (!Number.isInteger(i) || i < 0 || i >= w.hand.length) fail("BAD_REQUEST", `Invalid ${label} index: ${i}`);
      if (seen.has(i)) fail("BAD_REQUEST", `Duplicate ${label} index: ${i}`);
      seen.add(i);
    }
    return xs;
  };

  function afterHandPlayed() {
    if (w.chips >= target) return endRound(false);
    if (w.handsLeft <= 0) {
      // Mr. Bones saves a round that reached a quarter of the blind, and is gone.
      const bones = w.jokers.find((j) => j.key === "j_mr_bones" && !j.debuff);
      if (bones && w.chips >= target / 4) {
        fx.destroyJoker(bones);
        return endRound(true);
      }
      w.result = `Lost to ${blindRaw(w.blindIdx).name}`;
      w.phase = "GAME_OVER";
      return;
    }
    drawCards(true);
  }

  const methods: Record<string, (p?: Record<string, unknown>) => unknown> = {
    health: () => ({ status: "ok" }),
    gamestate: () => state(),
    menu: () => {
      w.phase = "MENU";
      w.pack = undefined;
      return state();
    },
    start: (p) => {
      need("MENU");
      const stake = typeof p?.stake === "string" ? p.stake : "";
      const deck = typeof p?.deck === "string" ? p.deck : "";
      if (stakeIndex(stake) < 0) fail("BAD_REQUEST", `Invalid stake enum. Got: ${stake}`);
      if (!DECKS.has(deck)) fail("BAD_REQUEST", `Invalid deck enum. Got: ${deck}`);
      startRun(typeof p?.seed === "string" && p.seed ? p.seed : `SIM${Math.floor(menuRng("seed") * 1e6)}`, stake, deck);
      return state();
    },
    select: () => {
      need("BLIND_SELECT");
      startRound();
      return state();
    },
    skip: () => {
      need("BLIND_SELECT");
      if (w.blindIdx === 2) fail("NOT_ALLOWED", "Cannot skip Boss blind");
      const tag = w.blindTags[w.blindIdx];
      w.skips++;
      w.status[w.blindIdx] = "SKIPPED";
      w.blindIdx++;
      w.status[w.blindIdx] = "SELECT";
      addTag(tag);
      immediateTags();
      blindChoiceTags();
      return state();
    },
    reroll_boss: () => {
      need("BLIND_SELECT");
      if (w.blindIdx !== 2) fail("NOT_ALLOWED", "Boss reroll is only available when the Boss blind is on deck");
      if (w.status[2] === "DEFEATED" || w.status[2] === "SKIPPED") fail("NOT_ALLOWED", "Boss blind is no longer selectable");
      if (!(used(w, "v_retcon") || (used(w, "v_directors_cut") && !w.bossRerolled))) fail("NOT_ALLOWED", "Boss reroll requires Director's Cut or Retcon voucher (or already used this ante)");
      if (buyingPower() < 10) fail("NOT_ALLOWED", `Not enough dollars to reroll boss. Available: ${buyingPower()}, Required: 10`);
      w.money -= 10;
      w.boss = newBoss(w.boss);
      w.bossRerolled = true;
      return state();
    },
    play: (p) => {
      need("SELECTING_HAND");
      const xs = intList(p, "cards");
      if (!xs?.length) fail("BAD_REQUEST", "Must provide at least one card to play");
      if (xs!.length > 5) fail("BAD_REQUEST", "You can only play 5 cards");
      handIndices(xs!);
      // Cerulean Bell's card stays selected: it plays last, and leaves room for four others.
      const forced = w.hand.findIndex((c) => c.forced);
      let order = xs!;
      if (forced >= 0) order = [...order.filter((i) => i !== forced).slice(0, 4), forced];
      const played = order.map((i) => w.hand[i]);
      w.hand = w.hand.filter((c) => !played.includes(c));
      for (const c of played) c.forced = false;
      playHand(played);
      afterHandPlayed();
      return state();
    },
    discard: (p) => {
      need("SELECTING_HAND");
      const xs = intList(p, "cards");
      if (!xs?.length) fail("BAD_REQUEST", "Must provide at least one card to discard");
      if (w.discardsLeft <= 0) fail("BAD_REQUEST", "No discards left");
      if (xs!.length > 5) fail("BAD_REQUEST", "You can only discard 5 cards");
      handIndices(xs!);
      // Cerulean Bell's card is selected too, so it goes with the discard.
      const forced = w.hand.findIndex((c) => c.forced);
      const order = forced >= 0 ? [...xs!.filter((i) => i !== forced).slice(0, 4), forced] : xs!;
      const cards = order.map((i) => w.hand[i]);
      for (const c of cards) c.forced = false;
      w.hand = w.hand.filter((c) => !cards.includes(c));
      // Green Joker and friends see the discard before it counts.
      discardEffects(cards, false);
      w.discardsLeft--;
      w.discardsUsed++;
      drawCards(true);
      return state();
    },
    cash_out: () => {
      need("ROUND_EVAL");
      w.money += w.cashout.total;
      if (w.blindIdx === 2) w.status = ["UPCOMING", "UPCOMING", "UPCOMING"];
      // The round's counters reset for the shop and the next blind select (the real logs show 4/4 there).
      w.handsLeft = roundHands(w);
      w.discardsLeft = roundDiscards(w);
      openShop();
      return state();
    },
    next_round: () => {
      need("SHOP");
      if (w.status.every((s) => s === "UPCOMING")) {
        w.blindIdx = 0;
        w.status = ["SELECT", "UPCOMING", "UPCOMING"];
      } else {
        w.blindIdx++;
        w.status[w.blindIdx] = "SELECT";
      }
      w.shop = [];
      w.shopVouchers = [];
      w.shopPacks = [];
      w.phase = "BLIND_SELECT";
      blindChoiceTags();
      return state();
    },
    buy: (p) => {
      need("SHOP");
      const which = (["card", "voucher", "pack"] as const).filter((k) => p?.[k] !== undefined);
      if (!which.length) fail("BAD_REQUEST", "Invalid arguments. You must provide one of: card, voucher, pack");
      if (which.length > 1) fail("BAD_REQUEST", "Invalid arguments. Cannot provide more than one of: card, voucher, or pack");
      const kind = which[0];
      const list = kind === "card" ? w.shop : kind === "voucher" ? w.shopVouchers : w.shopPacks;
      const i = Number(p![kind]);
      if (!list.length) fail("BAD_REQUEST", kind === "card" ? "No jokers/consumables/cards in the shop. Reroll to restock the shop" : kind === "voucher" ? "No vouchers to redeem. Defeat boss blind to restock" : "No packs to open");
      const it = list[i];
      if (!it) return fail("BAD_REQUEST", `${kind === "card" ? "Card" : kind === "voucher" ? "Voucher" : "Pack"} index out of range. Index: ${p![kind]}, Available: ${list.length}`);
      const cost = askPrice(it);
      if (cost > 0 && cost > buyingPower()) fail("BAD_REQUEST", `Card is not affordable. Cost: ${cost}, Available money: ${buyingPower()}`);
      if (it.set === "JOKER" && w.jokers.length >= jokerSlots(w) && it.edition !== "NEGATIVE") fail("BAD_REQUEST", `Cannot purchase joker card, joker slots are full. Current: ${w.jokers.length}, Limit: ${jokerSlots(w)}`);
      if ((it.set === "PLANET" || it.set === "TAROT" || it.set === "SPECTRAL") && w.consumables.length >= consumableSlots(w)) fail("BAD_REQUEST", `Cannot purchase consumable card, consumable slots are full. Current: ${w.consumables.length}, Limit: ${consumableSlots(w)}`);
      w.money -= cost;
      list.splice(i, 1);
      if (kind === "voucher") {
        w.vouchers.push(it.key);
        if (it.key === w.anteVoucher) w.anteVoucher = undefined;
        redeem(it.key);
      } else if (kind === "pack") openPack(PACK_BY_KEY.get(it.key)!, "SHOP");
      else if (it.card) fx.addCard(it.card, "draw");
      else if (it.set === "JOKER") {
        it.couponed = false;
        w.jokers.push(it);
      } else w.consumables.push(it);
      reprice();
      return state();
    },
    sell: (p) => {
      need("SHOP", "BLIND_SELECT", "SELECTING_HAND", "SMODS_BOOSTER_OPENED");
      const isJoker = p?.joker !== undefined;
      if (isJoker === (p?.consumable !== undefined)) fail("BAD_REQUEST", isJoker ? "Can only sell one item at a time" : "Must provide exactly one of: joker or consumable");
      const list = isJoker ? w.jokers : w.consumables;
      if (!list.length) fail("NOT_ALLOWED", `No ${isJoker ? "jokers" : "consumables"} available to sell`);
      const i = Number(isJoker ? p!.joker : p!.consumable);
      const it = list[i];
      if (!it) return fail("BAD_REQUEST", `Index out of range for ${isJoker ? "joker" : "consumable"}: ${i}`);
      if (isJoker && it.eternal) fail("NOT_ALLOWED", "Cannot sell eternal joker");
      w.money += sellValue(it);
      list.splice(i, 1);
      if (isJoker) {
        if (!it.debuff) HOOKS[it.key]?.sold?.(it, w, fx);
        if (it.key === "j_luchador" && !it.debuff && w.phase === "SELECTING_HAND" && w.blindIdx === 2) disableBoss();
        if (bossIs("bl_final_leaf")) disableBoss();
      }
      for (const j of w.jokers) hooksOf(j)?.anySold?.(j, w);
      refreshDebuffs();
      reprice();
      return state();
    },
    rearrange: (p) => {
      need("SELECTING_HAND", "SHOP", "SMODS_BOOSTER_OPENED");
      const order = p?.jokers;
      if (!Array.isArray(order)) return fail("BAD_REQUEST", "Must provide jokers");
      if (order.length !== w.jokers.length) fail("BAD_REQUEST", `Must provide exactly ${w.jokers.length} indices for jokers`);
      if (new Set(order).size !== order.length || order.some((i) => !w.jokers[Number(i)])) fail("BAD_REQUEST", "jokers must be a permutation of the current joker indices");
      w.jokers = order.map((i) => w.jokers[Number(i)]);
      return state();
    },
    reroll: () => {
      need("SHOP");
      const cost = rerollCost();
      if (cost > 0 && buyingPower() < cost) fail("NOT_ALLOWED", `Not enough dollars to reroll. Available: ${buyingPower()}, Required: ${cost}`);
      w.money -= cost;
      if (w.freeRerolls > 0) w.freeRerolls--;
      else w.rerollIncrease++;
      w.shop = [];
      for (let i = 0; i < shopSlots(w); i++) w.shop.push(shopCard());
      eachHook("reroll", (h, j) => h(j, w));
      return state();
    },
    use: (p) => {
      need("BLIND_SELECT", "SELECTING_HAND", "SHOP", "SMODS_BOOSTER_OPENED");
      const i = Number(p?.consumable);
      if (!Number.isInteger(i) || i < 0 || i >= w.consumables.length) fail("BAD_REQUEST", `Consumable index out of range: ${p?.consumable}`);
      const it = w.consumables[i];
      const spec = specOf(it.key);
      const xs = intList(p, "cards") ?? [];
      if (spec?.max) {
        if (!w.hand.length) fail("INVALID_STATE", `Consumable '${it.label}' requires card selection and a visible hand`);
        if (!xs.length) fail("BAD_REQUEST", `Consumable '${it.label}' requires card selection`);
        handIndices(xs);
      }
      const why = cannotUse(w, it, xs.length);
      if (why) fail(why.startsWith("needs") && spec?.max ? "BAD_REQUEST" : "NOT_ALLOWED", `Consumable '${it.label}' cannot be used at this time: ${why}`);
      const targets = spec?.max ? xs.map((x) => w.hand[x]) : [];
      w.consumables.splice(i, 1);
      useConsumable(w, fx, it, targets);
      refreshDebuffs();
      return state();
    },
    pack: (p) => {
      need("SMODS_BOOSTER_OPENED", "BLIND_SELECT");
      const hasCard = p?.card !== undefined;
      const skip = Boolean(p?.skip);
      if (!hasCard && !skip) fail("BAD_REQUEST", "Invalid arguments. You must provide one of: card, skip");
      if (hasCard && skip) fail("BAD_REQUEST", "Invalid arguments. Cannot provide both card and skip");
      if (!w.pack) return fail("INVALID_STATE", "No pack is currently open");
      if (skip) {
        eachHook("packSkipped", (h, j) => h(j, w));
        closePack();
        return state();
      }
      const i = Number(p!.card);
      const it = w.pack.items[i];
      if (!it) return fail("BAD_REQUEST", `Card index out of range. Index: ${p!.card}, Available cards: ${w.pack.items.length}`);
      if (it.set === "JOKER" && w.jokers.length >= jokerSlots(w) && it.edition !== "NEGATIVE") fail("NOT_ALLOWED", `Cannot select joker, joker slots are full. Current: ${w.jokers.length}, Limit: ${jokerSlots(w)}`);
      const spec = it.set === "TAROT" || it.set === "SPECTRAL" ? specOf(it.key) : undefined;
      if (spec?.needsJoker && w.jokers.length < 1) fail("NOT_ALLOWED", `Card '${it.key}' requires at least 1 joker(s). Current: 0`);
      const xs = intList(p, "targets") ?? [];
      if (spec?.max) {
        const min = spec.min ?? 1;
        if (xs.length < min || xs.length > spec.max) fail("BAD_REQUEST", `Card '${it.key}' requires ${min === spec.max ? `exactly ${min}` : `${min}-${spec.max}`} target card(s). Provided: ${xs.length}`);
        handIndices(xs, "target card");
      }
      w.pack.items.splice(i, 1);
      if (it.set === "JOKER") w.jokers.push(it);
      else if (it.card) fx.addCard(it.card, "draw");
      else useConsumable(w, fx, it, spec?.max ? xs.map((x) => w.hand[x]) : []);
      refreshDebuffs();
      w.pack.choices--;
      if (w.pack.choices <= 0 || !w.pack.items.length) closePack();
      return state();
    },
    // The mod's debug endpoints, for tests and hand-driven checks.
    add: (p) => {
      need("SELECTING_HAND", "SHOP", "ROUND_EVAL");
      const key = String(p?.key ?? "");
      const edition = p?.edition as Edition | undefined;
      if (/^[HDCS]_[2-9TJQKA]$/.test(key)) {
        if (w.phase !== "SELECTING_HAND") fail("BAD_REQUEST", "Playing cards can only be added in SELECTING_HAND state");
        const c: SimCard = { id: 0, suit: key[0], rank: key[2], enhancement: p?.enhancement as string | undefined, edition, seal: p?.seal as string | undefined };
        fx.addCard(c, "hand");
      } else if (key.startsWith("j_")) {
        if (!CATALOG_BY_KEY.has(key)) fail("BAD_REQUEST", `Joker key not found: ${key}`);
        const j = newJoker({ key, edition, plain: true });
        Object.assign(j, { eternal: Boolean(p?.eternal) || undefined, perishable: p?.perishable ? Number(p.perishable) : undefined, rental: Boolean(p?.rental) || undefined });
        w.jokers.push(price(w, j));
      } else if (key.startsWith("c_")) {
        if (!specOf(key) && !PLANET_BY_KEY.has(key)) fail("BAD_REQUEST", `Consumable key not found: ${key}`);
        w.consumables.push(PLANET_BY_KEY.has(key) ? newConsumable("PLANET", key) : key === "c_black_hole" ? makeItem(key, "SPECTRAL", labelOf(key), 4) : newConsumable(TAROTS[key] ? "TAROT" : "SPECTRAL", key));
      } else if (key.startsWith("v_")) {
        if (w.phase !== "SHOP") fail("BAD_REQUEST", "Vouchers can only be added in SHOP state");
        if (!VOUCHERS[key]) fail("BAD_REQUEST", `Voucher key not found: ${key}`);
        w.shopVouchers.push(makeItem(key, "VOUCHER", VOUCHERS[key].label, 10));
      } else if (key.startsWith("p_")) {
        if (w.phase !== "SHOP") fail("BAD_REQUEST", "Packs can only be added in SHOP state");
        if (w.shopPacks.length >= 2) fail("BAD_REQUEST", "Cannot add pack, shop booster slots are full");
        const spec = PACK_BY_KEY.get(key);
        if (!spec) return fail("BAD_REQUEST", `Pack key not found: ${key}`);
        w.shopPacks.push(newPackItem(spec));
      } else fail("BAD_REQUEST", "Invalid card key format. Expected: joker (j_*), consumable (c_*), voucher (v_*), or playing card (SUIT_RANK)");
      refreshDebuffs();
      return state();
    },
    set: (p) => {
      const keys = ["money", "chips", "ante", "round", "hands", "discards", "shop", "grant_voucher", "boss_rerolled"].filter((k) => p?.[k] !== undefined);
      if (!keys.length) fail("BAD_REQUEST", "Must provide at least one field to set");
      for (const k of ["money", "chips", "ante", "round", "hands", "discards"]) if (p?.[k] !== undefined && Number(p[k]) < 0) fail("BAD_REQUEST", `${k[0].toUpperCase()}${k.slice(1)} must be a positive integer`);
      if (p?.money !== undefined) w.money = Number(p.money);
      if (p?.chips !== undefined) w.chips = Number(p.chips);
      if (p?.ante !== undefined) w.ante = Number(p.ante);
      if (p?.round !== undefined) w.round = Number(p.round);
      if (p?.hands !== undefined) w.handsLeft = Number(p.hands);
      if (p?.discards !== undefined) w.discardsLeft = Number(p.discards);
      if (p?.grant_voucher !== undefined) {
        if (!VOUCHERS[String(p.grant_voucher)]) fail("BAD_REQUEST", `Unknown voucher key: ${p.grant_voucher}`);
        w.vouchers.push(String(p.grant_voucher));
      }
      if (p?.boss_rerolled !== undefined) w.bossRerolled = Boolean(p.boss_rerolled);
      if (p?.shop) {
        if (w.phase !== "SHOP") fail("NOT_ALLOWED", "Can re-stock shop only in SHOP state");
        openShop();
      }
      return state();
    },
    screenshot: () => fail("NOT_ALLOWED", "the simulator has no screen"),
  };

  /** A voucher's effect the moment it is redeemed. */
  function redeem(key: string) {
    if (key === "v_hieroglyph" || key === "v_petroglyph") w.ante = Math.max(0, w.ante - 1);
    if (key === "v_overstock_norm" || key === "v_overstock_plus") w.shop.push(shopCard());
    reprice();
  }

  return {
    name: "simulator",
    state,
    world: () => w,
    async call<T>(method: string, params?: Record<string, unknown>): Promise<T> {
      const fn = methods[method];
      if (!fn) throw new RpcError(-32601, "METHOD_NOT_FOUND", `simulator does not implement ${method}`);
      return fn(params) as T;
    },
  };
}

const DECKS = new Set(["RED", "BLUE", "YELLOW", "GREEN", "BLACK", "MAGIC", "NEBULA", "GHOST", "ABANDONED", "CHECKERED", "ZODIAC", "PAINTED", "ANAGLYPH", "PLASMA", "ERRATIC"]);
const BOSS_NAMES = new Map(BOSSES.map((b) => [b.key, b.name]));
