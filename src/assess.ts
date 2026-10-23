// The situation, read before any move is valued: how the jokers work together and how much of the
// score they carry against the cards, what the deck needs, what the coming boss does to this build
// and what a reroll could bring instead, which Planets and jokers would add most, where the money
// stands, and how the run is doing against the next bosses. Code works all of it out (with round.ts
// simulations where it matters); the candidates branch on it, and the model reads it as facts.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ENGINE_TAGS, bossTargets, discardsPerRound, handsPerRound, interestCap, interestOn, powerWith, rentDue, type BuildProfile } from "./build.ts";
import { SUIT_NAME } from "./cards.ts";
import { applyToDeck, dealtHand, pickTargets } from "./deckfix.ts";
import type { Snapshot } from "./extract.ts";
import { ARCHETYPES, PLANET_HAND, bossKeyOf, bossPool, jokerTags } from "./knowledge.ts";
import { MODELLED_JOKERS, type HandName, type Joker } from "./poker.ts";
import { bossEffects, levelUp, mulberry32, roundOdds, type Setup } from "./round.ts";

export type Outlook = "ahead" | "on pace" | "behind" | "losing";

export interface Assessment {
  synergy: {
    carrying: string[];
    supporting: string[];
    idle: string[];
    /** Share of the build hand's typical score that the jokers add (the rest is cards and levels). */
    jokerShare?: number;
    /** Simulated next-ante boss odds with every joker, with none, and the loss without each one. */
    lift?: { all: number; none: number; perJoker: { label: string; loss: number }[] };
    text: string;
  };
  boss?: { name: string; effect: string; target: number; plain: number; withRule: number; threat: "none" | "mild" | "serious" | "severe"; text: string };
  /** The bosses a reroll could draw now, each with its simulated threat (drop in odds). */
  pool?: { bosses: { name: string; drop: number }[]; currentDrop: number; expectedDrop: number; text: string };
  deck?: { size: number; suit?: string; suitShare: number; enhanced: number; sealed: number; fixes: { key: string; label: string; gain: number }[]; text: string };
  planets: { hand: HandName; planet: string; gain: number }[];
  targets: { key: string; label: string; gain: number }[];
  /** Every joker the target search simulated, for weighing what a Buffoon pack could show. */
  targetPool: { key: string; gain: number }[];
  economy: { status: "no interest" | "under the cap" | "at the cap" | "surplus"; interest: number; cap: number; surplus: number; text: string };
  outlook: { status: Outlook; bosses: { ante: number; target: number; odds: number }[]; text: string };
  ms: number;
  cached?: boolean;
}

export interface AssessOptions {
  targets?: boolean;
  samples?: number;
  simulate?: boolean;
  /** Boss names seen this run, when the game doesn't report the bosses it has drawn. */
  bossesSeen?: string[];
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const pts = (x: number) => `${x >= 0 ? "+" : ""}${Math.round(x * 100)}`;

/** Joker names and rarities from the game's catalog, when it is on disk. */
let catalog: Map<string, { name: string; rarity: string }> | undefined;
export function jokerCatalog(): Map<string, { name: string; rarity: string }> {
  if (catalog) return catalog;
  catalog = new Map();
  const path = resolve(import.meta.dirname, "..", "data", "roffle", "catalog", "jokers.json");
  try {
    if (existsSync(path)) for (const j of JSON.parse(readFileSync(path, "utf8")) as { key: string; name: string; rarity: string }[]) catalog.set(j.key, { name: j.name, rarity: j.rarity });
  } catch {
    // Names fall back to the key.
  }
  return catalog;
}
const titled = (key: string) => {
  const named = jokerCatalog().get(key)?.name;
  if (named) return named;
  const words = key.replace(/^j_/, "").split("_");
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
};
const PLANET_OF = Object.fromEntries(Object.entries(PLANET_HAND).map(([k, h]) => [h, k])) as Record<string, string>;
const planetName = (key: string) => key.replace(/^c_/, "").replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());

export function outlookOf(odds: number[]): Outlook {
  if (odds[0] >= 0.9 && (odds[1] ?? 1) >= 0.6) return "ahead";
  if (odds[0] >= 0.6) return "on pace";
  if (odds[0] >= 0.25) return "behind";
  return "losing";
}

