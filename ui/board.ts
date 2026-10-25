// The board: the game drawn from the shown tick's snapshot, so the simulator (which has no window)
// can be watched, and a real game's picture can be swapped for the tick being looked at. The run's
// numbers along the top, the jokers and consumables, then what the phase puts on the table (the
// blinds, the hand, the shop, an open pack, the cash-out). The cards are the game's own sprites when
// ui/game/ holds them (tools/textures.py copies them from the local Balatro.love; they are never
// committed), and schematic CSS cards otherwise; the board's frame stays in the dashboard's style.
// The chosen move marks what it acts on in its kind's color, as the decision's swatches do; hand
// cards it plays, discards or targets rise, as they do in the game.

import type { PCard } from "../src/cards.ts";
import type { Candidate, RpcCall } from "../src/candidates.ts";
import type { BlindView, Item, ShopItem, Snapshot } from "../src/extract.ts";
import type { TickRecord } from "../src/loop.ts";
import type { Joker } from "../src/poker.ts";
import { h, mount, withTip } from "./dom.ts";

/** What a move does to one thing on the board: its kind's color (style.css .k-*) and a word. */
interface Mark {
  kind: string;
  word: string;
}

const METHOD_MARK: Record<string, Mark> = {
  play: { kind: "play", word: "Play" },
  discard: { kind: "discard", word: "Discard" },
  buy: { kind: "money", word: "Buy" },
  sell: { kind: "money", word: "Sell" },
  reroll: { kind: "money", word: "Reroll" },
  reroll_boss: { kind: "money", word: "Reroll" },
  cash_out: { kind: "money", word: "Cash out" },
  use: { kind: "card", word: "Use" },
  pack: { kind: "card", word: "Take" },
  select: { kind: "blind", word: "Play" },
  skip: { kind: "pass", word: "Skip" },
  next_round: { kind: "pass", word: "Leave" },
  rearrange: { kind: "pass", word: "Reorder" },
};
const TARGET: Mark = { kind: "card", word: "Target" };

const SUIT_GLYPH: Record<string, string> = { S: "♠︎", H: "♥︎", C: "♣︎", D: "♦︎" };
const SUIT_WORD: Record<string, string> = { S: "Spades", H: "Hearts", C: "Clubs", D: "Diamonds" };
const RANK_TEXT: Record<string, string> = { T: "10" };
const RANK_WORD: Record<string, string> = { T: "10", J: "Jack", Q: "Queen", K: "King", A: "Ace" };
/** A set's dot (style.css .c-*); jokers take their rarity's. */
const SET_TONE: Record<string, string> = { TAROT: "tarot", PLANET: "planet", SPECTRAL: "spectral", VOUCHER: "voucher", BOOSTER: "pack" };
/** Seals in their own colors: red, blue, gold, and purple (it makes Tarots). */
export const SEAL_TONE: Record<string, string> = { RED: "mult", BLUE: "chips", GOLD: "money", PURPLE: "tarot" };
/** Enhancements by what they add, matching the card washes (style.css .en-*): Steel and Stone stay grey. */
export const ENHANCEMENT_TONE: Record<string, string> = { BONUS: "chips", MULT: "mult", GOLD: "money", LUCKY: "hand", GLASS: "planet", WILD: "pack" };
const BLIND_STATUS: Record<string, string> = { SELECT: "Up next", CURRENT: "Playing", UPCOMING: "Upcoming", DEFEATED: "Defeated", SKIPPED: "Skipped" };
const BLIND_TYPE: Record<string, string> = { SMALL: "Small blind", BIG: "Big blind", BOSS: "Boss blind" };
const PACK_NAME: Record<string, string> = { TAROT: "Arcana pack", PLANET: "Celestial pack", SPECTRAL: "Spectral pack", JOKER: "Buffoon pack", DEFAULT: "Standard pack", ENHANCED: "Standard pack" };

// ---------------------------------------------------------------------------------------------
// The game's sprites (ui/game/sprites.json): each key's atlas and cell. Loaded once; any sprite
// that is missing falls back to the CSS card or tile.
// ---------------------------------------------------------------------------------------------

interface Cell {
  atlas: string;
  x: number;
  y: number;
  /** Legendary jokers (and Hologram) float a second layer over the card. */
  soul?: { x: number; y: number };
}
interface Sheet {
  url: string;
  cols: number;
  rows: number;
}
let art: { sheets: Record<string, Sheet>; groups: Record<string, Record<string, Cell>> } | undefined;

