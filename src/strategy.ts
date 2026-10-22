// General Balatro strategy plus the per-phase questions sent to System One.
// One request per tick: the action Choice the policy acts on, and speculative value questions
// (run strength, phase risk) that feed the visualizer and later composite scoring.

import type { CandidateSet } from "./candidates.ts";
import { modelState, type Snapshot } from "./extract.ts";
import type { Hints, Question, SystemOneRequest } from "./systemone.ts";

export const STRATEGY_GENERAL = [
  "Score is chips times mult, summed over the hands of a round; reach the blind's chip target before hands run out or the run ends.",
  "Commit to one or two poker hands, level them with the matching Planet cards, and favor jokers that pay out for those hands.",
  "Early antes: +Mult and +Chips jokers are enough. From ante 3 on, blind targets grow fast and the build needs xMult jokers to keep up.",
  "Money earns $1 interest per $5 held at round end (normally capped at $5). Holding $25 compounds, but never starve the build to save.",
  "Boss blinds bend the rules; read the boss effect before spending hands or skipping the blind before it.",
];

export const STRATEGY_BY_PHASE: Record<string, string[]> = {
  SELECTING_HAND: [
    "Play a hand that clears the blind whenever one exists.",
    "Otherwise chips accumulate across hands: play strong hands, and use discards to dig for a better hand while hands remain.",
    "Discards cost no hand and unused discards are lost when the round ends: while the best play is below the per-hand pace, discard first.",
    "Never spend the last hand on a play that cannot reach the target if a discard could still improve it.",
  ],
  SHOP: [
    "Fill joker slots early; replace weak jokers once slots are full rather than hoarding.",
    "Buy Planet cards for the hand the build plays most; vouchers that add hands, discards or slots pay off over the whole run.",
    "Leave the shop with money for interest unless a purchase clearly strengthens the build.",
  ],
  BLIND_SELECT: [
    "Skipping a small or big blind gives a tag but loses its cash and the chance to level up through shopping; skip only when the build is ahead and the tag is strong.",
  ],
  SMODS_BOOSTER_OPENED: ["Take the card that best fits the build's main hand; skip when nothing helps."],
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

export function buildRequest(s: Snapshot, set: CandidateSet, model: string): BuiltRequest {
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

  const state = { ...modelState(s), strategy: [...STRATEGY_GENERAL, ...(STRATEGY_BY_PHASE[s.phase] ?? [])] };

  const best = Math.max(0, ...set.candidates.map((c) => c.estimate?.score ?? 0));
  const reach = s.remaining > 0 ? Math.min(2, (best * Math.max(1, s.handsLeft)) / s.remaining) : 1.5;
  const hints: Hints = {
    action: Object.fromEntries(set.candidates.map((c) => [c.id, c.prior])),
    position: Math.min(3, Math.max(0, reach * 1.4)),
    risk: s.phase === "SELECTING_HAND" ? Math.max(0, 1 - reach) : s.phase === "SHOP" ? (s.money >= 20 ? 0.6 : 0.35) : 0.3,
  };
  return { request: { model, state, questions }, hints };
}
