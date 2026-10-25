// Using Tarots, Planets and Spectrals: the game's use_consumeable for each, and its can_use rules
// (which the mod checks for `use`; a card picked from a pack is used without them, as in the mod).

import { HAND_NAMES, type HandName } from "../poker.ts";
import { BLACK_HOLE, PLANET_BY_KEY, SOUL, SPECTRALS, TAROTS, type ConsumableSpec } from "./data.ts";
import { HOOKS, nextRank } from "./jokers.ts";
import { chance, consumableSlots, jokerSlots, pick, sellValue, shuffle, type Edition, type Fx, type Item, type SimCard, type World } from "./world.ts";

export const specOf = (key: string): ConsumableSpec | undefined => TAROTS[key] ?? SPECTRALS[key] ?? (key === "c_black_hole" ? BLACK_HOLE : key === "c_soul" ? SOUL : undefined);

const ENHANCE: Record<string, string> = {
  c_magician: "LUCKY",
  c_empress: "MULT",
  c_heirophant: "BONUS",
  c_lovers: "WILD",
  c_chariot: "STEEL",
  c_justice: "GLASS",
  c_devil: "GOLD",
  c_tower: "STONE",
};
const SUIT: Record<string, string> = { c_star: "D", c_moon: "C", c_sun: "H", c_world: "S" };
const SEAL: Record<string, string> = { c_talisman: "GOLD", c_deja_vu: "RED", c_trance: "BLUE", c_medium: "PURPLE" };

/** poll_edition guaranteed, no Negative: Foil 50%, Holographic 35%, Polychrome 15%. */
export function guaranteedEdition(w: World, stream: string): Edition {
  const r = w.rng(stream);
  return r > 0.85 ? "POLYCHROME" : r > 0.5 ? "HOLO" : "FOIL";
}

/** Why the game refuses to use it now, or undefined when it can be used. */
export function cannotUse(w: World, it: Item, targets: number): string | undefined {
  if (it.set === "PLANET" || it.key === "c_black_hole") return undefined;
  const spec = specOf(it.key);
  if (!spec) return "unknown consumable";
  if (spec.max) {
    const min = spec.min ?? 1;
    if (targets < min || targets > spec.max) return `needs ${min === spec.max ? min : `${min}-${spec.max}`} selected cards`;
    return undefined;
  }
  const plain = w.jokers.filter((j) => !j.edition);
  switch (it.key) {
    case "c_judgement":
    case "c_wraith":
    case "c_soul":
      return w.jokers.length < jokerSlots(w) ? undefined : "no room for a joker";
    case "c_wheel_of_fortune":
    case "c_hex":
    case "c_ectoplasm":
      return plain.length ? undefined : "no joker without an edition";
    case "c_ankh":
      return w.jokers.length ? undefined : "no joker to copy";
    case "c_fool":
      return w.lastTarotPlanet && w.lastTarotPlanet !== "c_fool" ? undefined : "no Tarot or Planet used yet";
    case "c_familiar":
    case "c_grim":
    case "c_incantation":
    case "c_immolate":
    case "c_sigil":
    case "c_ouija":
      return w.phase === "SELECTING_HAND" || w.pack ? (w.hand.length > 1 ? undefined : "needs cards in hand") : "needs cards in hand";
  }
  return undefined;
}

const copyInto = (to: SimCard, from: SimCard) => Object.assign(to, { rank: from.rank, suit: from.suit, enhancement: from.enhancement, edition: from.edition, seal: from.seal });

