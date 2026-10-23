// Switches for the decision stages, all on in play. The simulator harness turns them off one at a
// time to measure what each stage adds; nothing else should change them.

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
};
