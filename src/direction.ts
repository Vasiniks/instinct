// The run's direction, for macro checks: the cards worth looking for, read off the jokers the run
// is built around and the committed build. Neutral unless there is a strong lean: a Lucky Cat makes
// a Lucky run (The Magician, Oops! All 6s), Baron makes a Kings run (Steel, Red Seals, Mime), a
// suit joker makes a flush run in that suit. It follows the jokers held, so it only moves when they
// change, and the build part comes from the plan, which already resists flipping.

import type { Snapshot } from "./extract.ts";
import { SUIT_NAME } from "./cards.ts";

export interface Direction {
  /** "Neutral", or the run's lean in a few words. */
  theme: string;
  why: string;
  jokers: string[];
  tarots: string[];
  seals: string[];
  enhancements: string[];
  planets: string[];
}

interface Lean {
  theme: string;
  jokers?: string[];
  tarots?: string[];
  seals?: string[];
  enhancements?: string[];
  planets?: string[];
}

/** Jokers that set a direction on their own, and what they want. */
const LEANS: Record<string, Lean> = {
  j_lucky_cat: { theme: "Lucky cards", jokers: ["Oops! All 6s"], tarots: ["The Magician"], enhancements: ["Lucky"] },
  j_vampire: { theme: "Enhancements to eat", tarots: ["The Magician", "The Empress", "The Hierophant", "The Lovers", "The Chariot", "Justice", "The Tower", "The Devil"], enhancements: ["any"] },
  j_glass: { theme: "Glass cards", tarots: ["Justice"], enhancements: ["Glass"] },
  j_steel_joker: { theme: "Steel cards", jokers: ["Mime", "Baron"], tarots: ["The Chariot"], seals: ["Red"], enhancements: ["Steel"] },
  j_baron: { theme: "Kings held in hand", jokers: ["Mime", "Blueprint", "Brainstorm"], tarots: ["The Chariot", "Death", "Strength"], seals: ["Red"], enhancements: ["Steel"] },
  j_mime: { theme: "Cards held in hand", jokers: ["Baron", "Shoot the Moon"], tarots: ["The Chariot"], seals: ["Red"], enhancements: ["Steel", "Gold"] },
  j_shoot_the_moon: { theme: "Queens held in hand", jokers: ["Mime", "Baron"], tarots: ["The Chariot", "Death", "Strength"], seals: ["Red"], enhancements: ["Steel"] },
  j_hologram: { theme: "Cards added to the deck", jokers: ["DNA", "Certificate", "Marble Joker"], tarots: ["Cryptid"], enhancements: [] },
  j_stone: { theme: "Stone cards", jokers: ["Marble Joker"], tarots: ["The Tower"], enhancements: ["Stone"] },
  j_ticket: { theme: "Gold cards", jokers: ["Mime"], tarots: ["The Devil"], enhancements: ["Gold"] },
  j_golden: { theme: "Money", jokers: ["Bull", "Bootstraps", "To the Moon"], tarots: ["The Hermit", "Temperance"] },
  j_constellation: { theme: "Planets", jokers: ["Satellite", "Astronomer"], planets: ["any, the most played hand first"] },
  j_fortune_teller: { theme: "Tarots", jokers: ["Cartomancer"], tarots: ["any"] },
  j_photograph: { theme: "Face cards", jokers: ["Hanging Chad", "Sock and Buskin", "Pareidolia"], tarots: ["Strength"] },
  j_hack: { theme: "Low cards", jokers: ["Dusk", "Hanging Chad", "Wee Joker"], tarots: ["The Hanged Man"] },
  j_wee: { theme: "Twos", jokers: ["Hack"], tarots: ["Death"] },
  j_runner: { theme: "Straights", jokers: ["Shortcut", "Four Fingers"], planets: ["Saturn"] },
  j_obelisk: { theme: "A spread of hands", planets: ["the hands it plays second"] },
  j_supernova: { theme: "One hand, played often", planets: ["the most played hand"] },
};