/** Load the sprite map and every atlas it names; resolves false when ui/game/ isn't there. */
export async function loadArt(): Promise<boolean> {
  try {
    const res = await fetch("/game/sprites.json");
    if (!res.ok) return false;
    const map = (await res.json()) as { atlases: Record<string, { file: string; w: number; h: number }> } & Record<string, Record<string, Cell>>;
    const sheets: Record<string, Sheet> = {};
    await Promise.all(
      Object.entries(map.atlases).map(async ([name, a]) => {
        const img = new Image();
        img.src = `/game/${a.file}`;
        try {
          await img.decode();
          sheets[name] = { url: img.src, cols: Math.round(img.naturalWidth / a.w), rows: Math.round(img.naturalHeight / a.h) };
        } catch {
          // This atlas is missing; its sprites fall back.
        }
      }),
    );
    if (!Object.keys(sheets).length) return false;
    const { atlases: _, ...groups } = map;
    art = { sheets, groups };
    drawn = undefined;
    return true;
  } catch {
    return false;
  }
}

const cellOf = (group: string, key: string | undefined): Cell | undefined => (key && art?.groups[group]?.[key]) || undefined;

/** One atlas cell as CSS: the sheet scaled so a cell fills the element, offset to the cell. */
function spriteCss(c: Cell, at: { x: number; y: number } = c, prop: "background" | "mask" = "background"): Record<string, string> | undefined {
  const sh = art?.sheets[c.atlas];
  if (!sh) return undefined;
  const size = `${sh.cols * 100}% ${sh.rows * 100}%`;
  const pos = `${sh.cols > 1 ? (at.x / (sh.cols - 1)) * 100 : 0}% ${sh.rows > 1 ? (at.y / (sh.rows - 1)) * 100 : 0}%`;
  const url = `url("${sh.url}")`;
  return prop === "background"
    ? { backgroundImage: url, backgroundSize: size, backgroundPosition: pos }
    : { maskImage: url, maskSize: size, maskPosition: pos, webkitMaskImage: url, webkitMaskSize: size, webkitMaskPosition: pos };
}

const layer = (c: Cell | undefined, at?: { x: number; y: number }) => {
  const css = c && spriteCss(c, at);
  return css ? h("span", { class: "bd-layer", style: css }) : null;
};

/**
 * A card's art: its layers bottom to top, and an edition's sheen masked to the base layer's shape
 * (the game draws editions with shaders; here Foil, Holo and Polychrome are a tinted overlay and
 * Negative inverts). A debuffed card's strike is drawn over it by its piece (style.css).
 */
function artBox(base: Cell, layers: (HTMLElement | null)[], o: { edition?: string; label: string; size?: string }): HTMLElement {
  const ed = o.edition?.toLowerCase();
  return h(
    "span",
    { class: `bd-art${o.size ? ` ${o.size}` : ""}${ed ? ` ed-${ed}` : ""}`, role: "img", "aria-label": o.label },
    layers,
    ed && ed !== "negative" ? h("span", { class: "bd-sheen", style: spriteCss(base, base, "mask") }) : null,
  );
}

const STICKERS = ["eternal", "perishable", "rental"] as const;
function stickerLayers(x: { eternal: boolean; perishable?: number; rental?: number }) {
  return STICKERS.filter((k) => (k === "eternal" ? x.eternal : x[k] !== undefined)).map((k) => layer(cellOf("stickers", k)));
}

/** The sprite group for an item's set; playing cards in a shop or pack are keyed like "H_K". */
const GROUP_OF: Record<string, string> = { JOKER: "jokers", TAROT: "consumables", PLANET: "consumables", SPECTRAL: "consumables", VOUCHER: "vouchers", BOOSTER: "boosters" };

/** The blind chip's key from the blind's name: The Wall is bl_wall, Amber Acorn bl_final_acorn. */
function blindKey(b: BlindView): string {
  if (b.type === "SMALL") return "bl_small";
  if (b.type === "BIG") return "bl_big";
  const n = b.name.replace(/^The /, "").toLowerCase().replace(/[^a-z]+/g, "_");
  return cellOf("blinds", `bl_${n}`) ? `bl_${n}` : `bl_final_${n.split("_").pop()}`;
}

