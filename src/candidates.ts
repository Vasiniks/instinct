// Legal actions for the current phase, each with a plain-language description for the model, the
// exact BlindDeck call(s) that perform it, and a heuristic utility (the fallback pick and the UI's
// ghost marker). Utilities read the build profile and plan, so even the fallback plays for the
// build: it prefers the planned hand, respects boss rules and scaling jokers, swaps weak jokers for
// better ones, uses Tarots and Planets when they help, fixes the deck, and minds the economy.
// Lists stay well under StartLux's 26-options-per-pass ceiling no matter how large the hand is.

import { ENGINE_TAGS, bossTargets, discardsPerRound, handsPerRound, interestOn, jokerFit, powerOnHand, profileBuild, rentDue, type BuildProfile } from "./build.ts";
import { FACE_RANKS, SUIT_NAME, cardWorth, type PCard } from "./cards.ts";
import type { Item, ShopItem, Snapshot } from "./extract.ts";
import { ARCHETYPES, PLANET_HAND, SUIT_TAG, TAG_VALUE, TAROTS, VOUCHER_VALUE, bossRule, jokerTags, stakeAtLeast } from "./knowledge.ts";
import { buConsumableDelta, buTagDelta, expertTake, tierDelta, voucherDelta, type ExpertPriors } from "./expert.ts";
import { discardOptions, playOptions, type PlayOption } from "./options.ts";
import { assess, jokerCatalog, type Assessment } from "./assess.ts";
import { FEATURES } from "./features.ts";
import { enablerLift } from "./synergy.ts";
import { TUNING } from "./tuning.ts";
import { roundsTo } from "./growth.ts";
import type { Plan } from "./plan.ts";
import { isModelledJoker, type Joker } from "./poker.ts";
import { applyToDeck, changesDeck, dealtHand, pickTargets } from "./deckfix.ts";
import { bossEffects, levelUp, levelUpAll, mulberry32, roundOdds, roundOutcomes, type Setup } from "./round.ts";

export { pickTargets };

export { interestOn };

export interface RpcCall {
  method: string;
  params?: Record<string, unknown>;
}

export interface Candidate {
  id: string;
  kind: string;
  label: string;
  description: string;
  /** The call that carries the move (shown in the UI). */
  call: RpcCall;
  /** When one move takes several game calls (sell then buy), all of them in order. */
  calls?: RpcCall[];
  utility: number;
  /** Softmax of utilities across the list, so it reads like a probability next to the model's. */
  prior: number;
  /** Hand indices the action touches (highlighted on the board). */
  cards?: number[];
  estimate?: { hand: string; chips: number; mult: number; score: number; clears: boolean; approximate: boolean };
  chance?: number;
}

export interface CandidateSet {
  phase: string;
  candidates: Candidate[];
  /** A forced, judgment-free step (cash out, start a run); the model is not asked. */
  auto?: Candidate;
  note?: string;
  /** What the simulation stage ran for this decision, for the visualizer's flow chart. */
  sim?: SimTrace;
  /** The situation as the assess stage read it (also sent to the model as facts). */
  assessment?: Assessment;
  /** The branches the decision tree took, in order. */
  path?: Branch[];
}

/** One fork of the decision tree: which way it went and why. */
export interface Branch {
  /** The fork, e.g. "Outlook" or "Clear now?". */
  node: string;
  /** The way taken, e.g. "Behind: spend". */
  branch: string;
  why: string;
}

export interface SimTrace {
  /** "round": finishes of this round after each move; "bosses": rounds at the next bosses per offer. */
  kind: "round" | "bosses";
  ms: number;
  /** Moves or setups compared, and simulated rounds per move or setup and boss. */
  compared: number;
  samples: number;
  summary: string;
}

export interface CandidateOptions {
  autoStart?: { deck: string; stake: string; seed?: string };
  endless: boolean;
  maxOptions: number;
  plan?: Plan;
  /** The build profile for this snapshot; computed here when not given. */
  profile?: BuildProfile;
  /** How an expert treated each joker (data/roffle/priors.json); nudges joker values (never shown to the model). */
  expert?: ExpertPriors;
  /** Defaults to TUNING.expertWeight; the benchmark sweeps it. */
  expertWeight?: number;
  /** Defaults to TUNING.swapMargin; the benchmark sweeps it. */
  swapMargin?: number;
  /** Boss names seen this run, for the boss pool when the game doesn't report the bosses drawn. */
  bossesSeen?: string[];
}

type Draft = Omit<Candidate, "prior">;

const MAX_OPTIONS = 24;
const PAIR_FAMILY = new Set(["Pair", "Two Pair", "Three of a Kind", "Full House", "Four of a Kind"]);
const SPECTRAL_VALUE: Record<string, number> = {
  c_black_hole: 0.9,
  c_soul: 0.85,
  c_aura: 0.65,
  c_cryptid: 0.6,
  c_talisman: 0.55,
  c_deja_vu: 0.55,
  c_trance: 0.45,
  c_medium: 0.45,
  c_familiar: 0.45,
  c_grim: 0.4,
  c_incantation: 0.45,
};

const labels = (cards: PCard[]) => cards.map((c) => c.label).join(" ");
const money = (n: number) => `$${n}`;
const isFace = (c: PCard) => Boolean(c.rank && FACE_RANKS.has(c.rank));

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function finalize(list: Draft[], max: number): Candidate[] {
  const ids = new Set<string>();
  const trimmed = list.slice(0, max).map((c) => {
    let id = c.id || "option";
    for (let n = 2; ids.has(id); n++) id = `${c.id}_${n}`;
    ids.add(id);
    return { ...c, id };
  });
  const temp = 0.15;
  const exps = trimmed.map((c) => Math.exp(c.utility / temp));
  const total = exps.reduce((a, b) => a + b, 0) || 1;
  return trimmed.map((c, i) => ({ ...c, prior: exps[i] / total }));
}

/** What every phase reads: the profile, the build's hands, and what the owned jokers want. */
interface Ctx {
  s: Snapshot;
  p: BuildProfile;
  planHands: Set<string>;
  owned: Set<string>;
  tags: Set<string>;
  mostPlayed?: string;
  expert?: ExpertPriors;
  expertWeight: number;
  swapMargin: number;
  /** Filled by the simulation stage. */
  trace: { sim?: SimTrace };
  /** The assess stage's reading, when this phase runs it. */
  a?: Assessment;
  /** Forks taken, filled as the phase's tree is walked. */
  path: Branch[];
  /** The joker a pending pivot is waiting for. */
  pendingVia?: string;
}

function context(s: Snapshot, p: BuildProfile, opts: Pick<CandidateOptions, "expert" | "expertWeight" | "swapMargin" | "plan"> = {}): Ctx {
  const top = Object.entries(s.levels).sort((a, b) => (b[1]?.played ?? 0) - (a[1]?.played ?? 0))[0];
  return {
    s,
    p,
    planHands: new Set(ARCHETYPES[p.primary.name]?.hands ?? []),
    owned: new Set(s.jokers.map((j) => j.key)),
    tags: new Set(s.jokers.flatMap((j) => [...jokerTags(j.key, j.effect)])),
    mostPlayed: top && (top[1]?.played ?? 0) > 0 ? top[0] : undefined,
    expert: opts.expert,
    expertWeight: opts.expertWeight ?? TUNING.expertWeight,
    // Behind the next ante's boss, a smaller upgrade is worth the churn (the expert runs were rarely behind).
    swapMargin: (opts.swapMargin ?? TUNING.swapMargin) * (p.econ.behind ? 0.6 : 1),
    trace: {},
    path: [],
    pendingVia: opts.plan?.pending?.via.key,
  };
}

/** A joker's fit for the build, nudged by how often the expert took it, with his record for the description. */
function fitWithExpert(c: Ctx, item: Item): { value: number; note: string; pivot?: string; expert: string } {
  const fit = jokerFit(item, c.s, c.p);
  const ex = expertTake(c.expert, item.key, c.s.ante);
  const pending = c.pendingVia === item.key;
  const tier = TUNING.buWeight ? TUNING.buWeight * tierDelta(item.key) : 0;
  const value = Math.max(0, fit.value + c.expertWeight * (ex?.delta ?? 0) + tier + (pending ? 0.2 : 0));
  // The expert record moves the value only; it is not quoted to the model.
  return { ...fit, value, note: pending ? `${fit.note}, the plan's pending pivot waits for it` : fit.note, expert: "" };
}

/** What one offered joker is worth to this run (build fit plus the expert nudge); the benchmark ranks offers with it. */
export function offerValue(s: Snapshot, item: Item, opts: Pick<CandidateOptions, "plan" | "profile" | "expert" | "expertWeight"> = {}): number {
  return fitWithExpert(context(s, opts.profile ?? profileBuild(s, opts.plan?.build), opts), item).value;
}

/** The weakest joker's note, with how often the expert sold it when he had one. */
function weakNote(_c: Ctx, weak: { key: string; note: string; loss?: number }): string {
  if (weak.loss === undefined) return weak.note;
  return `${weak.note}; without it the simulated boss rounds are beaten ${Math.round(Math.max(0, weak.loss) * 100)} points less often`;
}

// ---------------------------------------------------------------------------------------------
// Consumables: which cards a Tarot touches, and what using it is worth to this build.
// ---------------------------------------------------------------------------------------------

/**
 * What a dollar is worth on the same scale as the cards' values: about 0.03 for each, more while
 * under the interest cap (it earns interest) and while the run is behind (it buys rerolls and
 * jokers), less once the bank is past the cap and the run is on pace.
 */
function dollarValue(c: Ctx): number {
  const { s, p } = c;
  const underCap = p.econ.interestCap > 0 && s.money < 5 * p.econ.interestCap;
  const behind = p.econ.behind || c.a?.outlook.status === "behind" || c.a?.outlook.status === "losing";
  return TUNING.dollar * (underCap ? TUNING.dollarUnderCap : 1) * (behind ? 1.2 : 1) * (p.econ.surplus > 0 && !behind ? 0.7 : 1);
}

/**
 * A consumable's worth, kept apart for taking it and for using it now. `value` is what taking it is
 * worth (a shop buy, held for its best later use); `use` is what using it right now is worth (a
 * pack pick is used at once, as is a held card used this tick). They differ for cards whose payoff
 * grows with waiting, like The Hermit (up to $20) or a Planet kept for Observatory.
 */
function consumableValue(item: Item, c: Ctx): { value: number; why: string; use?: number; useWhy?: string } {
  const v = consumableBase(item, c);
  // Balatro University's consumables tier list, as a measured nudge (tuning.ts; 0 until measured).
  // And what the card feeds in the jokers held (Strength and Death for Baron; src/synergy.ts).
  const fed = enablerLift(item.key, c.owned);
  const nudge = (TUNING.buConsumableWeight ? TUNING.buConsumableWeight * buConsumableDelta(item.key) : 0) + TUNING.enablerBonus * fed.lift;
  return nudge ? { ...v, value: v.value + nudge, why: `${v.why}${fedText(c, fed)}`, ...(v.use !== undefined ? { use: v.use + nudge } : {}) } : v;
}

/** " (feeds Baron, Mime)" for a description, or nothing. */
function fedText(c: Ctx, fed: { for: string[] }): string {
  if (!fed.for.length) return "";
  const label = (k: string) => c.s.jokers.find((j) => j.key === k)?.label ?? k;
  return `; feeds ${fed.for.map(label).join(", ")}`;
}