/** Boss draws this run: the game's count when reported, else one per boss seen. */
export function bossesUsed(s: Snapshot, seen: string[] = []): Record<string, number> {
  if (s.bossesUsed && Object.keys(s.bossesUsed).length) return s.bossesUsed;
  const used: Record<string, number> = {};
  const names = new Set([...seen, ...s.blinds.filter((b) => b.type === "BOSS").map((b) => b.name)]);
  for (const n of names) {
    const key = bossKeyOf(n);
    if (key) used[key] = (used[key] ?? 0) + 1;
  }
  return used;
}

// The same position assessed again (another tick of the same shop) reuses the work.
const cache = new Map<string, Assessment>();
function cacheKey(s: Snapshot, opts: AssessOptions): string {
  return JSON.stringify([
    s.seed,
    s.ante,
    s.round,
    s.phase === "SELECTING_HAND" ? s.handsLeft : 0,
    s.money,
    s.jokers.map((j) => `${j.key}:${j.edition ?? ""}:${JSON.stringify(j.stats)}`),
    s.deckLeft.length + s.hand.length,
    [...s.deckLeft, ...s.hand].reduce((a, c) => a + c.id * 31 + (c.enhancement?.length ?? 0) + (c.suit?.charCodeAt(0) ?? 0), 0),
    Object.values(s.levels).map((l) => l?.level ?? 1),
    s.blinds.map((b) => b.name),
    s.bossesUsed,
    opts,
  ]);
}

/**
 * `targets` (searching the jokers the code can score for the ones that would help most) costs the
 * most, so it runs only where buying is possible: shops and joker packs.
 */
