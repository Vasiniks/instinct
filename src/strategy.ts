// The rules of Balatro the model is told, plus the per-phase questions sent to System One. These are
// facts about the game, not advice: how to play is in the options' values (code, tuned on expert
// data), so the model weighs each option's consequences without a rule of thumb to overapply.
// One request per tick: the action Choice the policy acts on, speculative value questions (run
// strength, phase risk) for the visualizer, and at shops and joker packs the `build` Choice that
// lets the model keep the plan or pivot. The state carries the plan, so every decision sees the
// long-term picture: the committed build, its synergy, pivot options, economy and deck fixing.

import { assessmentView } from "./assess.ts";
import type { BuildProfile } from "./build.ts";
import type { CandidateSet } from "./candidates.ts";
import { modelState, type Snapshot } from "./extract.ts";
import { buildQuestion, planView, type BuildOption, type Plan } from "./plan.ts";
import type { Hints, Question, SystemOneRequest } from "./systemone.ts";

export const STRATEGY_GENERAL = [
  "A hand scores chips times mult; a round's hands add up, and the blind is beaten when the total reaches its chip target. Losing a blind ends the run; beating the ante 8 boss wins it.",
  "Blind targets grow every ante. +Mult and +Chips jokers add to the score; xMult jokers multiply it.",
  "`plan` is the build the agent is tracking: its main poker hand, the jokers backing it, and the deck's make-up.",
  "Planet cards level one poker hand: more chips and mult for that hand for the rest of the run.",
  "Money earns $1 interest per $5 held at the end of a round, up to a cap ($5 normally).",
  "Tarot and Spectral cards change playing cards (suit, rank, enhancement, seal, edition), add or destroy cards, or make jokers or money.",
  "Boss blinds have a rule that changes the round; `blind.effect` says what it is.",
];

export const STRATEGY_BY_PHASE: Record<string, string[]> = {
  SELECTING_HAND: [
    "Each play uses one hand; a discard uses no hand. Unused discards are lost when the round ends.",
    "Played cards that don't score still leave the hand; every card played or discarded is replaced by a draw.",
    "Steel and Gold cards pay while held in hand, not when played.",
    "Using a Tarot or Planet costs no hand.",
  ],
  SHOP: [
    "Selling a joker returns its sell value, about half its price.",
    "A reroll replaces the shop's cards; its price rises $1 with each reroll in the same shop.",
    "Vouchers are permanent upgrades. Packs open at once: take the shown number of cards or skip.",
    "Jokers apply left to right: an xMult joker multiplies what the jokers before it added; a copy joker copies its neighbour.",
  ],
  BLIND_SELECT: [
    "Skipping a small or big blind gives its tag, but no cash reward, no shop after it, and no interest that round.",
  ],
  SMODS_BOOSTER_OPENED: ["Cards taken from a pack are free; skipping the pack takes nothing."],
};

const ACTION_INSTRUCTIONS: Record<string, string> = {
  SELECTING_HAND:
    "You are playing Balatro and must choose the next move for this hand. Each option is a legal play, discard, or consumable use, with its estimated chips. Pick the option that best gets the round to `blind.target_chips` within the hands left while keeping the run strong.",
  SHOP:
    "You are in the Balatro shop between rounds. Each option is a legal purchase, sale, reroll, consumable use, or leaving the shop. Pick the single next shop action that most improves the run's chance to beat the coming blinds, given `run.money`, the jokers owned, and the hand levels.",
  BLIND_SELECT:
    "You are choosing whether to play the next Balatro blind. Pick the option that best serves winning the run, given the build's strength and the skip tag on offer.",
  SMODS_BOOSTER_OPENED:
    "You opened a Balatro booster pack. Pick the card that most strengthens the build, or skip the pack if none helps.",
};

const POSITION_LEVELS = [
  "Losing: the current or next blind looks out of reach with this build",
  "Fragile: small and big blinds are fine, but the boss or the next ante could end the run",
  "On pace: the build clears this ante's blinds with some margin",
  "Dominant: the build scores far above the blind targets and is on track to win the run",
];