function consumableBase(item: Item, c: Ctx): { value: number; why: string; use?: number; useWhy?: string } {
  const { s, p } = c;
  const flush = p.primary.name === "Flush";
  const dollar = dollarValue(c);
  const tarotFan = c.owned.has("j_fortune_teller") ? 0.08 : 0; // +1 Mult for every Tarot used
  const keeper = c.owned.has("j_perkeo") ? 0.08 : 0; // copies a held consumable at the end of each shop
  const grows = c.owned.has("j_hologram") ? 0.15 : 0; // gains xMult for every card added to the deck
  if (item.set === "PLANET") {
    const hand = PLANET_HAND[item.key];
    const build = Boolean(hand && c.planHands.has(hand));
    const extras = (c.owned.has("j_constellation") ? 0.15 : 0) + (c.owned.has("j_satellite") ? 0.06 : 0);
    // The build's hand counts only once the run plays it (a level alone is no reason).
    const played = hand ? (s.levels[hand]?.played ?? 0) : 0;
    const totalPlayed = Object.values(s.levels).reduce((a, l) => a + (l?.played ?? 0), 0);
    const base = build && (played > 0 || totalPlayed < 6) ? 0.9 : hand && hand === c.mostPlayed ? 0.6 : 0.3;
    const value = base + extras + keeper;
    // Observatory: a Planet held gives X1.5 Mult to its hand, so the build's Planet is worth keeping.
    if (build && s.usedVouchers.some((v) => /observatory/i.test(v))) {
      return { value: value + 0.15, why: `held, it gives X1.5 Mult to ${hand}, the build's hand (Observatory)`, use: base * 0.5, useWhy: `levels ${hand}, but held it gives X1.5 Mult (Observatory)` };
    }
    return { value, why: hand ? `levels up ${hand}${build ? ", the build's hand" : hand === c.mostPlayed ? ", the most played hand" : ", not the build's hand"}${extras ? "; Constellation or Satellite pay for every Planet used" : ""}` : "a Planet" };
  }
  if (item.set === "SPECTRAL") {
    const n = s.jokers.length;
    const roomForJoker = n < s.jokerSlots;
    // Hex and Ankh pick a random joker and destroy the rest, so with one joker there is no downside.
    if (item.key === "c_hex") return n === 1 ? { value: 0.75, why: `makes ${s.jokers[0].label} Polychrome with nothing else to lose` } : { value: 0.05, why: `destroys ${n - 1} of the jokers` };
    if (item.key === "c_ankh") return n === 1 ? { value: 0.6, why: `copies ${s.jokers[0].label} with nothing else to lose` } : { value: 0.05, why: `destroys ${n - 1} of the jokers` };
    if (item.key === "c_immolate") {
      const good = s.hand.filter((h) => h.enhancement || h.seal || h.edition).length;
      return { value: 20 * dollar + 0.1 - 0.05 * good, why: `+$20 and a thinner deck (destroys 5 cards in hand${good ? `, ${good} of them enhanced or sealed now` : ""})` };
    }
    if (item.key === "c_wraith") {
      const lost = Math.min(40, Math.max(0, s.money)) * dollar;
      return { value: (roomForJoker ? 0.75 : 0.1) - lost, why: `a Rare joker${roomForJoker ? "" : " (no free slot)"}, and money goes to $0 (-$${Math.max(0, s.money)})` };
    }
    if (item.key === "c_ectoplasm") return n ? { value: 0.4 + (roomForJoker ? 0 : 0.1), why: "a random joker turns Negative (a free slot), but hand size -1" } : { value: 0.05, why: "no joker to make Negative" };
    if (item.key === "c_ouija") return PAIR_FAMILY.has(p.primary.name) ? { value: 0.5, why: "every card in hand becomes one rank (for a rank build), hand size -1" } : { value: 0.1, why: "every card in hand becomes one rank, hand size -1" };
    if (item.key === "c_talisman") return { value: 6 * dollar + 0.15 + keeper, why: "a Gold Seal: $3 each time that card is played" };
    if (item.key === "c_trance") return { value: 0.45 + (c.owned.has("j_constellation") ? 0.1 : 0), why: "a Blue Seal: a Planet for the last hand played whenever that card stays in hand at round end" };
    if (item.key === "c_medium") return { value: 0.4 + tarotFan, why: "a Purple Seal: a Tarot whenever that card is discarded" };
    if (["c_familiar", "c_grim", "c_incantation", "c_cryptid"].includes(item.key)) {
      const fit = item.key === "c_grim" && (c.owned.has("j_scholar") || c.planHands.has("Pair")) ? 0.1 : item.key === "c_familiar" && c.tags.has("face") ? 0.1 : item.key === "c_cryptid" && PAIR_FAMILY.has(p.primary.name) ? 0.1 : 0;
      return { value: (SPECTRAL_VALUE[item.key] ?? 0.45) + fit + grows, why: `adds cards to the deck${grows ? " (Hologram grows with each)" : ""}` };
    }
    if (item.key === "c_sigil") return flush ? { value: 0.85, why: "turns the whole hand into one suit" } : { value: 0.2, why: "suit change the build doesn't need" };
    if (item.key === "c_soul") return roomForJoker ? { value: soulFit(c), why: `a random Legendary joker (${soulPicks(c).map((l) => l.label).join(", ")})` } : { value: 0.15, why: "no free joker slot for the Legendary" };
    // Every hand a level, the build's among them: a build Planet's worth and more. It is a Spectral,
    // so Constellation and Satellite don't count it.
    if (item.key === "c_black_hole") return { value: 1 + keeper, why: "levels up every poker hand, the build's hand among them" };
    return { value: SPECTRAL_VALUE[item.key] ?? 0.3, why: "a Spectral" };
  }
  const t = TAROTS[item.key];
  if (!t) return { value: 0.35, why: item.effect || "a consumable" };
  switch (t.kind) {
    case "suit": {
      const suit = t.detail!;
      // A joker that pays for the suit makes the conversion worth it in any build.
      const suitJoker = [...c.tags].some((tag) => SUIT_TAG[tag] === suit);
      if (suitJoker) return { value: 0.8 + tarotFan, why: `turns cards into ${SUIT_NAME[suit]}, the suit a joker pays for` };
      if (flush && p.deckFix.suit) return suit === p.deckFix.suit ? { value: 0.85 + tarotFan, why: `deck fixing: turns cards into ${SUIT_NAME[suit]}, the build's suit` } : { value: 0.1, why: "turns cards away from the build's suit" };
      if (flush) return suit === p.deckFix.commonSuit ? { value: 0.6 + tarotFan, why: `turns cards into ${SUIT_NAME[suit]}, the deck's most common suit` } : { value: 0.35 + tarotFan, why: `turns cards into ${SUIT_NAME[suit]}` };
      return { value: 0.3 + tarotFan, why: `turns cards into ${SUIT_NAME[suit]}` };
    }
    case "enhance": {
      const steelUse = c.owned.has("j_baron") || c.owned.has("j_mime") || c.owned.has("j_steel_joker");
      const goldUse = (c.owned.has("j_ticket") ? 0.25 : 0) - (c.owned.has("j_midas_mask") ? 0.05 : 0);
      const v: Record<string, number> = {
        STEEL: steelUse ? 0.8 : 0.55,
        GLASS: c.owned.has("j_glass") ? 0.8 : 0.65,
        MULT: 0.6,
        BONUS: 0.5,
        LUCKY: c.owned.has("j_lucky_cat") || c.owned.has("j_oops") ? 0.75 : 0.45,
        WILD: flush || c.owned.has("j_flower_pot") || c.owned.has("j_seeing_double") ? 0.8 : 0.4,
        // A Gold card pays $3 each round it stays in hand; Golden Ticket pays $4 more when it's played.
        GOLD: 0.2 + 9 * dollar + goldUse,
        STONE: c.tags.has("stone") ? 0.65 : 0.15,
      };
      // Vampire eats the enhancement for its XMult: the card's own value goes, Vampire's growth
      // comes in through the enabler table (consumableValue).
      const eaten = c.owned.has("j_vampire") ? 0.15 : 0;
      return { value: (v[t.detail!] ?? 0.45) - eaten + tarotFan, why: `enhances cards to ${t.detail!.toLowerCase()}${eaten ? " (Vampire eats it for XMult)" : ""}` };
    }
    case "rank":
      return { value: (p.primary.name === "Straight" ? 0.6 : 0.5) + tarotFan, why: "raises card ranks" };
    case "destroy":
      return { value: (flush || PAIR_FAMILY.has(p.primary.name) ? 0.7 : 0.6) + tarotFan, why: "deck fixing: destroys junk cards" };
    case "copy":
      return { value: (PAIR_FAMILY.has(p.primary.name) ? 0.72 : 0.6) + tarotFan, why: "deck fixing: copies a strong card" };
    case "money": {
      if (item.key === "c_hermit") {
        // It doubles money, up to +$20: worth up to $20 held until money nears $20, and the money
        // it adds now when used now.
        const now = Math.min(20, Math.max(0, s.money));
        const later = Math.max(now, 16);
        return {
          value: later * dollar + 0.1 + keeper + tarotFan,
          why: `doubles money, up to +$20 (+$${now} at $${s.money} now)`,
          use: now * dollar + 0.05 + tarotFan,
          useWhy: `+$${now} now; it adds up to $20 when money is $20 or more`,
        };
      }
      const sell = Math.min(50, s.jokers.reduce((a, j) => a + j.sell, 0));
      return { value: sell * dollar + 0.1 + tarotFan, why: `+$${sell}, the jokers' sell value (up to $50)` };
    }
    case "joker":
      return s.jokers.length < s.jokerSlots ? { value: 0.7 + tarotFan, why: "creates a random joker in a free slot" } : { value: 0.05, why: "no free joker slot" };
    case "edition": {
      // 1 in 4 (1 in 2 with Oops! All 6s) to give a joker Foil, Holographic or Polychrome.
      const odds = c.owned.has("j_oops") ? 0.5 : 0.25;
      return s.jokers.some((j) => !j.edition) ? { value: 0.15 + odds * 0.6 + tarotFan, why: `${Math.round(odds * 100)}% to give a joker an edition` } : { value: 0.1, why: "every joker already has an edition" };
    }
    case "create": {
      const room = s.consumables.length - 1 < s.consumableSlots;
      const extra = t.detail?.includes("Planet") ? (c.owned.has("j_constellation") ? 0.12 : 0) + (c.owned.has("j_satellite") ? 0.05 : 0) : tarotFan;
      return room ? { value: 0.5 + extra + tarotFan, why: `creates ${t.detail}` } : { value: 0.2, why: "no room for what it creates" };
    }
    default:
      return { value: 0.4 + tarotFan, why: t.detail ?? "a Tarot" };
  }
}

/** In a hand, a helpful consumable goes before the play unless a play already clears the blind. */
/** Cards that need cards in hand to act on (destroy, add or convert them). */
const HAND_SPECTRALS = new Set(["c_familiar", "c_grim", "c_incantation", "c_immolate", "c_sigil", "c_ouija"]);

/** Uses the game refuses right now (it would answer NOT_ALLOWED): no room for the joker made, no joker to change, nothing for The Fool to copy, no hand to act on. */
function refusedUse(s: Snapshot, item: Item, where: "hand" | "shop"): boolean {
  if ((item.key === "c_judgement" || item.key === "c_wraith" || item.key === "c_soul") && s.jokers.length >= s.jokerSlots) return true;
  if ((item.key === "c_wheel_of_fortune" || item.key === "c_hex" || item.key === "c_ectoplasm") && !s.jokers.some((j) => !j.edition)) return true;
  if (item.key === "c_fool" && item.copyKey !== undefined && (item.copyKey === "" || item.copyKey === "c_fool")) return true;
  if (HAND_SPECTRALS.has(item.key) && (where === "shop" || s.hand.length < 2)) return true;
  return false;
}

function useCandidates(c: Ctx, where: "hand" | "shop", bestClears = false): Draft[] {
  const { s, p } = c;
  const out: Draft[] = [];
  for (const item of s.consumables) {
    if (item.requiresJokers > s.jokers.length || refusedUse(s, item, where)) continue;
    const targets = pickTargets(item, s.hand, p.deckFix.suit);
    if (targets === null) continue;
    const v = consumableValue(item, c);
    const onCards = targets.length ? ` on ${targets.map((i) => s.hand[i].label).join(" ")}` : "";
    // Using it now is worth its use-now value; when holding is worth more (The Hermit at low
    // money, a Planet kept for Observatory) and the slot isn't needed, using it now ranks low.
    const now = v.use ?? v.value;
    // Holding waits for a better moment only while a slot is free: with the slots full, a card held
    // for later blocks every new one, so it is used now.
    const hold = v.use !== undefined && v.use < v.value - 0.1 && s.consumables.length < s.consumableSlots;
    const utility = hold ? 0.12 + now * 0.3 : where === "shop" ? 0.35 + now * 0.45 : bestClears ? 0.45 + now * 0.3 : 0.75 + now * 0.45;
    out.push({
      id: slug(`use_${item.label}`),
      kind: "use",
      label: `Use ${item.label}${onCards}`,
      description: `Use ${item.label}${onCards}: ${item.effect || "no description"}. For this run: ${v.useWhy ?? v.why}.${hold ? ` Held, it is worth more: ${v.why}.` : ""}${where === "hand" ? " Using it costs no hand." : ""}`,
      call: { method: "use", params: targets.length ? { consumable: item.index, cards: targets } : { consumable: item.index } },
      utility,
      cards: targets,
    });
  }
  return out.sort((a, b) => b.utility - a.utility);
}

// ---------------------------------------------------------------------------------------------
// Playing a hand
// ---------------------------------------------------------------------------------------------

