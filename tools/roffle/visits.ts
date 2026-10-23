// Reads the Roffle dataset (data/roffle) into shop and pack visits: what was offered, which jokers
// he held, his money and ante, and which offered jokers he took. Shared by priors.ts and agree.ts.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { ExpertPriors, JokerTally } from "../../src/expert.ts";

export const DATA = resolve(import.meta.dirname, "..", "..", "data", "roffle");

export interface Card {
  key: string;
  name: string;
  edition?: string;
  stickers?: string[];
}

export interface VideoData {
  video_id: string;
  title: string;
  offers: { t: number; where: "shop" | "pack"; items: Card[] }[];
  screens: { t: number; screen: string }[];
  hud: { t: number; money: number | null; ante: number | null; round: number | null }[];
  joker_lineups: { t: number; jokers: Card[] }[];
  packs: { t: number; pack: string }[];
  /** Blinds played, in order, with the ante counted from that order (second-pass videos). */
  blinds?: { start_t: number; end_t: number; ante: number; round: number; boss: boolean }[];
  /** Shop visits with the ante the game showed in them. */
  shops?: { start_t: number; end_t: number; ante: number }[];
}

export interface Decision {
  video_id: string;
  t_seconds: number;
  type: string;
  item: Card | null;
  jokers_before: Card[] | null;
  jokers_after: Card[] | null;
  ante: number | null;
  money_before: number | null;
  money_after: number | null;
  screen?: string;
  /** play_hand and discard: the whole hand before the choice. */
  hand?: HandCard[] | null;
  /** What the shop or pack showed just before the choice. */
  offered?: Card[] | null;
  pack?: string | null;
  /** What his cursor rested on since his previous choice in that visit. */
  hovered?: { key: string; name: string; seconds: number }[] | null;
}

/** A playing card as the card model read it: rank "2".."10","J".."A", suit "Spades".., modifiers capitalised. */
export interface HandCard {
  rank?: string;
  suit?: string;
  enhancement?: string;
  edition?: string;
  seal?: string;
}

export interface Visit {
  video: string;
  where: "shop" | "pack";
  start: number;
  end: number;
  pack?: string;
  /** Jokers offered during the visit (rerolls included), once each. */
  jokers: Card[];
  /** The offered jokers he took, in order. */
  taken: Card[];
  /** Offered jokers his cursor rested on that he did not take: read and passed on. */
  looked: string[];
  held: Card[];
  money?: number;
  ante?: number;
  /** His deck as estimated from recent hands (see `deckAt`); absent when too few were read. */
  deck?: HandCard[];
}

export interface CatalogJoker {
  key: string;
  name: string;
  rarity: string;
  cost: number;
  effect: string;
}

/** Deck and stake per video, from playbook.json (read off the deck back and the video description). */
export interface RunSetting {
  deck: string;
  stake: string;
}

/**
 * Every analysed video: the ones in videos.json plus any whose `<id>.json` and `<id>.decisions.jsonl`
 * exist (the analyzer writes those first). A file caught mid-write is skipped with a warning.
 */