/** Applies a consumable; it has already left its area. `targets` are hand cards, in the order given. */
export function useConsumable(w: World, fx: Fx, it: Item, targets: SimCard[]): void {
  const planet = PLANET_BY_KEY.get(it.key);
  if (planet) {
    fx.levelUp(planet.hand, 1);
    w.planetsUsed.add(it.key);
    w.lastTarotPlanet = it.key;
    for (const j of w.jokers) if (!j.debuff) HOOKS[j.key]?.planet?.(j, w);
    return;
  }
  if (it.set === "TAROT") {
    w.tarotUsed++;
    if (it.key !== "c_fool") w.lastTarotPlanet = it.key;
  }
  const room = () => w.consumables.length < consumableSlots(w);
  const plain = () => w.jokers.filter((j) => !j.edition);
  const k = it.key;
  if (ENHANCE[k]) for (const c of targets) c.enhancement = ENHANCE[k];
  else if (SUIT[k]) for (const c of targets) c.suit = SUIT[k];
  else if (SEAL[k]) for (const c of targets) c.seal = SEAL[k];
  else if (k === "c_strength") for (const c of targets) c.rank = nextRank(c.rank);
  else if (k === "c_hanged_man") fx.destroyCards(targets);
  else if (k === "c_death") {
    // The mod lays the cards out in argument order; the rightmost (last) is the one copied.
    const src = targets[targets.length - 1];
    for (const c of targets.slice(0, -1)) copyInto(c, src);
  } else if (k === "c_hermit") fx.earn(Math.min(20, Math.max(0, w.money)));
  else if (k === "c_temperance") fx.earn(Math.min(50, w.jokers.reduce((a, j) => a + sellValue(j), 0)));
  else if (k === "c_high_priestess" || k === "c_emperor") {
    for (let i = 0; i < 2 && room(); i++) fx.createConsumable(k === "c_emperor" ? "TAROT" : "PLANET");
  } else if (k === "c_fool") {
    if (w.lastTarotPlanet && room()) fx.createConsumable(PLANET_BY_KEY.has(w.lastTarotPlanet) ? "PLANET" : "TAROT", w.lastTarotPlanet);
  } else if (k === "c_judgement") fx.createJoker({});
  else if (k === "c_wheel_of_fortune") {
    if (plain().length && chance(w, "wheel_of_fortune", 4)) pick(w, "wheel_of_fortune", plain()).edition = guaranteedEdition(w, "wheel_of_fortune");
  } else if (k === "c_aura") {
    for (const c of targets) c.edition = guaranteedEdition(w, "aura");
  } else if (k === "c_familiar" || k === "c_grim" || k === "c_incantation") {
    if (w.hand.length) fx.destroyCards([pick(w, "random_destroy", w.hand)]);
    const ranks = k === "c_familiar" ? ["J", "Q", "K"] : k === "c_grim" ? ["A"] : ["2", "3", "4", "5", "6", "7", "8", "9", "T"];
    const n = k === "c_familiar" ? 3 : k === "c_grim" ? 2 : 4;
    for (let i = 0; i < n; i++) fx.addCard(fx.newCard({ rank: pick(w, "spectral_cards", ranks), enhanced: true }), "hand");
  } else if (k === "c_immolate") {
    fx.destroyCards(shuffle(w, "immolate", w.hand).slice(0, 5));
    fx.earn(20);
  } else if (k === "c_sigil") {
    const suit = pick(w, "sigil", ["S", "H", "C", "D"]);
    for (const c of w.hand) c.suit = suit;
  } else if (k === "c_ouija") {
    const rank = pick(w, "ouija", ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"]);
    for (const c of w.hand) c.rank = rank;
    w.handSizeDelta -= 1;
  } else if (k === "c_ectoplasm") {
    if (plain().length) pick(w, "ectoplasm", plain()).edition = "NEGATIVE";
    w.handSizeDelta -= w.ectoMinus;
    w.ectoMinus += 1;
  } else if (k === "c_wraith") {
    fx.createJoker({ rarity: "RARE" });
    w.money = 0;
  } else if (k === "c_soul") fx.createJoker({ rarity: "LEGENDARY" });
  else if (k === "c_ankh") {
    const chosen = pick(w, "ankh", w.jokers);
    for (const j of [...w.jokers]) if (j !== chosen && !j.eternal) fx.destroyJoker(j);
    fx.createJoker({ from: chosen, force: true });
  } else if (k === "c_hex") {
    const chosen = pick(w, "hex", plain());
    chosen.edition = "POLYCHROME";
    for (const j of [...w.jokers]) if (j !== chosen && !j.eternal) fx.destroyJoker(j);
  } else if (k === "c_cryptid") {
    for (let i = 0; i < 2; i++) fx.addCard({ ...targets[0], id: 0, faceDown: false, forced: false }, "hand");
  } else if (k === "c_black_hole") {
    for (const h of HAND_NAMES) fx.levelUp(h as HandName, 1);
  }
}