function handCandidates(c: Ctx, max: number): Draft[] {
  const { s, p } = c;
  const boss = s.blind?.type === "BOSS" ? bossRule(s.blind.name, s.blind.effect) : {};
  const bossName = s.blind?.name ?? "The boss";
  const plays = playOptions(s, 6, c.planHands);
  const best: PlayOption | undefined = plays[0];
  const pace = s.remaining / Math.max(1, s.handsLeft);
  const bestScore = best?.estimate.score ?? 0;
  const bestClears = bestScore >= s.remaining;
  // Discards cost no hand and expire with the round, so while the best play is off pace they are free digging.
  const dig = !bestClears && bestScore < pace && s.discardsLeft > 0;
  const playedThisRound = Object.entries(s.levels).filter(([, l]) => (l?.played_this_round ?? 0) > 0).map(([h]) => h);
  // What a reset would throw away: the Mult Ride the Bus holds, the XMult Obelisk holds.
  const live = (key: string) => s.jokers.filter((j) => j.key === key && !j.debuff);
  const streak = {
    bus: live("j_ride_the_bus").reduce((a, j) => a + (Number.isFinite(j.stats.mult) ? j.stats.mult : 0), 0),
    obelisk: Math.max(1, ...live("j_obelisk").map((j) => (Number.isFinite(j.stats.x_mult) ? j.stats.x_mult : 1))),
  };
  const special: Draft[] = [];
  const out: Draft[] = [];
  /** The part of each move's utility that judges the round from one hand's score; the simulation replaces it. */
  const base = new Map<Draft, number>();

  // Verdant Leaf debuffs every card until a joker is sold. While the hand is debuffed nothing it
  // plays scores, and the round simulation can't see that (fresh draws aren't flagged), so the sale
  // is the only move.
  const leafOn = boss.sellToLift && s.hand.length > 0 && s.hand.filter((h) => h.debuff).length * 2 >= s.hand.length;
  if (leafOn && p.weakest && !p.weakest.eternal) {
    return [{
      id: slug(`sell_${p.weakest.label}_leaf`),
      kind: "sell",
      label: `Sell ${p.weakest.label} to lift ${bossName}`,
      description: `${bossName} debuffs every card until a joker is sold, and every card in hand is debuffed. Sell ${p.weakest.label} (+${money(p.weakest.sell)}; ${p.weakest.note}), the joker the build misses least.`,
      call: { method: "sell", params: { joker: p.weakest.index } },
      utility: 2,
    }];
  }
  if (boss.sellToLift && p.weakest && !p.weakest.eternal && !s.hand.length) {
    special.push({
      id: slug(`sell_${p.weakest.label}_leaf`),
      kind: "sell",
      label: `Sell ${p.weakest.label} to lift ${bossName}`,
      description: `${bossName} debuffs every card until a joker is sold. Sell ${p.weakest.label} (+${money(p.weakest.sell)}; ${p.weakest.note}) first.`,
      call: { method: "sell", params: { joker: p.weakest.index } },
      utility: 1.3,
    });
  }
  // Luchador disables the boss when sold: worth it when the boss is in the way.
  const luchador = s.jokers.find((j) => j.key === "j_luchador");
  if (luchador && s.blind?.type === "BOSS" && !bestClears && p.margin < 1.3) {
    special.push({
      id: "sell_luchador",
      kind: "sell",
      label: `Sell Luchador to disable ${bossName}`,
      description: `Sell Luchador to disable ${bossName} (${s.blind.effect}). The build is only ${p.margin.toFixed(1)}x this blind.`,
      call: { method: "sell", params: { joker: luchador.index } },
      utility: 0.95,
    });
  }

  for (const o of plays) {
    const e = o.estimate;
    const clears = e.score >= s.remaining;
    const after = s.remaining - e.score;
    const consequence = clears
      ? "Clears the blind now."
      : `Pace needed: about ${Math.round(pace)} per hand. ${after} chips still needed afterwards with ${s.handsLeft - 1} hand${s.handsLeft - 1 === 1 ? "" : "s"} left.`;
    // `b` is the part the round simulation replaces: the one-hand guess at the round, and the
    // nudges that only guess at this round too (the build's hand, kickers cycling out). Left on top
    // of the simulated odds they would outweigh several points of them. The rest (Ride the Bus,
    // Obelisk, money, held Steel) reaches past the round and stays.
    let b = Math.min(e.score / Math.max(pace, 1), 2) * 0.55 + (clears ? 0.6 : 0) - (dig && !clears ? 0.15 : 0);
    let u = b;
    const notes: string[] = [];
    if (c.planHands.has(e.hand)) {
      u += 0.08;
      b += 0.07;
      notes.push(`${e.hand} is the build's hand`);
    }
    if (boss.noRepeat && playedThisRound.includes(e.hand)) {
      u = 0.02;
      notes.push(`${bossName}: ${e.hand} already scored this round, so it scores nothing`);
    }
    if (boss.oneType && playedThisRound.length && !playedThisRound.includes(e.hand)) {
      u = 0.02;
      notes.push(`${bossName}: only ${playedThisRound[0]} scores this round`);
    }
    if (boss.avoidMostPlayed && e.hand === c.mostPlayed && s.money > 3) {
      u -= 0.8;
      notes.push(`${bossName}: ${e.hand} is the most played hand, so playing it sets money to $0`);
    }
    if (boss.lowersLevel && c.planHands.has(e.hand) && !clears) {
      u -= 0.12;
      notes.push(`${bossName} lowers ${e.hand}'s level`);
    }
    if (boss.costPerCard) {
      u -= 0.02 * o.cards.length;
      notes.push(`costs ${money(o.cards.length * boss.costPerCard)} under ${bossName}`);
    }
    if (boss.halvesBase) notes.push(`${bossName} halves base chips and mult, so the real score is lower`);
    // A reset costs what the streak holds: nothing on a fresh Ride the Bus, up to a hand's worth
    // of odds once it carries the score. The round simulation already prices this round.
    if (c.tags.has("no_face") && o.cards.some(isFace) && !clears && streak.bus > 0) {
      u -= Math.min(0.12, 0.015 * streak.bus);
      notes.push(`face cards reset Ride the Bus (+${streak.bus} Mult)`);
    }
    if (c.owned.has("j_square") && o.cards.length === 4) {
      u += 0.05;
      notes.push("exactly 4 cards grows Square Joker");
    }
    if (c.tags.has("vary_hand") && e.hand === c.mostPlayed && streak.obelisk > 1) {
      u -= Math.min(0.1, 0.1 * (streak.obelisk - 1));
      notes.push(`the most played hand resets Obelisk (X${+streak.obelisk.toFixed(2)})`);
    }
    if (c.tags.has("repeat_hand") && playedThisRound.includes(e.hand)) u += 0.04;
    // Kickers that don't score still leave the hand: a free discard on top of the play.
    const kickers = o.cards.length - e.scoring.length;
    if (kickers > 0 && !clears && s.handsLeft > 1) {
      u += 0.03;
      b += 0.03;
      notes.push(`the ${kickers} card${kickers === 1 ? "" : "s"} that don't score cycle out for fresh draws, like a free discard`);
    }
    const heldValue = o.cards.filter((x) => x.enhancement === "STEEL" || x.enhancement === "GOLD").length;
    if (heldValue && !clears) {
      u -= 0.05 * heldValue;
      notes.push("plays Steel or Gold cards that pay more when held");
    }
    const draft: Draft = {
      id: slug(`play_${e.hand}_${o.cards.map((x) => x.label).join("")}`),
      kind: "play",
      label: `Play ${e.hand}: ${labels(o.cards)}`,
      description: `Play ${e.hand} with ${labels(o.cards)}: ${e.approximate ? "about " : ""}${e.score} chips (${e.chips} x ${e.mult}). Uses 1 of ${s.handsLeft} hands. ${consequence}${notes.length ? ` Note: ${notes.join("; ")}.` : ""}`,
      call: { method: "play", params: { cards: o.cards.map((x) => x.index) } },
      utility: u,
      cards: o.cards.map((x) => x.index),
      estimate: { hand: e.hand, chips: e.chips, mult: e.mult, score: e.score, clears, approximate: e.approximate },
    };
    out.push(draft);
    base.set(draft, b);
  }

  const discardCost = [...c.owned].filter((k) => ["j_green_joker", "j_ramen", "j_banner", "j_delayed_grat"].includes(k)).length;
  for (const d of discardOptions(s, best, 3)) {
    const chanceText = d.target && d.chance !== undefined ? ` ${Math.round(d.chance * 100)}% chance to draw into ${d.target}${d.targetScore ? ` (about ${d.targetScore} chips)` : ""}.` : " Cycles weak cards for fresh draws.";
    const expected = d.chance !== undefined && d.targetScore ? d.chance * d.targetScore + (1 - d.chance) * bestScore : bestScore * 1.05;
    let b = Math.min(expected / Math.max(pace, 1), 2) * 0.5 * (bestClears ? 0.3 : 1) + (dig ? 0.2 : 0);
    let u = b;
    const notes: string[] = [];
    if (d.target && c.planHands.has(d.target)) {
      u += 0.1;
      b += 0.09;
      notes.push("digs for the build's hand");
    }
    if (discardCost) {
      u -= 0.06 * discardCost;
      notes.push("costs value on Green Joker, Ramen, Banner or Delayed Gratification");
    }
    if (c.owned.has("j_hit_the_road") && d.cards.some((x) => x.rank === "J")) {
      u += 0.08;
      notes.push("discarded Jacks grow Hit the Road");
    }
    if (c.owned.has("j_faceless") && d.cards.filter(isFace).length >= 3) {
      u += 0.1;
      notes.push("3+ face cards pay $5 from Faceless Joker");
    }
    if (c.owned.has("j_yorick") || c.owned.has("j_castle") || c.owned.has("j_mail")) u += 0.03;
    const draft: Draft = {
      id: slug(`discard_${d.target ?? "junk"}_${d.cards.map((x) => x.label).join("")}`),
      kind: "discard",
      label: `Discard ${labels(d.cards)}`,
      description: `Discard ${d.cards.length} (${labels(d.cards)}), keeping ${d.keep}. Costs no hand.${chanceText} ${s.discardsLeft - 1} discard${s.discardsLeft - 1 === 1 ? "" : "s"} left after.${notes.length ? ` Note: ${notes.join("; ")}.` : ""}`,
      call: { method: "discard", params: { cards: d.cards.map((x) => x.index) } },
      utility: u,
      cards: d.cards.map((x) => x.index),
      chance: d.chance,
    };
    out.push(draft);
    base.set(draft, b);
  }

  // Trading Card: the round's first discard of a single card destroys it for $3 (deck thinning).
  if (c.owned.has("j_trading") && s.discardsLeft > 0 && s.handsPlayed === 0) {
    const junk = [...s.hand].filter((x) => !x.forced).sort((a, b) => cardWorth(a) - cardWorth(b))[0];
    if (junk) {
      out.push({
        id: "trading_card_discard",
        kind: "discard",
        label: `Discard ${junk.label} alone (Trading Card)`,
        description: `Discard only ${junk.label}. If it is the round's first discard, Trading Card destroys it and pays $3: thins the deck and earns money.`,
        call: { method: "discard", params: { cards: [junk.index] } },
        utility: 0.45 + (dig ? 0.1 : 0),
        cards: [junk.index],
      });
    }
  }
  // DNA: a single card played as the round's first hand is copied into the deck.
  if (c.owned.has("j_dna") && s.handsPlayed === 0 && s.handsLeft >= 2 && !bestClears) {
    const suit = p.deckFix.suit;
    const keeper = [...s.hand].filter((x) => !x.hidden && (!suit || x.suit === suit)).sort((a, b) => cardWorth(b) - cardWorth(a))[0];
    if (keeper) {
      out.push({
        id: "dna_copy",
        kind: "play",
        label: `Play ${keeper.label} alone (DNA copies it)`,
        description: `Play only ${keeper.label} as the first hand: DNA adds a permanent copy to the deck (deck fixing). Scores little and uses 1 of ${s.handsLeft} hands.`,
        call: { method: "play", params: { cards: [keeper.index] } },
        utility: 0.5,
        cards: [keeper.index],
      });
    }
  }

  // Fork: can a play beat the blind now? Then take one; if not, the round tree weighs every move.
  if (bestClears) c.path.push({ node: "Clear now?", branch: "Yes: take a clearing play", why: `${best!.estimate.hand} makes ${bestScore} of the ${s.remaining} needed` });
  // A hand of more than a dozen cards (Perkeo, Cryptid) would make the simulation slow; the one-hand values stand.
  else if (FEATURES.roundSim && s.hand.length <= 12) {
    c.trace.sim = simulateRound(s, base);
    const top = Math.max(0, ...[...base.keys()].map((d) => d.chance ?? 0));
    c.path.push(
      top < 0.05
        ? { node: "Clear now?", branch: "No, and no line beats it", why: `the best move beats the blind in ${Math.round(top * 100)}% of simulated finishes; the most chips is the goal` }
        : { node: "Clear now?", branch: "No: weigh the round tree", why: c.trace.sim.summary },
    );
  } else c.path.push({ node: "Clear now?", branch: "No: one-hand values", why: "the round simulation is off or the hand is too large" });

  const uses = useCandidates(c, "hand", bestClears).slice(0, 4);
  // Planets and deck-changing cards used now are judged by the round after them: the best moves
  // they leave, simulated like every other move. The rest: a clearly useful card costs no hand,
  // so it goes before the move it would improve.
  const simulated = !bestClears && FEATURES.roundSim && s.hand.length <= 12 ? simulateUses(s, uses) : new Set<Draft>();
  // Tarots that work on cards in hand are kept for the boss blind while a slot is free, unless the
  // simulation says this round needs them now (the user's call: save Tarots for the boss).
  if (s.blind?.type !== "BOSS" && s.consumables.length < s.consumableSlots) {
    for (const u of uses) {
      const item = s.consumables.find((x) => x.index === u.call.params?.consumable);
      if (item?.set === "TAROT" && item.targetMax > 0 && !(simulated.has(u) && !bestClears)) u.utility = Math.min(u.utility, 0.3);
    }
  }
  if (!bestClears) {
    const top = Math.max(0, ...out.map((d) => d.utility));
    for (const u of uses) if (!simulated.has(u) && u.utility >= 1.02) u.utility = Math.max(u.utility, top + 0.05);
  }
  const free = uses.find((u) => u.utility >= 1.02);
  c.path.unshift(free ? { node: "Free card first?", branch: `Yes: ${free.label}`, why: "using it costs no hand" } : { node: "Free card first?", branch: "No", why: s.consumables.length ? "no held card helps this hand" : "no consumables held" });
  return [...special, ...uses.filter((u) => u.utility >= 0.9), ...out, ...uses.filter((u) => u.utility < 0.9)].slice(0, max);
}