const RISK_QUESTION: Record<string, Question> = {
  SELECTING_HAND: {
    type: "noul",
    instructions: "The chips still needed for this blind (`blind.still_needed`) look out of reach with the hands and discards left.",
  },
  SHOP: {
    type: "noul",
    instructions: "The agent should keep its money now, for interest or a better purchase later, rather than spend more in this shop.",
  },
  BLIND_SELECT: {
    type: "noul",
    instructions: "The run is strong enough to skip this blind for its tag without endangering the next blinds.",
  },
};

/** Question ids for the visualizer; the model never sees them. */
export const RISK_LABEL: Record<string, string> = {
  SELECTING_HAND: "blind out of reach",
  SHOP: "save money",
  BLIND_SELECT: "safe to skip",
};

export interface BuiltRequest {
  request: SystemOneRequest;
  hints: Hints;
}

export interface RequestContext {
  plan?: Plan;
  profile?: BuildProfile;
  /** Keep or pivot options; the `build` question is asked when there is a real choice. */
  buildOptions?: BuildOption[];
}

export function buildRequest(s: Snapshot, set: CandidateSet, model: string, ctx: RequestContext = {}): BuiltRequest {
  const questions: Record<string, Question> = {
    action: {
      type: "choice",
      instructions: ACTION_INSTRUCTIONS[s.phase] ?? "Pick the best next Balatro action.",
      criteria: Object.fromEntries(set.candidates.map((c) => [c.id, c.description])),
    },
    position: {
      type: "score",
      instructions: "How strong is this Balatro run right now, judged from the jokers, hand levels, money, and the blinds ahead?",
      criteria: POSITION_LEVELS,
    },
  };
  if (RISK_QUESTION[s.phase]) questions.risk = RISK_QUESTION[s.phase];
  const options = ctx.buildOptions ?? [];
  if (options.length > 1) questions.build = buildQuestion(options);

  const state: Record<string, unknown> = { ...modelState(s) };
  if (ctx.plan && ctx.profile) state.plan = planView(ctx.plan, ctx.profile, s);
  // The assess stage's reading of the situation, as facts the code worked out. When it simulated
  // each joker's worth, that replaces the plan's typical-hand reading of who is dead weight.
  if (set.assessment) {
    state.assessment = assessmentView(set.assessment);
    const syn = set.assessment.synergy;
    if (syn.lift && state.plan) {
      const loss = new Map(syn.lift.perJoker.map((x) => [x.label, x.loss]));
      const said = (label: string) => `${label}: ${Math.round((loss.get(label) ?? 0) * 100)} points of simulated boss rounds without it`;
      state.plan = { ...(state.plan as object), current_synergy: [...syn.carrying, ...syn.supporting].map(said), dead_weight: syn.idle.map(said) };
    }
  }
  state.strategy = [...STRATEGY_GENERAL, ...(STRATEGY_BY_PHASE[s.phase] ?? [])];

  const best = Math.max(0, ...set.candidates.map((c) => c.estimate?.score ?? 0));
  const reach = s.remaining > 0 ? Math.min(2, (best * Math.max(1, s.handsLeft)) / s.remaining) : 1.5;
  const hints: Hints = {
    action: Object.fromEntries(set.candidates.map((c) => [c.id, c.prior])),
    position: Math.min(3, Math.max(0, reach * 1.4)),
    risk: s.phase === "SELECTING_HAND" ? Math.max(0, 1 - reach) : s.phase === "SHOP" ? (s.money >= 20 ? 0.6 : 0.35) : 0.3,
    ...(options.length > 1 ? { build: Object.fromEntries(options.map((o, i) => [o.id, i === 0 ? 0.6 : 0.4 / (options.length - 1)])) } : {}),
  };
  return { request: { model, state, questions }, hints };
}
