// What an expert did with each joker, from the Roffle Lite video dataset (data/roffle). The agent
// does not train on it: `tools/roffle/priors.ts` counts, per joker, how often he took it when a
// shop or pack offered it, and the candidates use that as a small utility nudge, sized by the
// leave-one-video-out benchmark in `tools/roffle/agree.ts`. The model never sees it as text: the
// data shapes the option values, and the decision combines those with the model's judgment.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface JokerTally {
  /** Shop and pack visits that offered it. */
  offered: number;
  /** Visits where he took it. */
  taken: number;
  /** The same, restricted to antes 1-3. */
  offeredEarly: number;
  takenEarly: number;
  /** Times he sold it, and times he got it any way (buy, pack, made by another card). */
  sold: number;
  acquired: number;
  /** Offers his cursor rested on that he still didn't take. Absent in priors built before hovers. */
  passed?: number;
}

export interface ExpertPriors {
  source: { videos: string[]; visits: number; built: string };
  /** Share of offered jokers he took, overall and in antes 1-3. */
  base: number;
  baseEarly: number;
  jokers: Record<string, JokerTally>;
}

export interface ExpertSignal {
  /** Smoothed take rate minus the base rate: above zero means he took it more than most. */
  delta: number;
  /** For the option's description; absent when the counts are too small to mean anything. */
  note?: string;
}

/**
 * Utility added per unit of `delta`. Chosen with `tools/roffle/agree.ts` (leave-one-video-out) on 12
 * videos and 173 picks: 0 gives 46% pick agreement, 0.5 gives 50%, 1 gives 53%, and 1.5 adds nothing
 * more while take agreement starts to slip. Past 1 it would mostly copy his habits at Gold stake.
 */
export const EXPERT_WEIGHT = 1;
/** Pseudo-offers at the base rate added to every joker's counts, so one sighting moves little. */
const SMOOTHING = 3;
const EARLY_ANTE = 3;

export const DEFAULT_PRIORS_PATH = resolve(import.meta.dirname, "..", "data", "roffle", "priors.json");

export function loadExpertPriors(path = DEFAULT_PRIORS_PATH): ExpertPriors | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ExpertPriors;
  } catch {
    return undefined;
  }
}

/** How he treated this joker when offered; early-game counts are used in antes 1-3 when there are enough. */
export function expertTake(priors: ExpertPriors | undefined, key: string, ante: number): ExpertSignal | undefined {
  const j = priors?.jokers[key];
  if (!priors || !j || j.offered === 0) return undefined;
  const early = ante <= EARLY_ANTE && j.offeredEarly >= 2;
  const taken = early ? j.takenEarly : j.taken;
  const offered = early ? j.offeredEarly : j.offered;
  const base = early ? priors.baseEarly : priors.base;
  const rate = (taken + SMOOTHING * base) / (offered + SMOOTHING);
  const where = early ? " in antes 1-3" : "";
  const looked = (j.passed ?? 0) >= 2 ? `; ${j.passed} times he looked it over and still passed` : "";
  return {
    delta: rate - base,
    note: offered >= 2 ? `In recorded expert runs (Roffle Lite), he took it ${taken} of ${offered} times it was offered${where}${looked}` : undefined,
  };
}

/** A sentence on how often he sold it once owned, when he owned it often enough to say. */
export function expertSellNote(priors: ExpertPriors | undefined, key: string): string | undefined {
  const j = priors?.jokers[key];
  if (!j || j.acquired < 2) return undefined;
  return `in recorded expert runs he sold it ${j.sold} of ${j.acquired} times he had it`;
}

/**
 * Balatro University's tier lists (data/bu/tiers.json, built by tools/bu from his tier-list
 * videos): a 0-1 prior per joker, read from his verdicts within each rarity. `tierDelta` is the
 * joker's prior less the mean of its rarity, so it ranks within what the shop can offer together;
 * TUNING.buWeight sets how much it moves a joker's value (0 until measured).
 */
interface TierRow {
  key: string;
  rarity?: string;
  prior?: number | null;
}