/**
 * A Planet or a deck-changing Tarot or Spectral used before the next move: the hand and levels
 * after it, then the best few plays and discards from there, each simulated to the end of the
 * round. The use takes the best of those outcomes on the same scale as the moves themselves
 * (a small edge for costing no hand), so it goes first only when the round goes better after it.
 */
function simulateUses(s: Snapshot, uses: Draft[]): Set<Draft> {
  const done = new Set<Draft>();
  const rand = mulberry32(s.round * 31337 + s.hand.length);
  for (const u of uses) {
    const index = u.call.params?.consumable;
    const item = typeof index === "number" ? s.consumables.find((x) => x.index === index) : undefined;
    if (!item) continue;
    let after: Snapshot | undefined;
    if (item.set === "PLANET" && PLANET_HAND[item.key]) after = { ...s, levels: levelUp(s.levels, PLANET_HAND[item.key]) };
    else if (item.key === "c_black_hole") after = { ...s, levels: levelUpAll(s.levels) };
    else if (changesDeck(item.key)) {
      const targets = (u.cards ?? []).map((i) => s.hand[i]).filter(Boolean);
      const hand = applyToDeck(item, s.hand, targets, rand);
      if (hand) after = { ...s, hand: hand.map((card, i) => ({ ...card, index: i })), consumables: s.consumables.filter((x) => x !== item) };
    }
    if (!after) continue;
    const plays = playOptions(after, 3);
    const discards = discardOptions(after, plays[0], 2);
    const moves = [...plays.map((o) => ({ kind: "play" as const, cards: o.cards.map((x) => x.index) })), ...discards.map((d) => ({ kind: "discard" as const, cards: d.cards.map((x) => x.index) }))];
    if (!moves.length) continue;
    const best = roundOutcomes(after, moves, 40).sort((a, b) => b.clear - a.clear || b.reach - a.reach)[0];
    u.utility = 0.22 + 1.2 * best.clear + 0.3 * best.reach + 0.02 * best.spare;
    u.description += ` Simulated: after it, the best move beats the blind in ${Math.round(best.clear * 100)}% of ${best.samples} finishes.`;
    u.chance = best.clear;
    done.add(u);
  }
  return done;
}

/**
 * When no play beats the blind now, each play and discard is judged by simulated finishes of the
 * round (round.ts) instead of by its own score: its one-hand base utility is swapped for one built
 * from the share of finishes that beat the blind, and the description gives that share.
 */
function simulateRound(s: Snapshot, base: Map<Draft, number>): SimTrace {
  const t0 = performance.now();
  const drafts = [...base.keys()].filter((d) => d.cards?.length);
  const outcomes = roundOutcomes(s, drafts.map((d) => ({ kind: d.kind === "discard" ? "discard" : "play", cards: d.cards! })));
  drafts.forEach((d, i) => {
    const o = outcomes[i];
    const sim = 0.2 + 1.2 * o.clear + 0.3 * o.reach + 0.02 * o.spare;
    d.utility += sim - base.get(d)!;
    d.description += ` Simulated ${o.samples} finishes of the round after this move: the blind is beaten in ${Math.round(o.clear * 100)}%.`;
    d.chance = o.clear;
  });
  const best = drafts.map((d, i) => ({ d, o: outcomes[i] })).sort((a, b) => b.o.clear - a.o.clear)[0];
  return {
    kind: "round",
    ms: performance.now() - t0,
    compared: drafts.length,
    samples: outcomes[0]?.samples ?? 0,
    summary: best ? `Best: ${best.d.label}, beats the blind in ${Math.round(best.o.clear * 100)}%` : "No moves to simulate",
  };
}

// ---------------------------------------------------------------------------------------------
// Shop
// ---------------------------------------------------------------------------------------------

/** Vouchers that change every round, as the simulation plays them. */
const VOUCHER_ROUND: Record<string, { bonus: Setup["bonus"]; text: string }> = {
  v_grabber: { bonus: { hands: 1 }, text: "one more hand a round" },
  v_nacho_tong: { bonus: { hands: 1 }, text: "one more hand a round" },
  v_wasteful: { bonus: { discards: 1 }, text: "one more discard a round" },
  v_recyclomancy: { bonus: { discards: 1 }, text: "one more discard a round" },
  v_paint_brush: { bonus: { handSize: 1 }, text: "one more card in hand" },
  v_palette: { bonus: { handSize: 1 }, text: "one more card in hand" },
};


/** The Soul makes one of these, at random among those not held (any of them with Showman). */
const LEGENDARIES: { key: string; label: string; effect: string }[] = [
  { key: "j_caino", label: "Canio", effect: "This Joker gains X1 Mult when a face card is destroyed (Currently X1 Mult)" },
  { key: "j_triboulet", label: "Triboulet", effect: "Played Kings and Queens each give X2 Mult when scored" },
  { key: "j_yorick", label: "Yorick", effect: "This Joker gains X1 Mult every 23 [23] cards discarded (Currently X1 Mult)" },
  { key: "j_chicot", label: "Chicot", effect: "Disables effect of every Boss Blind" },
  { key: "j_perkeo", label: "Perkeo", effect: "Creates a Negative copy of 1 random consumable card in your possession at the end of the shop" },
];
const soulPicks = (c: Ctx): Item[] =>
  LEGENDARIES.filter((l) => !c.owned.has(l.key) || c.owned.has("j_ring_master")).map((l) => ({ ...l, index: -1, set: "JOKER", cost: 20, sell: 10, rarity: "LEGENDARY", eternal: false, targetMin: 0, targetMax: 0, requiresJokers: 0, randomJoker: false }));
/** The Soul's worth to this run: the mean fit of the Legendaries it could make. */
const soulFit = (c: Ctx): number => {
  const picks = soulPicks(c);
  return picks.length ? picks.reduce((a, l) => a + fitWithExpert(c, l).value, 0) / picks.length : 0;
};

const asJoker = (item: Item, index: number): Joker => ({ index, key: item.key, label: item.label, effect: item.effect, stats: {}, edition: item.edition, rarity: item.rarity, debuff: false, eternal: Boolean(item.eternal), sell: item.sell });

interface SimGain {
  /** Mean share of simulated rounds beaten over the next bosses, now and with the card. */
  now: number;
  with: number;
  /** Per boss: target, share now, share with. */
  bosses: { ante: number; target: number; now: number; with: number }[];
  /** For the description: what the setup changes. */
  text: string;
}

/** Invisible Joker's "(Currently n/2)": ready once n reaches the rounds it needs. */
export function invisibleReady(j: Pick<Joker, "effect">): boolean {
  const m = j.effect.match(/Currently\s*(\d+)\s*\/\s*(\d+)/i);
  return Boolean(m && Number(m[1]) >= Number(m[2]));
}

/**
 * What selling a ready Invisible Joker is worth: the mean, over the jokers it could copy, of the
 * simulated odds at the next bosses with that joker doubled (the copy takes Invisible's slot),
 * against the row as it is; plus a share of what the copied jokers are worth beyond today's score.
 */
function invisibleCopy(c: Ctx, inv: Joker): { utility: number; others: string[]; text: string } | undefined {
  const { s, p } = c;
  const others = s.jokers.filter((j) => j !== inv);
  if (!others.length) return undefined;
  const rest = others.map((j, i) => ({ ...j, index: i }));
  const setups: Setup[] = [{ jokers: s.jokers, levels: s.levels }, ...rest.map((j) => ({ jokers: [...rest, { ...j, index: rest.length, edition: j.edition === "NEGATIVE" ? undefined : j.edition }], levels: s.levels }))];
  const targets = bossTargets(s, 3);
  const odds = targets.map((t, k) => roundOdds(s, setups, t, handsPerRound(s), discardsPerRound(s), 24, undefined, roundsTo(s, k)));
  const mean = (i: number) => odds.reduce((a, o) => a + o[i], 0) / odds.length;
  const gain = rest.reduce((a, _, i) => a + mean(i + 1), 0) / rest.length - mean(0);
  const worth = p.jokers.filter((r) => r.key !== "j_invisible").reduce((a, r) => a + r.worth, 0) / Math.max(1, others.length);
  return {
    utility: Math.min(1.1, 0.55 + TUNING.simWeight * Math.max(0, gain) + 0.25 * worth),
    others: others.map((j) => j.label),
    text: `Simulated rounds at the bosses of antes ${s.ante}-${s.ante + 2}: beaten ${pcts(odds.map((o) => o[0]))} now, ${pcts(odds.map((o) => rest.reduce((a, _, i) => a + o[i + 1], 0) / rest.length))} on average with the copy.`,
  };
}

/**
 * A joker the offer simulation scored and found changing nothing at any of the next three bosses,
 * with no lasting role the simulation can't see (money, copying, growing, an engine or rule). Only
 * for jokers the scorer models, and only when the odds aren't pinned at 0% or 100% everywhere.
 */
function changedNothing(item: Item, g: SimGain | undefined): boolean {
  if (!g || !FEATURES.uselessJoker || !isModelledJoker(item.key)) return false;
  if (!g.bosses.some((b) => b.now > 0.05 && b.now < 0.95)) return false;
  if (Math.max(...g.bosses.map((b) => b.with - b.now)) > 0.005) return false;
  const tags = jokerTags(item.key, item.effect);
  return !["econ", "copy", "scaling", "sell_value", ...ENGINE_TAGS].some((t) => tags.has(t));
}
const NOTHING_TEXT = " In the simulated rounds it changed nothing at any of the three bosses.";

/**
 * For every offered joker and Planet (shop or pack): the share of simulated rounds at this ante's
 * boss beaten with it, against the current row (round.ts). A joker goes into an open slot, or in
 * place of the weakest joker when the row is full. Keyed by the item's index in its area.
 */
/**
 * The joker a full row gives up for a better one. Without simulation it is the build profile's
 * weakest; with it, each sellable joker is also judged by the share of simulated rounds at the next
 * bosses lost without it, so a joker that carries this deck's hands is not sold for its tags.
 */
function swapVictim(c: Ctx): (BuildProfile["jokers"][number] & { loss?: number }) | undefined {
  const { s, p } = c;
  // Selling a Negative joker takes its slot with it, so it never makes room.
  const negative = (index: number) => s.jokers.find((j) => j.index === index)?.edition === "NEGATIVE";
  const sellable = p.jokers.filter((r) => !r.eternal && r.key !== "j_invisible" && !negative(r.index));
  const fallback = p.weakest && !p.weakest.eternal && !negative(p.weakest.index) ? p.weakest : sellable.sort((a, b) => a.worth - b.worth)[0];
  if (!FEATURES.shopSim || s.jokers.length < s.jokerSlots || sellable.length < 2) return fallback;
  const t0 = performance.now();
  const targets = bossTargets(s, 3);
  const setups = [{ jokers: s.jokers, levels: s.levels }, ...sellable.map((r) => ({ jokers: s.jokers.filter((j) => j.index !== r.index), levels: s.levels }))];
  const odds = targets.map((t, k) => roundOdds(s, setups, t, handsPerRound(s), discardsPerRound(s), 40, undefined, roundsTo(s, k)));
  const mean = (i: number) => odds.reduce((a, o) => a + o[i], 0) / odds.length;
  const victim = sellable.map((r, i) => ({ ...r, loss: mean(0) - mean(i + 1) })).sort((a, b) => a.worth + TUNING.simWeight * a.loss - (b.worth + TUNING.simWeight * b.loss))[0];
  c.trace.sim = { kind: "bosses", ms: performance.now() - t0, compared: setups.length, samples: 40, summary: `Row full; ${victim.label} would be sold first` };
  return victim;
}

