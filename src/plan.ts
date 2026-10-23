// The plan: the build the run is committed to, carried across ticks so decisions stop being one
// move at a time. Code proposes it from the build profile; the model confirms it or pivots once per
// shop visit or joker pack through the `build` question. Both go through the same gate, which is
// what makes the commitment stick:
// - a code switch needs a clear lead, and a model switch a confident answer;
// - after any pivot the build is locked for the rest of that ante, so neither side can undo it;
// - every pivot raises the bar for the next one;
// - a pivot that depends on a joker waits until the joker is owned, and lapses if the shop or pack
//   is left without it.

import type { BuildProfile } from "./build.ts";
import type { Snapshot } from "./extract.ts";
import { ARCHETYPES } from "./knowledge.ts";
import type { ChoiceAnswer, Question } from "./systemone.ts";

export interface Pivot {
  ante: number;
  round: number;
  from: string;
  to: string;
  why: string;
  by: "code" | "model";
}

export interface Plan {
  seed?: string;
  build: string;
  since: { ante: number; round: number };
  by: "code" | "model";
  pivots: Pivot[];
  /** The ante of the last pivot: no further pivots until the run leaves it. */
  lockedAnte?: number;
  /** A pivot waiting for its joker. */
  pending?: { to: string; via: { key: string; label: string }; why: string; by: Pivot["by"]; ante: number; round: number };
}

export interface BuildOption {
  id: string;
  build: string;
  why: string;
  /** The offered joker this pivot needs; the pivot commits once it is owned. */
  via?: { key: string; label: string };
}

/** What the plan looks like to the model and the visualizer. */
export interface PlanView {
  build: string;
  since: string;
  strength: string;
  needs: string[];
  current_synergy: string[];
  dead_weight: string[];
  sell_first?: string;
  pivot_options: string[];
  /** Why the build can't change right now, or what a pending pivot waits for. */
  commitment?: string;
  economy: string;
  deck_fixing: string;
  deck_and_stake: string[];
  last_pivot?: string;
}

/** Above this ratio of archetype scores the code switches builds on its own. */
const CODE_PIVOT_RATIO = 1.35;
/** The model's build answer moves the plan only when it is at least this confident. */
export const MODEL_PIVOT_CONFIDENCE = 0.6;
/** Each pivot already made raises both bars by this much. */
const PIVOT_COST = 0.1;

const SHOPPING = new Set(["SHOP", "SMODS_BOOSTER_OPENED"]);

function pivot(prev: Plan, s: Snapshot, to: string, why: string, by: Pivot["by"]): Plan {
  return {
    ...prev,
    build: to,
    since: { ante: s.ante, round: s.round },
    by,
    pivots: [...prev.pivots, { ante: s.ante, round: s.round, from: prev.build, to, why, by }],
    lockedAnte: s.ante,
    pending: undefined,
  };
}

export const isLocked = (plan: Plan, s: Snapshot) => plan.lockedAnte === s.ante;

/** Start a plan on a new run; settle a pending pivot; otherwise keep it unless another build is clearly ahead. */
export function updatePlan(prev: Plan | undefined, s: Snapshot, p: BuildProfile): Plan {
  if (!prev || (s.seed && prev.seed !== s.seed)) return { seed: s.seed, build: p.primary.name, since: { ante: s.ante, round: s.round }, by: "code", pivots: [] };
  if (prev.pending) {
    const { pending } = prev;
    if (s.jokers.some((j) => j.key === pending.via.key)) return pivot(prev, s, pending.to, pending.why, pending.by);
    // The shop or pack closed without the joker: the pivot lapses.
    if (!SHOPPING.has(s.phase) || pending.ante !== s.ante || pending.round !== s.round) prev = { ...prev, pending: undefined };
  }
  const leader = [...p.archetypes].sort((a, b) => b.score - a.score)[0];
  // Before any joker backs a build in ante 1 the plan is only a lean: follow the leader freely.
  if (prev.pivots.length === 0 && s.ante <= 1 && !p.jokers.some((r) => r.fits)) {
    return leader.name === prev.build ? prev : { ...prev, build: leader.name, since: { ante: s.ante, round: s.round } };
  }
  if (isLocked(prev, s)) return prev;
  const current = p.archetypes.find((a) => a.name === prev.build);
  const ratio = CODE_PIVOT_RATIO + PIVOT_COST * prev.pivots.length;
  if (leader.name !== prev.build && (!current || leader.score >= current.score * ratio + 1)) {
    return pivot(prev, s, leader.name, `${leader.name} pulled clearly ahead: ${leader.reasons.slice(0, 3).join(", ") || "deck and levels"}`, "code");
  }
  return prev;
}