export function assess(s: Snapshot, p: BuildProfile, opts: AssessOptions = {}): Assessment {
  const key = cacheKey(s, opts);
  const hit = cache.get(key);
  if (hit) return { ...hit, ms: 0, cached: true };
  const t0 = performance.now();
  const samples = opts.samples ?? 40;
  const minor = Math.max(12, Math.round(samples * 0.5)); // samples for the secondary analyses
  const hands = handsPerRound(s);
  const discards = discardsPerRound(s);
  const current: Setup = { jokers: s.jokers, levels: s.levels };
  const simulate = opts.simulate ?? true;
  const targets = bossTargets(s, 3);
  const next = targets[1] ?? targets[0];

  // Outlook: simulated rounds at this ante's boss and the next two. Mid-round (simulate: false) the
  // build estimate stands in, since the round itself is what the hand stage simulates.
  const odds = simulate ? targets.map((t) => roundOdds(s, [current], t, hands, discards, samples)[0]) : targets.map((t) => Math.min(1, (p.power * hands) / Math.max(1, t) / 1.5));
  const status = outlookOf(odds);
  const outlook = {
    status,
    bosses: targets.map((target, k) => ({ ante: s.ante + k, target, odds: odds[k] })),
    text: simulate
      ? `${status[0].toUpperCase()}${status.slice(1)}: simulated rounds beat the bosses of antes ${s.ante}-${s.ante + 2} (${targets.join(", ")} chips) ${odds.map(pct).join(", ")} of the time.`
      : `${status[0].toUpperCase()}${status.slice(1)} by the build estimate: about ${p.power} a hand against bosses of ${targets.join(", ")} chips.`,
  };

  // Synergy: how much the row adds over the cards alone, and what each joker is worth, simulated at
  // whichever of the next bosses is closest to a coin flip (where a joker's worth shows; at 0% or
  // 100% every joker looks idle). A joker that costs a lot of those rounds when removed carries the
  // score, one that costs some or has a lasting role (money, copying, growing, an engine) supports
  // it, the rest idle. Mid-round, without simulation, the typical-hand estimate stands in.
  const bare = p.power > 0 ? powerWith(s, p, []) : 0;
  const jokerShare = p.power > 0 && s.jokers.length ? Math.max(0, 1 - bare / p.power) : undefined;
  let lift: Assessment["synergy"]["lift"];
  let liftAt = next;
  if (simulate && s.jokers.length) {
    liftAt = targets[odds.reduce((best, o, i) => (Math.abs(o - 0.5) < Math.abs(odds[best] - 0.5) ? i : best), 0)];
    const setups = [current, { jokers: [], levels: s.levels }, ...s.jokers.map((j) => ({ jokers: s.jokers.filter((x) => x !== j), levels: s.levels }))];
    const o = roundOdds(s, setups, liftAt, hands, discards, minor);
    lift = { all: o[0], none: o[1], perJoker: s.jokers.map((j, i) => ({ label: j.label, loss: o[0] - o[i + 2] })).sort((a, b) => b.loss - a.loss) };
  }
  const role = (tags: string[]) => tags.some((t) => ["econ", "copy", "scaling", "sell_value", ...ENGINE_TAGS].includes(t));
  const lossOf = new Map(lift?.perJoker.map((x) => [x.label, x.loss]) ?? []);
  const carrying = p.jokers.filter((r) => (lift ? (lossOf.get(r.label) ?? 0) >= 0.1 : r.contribution >= 0.15)).map((r) => r.label);
  const supporting = p.jokers
    .filter((r) => !carrying.includes(r.label))
    .filter((r) => (lift ? (lossOf.get(r.label) ?? 0) >= 0.02 || role(r.tags) : r.fits || r.contribution > 0.02 || role(r.tags) || r.tags.includes("xmult")))
    .map((r) => r.label);
  const idle = p.jokers.filter((r) => !carrying.includes(r.label) && !supporting.includes(r.label)).map((r) => r.label);
  const synergy = {
    carrying,
    supporting,
    idle,
    jokerShare,
    lift,
    text: s.jokers.length
      ? [
          `${p.primary.name}: ${carrying.length ? `${carrying.join(", ")} carr${carrying.length === 1 ? "ies" : "y"} the score` : "no joker carries the score"}${supporting.length ? `; ${supporting.join(", ")} support it` : ""}${idle.length ? `; ${idle.join(", ")} do${idle.length === 1 ? "es" : ""} nothing for it` : ""}.`,
          jokerShare !== undefined ? `The jokers make ${pct(jokerShare)} of a typical ${p.primary.name}'s score; the cards and hand levels the rest.` : "",
          lift
            ? `A boss of ${liftAt} chips falls in ${pct(lift.all)} of simulated rounds with these jokers and ${pct(lift.none)} with none; without one: ${lift.perJoker.map((x) => `${x.label} ${pts(-x.loss)}`).join(", ")}.`
            : "",
        ]
          .filter(Boolean)
          .join(" ")
      : "No jokers yet.",
  };

  // The coming boss: the same rounds with its rule in play.
  const bossBlind = s.blinds.find((b) => b.type === "BOSS");
  let boss: Assessment["boss"];
  if (bossBlind && simulate) {
    const rule = bossEffects(bossBlind.name, s.handSize);
    const target = bossBlind.target || targets[0];
    const plain = rule ? roundOdds(s, [current], target, hands, discards, samples)[0] : odds[0];
    const withRule = rule ? roundOdds(s, [current], target, hands, discards, samples, rule)[0] : plain;
    const drop = plain - withRule;
    const threat = drop >= 0.4 ? "severe" : drop >= 0.2 ? "serious" : drop >= 0.05 ? "mild" : "none";
    boss = {
      name: bossBlind.name,
      effect: bossBlind.effect,
      target,
      plain,
      withRule,
      threat,
      text: rule
        ? `${bossBlind.name} (${bossBlind.effect}): beaten in ${pct(withRule)} of simulated rounds, against ${pct(plain)} without its rule; threat ${threat}.`
        : `${bossBlind.name} (${bossBlind.effect}): its rule doesn't change scoring here; beaten in ${pct(plain)} of simulated rounds.`,
    };
  }

  // The boss pool: a reroll draws from the eligible bosses used the fewest times this run, so the
  // current boss is set against the average of what could replace it.
  let pool: Assessment["pool"];
  if (boss && simulate) {
    const choices = bossPool(s.ante, bossesUsed(s, opts.bossesSeen)).filter((b) => b.name !== boss!.name);
    if (choices.length) {
      // The same deals and sample count for the plain round and every boss, so drops compare.
      const target = boss.target;
      const n = Math.min(24, minor);
      const plain = roundOdds(s, [current], target, hands, discards, n)[0];
      const scored = choices.slice(0, 8).map((b) => {
        const rule = bossEffects(b.name, s.handSize);
        return { name: b.name, drop: rule ? plain - roundOdds(s, [current], target, hands, discards, n, rule)[0] : 0 };
      });
      const expectedDrop = scored.reduce((a, b) => a + b.drop, 0) / scored.length;
      const currentDrop = boss.plain - boss.withRule;
      pool = {
        bosses: scored.sort((a, b) => b.drop - a.drop),
        currentDrop,
        expectedDrop,
        text: `A reroll draws one of ${choices.length} boss${choices.length === 1 ? "" : "es"} not yet met this cycle (${scored.map((b) => `${b.name} ${pts(-b.drop)}`).join(", ")}): on average they cost ${Math.round(expectedDrop * 100)} points of simulated odds, against ${Math.round(currentDrop * 100)} for ${boss.name}.`,
      };
    }
  }

  // The deck: what it is, and what the deck-fixing cards would do for it (simulated on a dealt hand).
  let deck: Assessment["deck"];
  const cards = [...s.deckLeft, ...s.hand].filter((c) => c.rank || c.enhancement === "STONE");
  if (cards.length) {
    const bySuit = new Map<string, number>();
    for (const c of cards) if (c.suit) bySuit.set(c.suit, (bySuit.get(c.suit) ?? 0) + 1);
    const suit = p.deckFix.suit ?? [...bySuit].sort((a, b) => b[1] - a[1])[0]?.[0];
    const suitShare = suit ? (bySuit.get(suit) ?? 0) / cards.length : 0;
    const enhanced = cards.filter((c) => c.enhancement).length;
    const sealed = cards.filter((c) => c.seal).length;
    const fixes: NonNullable<Assessment["deck"]>["fixes"] = [];
    if (simulate) {
      const SUIT_TAROT: Record<string, string> = { H: "c_sun", D: "c_star", C: "c_moon", S: "c_world" };
      const tries: { key: string; label: string; n: number }[] = [
        ...(p.primary.name === "Flush" && suit ? [{ key: SUIT_TAROT[suit], label: `${{ H: "The Sun", D: "The Star", C: "The Moon", S: "The World" }[suit]} (to ${SUIT_NAME[suit]})`, n: 3 }] : []),
        { key: "c_hanged_man", label: "The Hanged Man (destroy 2)", n: 2 },
        { key: "c_death", label: "Death (copy a card)", n: 2 },
        { key: "c_justice", label: "Justice (Glass)", n: 1 },
        { key: "c_empress", label: "The Empress (Mult x2)", n: 2 },
        { key: "c_chariot", label: "The Chariot (Steel)", n: 1 },
      ];
      const rand = mulberry32(s.round * 1299709 + cards.length);
      const hand = dealtHand(cards, s.handSize, rand);
      const setups: Setup[] = [current];
      const used: typeof tries = [];
      for (const t of tries) {
        const picks = pickTargets({ key: t.key, targetMin: 1, targetMax: t.n }, hand, p.deckFix.suit);
        if (!picks) continue;
        const changed = applyToDeck({ key: t.key }, cards, picks.map((i) => hand[i]), rand);
        if (!changed) continue;
        setups.push({ ...current, deck: changed });
        used.push(t);
      }
      const o = roundOdds(s, setups, next, hands, discards, minor);
      used.forEach((t, i) => fixes.push({ key: t.key, label: t.label, gain: o[i + 1] - o[0] }));
      fixes.sort((a, b) => b.gain - a.gain);
    }
    deck = {
      size: cards.length,
      suit,
      suitShare,
      enhanced,
      sealed,
      fixes,
      text: `${cards.length} cards${suit ? `, ${pct(suitShare)} ${SUIT_NAME[suit]}` : ""}, ${enhanced} enhanced, ${sealed} sealed${s.deckKnown ? "" : " (assumed: the game hid the deck)"}.${fixes.length ? ` Simulated at the next ante's boss, on a dealt hand: ${fixes.slice(0, 3).map((f) => `${f.label} ${pts(f.gain)}`).join(", ")}.` : ""}`,
    };
  }

  // Planets: one more level for the build's hands and the most played one.
  const planets: Assessment["planets"] = [];
  if (simulate) {
    const top = Object.entries(s.levels).sort((a, b) => (b[1]?.played ?? 0) - (a[1]?.played ?? 0))[0];
    const handsToTry = [...new Set([...(ARCHETYPES[p.primary.name]?.hands ?? []).slice(0, 2), ...(top && (top[1]?.played ?? 0) > 0 ? [top[0]] : [])])].filter((h) => PLANET_OF[h]) as HandName[];
    if (handsToTry.length) {
      const o = roundOdds(s, [current, ...handsToTry.map((h) => ({ ...current, levels: levelUp(s.levels, h) }))], next, hands, discards, minor);
      handsToTry.forEach((h, i) => planets.push({ hand: h, planet: planetName(PLANET_OF[h]), gain: o[i + 1] - o[0] }));
      planets.sort((a, b) => b.gain - a.gain);
    }
  }

  // Targets: the jokers that would add most, ranked by the typical hand, then simulated.
  const out: Assessment["targets"] = [];
  const targetPool: Assessment["targetPool"] = [];
  if (opts.targets && simulate && p.power > 0) {
    const owned = new Set(s.jokers.map((j) => j.key));
    const asJoker = (k: string): Joker => ({ index: s.jokers.length, key: k, label: titled(k), effect: "", stats: {}, debuff: false, eternal: false, sell: 2 });
    const ranked = MODELLED_JOKERS.filter((k) => !owned.has(k) && !jokerTags(k, "").has("econ"))
      .map((k) => ({ key: k, power: powerWith(s, p, [...s.jokers, asJoker(k)]) }))
      .sort((a, b) => b.power - a.power)
      .slice(0, 6);
    const full = s.jokers.length >= s.jokerSlots;
    const without = full && p.weakest ? s.jokers.filter((j) => j.index !== p.weakest!.index) : s.jokers;
    const setups = ranked.map((r) => ({ jokers: [...without, asJoker(r.key)], levels: s.levels }));
    const base = roundOdds(s, [{ jokers: without, levels: s.levels }, ...setups], next, hands, discards, minor);
    ranked.forEach((r, i) => targetPool.push({ key: r.key, gain: base[i + 1] - base[0] }));
    out.push(...targetPool.map((t) => ({ ...t, label: titled(t.key) })).sort((a, b) => b.gain - a.gain).slice(0, 3));
  }

  // Economy.
  const cap = interestCap(s);
  const rent = rentDue(s);
  const interest = interestOn(s, s.money);
  const surplus = cap > 0 ? Math.max(0, s.money - rent - 5 * cap) : s.money;
  const econStatus = cap === 0 ? "no interest" : surplus > 0 ? "surplus" : interest >= cap ? "at the cap" : "under the cap";
  const economy = {
    status: econStatus,
    interest,
    cap,
    surplus,
    text:
      cap === 0
        ? `No interest on this deck; $${s.money} to spend.`
        : `$${s.money}${rent ? ` ($${rent} rent due)` : ""}: $${interest} of $${cap} interest a round${surplus > 0 ? `, $${surplus} above the cap` : interest < cap ? `, $${5 * (interest + 1) + rent - s.money} short of the next $1` : ""}; about $${p.econ.incomePerRound} income a round.`,
  } as Assessment["economy"];

  const result: Assessment = { synergy, boss, pool, deck, planets, targets: out, targetPool, economy, outlook, ms: performance.now() - t0 };
  cache.set(key, result);
  if (cache.size > 48) cache.delete(cache.keys().next().value!);
  return result;
}

/** The assessment as facts for the model's state. */
export function assessmentView(a: Assessment): Record<string, string> {
  return {
    joker_synergy: a.synergy.text,
    run_outlook: a.outlook.text,
    ...(a.boss ? { coming_boss: a.boss.text } : {}),
    ...(a.pool ? { boss_reroll_pool: a.pool.text } : {}),
    ...(a.deck ? { deck: a.deck.text } : {}),
    ...(a.planets.length ? { planet_value: `One more level, simulated at the next ante's boss: ${a.planets.map((x) => `${x.planet} (${x.hand}) ${pts(x.gain)}`).join(", ")}.` } : {}),
    ...(a.targets.length ? { jokers_that_would_help_most: a.targets.map((t) => `${t.label} (${pts(t.gain)} points at the next ante's boss)`).join(", ") } : {}),
    economy: a.economy.text,
  };
}