function simulateOffers(c: Ctx, items: Item[], weak: ReturnType<typeof swapVictim>): Map<Item, SimGain> {
  const t0 = performance.now();
  const { s } = c;
  const out = new Map<Item, SimGain>();
  const full = s.jokers.length >= s.jokerSlots;
  const setups: { item: Item; setup: Setup; text: string }[] = [];
  // Deck-changing Tarots and Spectrals act on a hand: the one dealt now (a pack), or one dealt from
  // the deck for a card bought now and used later.
  const deck = [...s.deckLeft, ...s.hand];
  const rand = mulberry32(s.round * 92821 + deck.length);
  const handFor = () => (s.phase === "SMODS_BOOSTER_OPENED" && s.hand.length ? s.hand : dealtHand(deck, s.handSize, rand));
  for (const item of FEATURES.shopSim ? items : []) {
    const voucher = (item as Partial<ShopItem>).area === "voucher" ? VOUCHER_ROUND[item.key] : undefined;
    if (voucher) {
      setups.push({ item, setup: { jokers: s.jokers, levels: s.levels, bonus: voucher.bonus }, text: `with ${voucher.text}` });
    } else if (item.set === "JOKER") {
      if (!full || item.edition === "NEGATIVE") setups.push({ item, setup: { jokers: [...s.jokers, asJoker(item, s.jokers.length)], levels: s.levels }, text: "with it" });
      else if (weak) setups.push({ item, setup: { jokers: [...s.jokers.filter((j) => j.index !== weak.index), asJoker(item, s.jokers.length)], levels: s.levels }, text: `with it in place of ${weak.label}` });
    } else if (item.set === "PLANET" && PLANET_HAND[item.key]) {
      setups.push({ item, setup: { jokers: s.jokers, levels: levelUp(s.levels, PLANET_HAND[item.key]) }, text: `with ${PLANET_HAND[item.key]} one level higher` });
    } else if (item.key === "c_black_hole") {
      setups.push({ item, setup: { jokers: s.jokers, levels: levelUpAll(s.levels) }, text: "with every hand one level higher" });
    } else if (item.key === "c_soul" && (!full || weak)) {
      const kept = full ? s.jokers.filter((j) => j.index !== weak!.index) : s.jokers;
      for (const l of soulPicks(c)) setups.push({ item, setup: { jokers: [...kept, asJoker(l, s.jokers.length)], levels: s.levels }, text: full ? `with a random Legendary in place of ${weak!.label}` : "with a random Legendary" });
    } else if (FEATURES.deckFixSim && (item.set === "TAROT" || item.set === "SPECTRAL") && changesDeck(item.key)) {
      const hand = handFor();
      const picks = pickTargets(item, hand, c.p.deckFix.suit);
      if (picks === null) continue;
      const targets = picks.map((i) => hand.find((h) => h.index === i)!).filter(Boolean);
      const changed = applyToDeck(item, deck, targets, rand);
      if (changed) setups.push({ item, setup: { jokers: s.jokers, levels: s.levels, deck: changed }, text: `with the deck after it${targets.length ? ` (on ${targets.map((t) => t.label).join(" ")})` : ""}` });
    }
  }
  if (!setups.length) return out;
  // This ante's boss and the next two: early on the row beats the coming boss either way, and what
  // a card is worth shows in the antes after.
  const all = [{ jokers: s.jokers, levels: s.levels }, ...setups.map((x) => x.setup)];
  const perBoss = bossTargets(s, 3).map((target, k) => ({ ante: s.ante + k, target, odds: roundOdds(s, all, target, handsPerRound(s), discardsPerRound(s), 40, undefined, roundsTo(s, k)) }));
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  // An item with several setups (The Soul, one per Legendary) counts their mean.
  const byItem = new Map<Item, number[]>();
  setups.forEach((x, i) => byItem.set(x.item, [...(byItem.get(x.item) ?? []), i + 1]));
  for (const [item, cols] of byItem) {
    const withAt = (b: (typeof perBoss)[number]) => mean(cols.map((k) => b.odds[k]));
    out.set(item, {
      now: mean(perBoss.map((b) => b.odds[0])),
      with: mean(perBoss.map(withAt)),
      bosses: perBoss.map((b) => ({ ante: b.ante, target: b.target, now: b.odds[0], with: withAt(b) })),
      text: setups[cols[0] - 1].text,
    });
  }
  const top = [...out].sort((a, b) => b[1].with - b[1].now - (a[1].with - a[1].now))[0];
  c.trace.sim = {
    kind: "bosses",
    ms: performance.now() - t0 + (c.trace.sim?.ms ?? 0),
    compared: setups.length + 1,
    samples: 40,
    summary: `Bosses of antes ${s.ante}-${s.ante + 2} beaten ${pcts(perBoss.map((b) => b.odds[0]))} now${top ? `; best: ${top[0].label} ${pcts(top[1].bosses.map((b) => b.with))}` : ""}`,
  };
  return out;
}

const pcts = (xs: number[]) => xs.map((x) => `${Math.round(x * 100)}%`).join("/");
const simText = (g: SimGain | undefined) =>
  g
    ? ` Simulated rounds at the bosses of antes ${g.bosses[0].ante}-${g.bosses.at(-1)!.ante} (${g.bosses.map((b) => b.target).join(", ")} chips): beaten ${pcts(g.bosses.map((b) => b.now))} now, ${pcts(g.bosses.map((b) => b.with))} ${g.text}.`
    : "";

/** The rarity odds a shop slot or Buffoon pack draws a joker with. */
const RARITY_WEIGHT: Record<string, number> = { common: 0.7, uncommon: 0.25, rare: 0.05 };

/**
 * What a pack is expected to add, from what it could show: cards drawn the way the game draws them
 * (jokers by rarity, Planets and Tarots evenly), each worth its simulated gain at the next ante's
 * boss from the assessment (cards it didn't simulate count as nothing), the best one (two from a
 * Mega pack) taken. Undefined when there is nothing to weigh it with.
 */
function packOdds(c: Ctx, label: string): { gain: number; why: string } | undefined {
  const a = c.a;
  if (!a || !FEATURES.packOdds) return undefined;
  const l = label.toLowerCase();
  const picks = /mega/.test(l) ? 2 : 1;
  let pool: { key: string; weight: number }[] = [];
  let gainOf = new Map<string, number>();
  let shown = 3;
  let what = "";
  if (l.includes("buffoon")) {
    shown = /jumbo|mega/.test(l) ? 4 : 2;
    const cat = jokerCatalog();
    const count: Record<string, number> = {};
    for (const j of cat.values()) count[j.rarity] = (count[j.rarity] ?? 0) + 1;
    pool = [...cat].filter(([, j]) => RARITY_WEIGHT[j.rarity]).map(([key, j]) => ({ key, weight: RARITY_WEIGHT[j.rarity] / count[j.rarity] }));
    gainOf = new Map(a.targetPool.map((t) => [t.key, t.gain]));
    what = "joker";
  } else if (l.includes("celestial")) {
    shown = /jumbo|mega/.test(l) ? 5 : 3;
    pool = Object.keys(PLANET_HAND).map((key) => ({ key, weight: 1 }));
    gainOf = new Map(a.planets.map((x) => [Object.keys(PLANET_HAND).find((k) => PLANET_HAND[k] === x.hand)!, x.gain]));
    what = "Planet";
  } else if (l.includes("arcana")) {
    shown = /jumbo|mega/.test(l) ? 5 : 3;
    pool = Object.keys(TAROTS).map((key) => ({ key, weight: 1 }));
    gainOf = new Map((a.deck?.fixes ?? []).map((f) => [f.key, f.gain]));
    what = "Tarot";
  } else return undefined;
  if (!pool.length || ![...gainOf.values()].some((g) => g > 0)) return undefined;
  // Telescope puts the most played hand's Planet in every Celestial pack.
  const telescope = what === "Planet" && c.s.usedVouchers.some((v) => /telescope/i.test(v)) ? Object.keys(PLANET_HAND).find((k) => PLANET_HAND[k] === c.mostPlayed) : undefined;
  const rand = mulberry32(c.s.round * 15485863 + pool.length * shown);
  const total = pool.reduce((x, y) => x + y.weight, 0);
  let sum = 0;
  const N = 300;
  for (let n = 0; n < N; n++) {
    const left = [...pool];
    let mass = total;
    const gains: number[] = telescope ? [gainOf.get(telescope) ?? 0] : [];
    while (gains.length < shown && left.length) {
      let r = rand() * mass;
      let i = 0;
      while (i < left.length - 1 && (r -= left[i].weight) > 0) i++;
      gains.push(gainOf.get(left[i].key) ?? 0);
      mass -= left[i].weight;
      left.splice(i, 1);
    }
    sum += gains.sort((x, y) => y - x).slice(0, picks).reduce((x, y) => x + Math.max(0, y), 0);
  }
  const gain = sum / N;
  return { gain, why: `the best ${what}${picks > 1 ? "s" : ""} of the ${shown} it shows add${picks > 1 ? "" : "s"} about ${Math.round(gain * 100)} points of simulated odds at the next ante's boss on average` };
}

function packValue(item: Item, c: Ctx, jokerFull: boolean): { value: number; why: string } | null {
  const base = basePackValue(item, c, jokerFull);
  // Measured shifts (tuning.ts): every pack, and Arcana packs on top (Roffle opens about 1.5 packs a
  // shop from ante 3, Arcana most often; the agent opened 0.4-0.7, Buffoon first).
  // What the pack's cards feed in the jokers held: Arcana for Vampire and Fortune Teller, Celestial
  // for Constellation, Standard for Hologram (src/synergy.ts).
  const kind = ["arcana", "celestial", "standard", "spectral", "buffoon"].find((k) => item.label.toLowerCase().includes(k));
  const fed = kind ? enablerLift(`p_${kind}`, c.owned) : { lift: 0, for: [] };
  const v = base && { ...base, value: base.value + TUNING.packBoost + (/arcana/i.test(item.label) ? TUNING.arcanaBoost - TUNING.tarotCut : 0) + (/spectral/i.test(item.label) ? TUNING.spectralBoost : 0) + TUNING.enablerBonus * fed.lift, why: `${base.why}${fedText(c, fed)}` };
  const odds = v && packOdds(c, item.label);
  return v && odds ? { value: v.value + TUNING.simWeight * 0.8 * odds.gain, why: `${v.why}; ${odds.why}` } : v;
}

function basePackValue(item: Item, c: Ctx, jokerFull: boolean): { value: number; why: string } | null {
  const { s, p } = c;
  const l = item.label.toLowerCase();
  const size = /mega/.test(l) ? 0.06 : /jumbo/.test(l) ? 0.03 : 0;
  if (l.includes("buffoon")) {
    // At high stakes early Buffoon jokers are often Rental, Perishable or Eternal Rental; the money
    // spent compounds through interest (BalatroUniversity's Gold-stake advice).
    if (!jokerFull && p.econ.pressure >= 0.5 && s.ante <= 2) return { value: 0.36 + size, why: "a joker, though early ones at this stake often carry Rental or Perishable stickers" };
    if (!jokerFull) return { value: 0.52 + size, why: "a chance at a joker that fits the build" };
    // Full slots: only worth it when a weak joker could be sold for the find.
    return p.weakest && !p.weakest.eternal && p.weakest.keep < 0.3 ? { value: 0.4 + size, why: `could replace ${p.weakest.label}` } : null;
  }
  if (l.includes("celestial")) {
    // A pack shows 3 (Jumbo, Mega: 5) of the 12 Planets; Telescope makes one of them the most played hand's.
    const shown = /jumbo|mega/.test(l) ? 5 : 3;
    const picks = /mega/.test(l) ? 2 : 1;
    const hit = s.usedVouchers.some((v) => /telescope/i.test(v)) ? 1 : 1 - (12 - shown) / 12;
    const other = c.owned.has("j_constellation") ? 0.6 : 0.42;
    const value = 0.25 + 0.5 * (hit * 0.9 + (1 - hit) * other) * (picks === 2 ? 1.25 : 1) + (c.owned.has("j_constellation") || c.owned.has("j_satellite") ? 0.05 : 0);
    return { value: value + size, why: `${Math.round(hit * 100)}% chance it shows the Planet for ${ARCHETYPES[p.primary.name]?.hands[0] ?? "the build's hand"}` };
  }
  if (l.includes("arcana")) {
    const fixing = p.needs.some((n) => n.startsWith("deck fixing"));
    return { value: 0.36 + size + (fixing ? 0.12 : 0) + (c.owned.has("j_fortune_teller") ? 0.06 : 0), why: fixing ? "Tarots for deck fixing" : "Tarots" };
  }
  if (l.includes("standard")) return { value: 0.3 + size + (p.primary.name === "Flush" ? 0.08 : 0), why: "playing cards for the deck" };
  if (l.includes("spectral")) return { value: 0.3 + size, why: "Spectral cards" };
  return { value: 0.3 + size, why: "a booster pack" };
}