const TIERS_PATH = resolve(import.meta.dirname, "..", "data", "bu", "tiers.json");
let tierDeltas: Map<string, number> | undefined;

export function tierDelta(key: string): number {
  if (!tierDeltas) {
    tierDeltas = new Map();
    try {
      const rows = (JSON.parse(readFileSync(TIERS_PATH, "utf8")) as { jokers?: TierRow[] }).jokers ?? [];
      const byRarity = new Map<string, number[]>();
      for (const r of rows) if (typeof r.prior === "number") byRarity.set(r.rarity ?? "", [...(byRarity.get(r.rarity ?? "") ?? []), r.prior]);
      const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
      for (const r of rows) if (typeof r.prior === "number") tierDeltas.set(r.key, r.prior - mean(byRarity.get(r.rarity ?? "")!));
    } catch {
      // No tier data: every joker reads 0.
    }
  }
  return tierDeltas.get(key) ?? 0;
}

/**
 * Roffle's voucher buys (data/roffle/policy.json, his Gold runs): the share of shop visits with a
 * voucher on the shelf where he bought it, smoothed toward his overall rate, less that rate.
 * TUNING.voucherExpertWeight sets how much it moves a voucher's value (0 until measured).
 */
const POLICY_PATH = resolve(import.meta.dirname, "..", "data", "roffle", "policy.json");
const CONSUMABLES_PATH = resolve(import.meta.dirname, "..", "data", "roffle", "catalog", "consumables.json");
let voucherDeltas: Map<string, number> | undefined;

export function voucherDelta(key: string): number {
  if (!voucherDeltas) {
    voucherDeltas = new Map();
    try {
      const names = JSON.parse(readFileSync(CONSUMABLES_PATH, "utf8")) as Record<string, { name: string }>;
      const keyOf = new Map(Object.entries(names).map(([k, v]) => [v.name, k]));
      const v = (JSON.parse(readFileSync(POLICY_PATH, "utf8")) as { GOLD?: { vouchers?: { shelf?: { offered: number; bought: number }; byVoucher?: Record<string, { bought: number; shelfVisits: number }> } } }).GOLD?.vouchers;
      const base = v?.shelf ? v.shelf.bought / Math.max(1, v.shelf.offered) : 0.16;
      for (const [name, r] of Object.entries(v?.byVoucher ?? {})) {
        const k = keyOf.get(name);
        if (k) voucherDeltas.set(k, (r.bought + SMOOTHING * base) / (r.shelfVisits + SMOOTHING) - base);
      }
    } catch {
      // No policy data: every voucher reads 0.
    }
  }
  return voucherDeltas.get(key) ?? 0;
}

/** Balatro University's tier priors for skip tags and consumables, less the mean of their list. */
let tagDeltas: Map<string, number> | undefined;
let consumableDeltas: Map<string, number> | undefined;

function loadListDeltas(): void {
  tagDeltas = new Map();
  consumableDeltas = new Map();
  try {
    const t = JSON.parse(readFileSync(TIERS_PATH, "utf8")) as { tags?: (TierRow & { list?: string })[]; consumables?: TierRow[] };
    // The tag list was redone for patch 1.0.1; where a tag is in both, the update counts.
    const tags = new Map<string, number>();
    for (const r of t.tags ?? []) if (typeof r.prior === "number" && (r.list !== "original" || !tags.has(r.key))) tags.set(r.key, r.prior);
    const fill = (into: Map<string, number>, rows: [string, number][]) => {
      const mean = rows.reduce((a, [, p]) => a + p, 0) / Math.max(1, rows.length);
      for (const [k, p] of rows) into.set(k, p - mean);
    };
    fill(tagDeltas, [...tags]);
    fill(consumableDeltas, (t.consumables ?? []).filter((r) => typeof r.prior === "number").map((r) => [r.key, r.prior as number]));
  } catch {
    // No tier data.
  }
}

export function buTagDelta(key: string): number {
  if (!tagDeltas) loadListDeltas();
  return tagDeltas!.get(key) ?? 0;
}

export function buConsumableDelta(key: string): number {
  if (!consumableDeltas) loadListDeltas();
  return consumableDeltas!.get(key) ?? 0;
}