/** Suit jokers: a flush in that suit. */
const SUIT_LEAN: Record<string, string> = { j_bloodstone: "H", j_lusty_joker: "H", j_arrowhead: "S", j_wrathful_joker: "S", j_onyx_agate: "C", j_gluttenous_joker: "C", j_rough_gem: "D", j_greedy_joker: "D" };
const FLUSH_PAYOFF = new Set(["j_tribe", "j_droll", "j_crafty", "j_smeared", "j_four_fingers"]);
const SUIT_TAROT: Record<string, string> = { H: "The Sun", S: "The World", C: "The Moon", D: "The Star" };

/** The committed build's Planet, once the plan holds a build that jokers back. */
const BUILD_PLANET: Record<string, string> = { Pair: "Mercury", "Two Pair": "Uranus", "Three of a Kind": "Venus", Straight: "Saturn", Flush: "Jupiter", "Full House": "Earth", "Four of a Kind": "Mars", "High Card": "Pluto" };

const NEUTRAL: Direction = { theme: "Neutral", why: "no joker or build sets a strong lean yet", jokers: [], tarots: [], seals: [], enhancements: [], planets: [] };

export function directionOf(s: Snapshot, build?: { name: string; backers: number }): Direction {
  const held = s.jokers.filter((j) => !j.debuff);
  const owned = new Set(held.map((j) => j.label));
  const leans = held.map((j) => ({ j, lean: LEANS[j.key] })).filter((x) => x.lean);
  const suits = held.map((j) => SUIT_LEAN[j.key]).filter(Boolean);
  const dir: Direction = { theme: "", why: "", jokers: [], tarots: [], seals: [], enhancements: [], planets: [] };
  const add = (into: string[], xs?: string[]) => {
    for (const x of xs ?? []) if (!into.includes(x) && !owned.has(x)) into.push(x);
  };
  const themes: string[] = [];
  const whys: string[] = [];
  for (const { j, lean } of leans) {
    // Two copies of a joker (Constellation twice) are one lean.
    if (themes.includes(lean.theme)) continue;
    themes.push(lean.theme);
    whys.push(j.label);
    add(dir.jokers, lean.jokers);
    add(dir.tarots, lean.tarots);
    add(dir.seals, lean.seals);
    add(dir.enhancements, lean.enhancements);
    add(dir.planets, lean.planets);
  }
  // A suit two jokers pay for, or one with a flush payoff beside it, is a flush direction.
  const bySuit = new Map<string, number>();
  for (const x of suits) bySuit.set(x, (bySuit.get(x) ?? 0) + 1);
  const suit = [...bySuit].sort((a, b) => b[1] - a[1])[0];
  const flushPayoff = held.some((j) => FLUSH_PAYOFF.has(j.key));
  if (suit && (suit[1] >= 2 || (suit[1] >= 1 && flushPayoff))) {
    themes.push(`${SUIT_NAME[suit[0]]} flush`);
    whys.push(held.filter((j) => SUIT_LEAN[j.key] === suit[0]).map((j) => j.label).join(", "));
    add(dir.tarots, [SUIT_TAROT[suit[0]]]);
    add(dir.jokers, ["Smeared Joker", "The Tribe", "Droll Joker"]);
    add(dir.planets, ["Jupiter"]);
  }
  // The committed build, when at least two jokers back it: its Planet.
  if (build && build.backers >= 2 && BUILD_PLANET[build.name] && !(build.name === "Flush" && themes.some((t) => t.endsWith("flush")))) {
    themes.push(build.name);
    whys.push(`${build.backers} jokers back ${build.name}`);
    add(dir.planets, [BUILD_PLANET[build.name]]);
  }
  if (!themes.length) return NEUTRAL;
  return { ...dir, theme: themes.join(" + "), why: `from ${whys.join("; ")}` };
}