/** A playing card offered in the shop or a Standard pack: worth it when it fixes the deck. */
function cardValue(card: { suit?: string; enhancement?: string; seal?: string; edition?: string; label: string }, c: Ctx): { value: number; why: string } {
  const suit = c.p.deckFix.suit;
  let value = 0.3;
  const why: string[] = [];
  if (suit && card.suit === suit) {
    value += 0.2;
    why.push(`a ${SUIT_NAME[suit]} card for the flush`);
  }
  if (card.enhancement && card.enhancement !== "STONE") {
    value += 0.1;
    why.push(`${card.enhancement.toLowerCase()} enhancement`);
  }
  if (card.seal) {
    value += 0.1;
    why.push(`${card.seal.toLowerCase()} seal`);
  }
  if (card.edition) value += 0.1;
  return { value, why: why.join(", ") || "a plain card" };
}

/** The joker order that scores the build's hand highest (xMult last, Blueprint next to the best). */
function bestOrder(c: Ctx): { order: number[]; gain: number } | null {
  const { s, p } = c;
  const n = s.jokers.length;
  if (n < 2 || n > 6) return null;
  // Scored over the hands the run plays, not only the build's: a conditional xMult (The Duo, Card
  // Sharp, Photograph) may not fire in the build's typical hand but does in the others.
  const played = Object.entries(s.levels).filter(([, l]) => (l?.played ?? 0) > 0).sort((a, b) => (b[1]?.played ?? 0) - (a[1]?.played ?? 0)).map(([h]) => h);
  const hands = [...new Set([p.primary.name, ...played.slice(0, 2)])].filter((h) => ARCHETYPES[h]);
  const scoreOf = (order: number[]) => {
    const row = order.map((i, k) => ({ ...s.jokers[i], index: k }));
    return hands.reduce((a, h) => a + powerOnHand(s, p, h, row), 0);
  };
  // Ties go to the order with every xMult joker after the +Mult and +Chips ones: the game applies
  // jokers left to right, so an xMult that fires first multiplies less.
  const kind = (i: number) => {
    const tags = jokerTags(s.jokers[i].key, s.jokers[i].effect);
    return tags.has("copy") ? 1 : tags.has("xmult") ? 2 : tags.has("mult") || tags.has("chips") ? 0 : 1;
  };
  const inversions = (order: number[]) => order.reduce((a, x, k) => a + order.slice(k + 1).filter((y) => kind(y) < kind(x) && kind(x) === 2).length, 0);
  const now = s.jokers.map((_, i) => i);
  const current = scoreOf(now);
  if (current <= 0) return null;
  let best = { order: now, score: current, inv: inversions(now) };
  const permute = (rest: number[], acc: number[]) => {
    if (!rest.length) {
      const score = scoreOf(acc);
      const inv = inversions(acc);
      if (score > best.score * 1.0001 || (score >= best.score * 0.9999 && inv < best.inv)) best = { order: acc, score, inv };
      return;
    }
    rest.forEach((x, i) => permute([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, x]));
  };
  permute(now, []);
  const gain = (best.score - current) / current;
  return gain >= 0.01 || best.inv < inversions(now) ? { order: best.order, gain: Math.max(0, gain) } : null;
}

