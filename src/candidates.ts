// Legal actions for the current phase, each with a plain-language description for the model,
// the exact BlindDeck call that performs it, and a heuristic utility (fallback pick + UI ghost marker).
// Lists stay well under StartLux's 26-options-per-pass ceiling no matter how large the hand is.

import { cardWorth, type PCard } from "./cards.ts";
import type { Item, ShopItem, Snapshot } from "./extract.ts";
import { discardOptions, playOptions, type PlayOption } from "./options.ts";

export interface RpcCall {
  method: string;
  params?: Record<string, unknown>;
}

export interface Candidate {
  id: string;
  kind: string;
  label: string;
  description: string;
  call: RpcCall;
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
}

export interface CandidateOptions {
  autoStart?: { deck: string; stake: string; seed?: string };
  endless: boolean;
  maxOptions: number;
}

const MAX_OPTIONS = 24;

const PLANET_HAND: Record<string, string> = {
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

const RARITY_UTILITY: Record<string, number> = { COMMON: 0.5, UNCOMMON: 0.62, RARE: 0.78, LEGENDARY: 0.95 };
const GOOD_TAGS = new Set(["tag_double", "tag_negative", "tag_polychrome", "tag_rare", "tag_voucher", "tag_holo", "tag_foil", "tag_investment", "tag_economy"]);

const labels = (cards: PCard[]) => cards.map((c) => c.label).join(" ");
const money = (n: number) => `$${n}`;

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export function interestOn(s: Snapshot, dollars: number): number {
  const v = s.usedVouchers.join(" ").toLowerCase();
  const cap = v.includes("money tree") || v.includes("v_money_tree") ? 20 : v.includes("seed money") || v.includes("v_seed_money") ? 10 : 5;
  return Math.max(0, Math.min(cap, Math.floor(dollars / 5)));
}

function finalize(list: Omit<Candidate, "prior">[], max: number): Candidate[] {
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

// ---------------------------------------------------------------------------------------------
// Consumable targets: which hand cards a Tarot/Spectral should touch.
// ---------------------------------------------------------------------------------------------

const SUIT_TAROT: Record<string, string> = { c_star: "D", c_moon: "C", c_sun: "H", c_world: "S" };

export function pickTargets(item: Item, hand: PCard[]): number[] | null {
  if (item.targetMax <= 0) return [];
  const pool = hand.filter((c) => !c.hidden);
  if (pool.length < Math.max(1, item.targetMin)) return null;
  const n = Math.min(item.targetMax, pool.length);
  const asc = [...pool].sort((a, b) => cardWorth(a) - cardWorth(b));
  const desc = [...asc].reverse();
  let picks: PCard[];
  if (item.key === "c_hanged_man") picks = asc.slice(0, n);
  else if (item.key === "c_death") {
    // Left card becomes a copy of the right card: lowest-worth card left of the best one.
    let bestPair: [PCard, PCard] | null = null;
    let low: PCard | null = null;
    for (const c of [...pool].sort((a, b) => a.index - b.index)) {
      if (low && (!bestPair || cardWorth(c) - cardWorth(low) > cardWorth(bestPair[1]) - cardWorth(bestPair[0]))) bestPair = [low, c];
      if (!low || cardWorth(c) < cardWorth(low)) low = c;
    }
    if (!bestPair || cardWorth(bestPair[1]) <= cardWorth(bestPair[0])) return null;
    picks = bestPair;
  } else if (SUIT_TAROT[item.key]) picks = asc.filter((c) => c.suit !== SUIT_TAROT[item.key]).slice(0, n);
  else if (item.key === "c_strength") picks = desc.filter((c) => c.rank && c.rank !== "A").slice(0, n);
  else picks = desc.slice(0, n);
  if (picks.length < Math.max(1, item.targetMin)) return null;
  return picks.map((c) => c.index).sort((a, b) => a - b);
}

function consumableUtility(item: Item, bestHand?: string): number {
  if (item.set === "PLANET") return PLANET_HAND[item.key] && PLANET_HAND[item.key] === bestHand ? 0.62 : 0.45;
  if (item.set === "TAROT") return 0.35;
  if (item.set === "SPECTRAL") return 0.3;
  return 0.25;
}

function useCandidates(s: Snapshot, bestHand?: string): Omit<Candidate, "prior">[] {
  const out: Omit<Candidate, "prior">[] = [];
  for (const item of s.consumables) {
    if (item.requiresJokers > s.jokers.length) continue;
    const targets = pickTargets(item, s.hand);
    if (targets === null) continue;
    const onCards = targets.length ? ` on ${targets.map((i) => s.hand[i].label).join(" ")}` : "";
    out.push({
      id: slug(`use_${item.label}`),
      kind: "use",
      label: `Use ${item.label}${onCards}`,
      description: `Use ${item.label}${onCards}: ${item.effect || "no description"}`,
      call: { method: "use", params: targets.length ? { consumable: item.index, cards: targets } : { consumable: item.index } },
      utility: consumableUtility(item, bestHand),
      cards: targets,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------------------------

function handCandidates(s: Snapshot, max: number): Omit<Candidate, "prior">[] {
  const plays = playOptions(s, 6);
  const best: PlayOption | undefined = plays[0];
  const pace = s.remaining / Math.max(1, s.handsLeft);
  const bestScore = best?.estimate.score ?? 0;
  const bestClears = bestScore >= s.remaining;
  // Discards cost no hand and expire with the round, so while the best play is off pace they are free digging.
  const dig = !bestClears && bestScore < pace && s.discardsLeft > 0;
  const out: Omit<Candidate, "prior">[] = [];

  for (const p of plays) {
    const e = p.estimate;
    const clears = e.score >= s.remaining;
    const after = s.remaining - e.score;
    const consequence = clears
      ? "Clears the blind now."
      : `Pace needed: about ${Math.round(pace)} per hand. ${after} chips still needed afterwards with ${s.handsLeft - 1} hand${s.handsLeft - 1 === 1 ? "" : "s"} left.`;
    out.push({
      id: slug(`play_${e.hand}_${p.cards.map((c) => c.label).join("")}`),
      kind: "play",
      label: `Play ${e.hand}: ${labels(p.cards)}`,
      description: `Play ${e.hand} with ${labels(p.cards)}: ${e.approximate ? "about " : ""}${e.score} chips (${e.chips} x ${e.mult}). Uses 1 of ${s.handsLeft} hands. ${consequence}`,
      call: { method: "play", params: { cards: p.cards.map((c) => c.index) } },
      utility: Math.min(e.score / Math.max(pace, 1), 2) * 0.55 + (clears ? 0.6 : 0) - (dig && !clears ? 0.15 : 0),
      cards: p.cards.map((c) => c.index),
      estimate: { hand: e.hand, chips: e.chips, mult: e.mult, score: e.score, clears, approximate: e.approximate },
    });
  }

  for (const d of discardOptions(s, best, 3)) {
    const chanceText = d.target && d.chance !== undefined ? ` ${Math.round(d.chance * 100)}% chance to draw into ${d.target}${d.targetScore ? ` (about ${d.targetScore} chips)` : ""}.` : " Cycles weak cards for fresh draws.";
    const expected = d.chance !== undefined && d.targetScore ? d.chance * d.targetScore + (1 - d.chance) * bestScore : bestScore * 1.05;
    out.push({
      id: slug(`discard_${d.target ?? "junk"}_${d.cards.map((c) => c.label).join("")}`),
      kind: "discard",
      label: `Discard ${labels(d.cards)}`,
      description: `Discard ${d.cards.length} (${labels(d.cards)}), keeping ${d.keep}. Costs no hand.${chanceText} ${s.discardsLeft - 1} discard${s.discardsLeft - 1 === 1 ? "" : "s"} left after.`,
      call: { method: "discard", params: { cards: d.cards.map((c) => c.index) } },
      utility: Math.min(expected / Math.max(pace, 1), 2) * 0.5 * (bestClears ? 0.3 : 1) + (dig ? 0.2 : 0),
      cards: d.cards.map((c) => c.index),
      chance: d.chance,
    });
  }

  out.push(...useCandidates(s, best?.estimate.hand).slice(0, 4));
  return out.slice(0, max);
}

function shopItemUtility(item: ShopItem): number {
  if (item.area === "voucher") return 0.5;
  if (item.area === "pack") {
    const l = item.label.toLowerCase();
    if (l.includes("buffoon")) return 0.5;
    if (l.includes("celestial")) return 0.42;
    if (l.includes("arcana")) return 0.36;
    if (l.includes("spectral")) return 0.32;
    return 0.26;
  }
  if (item.set === "JOKER") return (RARITY_UTILITY[item.rarity ?? ""] ?? 0.5) + (/x\d|X\d|×/.test(item.effect) ? 0.1 : 0);
  if (item.set === "PLANET") return 0.42;
  if (item.set === "TAROT") return 0.32;
  if (item.set === "SPECTRAL") return 0.3;
  return 0.25;
}

function shopCandidates(s: Snapshot, max: number): Omit<Candidate, "prior">[] {
  const out: Omit<Candidate, "prior">[] = [];
  const jokerFull = s.jokers.length >= s.jokerSlots;
  const consumableFull = s.consumables.length >= s.consumableSlots;
  const interestNow = interestOn(s, s.money);

  for (const item of s.shop) {
    if (item.cost > s.buyingPower) continue;
    const isJoker = item.set === "JOKER";
    const isConsumable = item.set === "PLANET" || item.set === "TAROT" || item.set === "SPECTRAL";
    if (item.area === "card" && isJoker && jokerFull && item.edition !== "NEGATIVE") continue;
    if (item.area === "card" && isConsumable && consumableFull) continue;
    // A Buffoon pack with no free joker slot can only be skipped.
    if (item.area === "pack" && /buffoon/i.test(item.label) && jokerFull) continue;
    const left = s.money - item.cost;
    const interestAfter = interestOn(s, left);
    const interestNote = interestAfter < interestNow ? ` Interest drops from ${money(interestNow)} to ${money(interestAfter)}.` : "";
    const interestCost = (interestNow - interestAfter) * (s.ante >= 2 ? 0.06 : 0.03);
    const kind = item.area !== "card" ? item.area : isJoker ? "Joker" : isConsumable ? item.set.toLowerCase() : "playing card";
    out.push({
      id: slug(`buy_${item.label}`),
      kind: "buy",
      label: `Buy ${item.label} (${money(item.cost)})`,
      description: `Buy ${item.label} for ${money(item.cost)}${item.rarity ? `, ${item.rarity.toLowerCase()}` : ""} ${kind}${item.edition ? `, ${item.edition.toLowerCase()} edition` : ""}: ${item.effect || "no description"}. Leaves ${money(left)}.${interestNote}`,
      call: { method: "buy", params: { [item.area]: item.index } },
      utility: shopItemUtility(item) - interestCost,
    });
  }

  if (s.rerollCost <= s.buyingPower) {
    out.push({
      id: "reroll_shop",
      kind: "reroll",
      label: `Reroll shop (${money(s.rerollCost)})`,
      description: `Reroll the shop for ${money(s.rerollCost)} to see new jokers and cards. Leaves ${money(s.money - s.rerollCost)}.`,
      call: { method: "reroll" },
      utility: s.money - s.rerollCost >= 25 ? 0.35 : 0.18,
    });
  }

  for (const j of [...s.jokers].filter((j) => !j.eternal).sort((a, b) => a.sell - b.sell).slice(0, 5)) {
    out.push({
      id: slug(`sell_${j.label}`),
      kind: "sell",
      label: `Sell ${j.label} (+${money(j.sell)})`,
      description: `Sell the ${j.label} joker for ${money(j.sell)}, freeing a joker slot. It currently does: ${j.effect || "no description"}.`,
      call: { method: "sell", params: { joker: j.index } },
      utility: jokerFull ? 0.2 : 0.08,
    });
  }

  out.push(...useCandidates(s).slice(0, 3));

  out.push({
    id: "leave_shop",
    kind: "next_round",
    label: "Leave shop",
    description: `Leave the shop and go to the next blind, keeping ${money(s.money)} (earns ${money(interestNow)} interest at the end of the next round).`,
    call: { method: "next_round" },
    utility: 0.42 + (s.money >= 25 ? 0.08 : 0),
  });
  // Keep the exit option even when the list is long.
  const exit = out.pop()!;
  return [...out.sort((a, b) => b.utility - a.utility).slice(0, max - 1), exit];
}

function blindCandidates(s: Snapshot): Omit<Candidate, "prior">[] {
  const b = s.blind;
  if (!b) return [];
  const out: Omit<Candidate, "prior">[] = [
    {
      id: slug(`play_${b.name}`),
      kind: "select",
      label: `Play ${b.name}`,
      description: `Play the ${b.name} (needs ${b.target} chips). ${b.effect && !/no special effect/i.test(b.effect) ? `Boss rule: ${b.effect}.` : "No special rule."}`,
      call: { method: "select" },
      utility: 0.6,
    },
  ];
  if (b.type !== "BOSS") {
    out.push({
      id: slug(`skip_${b.name}`),
      kind: "skip",
      label: `Skip for ${b.tag?.name ?? "tag"}`,
      description: `Skip the ${b.name} without playing it and take the ${b.tag?.name ?? "tag"}${b.tag?.effect ? `: ${b.tag.effect}` : ""}. Skipping gives up this blind's cash reward.`,
      call: { method: "skip" },
      utility: 0.3 + (b.tag && GOOD_TAGS.has(b.tag.key) ? 0.15 : 0),
    });
  }
  if (b.type === "BOSS" && s.bossRerollAvailable) {
    out.push({
      id: "reroll_boss",
      kind: "reroll_boss",
      label: "Reroll boss ($10)",
      description: `Pay $10 to replace ${b.name} (${b.effect}) with a random different boss.`,
      call: { method: "reroll_boss" },
      utility: 0.25,
    });
  }
  return out;
}

function packCandidates(s: Snapshot): Omit<Candidate, "prior">[] {
  const out: Omit<Candidate, "prior">[] = [];
  const jokerFull = s.jokers.length >= s.jokerSlots;
  for (const item of s.pack) {
    if (item.set === "JOKER" && jokerFull && item.edition !== "NEGATIVE") continue;
    if (item.requiresJokers > s.jokers.length) continue;
    const targets = pickTargets(item, s.hand);
    if (targets === null) continue;
    const onCards = targets.length ? ` on ${targets.map((i) => s.hand[i].label).join(" ")}` : "";
    const playing = s.packCards.find((c) => c.index === item.index) ?? null;
    const utility =
      item.set === "JOKER" ? (RARITY_UTILITY[item.rarity ?? ""] ?? 0.5) : item.set === "PLANET" ? 0.6 : item.set === "TAROT" ? 0.45 : item.set === "SPECTRAL" ? 0.35 : 0.3 + (playing ? cardWorth(playing) / 200 : 0);
    out.push({
      id: slug(`take_${item.label}`),
      kind: "pack",
      label: `Take ${item.label}${onCards}`,
      description: `Take ${item.label}${onCards}: ${item.effect || "no description"}`,
      call: { method: "pack", params: targets.length ? { card: item.index, targets } : { card: item.index } },
      utility,
      cards: targets,
    });
  }
  out.push({
    id: "skip_pack",
    kind: "pack_skip",
    label: "Skip pack",
    description: "Skip the rest of this booster pack and take nothing more from it.",
    call: { method: "pack", params: { skip: true } },
    utility: 0.15,
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
    case "BLIND_SELECT":
      return { phase: s.phase, candidates: finalize(blindCandidates(s), max) };
    case "SELECTING_HAND":
      return { phase: s.phase, candidates: finalize(handCandidates(s, max), max) };
    case "SHOP":
      return { phase: s.phase, candidates: finalize(shopCandidates(s, max), max) };
    case "SMODS_BOOSTER_OPENED":
      return { phase: s.phase, candidates: finalize(packCandidates(s), max) };
    default:
      return { phase: s.phase, candidates: [], note: `Unhandled phase ${s.phase}; waiting.` };
  }
}