const num = (x: number) => (Number.isInteger(x) ? x.toLocaleString() : x.toFixed(1));
const word = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
const isPlaying = (set: string) => set === "DEFAULT" || set === "ENHANCED";

/** Every thing the move's calls act on, keyed by where it sits on the board. */
function marksOf(s: Snapshot, calls: RpcCall[]): Map<string, Mark> {
  const m = new Map<string, Mark>();
  for (const c of calls) {
    const mark = METHOD_MARK[c.method];
    if (!mark) continue;
    const p = c.params ?? {};
    const at = (k: string) => (typeof p[k] === "number" ? (p[k] as number) : undefined);
    const list = (k: string) => (Array.isArray(p[k]) ? (p[k] as unknown[]).filter((x): x is number => typeof x === "number") : []);
    switch (c.method) {
      case "play":
      case "discard":
        for (const i of list("cards")) m.set(`hand:${i}`, mark);
        break;
      case "use":
        if (at("consumable") !== undefined) m.set(`cons:${at("consumable")}`, mark);
        for (const i of list("cards")) m.set(`hand:${i}`, TARGET);
        break;
      case "sell":
        if (at("joker") !== undefined) m.set(`joker:${at("joker")}`, mark);
        if (at("consumable") !== undefined) m.set(`cons:${at("consumable")}`, mark);
        break;
      case "buy":
        for (const area of ["card", "voucher", "pack"]) if (at(area) !== undefined) m.set(`shop:${area}:${at(area)}`, mark);
        break;
      case "pack":
        if (p.skip) m.set("pack:skip", METHOD_MARK.skip);
        else if (at("card") !== undefined) m.set(`pack:${at("card")}`, mark);
        for (const i of list("targets")) m.set(`hand:${i}`, TARGET);
        break;
      case "select":
      case "skip": {
        const b = s.blinds.find((x) => x.status === "SELECT");
        if (b) m.set(`blind:${b.type}`, mark);
        break;
      }
      case "reroll_boss":
        m.set("blind:BOSS", mark);
        break;
      case "reroll":
        m.set("reroll", mark);
        break;
      case "next_round":
        m.set("leave", mark);
        break;
      case "cash_out":
        m.set("cashout", mark);
        break;
      case "rearrange":
        m.set("jokers", mark);
        break;
    }
  }
  return m;
}

/** The small label a marked thing wears: the kind's swatch and what the move does to it. */
const actLabel = (mark: Mark | undefined, text?: string) => (mark ? h("span", { class: `bd-act k-${mark.kind}` }, text ?? mark.word) : null);
const markClass = (mark: Mark | undefined) => (mark ? ` is-act k-${mark.kind}` : "");
const editionClass = (edition: string | undefined) => (edition ? ` has-ed ed-${edition.toLowerCase()}` : "");

function tipOf(title: string, lines: (string | undefined | false)[], meta: (string | undefined | false)[]) {
  return () =>
    h(
      "div",
      null,
      h("p", { class: "tip-title" }, title),
      lines.filter(Boolean).map((l) => h("p", null, l as string)),
      meta.some(Boolean) ? h("p", { class: "tip-meta" }, meta.filter(Boolean).join(" · ")) : null,
    );
}

// ---------------------------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------------------------

/** A joker's live numbers in the game's boxes: +chips blue, +mult and xmult red. */
function stats(st: Record<string, number>): HTMLElement | null {
  const boxes = [
    st.chips ? h("b", { class: "score-chips" }, `+${num(st.chips)}`) : null,
    st.mult ? h("b", { class: "score-mult" }, `+${num(st.mult)}`) : null,
    st.x_mult && st.x_mult !== 1 ? h("b", { class: "score-mult" }, `×${num(st.x_mult)}`) : null,
  ].filter(Boolean);
  return boxes.length ? h("span", { class: "bd-stats" }, boxes) : null;
}