export function loadDataset(): { videos: VideoData[]; decisions: Decision[]; catalog: Map<string, CatalogJoker>; settings: Map<string, RunSetting> } {
  const list = JSON.parse(readFileSync(resolve(DATA, "videos.json"), "utf8")) as { id: string }[] | { videos: { id: string }[] };
  const listed = (Array.isArray(list) ? list : list.videos).map((v) => v.id);
  const found = readdirSync(DATA)
    .filter((f) => f.endsWith(".decisions.jsonl"))
    .map((f) => f.slice(0, -".decisions.jsonl".length))
    .filter((id) => existsSync(resolve(DATA, `${id}.json`)));
  const videos: VideoData[] = [];
  const decisions: Decision[] = [];
  for (const id of [...new Set([...listed, ...found])]) {
    try {
      const v = JSON.parse(readFileSync(resolve(DATA, `${id}.json`), "utf8")) as VideoData;
      const own = resolve(DATA, `${id}.decisions.jsonl`);
      const lines = existsSync(own)
        ? readFileSync(own, "utf8").split("\n").filter(Boolean)
        : readFileSync(resolve(DATA, "decisions.jsonl"), "utf8").split("\n").filter((l) => l.includes(`"${id}"`));
      decisions.push(...lines.map((line) => JSON.parse(line) as Decision).filter((d) => d.video_id === id));
      videos.push(v);
    } catch (e) {
      console.warn(`skipping ${id}: ${(e as Error).message}`);
    }
  }
  const catalog = new Map((JSON.parse(readFileSync(resolve(DATA, "catalog", "jokers.json"), "utf8")) as CatalogJoker[]).map((j) => [j.key, j]));
  const settings = new Map<string, RunSetting>();
  // videos.json carries the analyzer's deck and stake; the playbook's sources, checked by hand, win.
  for (const v of Array.isArray(list) ? list : list.videos) {
    const s = v as { id: string; deck?: string; stake?: string };
    if (s.deck && s.stake) settings.set(s.id, { deck: s.deck.toUpperCase(), stake: s.stake.toUpperCase() });
  }
  const playbook = resolve(DATA, "playbook.json");
  if (existsSync(playbook)) {
    for (const src of (JSON.parse(readFileSync(playbook, "utf8")) as { sources: { id: string; deck?: string; stake?: string }[] }).sources) {
      if (src.deck && src.stake) settings.set(src.id, { deck: src.deck.toUpperCase(), stake: src.stake.toUpperCase() });
    }
  }
  return { videos, decisions, catalog, settings };
}

const ACQUIRE = new Set(["buy_joker", "pack_pick_joker"]);
/** Screens that end a visit: a shop ends when play resumes, a pack when any other screen shows. */
const ENDS_SHOP = new Set(["hand", "blind_select", "cash_out"]);

const isJoker = (c: Card) => c.key.startsWith("j_");
const validAnte = (a: number | null | undefined) => (a !== null && a !== undefined && a >= 1 ? a : undefined);

function mode(values: number[]): number | undefined {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0];
}

/**
 * The ante the game showed at second `t`, from the blinds played in order: the shop visit's own
 * ante when one covers `t`, else the last blind's, one higher once its boss is beaten. Undefined
 * for videos analysed before blinds were tracked; those fall back to HUD OCR.
 */
function anteFromBlinds(v: VideoData, t: number): number | undefined {
  const shop = v.shops?.find((s) => t >= s.start_t - 3 && t <= s.end_t + 3);
  if (shop) return validAnte(shop.ante);
  const last = v.blinds?.filter((b) => b.start_t <= t).at(-1);
  return last ? validAnte(last.ante + (last.boss && t > last.end_t ? 1 : 0)) : undefined;
}

const cardSig = (c: HandCard) => [c.rank, c.suit, c.enhancement, c.edition, c.seal].map((x) => x ?? "").join("|");

/**
 * An estimate of his deck at second `t`: the cards seen in hand over the last three blinds of the
 * run, scaled to 52. Within a blind each card is counted once (a card stays in hand until played
 * or discarded, so only the new arrivals between two readings are added); blinds are separate
 * draws from the same deck, so pooling them gives its proportions: suits, ranks, enhancements,
 * seals. Undefined when too few cards were read to say.
 */
