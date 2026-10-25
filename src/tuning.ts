// Numbers the decision stages weigh that measurement should set, not taste: each is read where it
// acts, and `tools/tune.ts` plays the same seeded simulator games with one moved to see what it does
// to the average ante. Where expert play gives a value (Roffle's logs, Balatro University), that's
// a starting point or an arm to test; the measured average ante decides.

export const TUNING = {
  /** Utility of $1 on the scale of the cards' values (candidates.ts `dollarValue`). */
  dollar: 0.03,
  /** A dollar's worth while under the interest cap, relative. */
  dollarUnderCap: 1.3,
  /** Shop: utility per dollar of interest a purchase loses while the run is saving. */
  interestLoss: 0.07,
  /** Shop: leaving's base utility; buys and rerolls are measured against it. */
  leave: 0.42,
  /** Shop: a reroll's utility when the build needs a piece and the money is there (0.34 from tools/autotune.ts). */
  rerollCore: 0.34,
  /** Shop: utility per dollar past the interest cap (plus `rerollBuffer`) that a reroll gains when nothing is missing. */
  rerollSurplus: 0.012,
  /** Shop: dollars kept past the cap before surplus rerolls start (Roffle stopped at about $36). */
  rerollBuffer: 10,
  /**
   * Shop and packs: utility per unit of simulated boss odds a card adds (0.3 = from 40% to 70% of
   * rounds beaten). 1.69 from tools/autotune.ts: with the rerollCore, rerollSurplus, packBoost and
   * tarotCut values it found, +0.40 ± 0.13 average ante over the old values on 300 fresh simulator
   * seeds, and +0.23 ± 0.42 on 40 real-game seeds (14 wins against 11).
   */
  simWeight: 1.69,
  /**
   * Shop and packs: a swap must beat the joker it replaces by this much; selling loses half the
   * price, and experts rarely churn. From `tools/roffle/agree.ts --margin` on 12 videos: at 0.3 the
   * agent made 78 swaps he didn't, at 0.5 about as many full-row swaps as he makes (83 vs 89).
   */
  swapMargin: 0.5,
  /** Shop: rounds of income an economy joker is priced at, with FEATURES.econIncome. */
  econRounds: 3,
  /** Shop: with FEATURES.bankFloor, the round the $25 floor starts (Balatro University ~5, Roffle at Gold 7). */
  bankFromRound: 5,
  /** Shop and packs: utility per unit of Roffle's take rate above his base (expert.ts; 1 from tools/roffle/agree.ts). */
  expertWeight: 1,
  /** Shop and packs: utility per unit of Balatro University's tier-list prior above the middle of its rarity (data/bu/tiers.json). */
  buWeight: 0,
  /** Shop: added to every booster pack's value (0.08 from tools/autotune.ts). */
  packBoost: 0.08,
  /** Shop: added to an Arcana pack's value on top. */
  arcanaBoost: 0,
  /** Shop: scales every voucher's base value (Roffle bought 16% of those he was shown). */
  voucherScale: 1,
  /** Shop: utility per unit of Roffle's voucher buy rate above his overall rate (data/roffle/policy.json). */
  voucherExpertWeight: 0,
  /** Blind select: utility per unit of Balatro University's skip-tag tier prior above its list's mean. */
  buTagWeight: 0,
  /** Shop and packs: utility per unit of Balatro University's consumables tier prior above its list's mean. */
  buConsumableWeight: 0,
  /** Shop and packs: the least a Blueprint or Brainstorm is worth, offered or held (the user's call: always take them). */
  copyFloor: 1.5,
  /** Shop, packs and sales: added to a joker per unit of synergy with the jokers held (Baron and Mime is 1; src/synergy.ts). */
  comboBonus: 0.45,
  /** Shop and packs: added to a joker a run is built around (Baron, Mime, Hologram, ...). */
  buildAroundBonus: 0.2,
  /** Shop and packs: taken off a flat +Mult joker on Plasma deck, where chips count the same. */
  plasmaMultCut: 0.2,
  /** Shop: a Spectral pack's value on top of its base (the user's call: take Spectral packs). */
  spectralBoost: 0.25,
  /** Shop: taken off Arcana packs and Tarots bought from the shelf (the user's call: not so many Tarots; 0.06 measured better than 0.12). */
  tarotCut: 0.06,
  /** Blind select: subtracted from a tag's value to give the skip's utility. */
  skipCost: 0.15,
  /** Blind select: below this many times the next blind (build power x hands) a skip loses 0.3. */
  skipSafeRatio: 1.6,
  /**
   * Blind select, with the simulation on: a skip loses 0.3 unless simulated rounds beat the next
   * blind, played with the jokers held now, at least this often. It replaces the ratio above,
   * whose build's typical hand overstates a bare early board (a skip at ante 1 with no jokers
   * looked 3x safe).
   */
  skipSafeOdds: 0.95,
  /** Shop: the cost of each dollar of new Credit Card debt (twice a dollar's own value). */
  debtDollar: 0.06,
  /** Shop, packs and sales: taken off a joker per unit of conflict with the jokers held (src/synergy.ts). */
  conflictCut: 0.3,
  /** Vouchers, packs and consumables: added per unit of what they feed in the jokers held (src/synergy.ts). */
  enablerBonus: 0.2,
};