function jokerTile(j: Joker, mark: Mark | undefined): HTMLElement {
  const notes = [j.edition && word(j.edition), j.eternal && "Eternal", j.rental !== undefined && `Rental $${j.rental}`, j.perishable !== undefined && `Perishes in ${j.perishable}`, j.debuff && "Debuffed"].filter(
    (x): x is string => Boolean(x),
  );
  const rarity = j.rarity?.toLowerCase();
  const others = Object.entries(j.stats).filter(([k]) => !["chips", "mult", "x_mult"].includes(k));
  const sprite = cellOf("jokers", j.key);
  const body = sprite
    ? [
        actLabel(mark),
        artBox(sprite, [layer(sprite), sprite.soul ? layer(sprite, sprite.soul) : null, ...stickerLayers(j)], { edition: j.edition, label: j.label }),
        h("span", { class: `bd-cap` }, j.label),
        stats(j.stats),
      ]
    : [actLabel(mark), h("span", { class: `bd-name c-${rarity ?? "neutral"}` }, j.label), stats(j.stats), notes.length ? h("span", { class: "bd-notes" }, notes.join(" · ")) : null];
  return withTip(
    h("div", { class: `${sprite ? "bd-piece" : `bd-tile${editionClass(j.edition)}`}${markClass(mark)}${j.debuff ? " is-debuff" : ""}` }, body),
    tipOf(j.label, [j.effect || "No description", others.length ? others.map(([k, v]) => `${k.replace(/_/g, " ")} ${num(v)}`).join(", ") : undefined], [rarity && word(rarity), notes.join(", "), `sells for $${j.sell}`]),
  );
}

/** A consumable, a shop offer or a pack's card that isn't a playing card; offers show their text. */
function itemTile(it: Item, mark: Mark | undefined, offer?: { price?: number }): HTMLElement {
  const tone = it.set === "JOKER" ? (it.rarity?.toLowerCase() ?? "neutral") : (SET_TONE[it.set] ?? "neutral");
  const notes = [it.edition && word(it.edition), it.eternal && "Eternal", it.rental !== undefined && `Rental $${it.rental}`, it.perishable !== undefined && `Perishes in ${it.perishable}`].filter(
    (x): x is string => Boolean(x),
  );
  const kind = it.set === "JOKER" ? (it.rarity ? `${word(it.rarity)} joker` : "Joker") : it.set === "BOOSTER" ? "Pack" : isPlaying(it.set) ? "Playing card" : word(it.set);
  const sprite = cellOf(GROUP_OF[it.set] ?? "", it.key);
  // A playing card offered in a shop: its enhancement (from the label, "Glass Card") under its face.
  const face = isPlaying(it.set) ? cellOf("cards", it.key) : undefined;
  const under = face ? (cellOf("enhancers", `m_${it.label.split(" ")[0].toLowerCase()}`) ?? cellOf("enhancers", "c_base")) : undefined;
  const base = sprite ?? under;
  if (base) {
    return withTip(
      h(
        "div",
        { class: `bd-piece${markClass(mark)}` },
        actLabel(mark),
        artBox(base, sprite ? [layer(sprite), sprite.soul ? layer(sprite, sprite.soul) : null, ...stickerLayers(it)] : [layer(under), layer(face)], { edition: it.edition, label: it.label }),
        h("span", { class: "bd-cap" }, it.label),
        offer?.price !== undefined ? h("span", { class: "money" }, `$${offer.price}`) : null,
      ),
      tipOf(it.label, [it.effect || "No description"], [kind, notes.join(", "), it.sell ? `sells for $${it.sell}` : undefined]),
    );
  }
  return withTip(
    h(
      "div",
      { class: `bd-tile${offer ? " bd-offer" : ""}${markClass(mark)}${editionClass(it.edition)}` },
      actLabel(mark),
      h("span", { class: `bd-name c-${tone}` }, it.label),
      offer && it.effect ? h("span", { class: "bd-text" }, it.effect) : null,
      notes.length ? h("span", { class: "bd-notes" }, notes.join(" · ")) : null,
      offer?.price !== undefined ? h("span", { class: "bd-price" }, h("span", { class: "money" }, `$${offer.price}`)) : null,
    ),
    tipOf(it.label, [it.effect || "No description"], [kind, notes.join(", "), it.sell ? `sells for $${it.sell}` : undefined]),
  );
}

/**
 * A playing card: rank and suit, its enhancement as a wash, seal as a dot, edition as a top stripe.
 * In the hand a marked card only rises (the hand's head says what the move does); in a pack it
 * wears the label too.
 */
