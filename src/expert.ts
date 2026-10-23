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