function shopCandidates(c: Ctx, max: number): Draft[] {
  const { s, p } = c;
  const jokerFull = s.jokers.length >= s.jokerSlots;
  const consumableFull = s.consumables.length >= s.consumableSlots;
  const interestNow = interestOn(s, s.money);
  // Interest lost to a purchase weighs more at high stakes once the run is saving. While building
  // (antes 1-2 at Gold) it doesn't: experts buy the cheap early scoring there they'd skip at White.
  const econWeight = p.econ.mode === "spend" ? 0 : p.econ.mode === "save" ? TUNING.interestLoss * (1 + p.econ.pressure) : s.ante >= 2 ? 0.04 : 0.02;
  const spend = (cost: number) => {
    const left = s.money - cost;
    const lost = interestNow - interestOn(s, left);
    // Dipping under the reserve: a flat nudge at low stakes; at high stakes it grows with every dollar
    // below the line (Roffle left 71-93% of shops from ante 3 with $25+), so only core buys clear it.
    const under = Math.max(0, p.econ.reserve - left);
    const underReserve = p.econ.mode === "save" && under > 0 ? Math.min(0.25, 0.05 + 0.015 * under * p.econ.pressure) : 0;
    // Credit Card's debt costs no interest now, so it would look free: every new dollar under $0
    // has to be paid back before interest starts again.
    const debt = Math.max(0, -left) - Math.max(0, -s.money);
    const notes = `${lost > 0 ? ` Interest drops from ${money(interestNow)} to ${money(interestNow - lost)}.` : ""}${debt > 0 ? ` Borrows ${money(debt)} on Credit Card.` : ""}`;
    return { left, penalty: lost * econWeight + underReserve + debt * TUNING.debtDollar, note: notes };
  };
  const weak = swapVictim(c);
  const out: Draft[] = [];
  const sims = simulateOffers(c, s.shop.filter((i) => (i.area === "card" || (i.area === "voucher" && VOUCHER_ROUND[i.key])) && i.cost <= s.buyingPower + (weak?.sell ?? 0)), weak);
  // Behind: the build estimate is under the next ante's boss, or the current row beats this ante's
  // boss in under half the simulated rounds.
  // Fork 1, the outlook: behind (or losing) the next bosses, money goes into power; else it banks.
  // The simulated outlook decides when there is one; the build estimate otherwise.
  const outlook = c.a?.outlook.status;
  const behind = outlook ? outlook === "behind" || outlook === "losing" || (!FEATURES.outlookOnly && p.econ.behind) : p.econ.behind;
  c.path.push({
    node: "Outlook",
    branch: behind ? `${outlook === "losing" ? "Losing" : "Behind"}: spend` : `${outlook === "ahead" ? "Ahead" : "On pace"}: bank`,
    why: c.a?.outlook.text ?? (p.econ.behind ? "the build estimate is under the next ante's boss" : "the build estimate covers the next ante's boss"),
  });
  // Fork 2, the row: a full row swaps (the victim chosen by simulated loss); an open one fills.
  c.path.push(
    jokerFull
      ? { node: "Joker row", branch: weak ? `Full: swap out ${weak.label}` : "Full, nothing sellable", why: weak ? weakNote(c, weak) : "every joker is Eternal" }
      : { node: "Joker row", branch: `${s.jokerSlots - s.jokers.length} open: fill`, why: "an open slot takes a joker without selling one" },
  );
  // Fork 3, the targets: jokers the build is missing make rerolling worth more.
  const target = c.a?.targets[0];
  c.path.push(target && target.gain >= 0.05 ? { node: "Targets", branch: `Look for ${target.label}`, why: c.a!.targets.map((t) => `${t.label} +${Math.round(t.gain * 100)}`).join(", ") } : { node: "Targets", branch: "Nothing missing stands out", why: "no joker the code can score adds 5 points at the next ante's boss" });
  const simGain = (item: Item) => {
    const g = sims.get(item);
    return g ? TUNING.simWeight * (g.with - g.now) : 0;
  };

  for (const item of s.shop) {
    const isJoker = item.set === "JOKER";
    const isConsumable = item.set === "PLANET" || item.set === "TAROT" || item.set === "SPECTRAL";
    const isCard = item.set === "DEFAULT" || item.set === "ENHANCED";

    if (item.area === "card" && isJoker) {
      const fit = fitWithExpert(c, item);
      // An Eternal Rental drains $3 a round forever: pass it unless it is the build (Roffle took one, a Brainstorm).
      const eternal = item.eternal && item.rental ? (fit.value >= 0.9 ? 0.1 : 0.35) : item.eternal && fit.value < 0.5 ? 0.15 : 0;
      const pivotText = fit.pivot ? ` It would carry a pivot to ${fit.pivot}.` : "";
      const what = `${item.label}${item.rarity ? `, ${item.rarity.toLowerCase()}` : ""} joker${item.edition ? `, ${item.edition.toLowerCase()} edition` : ""}${item.eternal ? ", eternal (can never be sold)" : ""}: ${item.effect || "no description"}`;
      const nothing = changedNothing(item, sims.get(item));
      const dud = nothing ? 0.2 : 0;
      if (!jokerFull || item.edition === "NEGATIVE") {
        if (item.cost > s.buyingPower) {
          // Short of money for a joker worth much more than the weakest one held: sell it to pay.
          if (weak && item.cost <= s.buyingPower + weak.sell && fit.value + simGain(item) - weak.worth > Math.max(0.6, c.swapMargin)) {
            const cost = spend(item.cost - weak.sell);
            out.push({
              id: slug(`swap_${weak.label}_for_${item.label}`),
              kind: "swap",
              label: `Sell ${weak.label}, buy ${item.label}`,
              description: `Sell ${weak.label} (+${money(weak.sell)}; ${weakNote(c, weak)}) to afford ${what} for ${money(item.cost)}. For this run: ${fit.note}.${pivotText}${fit.expert}${simText(sims.get(item))} Leaves ${money(cost.left)}.${cost.note}`,
              call: { method: "buy", params: { card: item.index } },
              calls: [
                { method: "sell", params: { joker: weak.index } },
                { method: "buy", params: { card: item.index } },
              ],
              utility: 0.4 + (fit.value + simGain(item) - weak.worth) * 0.8 - cost.penalty - eternal,
            });
          }
          continue;
        }
        const cost = spend(item.cost);
        out.push({
          id: slug(`buy_${item.label}`),
          kind: "buy",
          label: `Buy ${item.label} (${money(item.cost)})`,
          description: `Buy ${what}. For this run: ${fit.note}.${pivotText}${fit.expert}${simText(sims.get(item))}${nothing ? NOTHING_TEXT : ""} Leaves ${money(cost.left)}.${cost.note}`,
          call: { method: "buy", params: { card: item.index } },
          utility: fit.value - cost.penalty - eternal + simGain(item) - dud,
        });
      } else if (weak && item.cost <= s.buyingPower + weak.sell) {
        // Slots full: the move is a swap, selling the weakest joker to make room.
        const gain = fit.value - weak.worth + simGain(item) - dud;
        if (gain <= c.swapMargin) continue;
        const cost = spend(item.cost - weak.sell);
        out.push({
          id: slug(`swap_${weak.label}_for_${item.label}`),
          kind: "swap",
          label: `Sell ${weak.label}, buy ${item.label}`,
          description: `Sell ${weak.label} (+${money(weak.sell)}; ${weakNote(c, weak)}) and buy ${what} for ${money(item.cost)}. For this run: ${fit.note}.${pivotText}${fit.expert}${simText(sims.get(item))}${nothing ? NOTHING_TEXT : ""} Leaves ${money(cost.left)}.${cost.note}`,
          call: { method: "buy", params: { card: item.index } },
          calls: [
            { method: "sell", params: { joker: weak.index } },
            { method: "buy", params: { card: item.index } },
          ],
          utility: 0.4 + gain * 0.8 - cost.penalty - eternal,
        });
      }
      continue;
    }

    if (item.cost > s.buyingPower) continue;
    const cost = spend(item.cost);
    let value: { value: number; why: string } | null;
    let kind = item.area as string;
    if (item.area === "card" && isConsumable) {
      if (consumableFull) continue;
      value = consumableValue(item, c);
      // A Planet or untargeted Tarot gets used right away; a targeted Tarot waits for a hand.
      // At high stakes experts lean on Planets, Tarots and Spectrals ("people overestimate the importance of jokers").
      value = { ...value, value: 0.25 + value.value * (item.set === "PLANET" || item.targetMax <= 0 ? 0.5 : 0.4) + 0.06 * p.econ.pressure + simGain(item) - (item.set === "TAROT" ? TUNING.tarotCut : 0), why: `${value.why}${simText(sims.get(item)).replace(/\.$/, "")}` };
      kind = item.set.toLowerCase();
    } else if (item.area === "card" && isCard) {
      value = cardValue({ label: item.label, suit: item.key.split("_")[0], edition: item.edition }, c);
      kind = "playing card";
    } else if (item.area === "voucher") {
      const econ = (item.key === "v_seed_money" || item.key === "v_money_tree") && p.econ.mode !== "spend" && s.ante <= 3 + Math.round(p.econ.pressure) ? 0.1 * (1 + p.econ.pressure) : 0;
      // Vouchers that change every round are valued by the simulated bosses, like a joker.
      const fed = enablerLift(item.key, c.owned);
      value = { value: (VOUCHER_VALUE[item.key] ?? 0.45) * TUNING.voucherScale + TUNING.voucherExpertWeight * voucherDelta(item.key) + econ + simGain(item) + TUNING.enablerBonus * fed.lift, why: `${econ ? "raises the interest cap early" : "a permanent upgrade"}${fedText(c, fed)}${simText(sims.get(item)).replace(/\.$/, "")}` };
    } else if (item.area === "pack") {
      value = packValue(item, c, jokerFull);
      if (!value) continue;
    } else value = { value: 0.3, why: "" };
    out.push({
      id: slug(`buy_${item.label}`),
      kind: "buy",
      label: `Buy ${item.label} (${money(item.cost)})`,
      description: `Buy ${item.label} for ${money(item.cost)}, ${kind}${item.edition ? `, ${item.edition.toLowerCase()} edition` : ""}: ${item.effect || "no description"}.${value.why ? ` For this run: ${value.why}.` : ""} Leaves ${money(cost.left)}.${cost.note}`,
      call: { method: "buy", params: { [item.area]: item.index } },
      utility: value.value - cost.penalty,
    });
  }

  if (s.rerollCost <= s.buyingPower) {
    const coreNeeded = p.needs.includes("xmult") || behind || !jokerFull || (weak !== undefined && weak.keep < 0.2);
    const after = s.money - s.rerollCost;
    // At high stakes reroll only out of money above $25 plus rent, at any ante (Roffle: a poor run had
    // no rerolls before ante 5, a rich one rerolled at antes 2-3 with $45-95).
    const line = 5 * p.econ.interestCap + rentDue(s);
    const canAfford = p.econ.pressure >= 0.5 && p.econ.mode !== "spend" ? after >= line : p.econ.mode !== "save" || after >= p.econ.reserve;
    let u = coreNeeded && canAfford ? TUNING.rerollCore : p.econ.pressure >= 0.5 && !canAfford ? 0.08 : 0.18;
    if (c.owned.has("j_flash")) u += 0.08;
    if (p.econ.mode === "spend") u += 0.06;
    // Out of surplus, a reroll costs no interest; when the build is behind it is the way to find power.
    if (coreNeeded && after - rentDue(s) >= 5 * p.econ.interestCap) u += Math.min(0.1, 0.004 * p.econ.surplus) + (behind ? 0.05 : 0);
    // Money past the cap earns nothing: spent on rerolls it looks for upgrades even when nothing is
    // missing (Roffle at White, ante 4: rerolls in 86% of shops, $37 a visit, leaving with $31).
    const spare = after - rentDue(s) - 5 * p.econ.interestCap - TUNING.rerollBuffer;
    if (!coreNeeded && p.econ.interestCap > 0 && spare >= 0) u += Math.min(0.35, TUNING.rerollSurplus * (spare + s.rerollCost));
    if (FEATURES.targetReroll && canAfford && target && target.gain >= 0.05) u += Math.min(0.12, target.gain * 0.4);
    if (s.rerollCost === 0) u = Math.max(u, 0.5);
    const cost = spend(s.rerollCost);
    out.push({
      id: "reroll_shop",
      kind: "reroll",
      label: `Reroll shop (${money(s.rerollCost)})`,
      description: `Reroll the shop for ${money(s.rerollCost)} to look for ${p.needs.includes("xmult") ? "an xMult joker" : "jokers that fit the build"}. Leaves ${money(after)}.${cost.note}`,
      call: { method: "reroll" },
      utility: u - cost.penalty,
    });
  }

  // Invisible Joker, once it has waited its rounds: selling it duplicates a random other joker.
  const invisible = s.jokers.find((j) => j.key === "j_invisible" && !j.eternal);
  if (invisible) {
    const ready = invisibleReady(invisible);
    const copy = ready ? invisibleCopy(c, invisible) : undefined;
    if (copy) {
      out.push({
        id: "sell_invisible_joker",
        kind: "sell",
        label: `Sell ${invisible.label}: duplicate a random joker`,
        description: `Sell ${invisible.label} (+${money(invisible.sell)}); it is ready (${invisible.effect.match(/Currently [^)]*/)?.[0] ?? "2/2 rounds"}), so selling it duplicates one of ${copy.others.join(", ")} at random, into its slot. ${copy.text}`,
        call: { method: "sell", params: { joker: invisible.index } },
        utility: copy.utility,
      });
    }
    c.path.push({ node: "Invisible Joker", branch: ready ? (copy ? "Ready: sell to duplicate" : "Ready, nothing to copy") : "Not ready: keep", why: invisible.effect });
  }

  // Selling on its own: dead weight, or jokers that pay when sold. A joker the simulated rounds
  // miss isn't dead weight, whatever the typical-hand estimate says.
  const simLoss = new Map((c.a?.synergy.lift?.perJoker ?? []).map((x) => [x.label, x.loss]));
  for (const r of p.jokers) {
    if (r.eternal || r.key === "j_invisible") continue;
    const diet = r.key === "j_diet_cola";
    if (r.keep >= 0.12 && !diet) continue;
    if (FEATURES.simSynergy && !diet && (simLoss.get(r.label) ?? 0) >= 0.02) continue;
    out.push({
      id: slug(`sell_${r.label}`),
      kind: "sell",
      label: `Sell ${r.label} (+${money(r.sell)})`,
      description: diet
        ? `Sell Diet Cola (+${money(r.sell)}) for a free Double Tag.`
        : `Sell ${r.label} (+${money(r.sell)}): ${weakNote(c, r)}. Frees a joker slot for something that fits the build.`,
      call: { method: "sell", params: { joker: r.index } },
      utility: diet ? 0.45 : 0.3 + (jokerFull ? 0.08 : 0),
    });
  }

  // A Rental that no longer carries the build: sell it before the next $3 comes off ahead of interest.
  for (const r of p.jokers) {
    const rent = s.jokers.find((j) => j.index === r.index)?.rental;
    if (!rent || r.eternal || r.worth >= 0.5 || r.keep < 0.12) continue;
    out.push({
      id: slug(`sell_${r.label}_rental`),
      kind: "sell",
      label: `Sell ${r.label} (+${money(r.sell)}), stop its rent`,
      description: `Sell ${r.label} (+${money(r.sell)}): a Rental costing ${money(rent)} every round, charged before interest, and it no longer carries the build (${weakNote(c, r)}).`,
      call: { method: "sell", params: { joker: r.index } },
      utility: 0.34 + 0.08 * p.econ.pressure,
    });
  }

  // A card the game won't let us use (Judgement or Wraith with every joker slot taken) only holds a
  // slot: sold, it pays its price and makes room.
  for (const item of s.consumables) {
    if (!refusedUse(s, item, "hand") || s.jokers.length < s.jokerSlots) continue;
    out.push({
      id: slug(`sell_${item.label}_unusable`),
      kind: "sell",
      label: `Sell ${item.label} (+${money(item.sell)})`,
      description: `Sell ${item.label} (+${money(item.sell)}): it can't be used while every joker slot is taken, and it holds a consumable slot.`,
      call: { method: "sell", params: { consumable: item.index } },
      utility: 0.46 + (s.consumables.length >= s.consumableSlots ? 0.08 : 0),
    });
  }

  // Money counts in $5 steps: when $1-2 short of the next interest step, a spare consumable can buy it.
  const rentNow = rentDue(s);
  const short = 5 - ((s.money - rentNow) % 5 + 5) % 5;
  if (p.econ.mode !== "spend" && interestNow < p.econ.interestCap && short <= 2 && s.money - rentNow >= 3) {
    const spare = s.consumables
      .map((item) => ({ item, v: consumableValue(item, c).value }))
      .filter((x) => x.item.sell >= short && x.v < 0.35)
      .sort((a, b) => a.v - b.v)[0];
    if (spare) {
      out.push({
        id: slug(`sell_${spare.item.label}_interest`),
        kind: "sell",
        label: `Sell ${spare.item.label} (+${money(spare.item.sell)}) for interest`,
        description: `Sell ${spare.item.label} (+${money(spare.item.sell)}), which this build barely uses, to reach ${money(s.money + spare.item.sell)}: one more dollar of interest every round from here.`,
        call: { method: "sell", params: { consumable: spare.item.index } },
        utility: 0.48 + 0.06 * p.econ.pressure,
      });
    }
  }

  const order = bestOrder(c);
  if (order) {
    out.push({
      id: "rearrange_jokers",
      kind: "rearrange",
      label: `Reorder jokers: ${order.order.map((i) => s.jokers[i].label).join(", ")}`,
      description: `Reorder the jokers to ${order.order.map((i) => s.jokers[i].label).join(", ")}: ${order.gain >= 0.01 ? `the hands the run plays score about ${Math.round(order.gain * 100)}% more` : "every xMult joker after the +Mult and +Chips ones"} (jokers apply left to right, so xMult goes last; copy jokers copy their neighbour).`,
      call: { method: "rearrange", params: { jokers: order.order } },
      utility: 0.5 + Math.min(0.3, order.gain),
    });
  }

  out.push(...useCandidates(c, "shop").slice(0, 3));

  // Money past the interest cap earns nothing, so leaving with it is only worth it when nothing on
  // the shelf helps; more so when the build is under the next ante's boss. The live runs that lost at
  // antes 4-7 left shops with $57-90 while Celestial packs and rerolls sat unbought.
  let leave = TUNING.leave;
  const { surplus } = p.econ;
  if (p.econ.mode === "save" && s.money >= p.econ.reserve && surplus < 5) leave += 0.08 + 0.04 * p.econ.pressure;
  if (p.econ.mode === "spend" && s.money >= 10) leave -= 0.08;
  if (surplus >= 5) leave -= behind ? Math.min(0.2, 0.006 * surplus) + 0.08 : Math.min(0.06, 0.002 * surplus);
  out.push({
    id: "leave_shop",
    kind: "next_round",
    label: "Leave shop",
    description: `Leave the shop and go to the next blind with ${money(s.money)} (${money(interestNow)} interest at the end of the next round). ${p.econ.note}`,
    call: { method: "next_round" },
    utility: leave,
  });
  // Keep the exit option even when the list is long.
  const exit = out.pop()!;
  return [...out.sort((a, b) => b.utility - a.utility).slice(0, max - 1), exit];
}

// ---------------------------------------------------------------------------------------------
// Blind select and packs
// ---------------------------------------------------------------------------------------------

/** A boss that cuts against the build, worth $10 to reroll. */
function nastyBoss(c: Ctx): string | null {
  const { s, p } = c;
  const boss = s.blinds.find((b) => b.type === "BOSS");
  if (!boss) return null;
  const rule = bossRule(boss.name, boss.effect);
  const e = boss.effect.toLowerCase();
  if (rule.avoidMostPlayed && c.mostPlayed && c.planHands.has(c.mostPlayed)) return `${boss.name} punishes playing ${c.mostPlayed}, the build's hand`;
  if ((rule.noRepeat || rule.oneType) && c.planHands.size === 1) return `${boss.name} limits repeating one hand type`;
  if (p.deckFix.suit && e.includes(SUIT_NAME[p.deckFix.suit].toLowerCase().slice(0, -1)) && e.includes("debuff")) return `${boss.name} debuffs the build's suit`;
  if (p.theme === "face" && e.includes("face") && e.includes("debuff")) return `${boss.name} debuffs face cards`;
  if (/(only 1 hand|play only 1)/.test(e) && p.margin < 2) return `${boss.name} allows one hand and the build is thin`;
  if (boss.name === "The Flint" && p.margin < 2.5) return "The Flint halves base chips and mult and the build has little to spare";
  return null;
}