function playingCard(c: PCard, mark: Mark | undefined, labelled = false, deck?: string): HTMLElement {
  const enh = c.enhancement?.toLowerCase();
  const sprite = cardSprite(c, deck);
  if (sprite) {
    const name = c.hidden ? "Face down" : enh === "stone" ? "Stone card" : c.rank && c.suit ? `${RANK_WORD[c.rank] ?? c.rank} of ${SUIT_WORD[c.suit]}` : c.label;
    const what = [enh && enh !== "stone" && `${word(enh)} card`, c.edition && word(c.edition), c.seal && `${word(c.seal)} seal`].filter(Boolean).join(", ");
    return withTip(
      h(
        "div",
        { class: `bd-piece bd-card-art${c.debuff ? " is-debuff" : ""}${markClass(mark)}` },
        labelled ? actLabel(mark) : null,
        artBox(sprite.base, sprite.layers, { edition: c.hidden ? undefined : c.edition, label: `${name}${what ? `, ${what}` : ""}${c.debuff ? ", debuffed" : ""}${mark ? `: ${mark.word.toLowerCase()}` : ""}` }),
        c.forced ? h("span", { class: "bd-forced", title: "Forced: always selected" }, "Forced") : null,
      ),
      tipOf(name, [c.debuff ? "Debuffed: scores nothing this blind." : undefined], [what, mark && `${mark.word} this tick`]),
    );
  }
  const cls = `bd-card${c.suit ? ` s-${c.suit}` : ""}${enh ? ` en-${enh}` : ""}${editionClass(c.edition)}${c.debuff ? " is-debuff" : ""}${c.hidden ? " is-down" : ""}${markClass(mark)}`;
  const foot = [enh && enh !== "stone" ? word(enh) : "", c.edition ? word(c.edition) : ""].filter(Boolean).join(" · ");
  const name = c.hidden ? "Face down" : enh === "stone" ? "Stone card" : c.rank && c.suit ? `${RANK_WORD[c.rank] ?? c.rank} of ${SUIT_WORD[c.suit]}` : c.label;
  const el = h(
    "div",
    { class: cls, role: "img", "aria-label": `${name}${foot ? `, ${foot.replace(" · ", ", ")}` : ""}${c.seal ? `, ${word(c.seal)} seal` : ""}${c.debuff ? ", debuffed" : ""}${mark ? `: ${mark.word.toLowerCase()}` : ""}` },
    labelled ? actLabel(mark) : null,
    c.hidden
      ? null
      : enh === "stone"
        ? h("span", { class: "bd-stone" }, "Stone")
        : [
            h("span", { class: "bd-rank" }, RANK_TEXT[c.rank ?? ""] ?? c.rank ?? "?", h("small", null, SUIT_GLYPH[c.suit ?? ""] ?? "")),
            h("span", { class: "bd-pip", "aria-hidden": "true" }, SUIT_GLYPH[c.suit ?? ""] ?? ""),
          ],
    c.seal ? h("span", { class: `bd-seal c-${SEAL_TONE[c.seal] ?? "neutral"}` }) : null,
    foot && !c.hidden ? h("span", { class: "bd-foot" }, foot) : null,
    c.forced ? h("span", { class: "bd-forced", title: "Forced: always selected" }, "Forced") : null,
  );
  return withTip(el, tipOf(name, [c.debuff ? "Debuffed: scores nothing this blind." : undefined], [enh && `${word(enh)} card`, c.edition && word(c.edition), c.seal && `${word(c.seal)} seal`, mark && `${mark.word} this tick`]));
}

/** A playing card's layers: the enhancement (or plain face), the rank and suit, the seal; the deck's back face down. */
function cardSprite(c: PCard, deck?: string): { base: Cell; layers: (HTMLElement | null)[] } | undefined {
  if (c.hidden) {
    const back = cellOf("backs", `b_${(deck ?? "red").toLowerCase()}`) ?? cellOf("backs", "b_red");
    return back && { base: back, layers: [layer(back)] };
  }
  const under = cellOf("enhancers", c.enhancement ? `m_${c.enhancement.toLowerCase()}` : "c_base");
  if (!under) return undefined;
  const seal = c.seal ? layer(cellOf("seals", c.seal)) : null;
  if (c.enhancement === "STONE") return { base: under, layers: [layer(under), seal] };
  const face = c.rank && c.suit ? cellOf("cards", `${c.suit}_${c.rank}`) : undefined;
  return face && { base: under, layers: [layer(under), layer(face), seal] };
}