export function deckAt(v: VideoData, decisions: Decision[], t: number, size = 52): HandCard[] | undefined {
  const before = (v.blinds ?? []).filter((b) => b.start_t < t);
  const recent: typeof before = [];
  for (const b of before.reverse()) {
    const later = recent.at(-1);
    if (later && b.round >= later.round) break; // a new run started after b
    recent.push(b);
    if (recent.length === 3) break;
  }
  const pooled = new Map<string, { card: HandCard; n: number }>();
  let total = 0;
  for (const b of recent) {
    const hands = decisions
      .filter((d) => d.video_id === v.video_id && d.hand?.length && d.t_seconds >= b.start_t && d.t_seconds <= b.end_t + 2 && (d.type === "play_hand" || d.type === "discard"))
      .sort((a, b) => a.t_seconds - b.t_seconds)
      .map((d) => d.hand!);
    let prev = new Map<string, number>();
    for (const hand of hands) {
      const now = new Map<string, number>();
      for (const c of hand) now.set(cardSig(c), (now.get(cardSig(c)) ?? 0) + 1);
      for (const c of hand) {
        const sig = cardSig(c);
        const fresh = (now.get(sig) ?? 0) - (prev.get(sig) ?? 0);
        if (fresh <= 0) continue;
        const slot = (pooled.get(sig) ?? pooled.set(sig, { card: c, n: 0 }).get(sig))!;
        slot.n += fresh;
        total += fresh;
        prev.set(sig, now.get(sig)!); // count this signature's arrivals once per hand
      }
      prev = now;
    }
  }
  if (total < 16) return undefined;
  // Largest remainders, so the counts add up to `size` and rare cards aren't all rounded away.
  const shares = [...pooled.values()].map(({ card, n }) => ({ card, exact: (n / total) * size, count: Math.floor((n / total) * size) }));
  let left = size - shares.reduce((a, s) => a + s.count, 0);
  for (const s of [...shares].sort((a, b) => b.exact - b.count - (a.exact - a.count))) if (left-- > 0) s.count++;
  return shares.flatMap(({ card, count }) => Array.from({ length: count }, () => card));
}

export function visitsOf(v: VideoData, decisions: Decision[]): Visit[] {
  const out: Visit[] = [];
  const open: Partial<Record<"shop" | "pack", Visit & { last: number }>> = {};
  const boundary = (where: "shop" | "pack", from: number, to: number) =>
    v.screens.some((s) => s.t > from && s.t < to && (where === "shop" ? ENDS_SHOP.has(s.screen) : s.screen !== "pack" && s.screen !== "other"));

  for (const o of [...v.offers].sort((a, b) => a.t - b.t)) {
    let cur = open[o.where];
    if (!cur || boundary(o.where, cur.last, o.t)) {
      const pack = o.where === "pack" ? [...v.packs].reverse().find((p) => p.t <= o.t + 2 && p.t >= o.t - 30)?.pack : undefined;
      cur = { video: v.video_id, where: o.where, start: o.t, end: o.t, last: o.t, pack, jokers: [], taken: [], looked: [], held: [] };
      open[o.where] = cur;
      out.push(cur);
    }
    cur.end = cur.last = o.t;
    for (const item of o.items.filter(isJoker)) if (!cur.jokers.some((j) => j.key === item.key)) cur.jokers.push(item);
  }

  for (const visit of out) {
    visit.held = [...v.joker_lineups].reverse().find((l) => l.t <= visit.start)?.jokers ?? [];
    const near = v.hud.filter((h) => h.money !== null && Math.abs(h.t - visit.start) <= 8).sort((a, b) => Math.abs(a.t - visit.start) - Math.abs(b.t - visit.start));
    visit.money = near[0]?.money ?? undefined;
    const antes = v.hud.filter((h) => h.t >= visit.start - 90 && h.t <= visit.start + 10).flatMap((h) => validAnte(h.ante) ?? []);
    visit.ante = anteFromBlinds(v, visit.start) ?? mode(antes);
    visit.deck = deckAt(v, decisions, visit.start);
  }

  // A visit lasts until the screen that ends it (a pack pick often lands after the last offer read).
  const close = new Map(out.map((x) => [x, Math.min(x.end + 30, v.screens.find((s) => s.t > x.end && boundary(x.where, x.end, s.t + 1))?.t ?? x.end + 6)]));
  const during = (x: Visit, t: number) => t >= x.start - 2 && t <= close.get(x)! + 2;
  // Each acquisition goes to one visit that offered the card around that time, same kind first. The
  // detector often misses a card or two of a pack, so a pick inside a pack visit counts as offered there.
  for (const d of decisions) {
    if (d.video_id !== v.video_id || !d.item || !ACQUIRE.has(d.type)) continue;
    const want = d.type === "buy_joker" ? "shop" : "pack";
    const fits = out.filter((x) => during(x, d.t_seconds) && x.jokers.some((j) => j.key === d.item!.key));
    let visit: Visit | undefined = fits.find((x) => x.where === want) ?? fits[0];
    if (!visit) {
      visit = out.find((x) => x.where === want && during(x, d.t_seconds) && (d.screen ?? want) === want);
      if (visit) visit.jokers.push(d.item);
    }
    if (!visit && want === "pack") {
      // A pack whose cards were never read: rebuild the visit from what the decision saw offered.
      const offered = [d.item, ...(d.offered ?? []).filter((c) => isJoker(c) && c.key !== d.item!.key)];
      visit = { video: v.video_id, where: "pack", start: d.t_seconds, end: d.t_seconds, pack: d.pack ?? "Buffoon Pack", jokers: offered, taken: [], looked: [], held: d.jokers_before ?? [], ante: validAnte(d.ante) };
      visit.money = v.hud.filter((h) => h.money !== null && Math.abs(h.t - d.t_seconds) <= 8).sort((a, b) => Math.abs(a.t - d.t_seconds) - Math.abs(b.t - d.t_seconds))[0]?.money ?? undefined;
      visit.deck = deckAt(v, decisions, d.t_seconds);
      out.push(visit);
      close.set(visit, d.t_seconds + 2);
    }
    if (visit && !visit.taken.some((j) => j.key === d.item!.key)) visit.taken.push(d.item);
    if (visit && visit.ante === undefined) visit.ante = validAnte(d.ante);
  }
  // Hovers come with the choices made in the visit; an offered joker he rested on and didn't take
  // is one he read and passed on.
  for (const d of decisions) {
    if (d.video_id !== v.video_id || !d.hovered?.length || (d.screen !== "shop" && d.screen !== "pack")) continue;
    const visit = out.find((x) => x.where === d.screen && during(x, d.t_seconds));
    if (!visit) continue;
    for (const h of d.hovered) {
      if (visit.jokers.some((j) => j.key === h.key) && !visit.looked.includes(h.key)) visit.looked.push(h.key);
    }
  }
  for (const visit of out) visit.looked = visit.looked.filter((k) => !visit.taken.some((j) => j.key === k));
  // Jokers "seen" in Arcana, Celestial and Standard packs are detector misreads (often the held
  // row), so only Buffoon packs count.
  return out.filter((x) => x.jokers.length > 0 && (x.where === "shop" || /buffoon/i.test(x.pack ?? "") || x.taken.length > 0)).sort((a, b) => a.start - b.start);
}