export type TuningKey = keyof typeof TUNING;
const DEFAULTS = { ...TUNING };
export const tuningDefaults = () => ({ ...DEFAULTS });

export type Changes = Partial<Record<TuningKey, number>>;
export interface Profiles {
  deck: Record<string, Changes>;
  stake: Record<string, Changes>;
}

/**
 * Per-deck and per-stake changes to the numbers above, as differences: a run plays TUNING plus its
 * deck's changes plus its stake's. The decks and stakes play differently (Green earns no interest,
 * Black has a hand less, Gold charges rent), so `tools/autotune.ts --profiles` searches each on its
 * own: a deck at White stake, a stake on the six-deck mix. White stake is the base and has none.
 */
export const PROFILES: Profiles = { deck: {}, stake: {} };

/** `--set` overrides, applied over any profile. */
const overrides: Changes = {};
let active: string | undefined;

/** Sets TUNING for a run on `deck` and `stake`: the base numbers, both profiles' changes, then any overrides. */
export function useProfile(deck = "", stake = ""): void {
  const key = `${deck}|${stake}`;
  if (key === active) return;
  active = key;
  const d = PROFILES.deck[deck] ?? {};
  const st = PROFILES.stake[stake] ?? {};
  for (const k of Object.keys(DEFAULTS) as TuningKey[]) TUNING[k] = DEFAULTS[k] + (d[k] ?? 0) + (st[k] ?? 0);
  Object.assign(TUNING, overrides);
}

/** Replaces the profiles, as tools/autotune.ts does for each arm it plays. */
export function loadProfiles(p: Partial<Profiles>): void {
  PROFILES.deck = p.deck ?? {};
  PROFILES.stake = p.stake ?? {};
  active = undefined;
}

/** Applies `key=value` overrides: FEATURES switches take true/false, TUNING numbers take numbers. */
export function applyOverrides(spec: string, features: Record<string, boolean>): string[] {
  const applied: string[] = [];
  for (const pair of spec.split(",").filter(Boolean)) {
    const [k, v] = pair.split("=");
    if (k in TUNING) {
      const n = Number(v);
      if (!Number.isFinite(n)) throw new Error(`${k} takes a number, got ${v}`);
      (TUNING as Record<string, number>)[k] = n;
      overrides[k as TuningKey] = n;
    } else if (k in features) {
      if (v !== "true" && v !== "false") throw new Error(`${k} takes true or false, got ${v}`);
      features[k] = v === "true";
    } else throw new Error(`no switch or number named ${k}; numbers: ${Object.keys(TUNING).join(", ")}; switches: ${Object.keys(features).join(", ")}`);
    applied.push(`${k}=${v}`);
  }
  return applied;
}