function zone(title: string, opts: { count?: string; extra?: (Node | null)[]; cls?: string; mark?: Mark }, ...body: (Node | null)[]): HTMLElement {
  return h(
    "section",
    { class: `bd-zone${opts.cls ? ` ${opts.cls}` : ""}${opts.mark ? ` is-act k-${opts.mark.kind}` : ""}`, "aria-label": title },
    h("div", { class: "bd-zone-head" }, h("strong", null, title), opts.count ? h("span", null, opts.count) : null, actLabel(opts.mark), opts.extra ?? []),
    body,
  );
}

const slots = (n: number) => Array.from({ length: Math.max(0, Math.min(n, 8)) }, () => h("span", { class: `bd-slot${art ? " art" : ""}`, "aria-hidden": "true" }));

// ---------------------------------------------------------------------------------------------
// Areas
// ---------------------------------------------------------------------------------------------

/** A tag: the game's tag sprite, or its name. */
function tagChip(key: string, name: string): HTMLElement {
  const c = cellOf("tags", key);
  return c ? artBox(c, [layer(c)], { label: name, size: "chip" }) : h("span", { class: "bd-tag" }, name.replace(/ Tag$/, ""));
}

/** The blind's chip, when the sprites are there. */
function blindChip(b: BlindView): HTMLElement | null {
  const c = cellOf("blinds", blindKey(b));
  return c ? artBox(c, [layer(c)], { label: b.name, size: "chip" }) : null;
}

function stat(label: string, value: Node | string, cls = ""): HTMLElement {
  return h("div", { class: `bd-stat${cls}` }, h("span", { class: "bd-k" }, label), typeof value === "string" ? h("span", { class: "bd-v" }, value) : value);
}

/** The run's numbers: ante and round, the blind and how far the score has got, hands, discards, money, tags. */
function top(s: Snapshot): HTMLElement {
  const b = s.blind;
  const playing = s.phase === "SELECTING_HAND" && b;
  const share = b && b.target ? Math.min(1, s.scored / b.target) : 0;
  return h(
    "div",
    { class: "bd-top" },
    stat("Ante", h("span", { class: "bd-v" }, String(s.ante), h("small", null, "/8"))),
    stat("Round", String(s.round)),
    b
      ? h(
          "div",
          { class: `bd-stat bd-blind${b.type === "BOSS" ? " boss" : ""}` },
          blindChip(b),
          h(
            "span",
            { class: "bd-blind-text" },
            h("span", { class: "bd-k" }, `${b.type === "BOSS" ? "Boss blind" : "Blind"}, ${(BLIND_STATUS[b.status] ?? word(b.status)).toLowerCase()}`),
            h("span", { class: "bd-blind-name" }, h("strong", null, b.name), b.effect ? h("span", { class: "bd-effect" }, b.effect) : null),
            playing
              ? h(
                  "span",
                  { class: "bd-score" },
                  h("span", { class: "bd-progress", role: "meter", "aria-valuemin": 0, "aria-valuemax": b.target, "aria-valuenow": s.scored, "aria-label": "Score" }, h("span", { style: { width: `${share * 100}%` } })),
                  h("span", { class: "bd-score-text" }, `${num(s.scored)} of ${num(b.target)}`, s.remaining > 0 ? `, ${num(s.remaining)} to go` : ", cleared"),
                )
              : h("span", { class: "bd-score-text" }, `Score at least ${num(b.target)}`),
          ),
        )
      : null,
    stat("Hands", h("b", null, String(s.handsLeft)), " bd-hands"),
    stat("Discards", h("b", null, String(s.discardsLeft)), " bd-discards"),
    stat("Money", h("span", { class: "money" }, `$${s.money}`)),
    s.tags.length
      ? h(
          "div",
          { class: "bd-stat bd-tags" },
          h("span", { class: "bd-k" }, "Tags"),
          h("span", { class: "bd-tag-list" }, s.tags.map((t) => withTip(tagChip(t.key, t.name), tipOf(t.name, [t.effect], [])))),
        )
      : null,
  );
}