export function computePriors(videos: VideoData[], decisions: Decision[]): ExpertPriors {
  const jokers: Record<string, JokerTally> = {};
  const tally = (key: string) => (jokers[key] ??= { offered: 0, taken: 0, offeredEarly: 0, takenEarly: 0, sold: 0, acquired: 0, passed: 0 });
  const ids = new Set(videos.map((v) => v.video_id));
  let visits = 0;
  for (const v of videos) {
    for (const visit of visitsOf(v, decisions)) {
      visits++;
      const early = visit.ante !== undefined && visit.ante <= 3;
      for (const j of visit.jokers) {
        const t = tally(j.key);
        const took = visit.taken.some((x) => x.key === j.key);
        t.offered++;
        if (took) t.taken++;
        if (early) {
          t.offeredEarly++;
          if (took) t.takenEarly++;
        }
        if (visit.looked.includes(j.key)) t.passed!++;
      }
    }
  }
  for (const d of decisions) {
    if (!ids.has(d.video_id) || !d.item?.key.startsWith("j_")) continue;
    if (d.type === "sell_joker") tally(d.item.key).sold++;
    if (ACQUIRE.has(d.type) || d.type === "gain_joker") tally(d.item.key).acquired++;
  }
  const all = Object.values(jokers);
  const sum = (f: (t: JokerTally) => number) => all.reduce((a, t) => a + f(t), 0);
  return {
    source: { videos: [...ids], visits, built: new Date().toISOString().slice(0, 10) },
    base: sum((t) => t.taken) / Math.max(1, sum((t) => t.offered)),
    baseEarly: sum((t) => t.takenEarly) / Math.max(1, sum((t) => t.offeredEarly)),
    jokers,
  };
}
