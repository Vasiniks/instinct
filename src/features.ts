// Switches for the decision stages. Play uses a preset (below), picked in the dashboard's settings
// for testing; the simulator harness also turns single switches off to measure what each adds.

export const FEATURES = {
  /** Hand: judge plays and discards by simulated finishes of the round (round.ts). */
  roundSim: true,
  /** Shop and packs: judge jokers and Planets by simulated rounds at the next bosses. */
  shopSim: true,
  /** Hand: fill small hands' spare slots with junk kickers that cycle out. */
  padding: true,
  /** Blind select: a run behind its bosses values skipping less (it can't spare the shop). */
  skipOutlook: true,
  /**
   * Shop: a missing joker the code can name raises the reroll value. Off: in 30 simulated White
   * games it cost 0.45 antes on average (more rerolls in antes 1-2, less money for the jokers).
   */
  targetReroll: false,
  /**
   * Shop: only the simulated outlook decides "behind". Off: the build estimate against the next
   * ante's boss can say so too, which held up better over the antes after the current one.
   */
  outlookOnly: false,
  /** Shop and packs: judge deck-changing Tarots and Spectrals by simulating the deck after them. */
  deckFixSim: true,
  /** Blind select: reroll a boss when its simulated threat beats the expected threat of the bosses a reroll can draw. */
  bossPoolReroll: true,
  /** Shop: Buffoon, Celestial and Arcana packs add the expected simulated gain of the best card they could show. */
  packOdds: true,
  /** Shop and packs: a joker the offer simulation finds changing nothing, with no lasting role, is worth less. */
  uselessJoker: true,
  /**
   * Shop: a joker whose removal costs simulated boss rounds is not offered for sale as dead weight.
   * Off: in 30 simulated White games it cost 0.2 antes (6.0 -> 5.8 mean ante, 2 -> 1 wins), within
   * noise but not a gain; the synergy reading and the plan's dead-weight list still use the losses.
   */
  simSynergy: false,
  /** Forecasts: growing and decaying jokers play at the value they will most likely have by the boss (growth.ts). */
  growth: true,
  /** Shop and packs: an economy joker is priced as its income over `TUNING.econRounds` rounds, at the dollar's utility. */
  econIncome: false,
  /** Shop: from round `TUNING.bankFromRound` the run saves to the interest cap at any stake, as at Gold. */
  bankFloor: false,
};

/** The switches as play starts: the "advanced" preset. */
const DEFAULTS = { ...FEATURES };

export type PresetId = "basic" | "standard" | "advanced";

export interface Preset {
  id: PresetId;
  label: string;
  describe: string;
  features: typeof FEATURES;
  /** Whether the Roffle priors nudge joker values. */
  expert: boolean;
}

const OFF = Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, false])) as typeof FEATURES;

/** The only loop settings the dashboard offers: whole configurations, not single switches. */
export const PRESETS: Preset[] = [
  {
    id: "basic",
    label: "Basic",
    describe: "Code heuristics and the model only: no simulation, no assessment, no expert data, small hands played bare.",
    features: { ...OFF },
    expert: false,
  },
  {
    id: "standard",
    label: "Standard",
    describe: "Adds the round tree for plays and discards, kickers on small hands and the expert data; no shop or pack simulation and no assessment.",
    features: { ...OFF, roundSim: true, padding: true },
    expert: true,
  },
  {
    id: "advanced",
    label: "Advanced",
    describe: "Everything: round tree, simulated shop and pack offers, deck fixing, boss pool, assessment and expert data.",
    features: { ...DEFAULTS },
    expert: true,
  },
];

let current: PresetId = "advanced";
export const currentPreset = () => current;

/** Applies a preset's switches; the caller handles `expert`. */
export function applyPreset(id: PresetId): Preset {
  const preset = PRESETS.find((p) => p.id === id) ?? PRESETS[PRESETS.length - 1];
  Object.assign(FEATURES, preset.features);
  current = preset.id;
  return preset;
}