function blindCandidates(c: Ctx): Draft[] {
  const { s, p } = c;
  const b = s.blind;
  if (!b) return [];
  const out: Draft[] = [
    {
      id: slug(`play_${b.name}`),
      kind: "select",
      label: `Play ${b.name}`,
      description: `Play the ${b.name} (needs ${b.target} chips; the build's typical ${p.primary.name} makes about ${p.power} a hand). ${b.effect && !/no special effect/i.test(b.effect) ? `Boss rule: ${b.effect}.` : "No special rule."}`,
      call: { method: "select" },
      utility: 0.6,
    },
  ];
  if (b.type !== "BOSS") {
    const order = ["SMALL", "BIG", "BOSS"];
    const next = s.blinds.find((x) => order.indexOf(x.type) === order.indexOf(b.type) + 1);
    const nextTarget = next?.target ?? b.target * 1.5;
    const ratio = (p.power * p.hands) / Math.max(1, nextTarget);
    // A skip gives up this round's shop, so the next blind is played with the jokers held now.
    const nextRule = next?.type === "BOSS" ? bossEffects(next.name, s.handSize) : undefined;
    const odds = FEATURES.shopSim ? roundOdds(s, [{ jokers: s.jokers, levels: s.levels }], nextTarget / (nextRule?.targetScale ?? 1), handsPerRound(s), discardsPerRound(s), 40, nextRule)[0] : undefined;
    const safe = odds !== undefined ? odds >= TUNING.skipSafeOdds : ratio >= TUNING.skipSafeRatio;
    const tagValue = ((b.tag && TAG_VALUE[b.tag.key]) ?? 0.35) + (b.tag && TUNING.buTagWeight ? TUNING.buTagWeight * buTagDelta(b.tag.key) : 0);
    let u = tagValue - TUNING.skipCost;
    if (!safe) u -= 0.3;
    else if (ratio > 3 && (odds === undefined || odds >= 0.99)) u += 0.1;
    if (stakeAtLeast(s.stake, "RED") && b.type === "SMALL") u += 0.08;
    // A skipped blind has no cash out, so its interest is lost too; at high stakes that decides it
    // (Roffle skipped no blinds in 26 logged Gold antes).
    const lostInterest = interestOn(s, s.money);
    u -= lostInterest * 0.04 * (1 + p.econ.pressure);
    if (c.owned.has("j_throwback")) u += 0.1;
    // The outlook decides most of it: a skip loses a shop, which a run behind its bosses can't spare.
    // No bonus for being ahead: skipping more cost antes in the simulator, and Roffle skipped 4 blinds in 424.
    const outlook = FEATURES.skipOutlook ? c.a?.outlook.status : undefined;
    if (outlook === "behind") u -= 0.2;
    else if (outlook === "losing") u -= 0.35;
    if (b.tag && ["tag_investment", "tag_economy", "tag_handy", "tag_garbage", "tag_speed"].includes(b.tag.key) && p.econ.mode !== "spend") u += 0.05 * (1 + p.econ.pressure);
    const reward = `${stakeAtLeast(s.stake, "RED") && b.type === "SMALL" ? "no cash reward" : "this blind's cash reward"}${lostInterest ? `, ${money(lostInterest)} of interest` : ""}`;
    out.push({
      id: slug(`skip_${b.name}`),
      kind: "skip",
      label: `Skip for ${b.tag?.name ?? "tag"}`,
      description: `Skip the ${b.name} and take the ${b.tag?.name ?? "tag"}${b.tag?.effect ? `: ${b.tag.effect}` : ""}. Gives up ${reward} and this round's shop. ${odds !== undefined ? `With the jokers held now, simulated rounds beat the next blind (${nextTarget}) ${Math.round(odds * 100)}% of the time.` : `The build makes about ${ratio.toFixed(1)}x the next blind (${nextTarget}).`}`,
      call: { method: "skip" },
      utility: u,
    });
    c.path.push(u > 0.6 ? { node: "Skip?", branch: `Skip for ${b.tag?.name ?? "the tag"}`, why: c.a?.outlook.text ?? `the build makes ${ratio.toFixed(1)}x the next blind` } : { node: "Skip?", branch: "Play it for the shop", why: c.a?.outlook.text ?? `the build makes ${ratio.toFixed(1)}x the next blind` });
  }
  if (b.type === "BOSS") {
    const threat = c.a?.boss;
    const serious = threat && (threat.threat === "serious" || threat.threat === "severe");
    const pool = FEATURES.bossPoolReroll ? c.a?.pool : undefined;
    let reroll = false;
    if (s.bossRerollAvailable) {
      const why = nastyBoss(c);
      const affordable = s.money - 10 >= (p.econ.mode === "save" ? Math.min(p.econ.reserve, 15) : 0);
      // With the pool simulated, a reroll is worth what it saves against the average replacement;
      // without it, a serious threat or a rule that cuts against the build.
      const edge = pool ? pool.currentDrop - pool.expectedDrop : undefined;
      const u = !affordable ? 0.2 : edge !== undefined ? Math.max(0.15, Math.min(0.85, 0.5 + 1.2 * edge)) : serious ? 0.72 : why ? 0.62 : 0.2;
      reroll = u > 0.6;
      out.push({
        id: "reroll_boss",
        kind: "reroll_boss",
        label: "Reroll boss ($10)",
        description: `Pay $10 to replace ${b.name} (${b.effect}) with a random different boss.${why ? ` ${why}.` : ""}${threat ? ` ${threat.text}` : ""}${pool ? ` ${pool.text}` : ""}`,
        call: { method: "reroll_boss" },
        utility: u,
      });
    }
    c.path.push({
      node: "Boss",
      branch: reroll ? `Reroll ${b.name}` : serious && !s.bossRerollAvailable ? `Face ${b.name} (no reroll)` : `Face ${b.name}`,
      why: [threat?.text ?? "its rule doesn't change scoring here", pool?.text].filter(Boolean).join(" "),
    });
  }
  return out;
}

function packCandidates(c: Ctx): Draft[] {
  const { s, p } = c;
  const out: Draft[] = [];
  const jokerFull = s.jokers.length >= s.jokerSlots;
  const weak = swapVictim(c);
  const sims = simulateOffers(c, s.pack, weak);
  const kind = s.pack.some((i) => i.set === "JOKER") ? "Jokers" : s.pack.some((i) => i.set === "PLANET") ? "Planets" : s.pack.some((i) => i.set === "TAROT") ? "Tarots" : s.pack.some((i) => i.set === "SPECTRAL") ? "Spectrals" : "Playing cards";
  c.path.push({
    node: "Pack",
    branch: kind,
    why:
      kind === "Jokers" || kind === "Planets"
        ? `each card simulated at the next bosses${jokerFull && kind === "Jokers" ? `; the row is full, so a joker replaces ${weak?.label ?? "nothing sellable"}` : ""}`
        : kind === "Tarots"
          ? "each card judged by what it does to the cards in hand and the build"
          : kind === "Spectrals"
            ? "each card checked for what it destroys"
            : "each card judged by whether it fits the deck",
  });
  const simGain = (item: Item) => {
    const g = sims.get(item);
    return g ? TUNING.simWeight * (g.with - g.now) : 0;
  };
  for (const item of s.pack) {
    if (item.requiresJokers > s.jokers.length) continue;
    if (item.set === "JOKER") {
      const fit = fitWithExpert(c, item);
      const nothing = changedNothing(item, sims.get(item));
      const dud = nothing ? 0.2 : 0;
      const what = `${item.label}${item.edition ? ` (${item.edition.toLowerCase()})` : ""}: ${item.effect || "no description"}. For this run: ${fit.note}.${fit.pivot ? ` It would carry a pivot to ${fit.pivot}.` : ""}${fit.expert}${simText(sims.get(item))}${nothing ? NOTHING_TEXT : ""}`;
      if (!jokerFull || item.edition === "NEGATIVE") {
        out.push({ id: slug(`take_${item.label}`), kind: "pack", label: `Take ${item.label}`, description: `Take ${what}`, call: { method: "pack", params: { card: item.index } }, utility: fit.value + simGain(item) - dud });
      } else if (weak && fit.value - weak.worth + simGain(item) - dud > c.swapMargin) {
        out.push({
          id: slug(`swap_${weak.label}_for_${item.label}`),
          kind: "swap",
          label: `Sell ${weak.label}, take ${item.label}`,
          description: `Sell ${weak.label} (+${money(weak.sell)}; ${weakNote(c, weak)}) and take ${what}`,
          call: { method: "pack", params: { card: item.index } },
          calls: [
            { method: "sell", params: { joker: weak.index } },
            { method: "pack", params: { card: item.index } },
          ],
          utility: 0.4 + (fit.value - weak.worth + simGain(item) - dud) * 0.8,
        });
      }
      continue;
    }
    if (item.key === "c_soul") {
      // A random Legendary, valued as the jokers it could be. With the row full it sells the weakest
      // joker first, whenever the Legendary is expected to beat it: the pack is paid for already
      // and a Legendary turns up nowhere else.
      const value = soulFit(c) + simGain(item);
      const what = `The Soul: ${item.effect || "creates a Legendary Joker"}. For this run: one of ${soulPicks(c).map((l) => l.label).join(", ")} at random.${simText(sims.get(item))}`;
      if (!jokerFull) out.push({ id: slug("take_the_soul"), kind: "pack", label: "Take The Soul", description: `Take ${what}`, call: { method: "pack", params: { card: item.index } }, utility: value });
      else if (weak && value > weak.worth) {
        out.push({
          id: slug(`swap_${weak.label}_for_the_soul`),
          kind: "swap",
          label: `Sell ${weak.label}, take The Soul`,
          description: `Sell ${weak.label} (+${money(weak.sell)}; ${weakNote(c, weak)}) and take ${what}`,
          call: { method: "pack", params: { card: item.index } },
          calls: [
            { method: "sell", params: { joker: weak.index } },
            { method: "pack", params: { card: item.index } },
          ],
          utility: 0.4 + (value - weak.worth) * 0.8,
        });
      }
      continue;
    }
    const targets = pickTargets(item, s.hand, p.deckFix.suit);
    if (targets === null) continue;
    const onCards = targets.length ? ` on ${targets.map((i) => s.hand[i].label).join(" ")}` : "";
    const playing = s.packCards.find((x) => x.index === item.index);
    // Cards taken from a pack are used at once (a playing card joins the deck).
    const taken: { value: number; why: string; use?: number; useWhy?: string } = playing ? cardValue(playing, c) : consumableValue(item, c);
    const v = taken.use !== undefined ? { value: taken.use, why: taken.useWhy ?? taken.why } : taken;
    out.push({
      id: slug(`take_${item.label}`),
      kind: "pack",
      label: `Take ${item.label}${onCards}`,
      description: `Take ${item.label}${onCards}: ${item.effect || "no description"}. For this run: ${v.why}.${simText(sims.get(item))}`,
      call: { method: "pack", params: targets.length ? { card: item.index, targets } : { card: item.index } },
      utility: 0.3 + v.value * 0.6 + simGain(item),
      cards: targets,
    });
  }
  const redCard = c.owned.has("j_red_card");
  out.push({
    id: "skip_pack",
    kind: "pack_skip",
    label: "Skip pack",
    description: `Skip the rest of this booster pack and take nothing more from it.${redCard ? " Red Card gains +3 Mult for skipping." : ""}`,
    call: { method: "pack", params: { skip: true } },
    utility: 0.15 + (redCard ? 0.25 : 0),
  });
  return out;
}

export function buildCandidates(s: Snapshot, opts: CandidateOptions): CandidateSet {
  const max = Math.min(opts.maxOptions || MAX_OPTIONS, MAX_OPTIONS);
  const auto = (id: string, label: string, call: RpcCall): CandidateSet => ({
    phase: s.phase,
    candidates: [],
    auto: { id, kind: call.method, label, description: label, call, utility: 1, prior: 1 },
  });
  const ctx = () => context(s, opts.profile ?? profileBuild(s, opts.plan?.build), opts);

  switch (s.phase) {
    case "MENU":
      if (!opts.autoStart) return { phase: s.phase, candidates: [], note: "At the main menu. Start a run from the UI." };
      return auto("start_run", `Start a ${opts.autoStart.deck} deck run on ${opts.autoStart.stake} stake`, {
        method: "start",
        params: { deck: opts.autoStart.deck, stake: opts.autoStart.stake, ...(opts.autoStart.seed ? { seed: opts.autoStart.seed } : {}) },
      });
    case "GAME_OVER":
      return { phase: s.phase, candidates: [], note: `Run over: ${s.runSummary?.result ?? (s.won ? "Victory" : "Lost")}` };
    case "ROUND_EVAL":
      if (s.victoryOverlay) {
        if (!opts.endless) return { phase: s.phase, candidates: [], note: "Run won. Endless mode is off." };
        return auto("endless", "Continue into endless mode", { method: "endless" });
      }
      return auto("cash_out", `Cash out${s.cashout !== undefined ? ` ${money(s.cashout)}` : ""}`, { method: "cash_out" });
    case "BLIND_SELECT": {
      const c = ctx();
      if (FEATURES.shopSim) c.a = assess(s, c.p, { bossesSeen: opts.bossesSeen });
      return { phase: s.phase, candidates: finalize(blindCandidates(c), max), assessment: c.a, path: c.path };
    }
    case "SELECTING_HAND": {
      const c = ctx();
      c.a = assess(s, c.p, { simulate: false });
      return { phase: s.phase, candidates: finalize(handCandidates(c, max), max), sim: c.trace.sim, assessment: c.a, path: c.path };
    }
    case "SHOP": {
      const c = ctx();
      if (FEATURES.shopSim) c.a = assess(s, c.p, { targets: true, bossesSeen: opts.bossesSeen });
      return { phase: s.phase, candidates: finalize(shopCandidates(c, max), max), sim: c.trace.sim, assessment: c.a, path: c.path };
    }
    case "SMODS_BOOSTER_OPENED": {
      const c = ctx();
      if (FEATURES.shopSim) c.a = assess(s, c.p, { targets: s.pack.some((i) => i.set === "JOKER"), bossesSeen: opts.bossesSeen });
      return { phase: s.phase, candidates: finalize(packCandidates(c), max), sim: c.trace.sim, assessment: c.a, path: c.path };
    }
    default:
      return { phase: s.phase, candidates: [], note: `Unhandled phase ${s.phase}; waiting.` };
  }
}