/** Apply the model's answer to the `build` question, through the same gate as the code. */
export function applyBuildAnswer(prev: Plan, s: Snapshot, answer: ChoiceAnswer | undefined, options: BuildOption[]): Plan {
  if (!answer?.choice || answer.confidence < MODEL_PIVOT_CONFIDENCE + PIVOT_COST * prev.pivots.length || isLocked(prev, s)) return prev;
  const opt = options.find((o) => o.id === answer.choice);
  if (!opt || opt.build === prev.build) return prev;
  if (opt.via && !s.jokers.some((j) => j.key === opt.via!.key)) {
    return { ...prev, pending: { to: opt.build, via: opt.via, why: opt.why, by: "model", ante: s.ante, round: s.round } };
  }
  return pivot(prev, s, opt.build, opt.why, "model");
}

/** Keep the build, or pivot to one of the builds the profile found worth considering. */
export function buildOptions(plan: Plan, p: BuildProfile): BuildOption[] {
  const synergy = p.synergy.active.slice(0, 3).join("; ") || "no joker backs it yet";
  const out: BuildOption[] = [
    { id: "keep", build: plan.build, why: `Stay on ${plan.build} (${ARCHETYPES[plan.build]?.describe ?? plan.build}). Current synergy: ${synergy}.` },
  ];
  for (const o of p.pivots) {
    if (o.to === plan.build || out.some((x) => x.build === o.to)) continue;
    const drop = o.wouldDrop.length ? ` It would leave ${o.wouldDrop.join(", ")} without a job.` : "";
    const via = o.via ? { key: o.via.key, label: o.via.label } : undefined;
    out.push({ id: `pivot_${o.to.toLowerCase().replace(/[^a-z]+/g, "_")}`, build: o.to, why: `Pivot to ${o.to}: ${o.why}.${drop}${via ? ` Needs ${via.label}.` : ""}`, ...(via ? { via } : {}) });
  }
  return out;
}

export function buildQuestion(options: BuildOption[]): Question {
  return {
    type: "choice",
    instructions:
      "Which build should this Balatro run commit to from here? Judge from `plan.current_synergy`, `plan.pivot_options`, `plan.strength` and the shop or pack on offer. Pivot only when the new build will clearly score more over the next antes, counting the jokers it would leave useless.",
    criteria: Object.fromEntries(options.map((o) => [o.id, o.why])),
  };
}

export function planView(plan: Plan, p: BuildProfile, s: Snapshot): PlanView {
  const next = p.targets[0];
  const ahead = p.targets[p.targets.length - 1];
  const weak = p.weakest && p.weakest.keep < 0.3 ? p.weakest : undefined;
  const last = plan.pivots[plan.pivots.length - 1];
  return {
    build: `${plan.build}${p.theme ? ` (${p.theme})` : ""}`,
    since: `ante ${plan.since.ante}, round ${plan.since.round}`,
    strength: `A typical ${plan.build} scores about ${p.power} (${p.chips} chips x ${p.mult} mult). With ${p.hands} hands that is ${p.margin.toFixed(1)}x ${next?.label ?? "the next blind"} (${next?.target ?? "?"}) and ${p.marginAhead.toFixed(1)}x ${ahead.label} (${ahead.target}).`,
    needs: p.needs,
    current_synergy: p.synergy.active,
    dead_weight: p.synergy.dead,
    sell_first: weak ? `${weak.label}: ${weak.note}` : undefined,
    commitment: plan.pending
      ? `Pivot to ${plan.pending.to} waits for ${plan.pending.via.label}; it lapses if this shop or pack closes without it.`
      : isLocked(plan, s)
        ? `Locked on ${plan.build} for the rest of ante ${s.ante} after the last pivot.`
        : undefined,
    pivot_options: p.pivots.map((o) => `${o.to}${o.via ? ` via ${o.via.label} (${o.via.source})` : ""}: ${o.why}${o.wouldDrop.length ? `; would drop ${o.wouldDrop.join(", ")}` : ""}`),
    economy: p.econ.note,
    deck_fixing: `${p.deckFix.goal} The deck has ${p.deckFix.deckSize} cards${p.deckFix.suit ? `, ${Math.round(p.deckFix.suitShare * 100)}% of the build's suit` : ""}.`,
    deck_and_stake: p.cond.notes,
    last_pivot: last ? `ante ${last.ante}: ${last.from} to ${last.to} (${last.by}): ${last.why}` : undefined,
  };
}