function jokers(s: Snapshot, marks: Map<string, Mark>): HTMLElement {
  return zone(
    "Jokers",
    { count: `${s.jokers.length}/${s.jokerSlots}`, cls: "bd-jokers", mark: marks.get("jokers") },
    h("div", { class: "bd-row" }, s.jokers.map((j) => jokerTile(j, marks.get(`joker:${j.index}`))), slots(s.jokerSlots - s.jokers.length)),
  );
}

function consumables(s: Snapshot, marks: Map<string, Mark>): HTMLElement {
  return zone(
    "Consumables",
    { count: `${s.consumables.length}/${s.consumableSlots}`, cls: "bd-cons" },
    h("div", { class: "bd-row" }, s.consumables.map((c) => itemTile(c, marks.get(`cons:${c.index}`))), slots(s.consumableSlots - s.consumables.length)),
  );
}

/** The hand, with what the move does to it and, for a play, its estimate in the game's boxes. */
function hand(s: Snapshot, marks: Map<string, Mark>, chosen: Candidate | undefined): HTMLElement {
  const marked = s.hand.map((c) => marks.get(`hand:${c.index}`)).filter((m): m is Mark => Boolean(m));
  const est = chosen?.estimate && chosen.kind === "play" ? chosen.estimate : undefined;
  const deck = s.deckSize ? `${s.deckLeft.length}/${s.deckSize}` : String(s.deckLeft.length);
  return zone(
    "Hand",
    {
      count: `${s.hand.length}/${s.handSize}, deck ${deck}${s.deckKnown ? "" : " (assumed)"}`,
      cls: "bd-hand-zone",
      extra: [
        marked.length
          ? h(
              "span",
              { class: "bd-move" },
              actLabel(marked[0], `${marked[0].word} ${marked.length} card${marked.length > 1 ? "s" : ""}`),
              est
                ? h("span", { class: "bd-est" }, est.hand, " ", h("span", { class: "score" }, est.approximate ? "~" : "", h("b", { class: "score-chips" }, num(est.chips)), "×", h("b", { class: "score-mult" }, num(est.mult))))
                : null,
            )
          : null,
      ],
    },
    h("div", { class: "bd-hand" }, s.hand.length ? s.hand.map((c) => playingCard(c, marks.get(`hand:${c.index}`), false, s.deck)) : h("p", { class: "bd-empty" }, "No cards in hand.")),
  );
}

function blinds(s: Snapshot, marks: Map<string, Mark>): HTMLElement {
  return zone(
    "Blinds",
    { cls: "bd-blinds-zone" },
    h(
      "div",
      { class: "bd-row" },
      s.blinds.map((b: BlindView) => {
        const mark = marks.get(`blind:${b.type}`);
        const done = b.status === "DEFEATED" || b.status === "SKIPPED";
        return h(
          "div",
          { class: `bd-tile bd-blindcard${b.type === "BOSS" ? " boss" : ""}${done ? " is-done" : ""}${markClass(mark)}` },
          actLabel(mark),
          h(
            "span",
            { class: "bd-blind-head" },
            blindChip(b),
            h("span", { class: "bd-blind-text" }, h("span", { class: "bd-k" }, `${BLIND_TYPE[b.type] ?? "Blind"}, ${(BLIND_STATUS[b.status] ?? word(b.status)).toLowerCase()}`), h("strong", { class: "bd-blind-title" }, b.name)),
          ),
          b.effect ? h("span", { class: "bd-effect" }, b.effect) : null,
          h("span", { class: "bd-score-text" }, `Score at least ${num(b.target)}`),
          b.tag
            ? withTip(h("span", { class: "bd-notes bd-skip" }, "Skip for ", cellOf("tags", b.tag.key) ? tagChip(b.tag.key, b.tag.name) : null, h("span", { class: "bd-tag" }, b.tag.name.replace(/ Tag$/, ""))), tipOf(b.tag.name, [b.tag.effect], ["skipping the blind gives this tag"]))
            : null,
        );
      }),
    ),
  );
}

function button(key: string, label: string, marks: Map<string, Mark>, price?: number): HTMLElement {
  const mark = marks.get(key);
  return h("span", { class: `bd-btn${markClass(mark)}` }, actLabel(mark), label, price !== undefined ? h("span", { class: "money" }, `$${price}`) : null);
}

