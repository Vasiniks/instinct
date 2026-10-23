// A small in-process Balatro stand-in that speaks BlindDeck's methods and GameState shape.
// It exists so the loop and the visualizer can run end to end without the game: scoring reuses the
// agent's own evaluator, the joker pool is vanilla, and bosses are the few with simple rules.

import { RpcError, type Game } from "./blinddeck.ts";
import { RANKS, SUITS, SUIT_NAME, toPCard } from "./cards.ts";
import { blindBase, stakeAtLeast } from "./knowledge.ts";
import { BASE_HANDS, HAND_NAMES, estimateScore, rulesFromJokers, type HandName, type Joker } from "./poker.ts";
import { mulberry32 } from "./systemone.ts";
import type { Area, Blind, GameState, RawCard } from "./types.ts";

interface SimCard {
  id: number;
  rank: string;
  suit: string;
}

interface Offer {
  id: number;
  key: string;
  label: string;
  set: "JOKER" | "PLANET";
  effect: string;
  cost: number;
  rarity?: string;
  stats?: Record<string, number>;
  hand?: HandName;
  /** Gold stake: costs $3 every round. */
  rental?: boolean;
}

const JOKERS: Omit<Offer, "id" | "set">[] = [
  { key: "j_joker", label: "Joker", effect: "+4 Mult", stats: { mult: 4 }, rarity: "COMMON", cost: 2 },
  { key: "j_jolly", label: "Jolly Joker", effect: "+8 Mult if played hand contains a Pair", stats: { mult: 8 }, rarity: "COMMON", cost: 3 },
  { key: "j_sly", label: "Sly Joker", effect: "+50 Chips if played hand contains a Pair", stats: { chips: 50 }, rarity: "COMMON", cost: 3 },
  { key: "j_droll", label: "Droll Joker", effect: "+10 Mult if played hand contains a Flush", stats: { mult: 10 }, rarity: "COMMON", cost: 4 },
  { key: "j_greedy_joker", label: "Greedy Joker", effect: "Played cards with Diamond suit give +3 Mult when scored", rarity: "COMMON", cost: 5 },
  { key: "j_half", label: "Half Joker", effect: "+20 Mult if played hand contains 3 or fewer cards", stats: { mult: 20 }, rarity: "COMMON", cost: 5 },
  { key: "j_scholar", label: "Scholar", effect: "Played Aces give +20 Chips and +4 Mult when scored", rarity: "COMMON", cost: 4 },
  { key: "j_banner", label: "Banner", effect: "+30 Chips for each remaining discard", rarity: "COMMON", cost: 5 },
  { key: "j_fibonacci", label: "Fibonacci", effect: "Each played Ace, 2, 3, 5, or 8 gives +8 Mult when scored", rarity: "UNCOMMON", cost: 8 },
  { key: "j_duo", label: "The Duo", effect: "X2 Mult if played hand contains a Pair", stats: { x_mult: 2 }, rarity: "RARE", cost: 8 },
  { key: "j_tribe", label: "The Tribe", effect: "X2 Mult if played hand contains a Flush", stats: { x_mult: 2 }, rarity: "RARE", cost: 8 },
  { key: "j_blueprint", label: "Blueprint", effect: "Copies ability of Joker to the right", rarity: "RARE", cost: 10 },
];

const PLANETS: { key: string; label: string; hand: HandName }[] = [
  { key: "c_pluto", label: "Pluto", hand: "High Card" },
  { key: "c_mercury", label: "Mercury", hand: "Pair" },
  { key: "c_uranus", label: "Uranus", hand: "Two Pair" },
  { key: "c_venus", label: "Venus", hand: "Three of a Kind" },
  { key: "c_saturn", label: "Saturn", hand: "Straight" },
  { key: "c_jupiter", label: "Jupiter", hand: "Flush" },
  { key: "c_earth", label: "Earth", hand: "Full House" },
  { key: "c_mars", label: "Mars", hand: "Four of a Kind" },
];

