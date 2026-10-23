// Code owns the decision; the model only judges. Same gates as balatro_controller.py.

import type { CandidateSet } from "./candidates.ts";
import type { ChoiceAnswer } from "./systemone.ts";

export interface Gates {
  /** StartLux guidance: none_probability >= 0.2 means no listed option fits. */
  noneThreshold: number;
  minConfidence: number;
}

/**
 * How the model's answer becomes a move. `blend` (the default) multiplies the model's probability
 * for each option by the code's prior (its utility, tuned on expert data) and takes the best
 * product, so the data shapes every decision without being told to the model; when the model
 * abstains it takes the code's pick. The others apply when the gates fail: take the code's pick,
 * trust the model anyway, or wait for a human.
 */
export type ReviewMode = "blend" | "fallback" | "model" | "pause";

export type VerdictStatus = "ACT" | "REVIEW" | "ABSTAIN" | "AUTO" | "IDLE" | "ERROR";

export interface Verdict {
  status: VerdictStatus;
  /** The model's top option, if it answered. */
  pick: string | null;
  /** The candidate that will be executed; undefined means nothing runs this tick. */
  chosen?: string;
  source: "model" | "blend" | "fallback" | "auto" | "human" | "none";
  confidence?: number;
  noneProbability?: number;
  reason: string;
}

function heuristicBest(set: CandidateSet): string | undefined {
  return [...set.candidates].sort((a, b) => b.utility - a.utility)[0]?.id;
}

/** The option with the highest model probability times code prior (a sum of logs). */
function blended(answer: ChoiceAnswer, set: CandidateSet): string | undefined {
  const probs = answer.probabilities ?? {};
  if (!set.candidates.some((c) => (probs[c.id] ?? 0) > 0)) return undefined;
  const score = (id: string, prior: number) => Math.log((probs[id] ?? 0) + 1e-3) + Math.log(prior + 1e-3);
  return [...set.candidates].sort((a, b) => score(b.id, b.prior) - score(a.id, a.prior))[0]?.id;
}

export function applyPolicy(answer: ChoiceAnswer | undefined, set: CandidateSet, gates: Gates, mode: ReviewMode): Verdict {
  if (set.auto) return { status: "AUTO", pick: null, chosen: set.auto.id, source: "auto", reason: "forced step, no judgment needed" };
  if (!set.candidates.length) return { status: "IDLE", pick: null, source: "none", reason: set.note ?? "no legal actions" };
  if (set.candidates.length === 1) return { status: "AUTO", pick: null, chosen: set.candidates[0].id, source: "auto", reason: "only one legal action" };

  if (!answer) {
    const chosen = mode === "pause" ? undefined : heuristicBest(set);
    return { status: "ERROR", pick: null, chosen, source: chosen ? "fallback" : "none", reason: "no model answer" };
  }

  const pick = answer.choice;
  const confidence = Number(answer.confidence);
  const noneP = Number(answer.none_probability ?? 0);
  const base = { pick, confidence, noneProbability: answer.none_probability };
  let status: VerdictStatus;
  let reason: string;
  if (pick === null) [status, reason] = ["ABSTAIN", "model picked none of the above"];
  else if (!set.candidates.some((c) => c.id === pick)) [status, reason] = ["ABSTAIN", `model answered unknown option ${pick}`];
  else if (noneP >= gates.noneThreshold) [status, reason] = ["ABSTAIN", `none_probability ${noneP.toFixed(2)} >= ${gates.noneThreshold}: no listed action fits`];
  else if (confidence < gates.minConfidence) [status, reason] = ["REVIEW", `confidence ${confidence.toFixed(2)} < ${gates.minConfidence}`];
  else if (mode !== "blend") return { ...base, status: "ACT", chosen: pick, source: "model", reason: "gates passed" };
  else [status, reason] = ["ACT", "gates passed"];

  if (mode === "blend" && status !== "ABSTAIN") {
    const chosen = blended(answer, set) ?? pick!;
    const agree = chosen === pick;
    return { ...base, status, chosen, source: agree ? "model" : "blend", reason: `${reason}; ${agree ? "the code's values agree" : "the code's values outweigh the model's pick"}` };
  }
  if (mode === "blend") return { ...base, status, chosen: heuristicBest(set), source: "fallback", reason: `${reason}; using the heuristic pick` };

  if (mode === "pause") return { ...base, status, source: "none", reason: `${reason}; waiting for a human pick` };
  if (mode === "model" && pick && set.candidates.some((c) => c.id === pick)) return { ...base, status, chosen: pick, source: "model", reason: `${reason}; trusting the model` };
  return { ...base, status, chosen: heuristicBest(set), source: "fallback", reason: `${reason}; using the heuristic pick` };
}