function shop(s: Snapshot, marks: Map<string, Mark>): HTMLElement {
  const group = (title: string, area: ShopItem["area"]) => {
    const items = s.shop.filter((x) => x.area === area);
    return items.length ? h("div", { class: "bd-group" }, h("span", { class: "bd-k" }, title), h("div", { class: "bd-row" }, items.map((it) => itemTile(it, marks.get(`shop:${area}:${it.index}`), { price: it.cost })))) : null;
  };
  return zone(
    "Shop",
    { cls: "bd-shop", extra: [h("span", { class: "bd-btns" }, button("reroll", "Reroll", marks, s.rerollCost), button("leave", "Next round", marks))] },
    h("div", { class: "bd-groups" }, group("Cards", "card"), group("Voucher", "voucher"), group("Packs", "pack")),
  );
}

function pack(s: Snapshot, marks: Map<string, Mark>): HTMLElement {
  const sets = new Set(s.pack.map((x) => x.set));
  const name = sets.size === 1 ? PACK_NAME[[...sets][0]] : sets.size === 2 && [...sets].every(isPlaying) ? PACK_NAME.DEFAULT : undefined;
  return zone(
    name ?? "Pack",
    { count: s.packChoicesRemaining ? `choose ${s.packChoicesRemaining}` : undefined, cls: "bd-pack", extra: [h("span", { class: "bd-btns" }, button("pack:skip", "Skip", marks))] },
    h(
      "div",
      { class: "bd-row bd-pack-row" },
      s.pack.map((it) => {
        const card = isPlaying(it.set) ? s.packCards.find((c) => c.index === it.index) : undefined;
        return card ? playingCard(card, marks.get(`pack:${it.index}`), true, s.deck) : itemTile(it, marks.get(`pack:${it.index}`), {});
      }),
    ),
  );
}

function cashout(s: Snapshot, marks: Map<string, Mark>): HTMLElement {
  return zone("Round won", { cls: "bd-cashout" }, h("div", { class: "bd-row" }, button("cashout", "Cash out", marks, s.cashout)));
}

function over(s: Snapshot): HTMLElement {
  const r = s.runSummary;
  const facts = [
    r?.best_hand !== undefined && `best hand ${num(r.best_hand)}`,
    r?.most_played_hand && `most played ${r.most_played_hand.name} (${r.most_played_hand.count})`,
    r?.cards_played !== undefined && `${r.cards_played} cards played`,
    r?.cards_purchased !== undefined && `${r.cards_purchased} bought`,
    r?.reroll_count !== undefined && `${r.reroll_count} rerolls`,
  ].filter(Boolean);
  return zone(s.won ? "Run won" : "Game over", { cls: "bd-over" }, h("p", { class: "bd-empty" }, facts.length ? `${word(facts.join(", "))}.` : `Ended at ante ${s.ante}, round ${s.round}.`));
}

// ---------------------------------------------------------------------------------------------

let drawn: TickRecord | undefined;

/** Draw the tick's board, with the chosen move's targets marked. Redraws only for a new tick. */
export function renderBoard(root: HTMLElement, t: TickRecord | undefined, chosen: Candidate | undefined) {
  if (t === drawn && root.childElementCount) return;
  drawn = t;
  if (!t) return mount(root);
  const s = t.snapshot;
  const calls = t.calls ?? (t.call ? [t.call] : chosen ? (chosen.calls ?? [chosen.call]) : []);
  const marks = marksOf(s, calls);
  if (s.phase === "MENU") return mount(root, h("div", { class: "bd-idle" }, h("h2", null, "Main menu"), h("p", null, "The next tick starts a run.")));
  const table =
    s.phase === "BLIND_SELECT"
      ? blinds(s, marks)
      : s.phase === "SELECTING_HAND"
        ? hand(s, marks, chosen)
        : s.phase === "SHOP"
          ? shop(s, marks)
          : s.phase === "SMODS_BOOSTER_OPENED"
            ? pack(s, marks)
            : s.phase === "ROUND_EVAL"
              ? cashout(s, marks)
              : s.phase === "GAME_OVER"
                ? over(s)
                : null;
  mount(
    root,
    top(s),
    h("div", { class: "bd-mid" }, jokers(s, marks), consumables(s, marks)),
    table,
    // An Arcana or Spectral pack deals a hand to use its card on.
    s.phase === "SMODS_BOOSTER_OPENED" && s.hand.length ? hand(s, marks, chosen) : null,
  );
}