const BOSSES: { name: string; effect: string; debuffSuit?: string }[] = [
  { name: "The Club", effect: "All Club cards are debuffed", debuffSuit: "C" },
  { name: "The Window", effect: "All Diamond cards are debuffed", debuffSuit: "D" },
  { name: "The Goad", effect: "All Spade cards are debuffed", debuffSuit: "S" },
  { name: "The Head", effect: "All Heart cards are debuffed", debuffSuit: "H" },
  { name: "The Wall", effect: "Extra large blind" },
  { name: "The Needle", effect: "Play only 1 hand" },
  { name: "The Psychic", effect: "Must play 5 cards" },
];

const TAGS = [
  { key: "tag_economy", name: "Economy Tag", effect: "Doubles your money (max of $40)" },
  { key: "tag_handy", name: "Handy Tag", effect: "Gives $5 now" },
];

const RANK_NAME: Record<string, string> = { T: "10", J: "Jack", Q: "Queen", K: "King", A: "Ace" };

function hashSeed(s: string): number {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

export function simGame(initialSeed = "SIM1"): Game & { state(): GameState } {
  let rand = mulberry32(hashSeed(initialSeed));
  let seed = initialSeed;
  let phase = "MENU";
  let nextId = 1;
  let ante = 1;
  let roundNum = 0;
  let blindIdx = 0;
  let status: Blind["status"][] = ["SELECT", "UPCOMING", "UPCOMING"];
  let boss = BOSSES[0];
  let tags = [TAGS[0], TAGS[1]];
  let money = 4;
  let stake = "WHITE";
  let deckName = "RED";
  let deck: SimCard[] = [];
  let draw: SimCard[] = [];
  let hand: SimCard[] = [];
  let handsLeft = 4;
  let discardsLeft = 3;
  let handsPlayed = 0;
  let chips = 0;
  let levels: Record<string, { level: number; chips: number; mult: number; played: number; played_this_round: number }> = {};
  let jokers: Offer[] = [];
  let consumables: Offer[] = [];
  let shop: Offer[] = [];
  let rerollCost = 5;
  let won = false;
  let result = "";
  let cashout = 0;

  const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
  const shuffle = <T>(xs: T[]): T[] => {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const fail = (kind: "INVALID_STATE" | "BAD_REQUEST" | "NOT_ALLOWED", msg: string): never => {
    throw new RpcError(kind === "BAD_REQUEST" ? -32001 : kind === "INVALID_STATE" ? -32002 : -32003, kind, msg);
  };
  const need = (...phases: string[]) => {
    if (!phases.includes(phase)) fail("INVALID_STATE", `requires ${phases.join("/")}, game is in ${phase}`);
  };
  const target = (idx = blindIdx) => {
    const base = blindBase(Math.min(ante, 8), stake, deckName) * [1, 1.5, 2][idx];
    return idx === 2 && boss.name === "The Wall" ? base * 2 : base;
  };
  const interest = () => Math.min(5, Math.floor(money / 5));
  const drawUp = () => {
    while (hand.length < 8 && draw.length) hand.push(draw.shift()!);
  };
  const debuffed = (c: SimCard) => phase === "SELECTING_HAND" && blindIdx === 2 && boss.debuffSuit === c.suit;

  const rawCard = (c: SimCard): RawCard => ({
    id: c.id,
    key: `${c.suit}_${c.rank}`,
    set: "DEFAULT",
    label: `${RANK_NAME[c.rank] ?? c.rank} of ${SUIT_NAME[c.suit]}`,
    value: { suit: c.suit, rank: c.rank, effect: "" },
    modifier: {},
    state: { debuff: debuffed(c) },
    cost: { sell: 1, buy: 0 },
  });
  const rawOffer = (o: Offer, owned: boolean): RawCard => ({
    id: o.id,
    key: o.key,
    set: o.set,
    label: o.label,
    value: { effect: o.effect, ...(o.stats ? { stats: o.stats } : {}), ...(o.rarity ? { rarity: o.rarity } : {}) },
    modifier: o.rental ? { rental: true, rental_cost: 3 } : {},
    state: {},
    cost: { sell: Math.max(1, Math.floor(o.cost / 2)), buy: owned ? 0 : o.cost },
  });
  const area = (cards: RawCard[], limit: number, extra: Partial<Area> = {}): Area => ({ count: cards.length, limit, cards, ...extra });
  const asJokers = (): Joker[] =>
    jokers.map((j, index) => ({ index, key: j.key, label: j.label, effect: j.effect, stats: j.stats ?? {}, debuff: false, eternal: false, sell: Math.floor(j.cost / 2) }));

  const blindRaw = (idx: number): Blind => ({
    type: (["SMALL", "BIG", "BOSS"] as const)[idx],
    status: status[idx],
    name: idx === 2 ? boss.name : idx === 1 ? "Big Blind" : "Small Blind",
    effect: idx === 2 ? boss.effect : "No special effect",
    score: target(idx),
    ...(idx < 2 ? { tag_key: tags[idx].key, tag_name: tags[idx].name, tag_effect: tags[idx].effect } : {}),
  });

  const newShop = () => {
    shop = [0, 1].map(() => {
      if (rand() < 0.7) {
        const j = { ...pick(JOKERS), id: nextId++, set: "JOKER" as const };
        // Gold stake: some shop jokers are Rentals, $1 up front and $3 every round.
        return stakeAtLeast(stake, "GOLD") && rand() < 0.3 ? { ...j, rental: true, cost: 1 } : j;
      }
      const p = pick(PLANETS);
      const b = BASE_HANDS[p.hand];
      return { id: nextId++, key: p.key, label: p.label, set: "PLANET" as const, effect: `Level up ${p.hand}: +${b.lmult} Mult and +${b.lchips} Chips`, cost: 3, hand: p.hand };
    });
  };

  const reset = (s: string) => {
    seed = s;
    rand = mulberry32(hashSeed(s));
    ante = 1;
    roundNum = 0;
    blindIdx = 0;
    status = ["SELECT", "UPCOMING", "UPCOMING"];
    boss = pick(BOSSES.filter((b) => b.name !== "The Wall"));
    tags = [pick(TAGS), pick(TAGS)];
    money = 4;
    deck = SUITS.flatMap((suit) => RANKS.map((rank) => ({ id: nextId++, rank, suit })));
    hand = [];
    draw = [];
    jokers = [];
    consumables = [];
    shop = [];
    won = false;
    result = "";
    levels = Object.fromEntries(HAND_NAMES.map((h) => [h, { level: 1, chips: BASE_HANDS[h].chips, mult: BASE_HANDS[h].mult, played: 0, played_this_round: 0 }]));
  };

  const state = (): GameState => {
    const inRun = phase !== "MENU";
    const gs: GameState = { state: phase, held_tags_ready: true };
    if (!inRun) return gs;
    Object.assign(gs, {
      round_num: roundNum,
      ante_num: ante,
      money,
      bankrupt_at: 0,
      deck: deckName,
      stake,
      seed,
      won,
      hands: Object.fromEntries(HAND_NAMES.map((h, i) => [h, { order: i + 1, ...levels[h] }])),
      round: {
        hands_left: handsLeft,
        hands_played: handsPlayed,
        discards_left: discardsLeft,
        reroll_cost: rerollCost,
        chips,
        ...(phase === "ROUND_EVAL" ? { cashout_preview: { total: cashout, lines: [] } } : {}),
      },
      blinds: { small: blindRaw(0), big: blindRaw(1), boss: blindRaw(2) },
      jokers: area(jokers.map((j) => rawOffer(j, true)), 5),
      consumables: area(consumables.map((c) => rawOffer(c, true)), 2),
      cards: area(draw.map(rawCard), 52),
      used_vouchers: {},
      held_tags: [],
    } satisfies Partial<GameState>);
    if (phase === "SELECTING_HAND") gs.hand = area(hand.map(rawCard), 8, { highlighted_limit: 5 });
    if (phase === "SHOP") {
      gs.shop = area(shop.map((o) => rawOffer(o, false)), 2);
      gs.vouchers = area([], 1);
      gs.packs = area([], 2);
    }
    if (phase === "GAME_OVER") gs.run_summary = { result };
    return gs;
  };

  const indices = (params: Record<string, unknown> | undefined, key: string, max: number): number[] => {
    const v = params?.[key];
    if (!Array.isArray(v) || !v.length) return fail("BAD_REQUEST", `${key} must be a non-empty array`);
    const xs = v.map(Number);
    if (new Set(xs).size !== xs.length || xs.some((i) => !Number.isInteger(i) || i < 0 || i >= hand.length)) fail("BAD_REQUEST", `bad ${key} indices ${JSON.stringify(v)}`);
    if (xs.length > max) fail("BAD_REQUEST", `at most ${max} cards`);
    return xs;
  };
  const takeFromHand = (xs: number[]) => {
    const picked = xs.map((i) => hand[i]);
    hand = hand.filter((_, i) => !xs.includes(i));
    return picked;
  };

  const methods: Record<string, (p?: Record<string, unknown>) => unknown> = {
    health: () => ({ status: "ok" }),
    gamestate: () => state(),
    menu: () => {
      phase = "MENU";
      return state();
    },
    start: (p) => {
      need("MENU");
      stake = typeof p?.stake === "string" ? p.stake : "WHITE";
      deckName = typeof p?.deck === "string" ? p.deck : "RED";
      reset(String(p?.seed ?? `SIM${Math.floor(rand() * 1e6)}`));
      phase = "BLIND_SELECT";
      return state();
    },
    select: () => {
      need("BLIND_SELECT");
      phase = "SELECTING_HAND";
      status[blindIdx] = "CURRENT";
      roundNum++;
      handsLeft = blindIdx === 2 && boss.name === "The Needle" ? 1 : 4;
      discardsLeft = 3;
      handsPlayed = 0;
      chips = 0;
      for (const h of Object.values(levels)) h.played_this_round = 0;
      draw = shuffle(deck);
      hand = [];
      drawUp();
      return state();
    },
    skip: () => {
      need("BLIND_SELECT");
      if (blindIdx === 2) fail("NOT_ALLOWED", "cannot skip the boss blind");
      const tag = tags[blindIdx];
      money += tag.key === "tag_economy" ? Math.min(40, Math.max(0, money)) : 5;
      status[blindIdx] = "SKIPPED";
      blindIdx++;
      status[blindIdx] = "SELECT";
      return state();
    },
    play: (p) => {
      need("SELECTING_HAND");
      const played = takeFromHand(indices(p, "cards", 5));
      const pcards = played.map((c, i) => ({ ...toPCard(rawCard(c), i) }));
      const held = hand.map((c, i) => toPCard(rawCard(c), i));
      const js = asJokers();
      const est = estimateScore(pcards, { levels, jokers: js, held, rules: rulesFromJokers(js), handsLeft, discardsLeft, balanced: deckName === "PLASMA" });
      const score = boss.name === "The Psychic" && blindIdx === 2 && played.length < 5 ? 0 : est.score;
      chips += score;
      levels[est.hand].played++;
      levels[est.hand].played_this_round++;
      handsLeft--;
      handsPlayed++;
      if (chips >= target()) {
        status[blindIdx] = "DEFEATED";
        if (blindIdx === 2 && ante >= 8) {
          won = true;
          result = "Victory";
          phase = "GAME_OVER";
          return state();
        }
        const reward = blindIdx === 0 && stakeAtLeast(stake, "RED") ? 0 : [3, 4, 5][blindIdx];
        cashout = reward + handsLeft + interest() - 3 * jokers.filter((j) => j.rental).length;
        phase = "ROUND_EVAL";
      } else if (handsLeft <= 0) {
        result = `Lost to ${blindRaw(blindIdx).name}`;
        phase = "GAME_OVER";
      } else drawUp();
      return state();
    },
    discard: (p) => {
      need("SELECTING_HAND");
      if (discardsLeft <= 0) fail("NOT_ALLOWED", "no discards left");
      takeFromHand(indices(p, "cards", 5));
      discardsLeft--;
      drawUp();
      return state();
    },
    cash_out: () => {
      need("ROUND_EVAL");
      money += cashout;
      rerollCost = 5;
      newShop();
      phase = "SHOP";
      return state();
    },
    next_round: () => {
      need("SHOP");
      if (blindIdx === 2) {
        ante++;
        blindIdx = 0;
        status = ["SELECT", "UPCOMING", "UPCOMING"];
        boss = pick(BOSSES);
        tags = [pick(TAGS), pick(TAGS)];
      } else {
        blindIdx++;
        status[blindIdx] = "SELECT";
      }
      phase = "BLIND_SELECT";
      return state();
    },
    buy: (p) => {
      need("SHOP");
      const i = Number(p?.card);
      const o = shop[i];
      if (!o) return fail("BAD_REQUEST", `no shop card at ${p?.card}`);
      if (o.cost > money) fail("NOT_ALLOWED", `cannot afford ${o.label}`);
      if (o.set === "JOKER" && jokers.length >= 5) fail("NOT_ALLOWED", "joker slots full");
      if (o.set === "PLANET" && consumables.length >= 2) fail("NOT_ALLOWED", "consumable slots full");
      money -= o.cost;
      (o.set === "JOKER" ? jokers : consumables).push(o);
      shop.splice(i, 1);
      return state();
    },
    sell: (p) => {
      need("SHOP", "BLIND_SELECT", "SELECTING_HAND");
      const list = p?.joker !== undefined ? jokers : consumables;
      const i = Number(p?.joker ?? p?.consumable);
      if (!list[i]) fail("BAD_REQUEST", "nothing to sell there");
      money += Math.max(1, Math.floor(list[i].cost / 2));
      list.splice(i, 1);
      return state();
    },
    rearrange: (p) => {
      const order = p?.jokers;
      if (!Array.isArray(order) || order.length !== jokers.length || new Set(order).size !== jokers.length || order.some((i) => !jokers[Number(i)])) {
        return fail("BAD_REQUEST", "jokers must be a permutation of the current joker indices");
      }
      jokers = order.map((i) => jokers[Number(i)]);
      return state();
    },
    reroll: () => {
      need("SHOP");
      if (rerollCost > money) fail("NOT_ALLOWED", "cannot afford reroll");
      money -= rerollCost;
      rerollCost++;
      newShop();
      return state();
    },
    use: (p) => {
      need("SHOP", "BLIND_SELECT", "SELECTING_HAND");
      const i = Number(p?.consumable);
      const c = consumables[i];
      if (!c?.hand) return fail("BAD_REQUEST", "no planet at that index");
      const l = levels[c.hand];
      const b = BASE_HANDS[c.hand];
      levels[c.hand] = { ...l, level: l.level + 1, chips: l.chips + b.lchips, mult: l.mult + b.lmult };
      consumables.splice(i, 1);
      return state();
    },
    screenshot: () => fail("NOT_ALLOWED", "the simulator has no screen"),
  };

  return {
    name: "simulator",
    state,
    async call<T>(method: string, params?: Record<string, unknown>): Promise<T> {
      const fn = methods[method];
      if (!fn) throw new RpcError(-32601, "METHOD_NOT_FOUND", `simulator does not implement ${method}`);
      return fn(params) as T;
    },
  };
}
