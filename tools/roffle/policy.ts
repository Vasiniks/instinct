// Numeric policies mined from the Roffle dataset, kept apart by stake (White, Gold, and any other),
// each number with the count behind it: money on leaving the shop, rerolls per shop visit, skips and
// tags, packs opened and picked from, vouchers, Tarot/Planet/Spectral use, joker sales and their
// replacements, and hand types played, by ante.
//
// Usage: node tools/roffle/policy.ts   (writes data/roffle/policy.json)
//
// Stake and deck come from videos.json, where a video with runs on different settings carries
// `segments` ({start_t, deck, stake}); playbook.json's hand-checked sources win for the rest.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { cardLabel, normEdition, normRank, type PCard } from "../../src/cards.ts";
import { evaluateHand, type Rules } from "../../src/poker.ts";
import { DATA, type HandCard, loadDataset } from "./visits.ts";

interface Item {
  key: string;
  name: string;
  edition?: string;
  stickers?: string[];
}
interface Move {
  video_id: string;
  t_seconds: number;
  type: string;
  item: Item | null;
  ante: number | null;
  round?: number | null;
  screen?: string;
  pack?: string | null;
  money_before: number | null;
  money_after: number | null;
  jokers_before?: Item[] | null;
  jokers_after?: Item[] | null;
  offered?: Item[] | null;
  cards?: HandCard[] | null;
  reroll?: { cost: number; index: number } | null;
  targets?: HandCard[] | null;
  detection?: { notes?: string; confidence?: string } | null;
}
interface Shop {
  start_t: number;
  end_t: number;
  ante: number;
  rerolls: number;
  reroll_spent: number;
  bought: string[];
}
interface Timeline {
  video_id: string;
  hud: { t: number; money: number | null }[];
  shops?: Shop[];
  skips?: { blind: string; before: number; ante: number }[];
  packs: { t: number; pack: string }[];
  blinds?: { start_t: number; end_t: number; key: string; ante: number; round: number; boss: boolean }[];
  offers: { t: number; where: "shop" | "pack"; items: Item[] }[];
  runs?: { start_t: number; end_t: number; ante_reached?: number }[];
}
interface Listed {
  id: string;
  deck?: string;
  stake?: string;
  segments?: { start_t: number; deck: string; stake: string }[];
}

const { videos, decisions, settings } = loadDataset();
const moves = decisions as unknown as Move[];
const timelines = new Map(videos.map((v) => [v.video_id, v as unknown as Timeline]));
const listed = new Map((JSON.parse(readFileSync(resolve(DATA, "videos.json"), "utf8")) as Listed[]).map((v) => [v.id, v]));
const sets = JSON.parse(readFileSync(resolve(DATA, "catalog", "consumables.json"), "utf8")) as Record<string, { name: string; set: string }>;

/** Deck and stake at second `t` of a video. */
function settingAt(video: string, t: number): { deck: string; stake: string } {
  const seg = listed
    .get(video)
    ?.segments?.filter((s) => s.start_t <= t)
    .at(-1);
  if (seg) return { deck: seg.deck.toUpperCase(), stake: seg.stake.toUpperCase() };
  const s = settings.get(video);
  return { deck: s?.deck ?? "?", stake: s?.stake ?? "?" };
}
const stakeAt = (video: string, t: number) => settingAt(video, t).stake;

// ---------------------------------------------------------------------------------------------
// Small statistics helpers. Every summary carries its `n`.
// ---------------------------------------------------------------------------------------------
const round1 = (x: number) => Math.round(x * 10) / 10;
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);
function quantile(sorted: number[], q: number): number {
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  return sorted[lo] + (sorted[Math.min(sorted.length - 1, lo + 1)] - sorted[lo]) * (i - lo);
}
function stats(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return { n: 0 };
  return { n: s.length, mean: round1(s.reduce((a, b) => a + b, 0) / s.length), median: round1(quantile(s, 0.5)), p25: round1(quantile(s, 0.25)), p75: round1(quantile(s, 0.75)) };
}
function counts<T>(xs: T[], key: (x: T) => string, top = 99): Record<string, number> {
  const m = new Map<string, number>();
  for (const x of xs) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
  return Object.fromEntries([...m].sort((a, b) => b[1] - a[1]).slice(0, top));
}
const bucket = (ante: number | null | undefined) => (ante == null || ante < 1 ? "?" : ante >= 9 ? "9+" : String(ante));
const BUCKETS = ["1", "2", "3", "4", "5", "6", "7", "8", "9+"];
function byBucket<T>(rows: T[], ante: (r: T) => number | null | undefined, f: (rs: T[]) => unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const b of BUCKETS) {
    const rs = rows.filter((r) => bucket(ante(r)) === b);
    if (rs.length) out[b] = f(rs);
  }
  return out;
}
const moneyBand = (m: number) => (m < 10 ? "<10" : m < 20 ? "10-19" : m < 30 ? "20-29" : m < 50 ? "30-49" : "50+");
const BANDS = ["<10", "10-19", "20-29", "30-49", "50+"];
const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : undefined);

/** The ante at second `t`: the shop visit's own, else the last blind's (one more once its boss is beaten). */
function anteAt(v: Timeline, t: number): number | undefined {
  const shop = v.shops?.find((s) => t >= s.start_t - 3 && t <= s.end_t + 3);
  if (shop) return shop.ante;
  const last = v.blinds?.filter((b) => b.start_t <= t).at(-1);
  return last ? last.ante + (last.boss && t > last.end_t ? 1 : 0) : undefined;
}
const shopAt = (v: Timeline, t: number) => v.shops?.find((s) => t >= s.start_t - 3 && t <= s.end_t + 3);
// Which run of the video second t belongs to. A "run" of a few seconds is a video's preview of its
// ending (ylLAEKHkm00 opens with one), not a run.
const runOf = (v: Timeline, t: number) => (v.runs ?? []).findIndex((r) => r.end_t - r.start_t >= 30 && t >= r.start_t - 30 && t <= r.end_t + 30);

// HUD money is OCR on a pixel font and slips digits (33 read as 3, 64 as 96), so a reading counts only
// once another one in the window agrees with it to the dollar: the first such value in time order.
// When none agree the median of the window is used.
function moneyIn(v: Timeline, a: number, b: number): number | undefined {
  const rs = v.hud.filter((h) => h.money != null && h.t >= a && h.t <= b && h.money >= -20 && h.money <= 999).map((h) => h.money!);
  const firm = rs.find((m, i) => rs.slice(i + 1).some((o) => Math.abs(o - m) <= 1));
  return firm ?? median(rs);
}
/**
 * Money on leaving a shop visit: read from the blind select screen and the next blind, where it
 * stays put until the hand is scored (up to 30 s, or the end of that blind). Money on entering: the
 * first ten seconds of the visit.
 */
function exitMoney(v: Timeline, s: Shop): number | undefined {
  const next = v.blinds?.find((b) => b.start_t >= s.end_t - 2);
  return moneyIn(v, s.end_t - 1, Math.min(s.end_t + 30, next?.end_t ?? Infinity));
}

const STAKES = [...new Set(videos.flatMap((v) => [settingAt(v.video_id, 0).stake, ...(listed.get(v.video_id)?.segments ?? []).map((s) => s.stake.toUpperCase())]))].sort();

// ---------------------------------------------------------------------------------------------
// Shop visits: money in and out, rerolls, what was on the shelf.
// ---------------------------------------------------------------------------------------------
interface VisitRow {
  video: string;
  stake: string;
  deck: string;
  run: number;
  start: number;
  end: number;
  ante: number;
  entry?: number;
  exit?: number;
  rerolls: number;
  spent: number;
  lastRerollLeft?: number;
  vouchers: string[];
  consumables: string[];
  bought: Move[];
}
const visits: VisitRow[] = [];
for (const v of timelines.values()) {
  for (const s of v.shops ?? []) {
    if (!(s.ante >= 1)) continue;
    const { stake, deck } = settingAt(v.video_id, s.start_t);
    const inVisit = (d: Move) => d.video_id === v.video_id && d.t_seconds >= s.start_t - 2 && d.t_seconds <= s.end_t + 2;
    const rr = moves.filter((d) => d.type === "reroll" && inVisit(d));
    const last = rr.at(-1);
    const shelf = v.offers.filter((o) => o.where === "shop" && o.t >= s.start_t - 1 && o.t <= s.end_t + 1).flatMap((o) => o.items);
    visits.push({
      video: v.video_id,
      stake,
      deck,
      run: runOf(v, s.start_t),
      start: s.start_t,
      end: s.end_t,
      ante: s.ante,
      entry: moneyIn(v, s.start_t - 1, Math.min(s.end_t, s.start_t + 10)),
      exit: exitMoney(v, s),
      rerolls: s.rerolls,
      spent: s.reroll_spent,
      lastRerollLeft: last && last.money_before != null && last.reroll ? last.money_before - last.reroll.cost : undefined,
      vouchers: [...new Set(shelf.filter((i) => i.key.startsWith("v_")).map((i) => i.key))],
      consumables: [...new Set(shelf.filter((i) => i.key.startsWith("c_")).map((i) => i.key))],
      bought: moves.filter((d) => inVisit(d) && ["buy_joker", "buy_consumable", "buy_voucher"].includes(d.type)),
    });
  }
}

function moneyPolicy(rows: VisitRow[]) {
  const exits = rows.filter((r) => r.exit !== undefined);
  const ex = exits.map((r) => r.exit!);
  return {
    visits: rows.length,
    exit: stats(ex),
    entry: stats(rows.flatMap((r) => (r.entry !== undefined ? [r.entry] : []))),
    exitAtLeast25Pct: pct(ex.filter((m) => m >= 25).length, ex.length),
    exitUnder5Pct: pct(ex.filter((m) => m < 5).length, ex.length),
    // Interest steps: of the exits from $5 up, how many sit at exactly a multiple of $5 to $5+1.
    exitOnInterestStepPct: pct(ex.filter((m) => m >= 5 && m % 5 <= 1).length, ex.filter((m) => m >= 5).length),
  };
}
function rerollPolicy(rows: VisitRow[]) {
  const rr = rows.map((r) => r.rerolls);
  const left = rows.flatMap((r) => (r.lastRerollLeft !== undefined ? [r.lastRerollLeft] : []));
  return {
    visits: rows.length,
    withRerollPct: pct(rows.filter((r) => r.rerolls > 0).length, rows.length),
    rerollsPerVisit: stats(rr).mean ?? 0,
    rerollsWhenRerolling: stats(rr.filter((n) => n > 0)),
    spentPerVisit: stats(rows.map((r) => r.spent)).mean ?? 0,
    moneyLeftAfterLastReroll: stats(left),
  };
}

// ---------------------------------------------------------------------------------------------
// Skips and tags. A skip opportunity is a Small or Big Blind of an ante he reached.
// ---------------------------------------------------------------------------------------------
function skipPolicy(stake: string) {
  const out: Record<string, { opportunities: number; skippedSmall: number; skippedBig: number; skipPct: number | null; tags: Record<string, number> }> = {};
  const skipMoves = moves.filter((d) => d.type === "skip_blind" && stakeAt(d.video_id, d.t_seconds) === stake);
  for (const v of timelines.values()) {
    const blinds = (v.blinds ?? []).filter((b) => stakeAt(v.video_id, b.start_t) === stake);
    const antes = new Map<string, number>();
    for (const b of blinds) antes.set(`${runOf(v, b.start_t)}:${b.ante}`, b.ante);
    for (const s of v.skips ?? []) if (stakeAt(v.video_id, s.before) === stake) antes.set(`${runOf(v, s.before)}:${s.ante}`, s.ante);
    for (const a of antes.values()) {
      const o = (out[bucket(a)] ??= { opportunities: 0, skippedSmall: 0, skippedBig: 0, skipPct: null, tags: {} });
      o.opportunities += 2;
    }
    for (const s of v.skips ?? []) {
      if (stakeAt(v.video_id, s.before) !== stake) continue;
      const o = (out[bucket(s.ante)] ??= { opportunities: 2, skippedSmall: 0, skippedBig: 0, skipPct: null, tags: {} });
      if (s.blind === "bl_small") o.skippedSmall++;
      else o.skippedBig++;
      const tag = skipMoves.find((d) => d.video_id === v.video_id && Math.abs(d.t_seconds - s.before) <= 40)?.item?.name ?? "unread";
      o.tags[tag] = (o.tags[tag] ?? 0) + 1;
    }
  }
  for (const o of Object.values(out)) o.skipPct = pct(o.skippedSmall + o.skippedBig, o.opportunities);
  return Object.fromEntries(BUCKETS.filter((b) => out[b]).map((b) => [b, out[b]]));
}

// ---------------------------------------------------------------------------------------------
// Packs: opened (pack screens) by type and ante, and what was taken out of them.
// ---------------------------------------------------------------------------------------------
interface PackRow {
  video: string;
  t: number;
  end: number;
  type: string;
  size: string;
  ante?: number;
  inShop: boolean;
  offered: Item[];
  jokers: Move[];
  consumables: Move[];
  leftDisplay: Item[];
}
const packs: PackRow[] = [];
for (const v of timelines.values()) {
  const list = [...(v.packs as { t: number; end_t?: number; pack: string | null; size?: string; offered?: Item[] }[])].sort((a, b) => a.t - b.t);
  list.forEach((p, i) => {
    const next = list[i + 1]?.t ?? Infinity;
    const end = p.end_t ?? Math.min(p.t + 60, next - 1);
    const shown = v.offers.filter((o) => o.where === "pack" && o.t >= p.t - 2 && o.t <= end + 2);
    const offered = p.offered ?? [...new Map(shown.flatMap((o) => o.items).map((x) => [x.key, x])).values()];
    // A card that leaves the display while the pack stays open was taken (a Mega pack's first
    // pick; the last pick closes the pack, so it is never seen leaving).
    const leftDisplay = shown.flatMap((o, j) => {
      const later = shown.slice(j + 1);
      if (later.length < 2) return [];
      return o.items.filter((x) => later.every((l) => l.items.length > 0 && l.items.length < o.items.length && !l.items.some((y) => y.key === x.key)));
    });
    const inPack = (d: Move) => d.video_id === v.video_id && d.t_seconds >= p.t - 2 && d.t_seconds <= end + 8;
    packs.push({
      video: v.video_id,
      t: p.t,
      end,
      type: p.pack ?? "unread",
      size: p.size ?? "?",
      ante: anteAt(v, p.t),
      inShop: Boolean(shopAt(v, p.t)),
      offered,
      jokers: moves.filter((d) => inPack(d) && d.type === "pack_pick_joker" && d.item),
      consumables: moves.filter((d) => inPack(d) && d.type === "pack_pick_consumable" && d.item),
      leftDisplay: [...new Map(leftDisplay.map((x) => [x.key, x])).values()],
    });
  });
}
function packPolicy(rows: PackRow[], shopVisits: VisitRow[]) {
  const types = [...new Set(rows.map((r) => r.type))].sort();
  const perAnte = byBucket(rows, (r) => r.ante, (rs) => ({ opened: rs.length, ...counts(rs, (r) => r.type) }));
  const shopPacks = byBucket(
    rows.filter((r) => r.inShop),
    (r) => r.ante,
    (rs) => rs.length,
  );
  const visitsByAnte = byBucket(shopVisits, (r) => r.ante, (rs) => rs.length);
  const perVisit = Object.fromEntries(Object.entries(visitsByAnte).map(([b, n]) => [b, { visits: n, packsBought: (shopPacks[b] as number) ?? 0, perVisit: round1(((shopPacks[b] as number) ?? 0) / (n as number)) }]));
  const byType = Object.fromEntries(
    types.map((t) => {
      const rs = rows.filter((r) => r.type === t);
      return [
        t,
        {
          opened: rs.length,
          sizes: counts(rs, (r) => r.size),
          fromTagsPct: pct(rs.filter((r) => !r.inShop).length, rs.length),
          medianAnte: median(rs.flatMap((r) => (r.ante ? [r.ante] : []))),
          byAnte: byBucket(rs, (r) => r.ante, (x) => x.length),
          // Buffoon: the jokers picked (packsWithOne of opened: how often he took one at all). Arcana
          // and Spectral: jokers made by The Soul, Judgement or Wraith. Celestial and Standard can't
          // hold jokers, so a joker there is a first-pass buy or Riff-Raff timed into the pack.
          jokersTaken: { packsWithOne: rs.filter((r) => r.jokers.length).length, jokers: counts(rs.flatMap((r) => r.jokers), (d) => d.item!.name, 15) },
          leftDisplay: { n: rs.reduce((a, r) => a + r.leftDisplay.length, 0), cards: counts(rs.flatMap((r) => r.leftDisplay), (x) => x.name, 15) },
          // Pack Tarots, Planets and Spectrals are used at once and never reach the slots, so a card
          // arriving there during a pack was made: by the card he picked (The Emperor, The High
          // Priestess, The Fool), by Hallucination on opening, or by Perkeo.
          consumablesArriving: counts(rs.flatMap((r) => r.consumables), (d) => d.item!.name, 10),
          offeredMost: counts(
            rs.flatMap((r) => r.offered),
            (x) => x.name,
            12,
          ),
        },
      ];
    }),
  );
  return { opened: rows.length, boughtInShopByAnte: perVisit, byAnte: perAnte, byType };
}

// ---------------------------------------------------------------------------------------------
// Vouchers: order and ante per run, and how often one on the shelf was bought.
// ---------------------------------------------------------------------------------------------
function voucherPolicy(stake: string, shopVisits: VisitRow[]) {
  const bought = moves.filter((d) => d.type === "buy_voucher" && d.item && stakeAt(d.video_id, d.t_seconds) === stake).sort((a, b) => a.video_id.localeCompare(b.video_id) || a.t_seconds - b.t_seconds);
  const runs = new Map<string, Move[]>();
  for (const d of bought) {
    const v = timelines.get(d.video_id)!;
    const k = `${d.video_id}#${runOf(v, d.t_seconds)}`;
    runs.set(k, [...(runs.get(k) ?? []), d]);
  }
  const byVoucher = new Map<string, { n: number; antes: number[]; order: number[]; offeredVisits: number; boughtWhenOffered: number }>();
  const slot = (name: string) => byVoucher.get(name) ?? byVoucher.set(name, { n: 0, antes: [], order: [], offeredVisits: 0, boughtWhenOffered: 0 }).get(name)!;
  for (const ds of runs.values())
    ds.forEach((d, i) => {
      const s = slot(d.item!.name);
      s.n++;
      s.antes.push(d.ante ?? 0);
      s.order.push(i + 1);
    });
  let offered = 0,
    took = 0;
  const entryWhenBought: number[] = [],
    entryWhenPassed: number[] = [];
  for (const r of shopVisits) {
    for (const key of r.vouchers) {
      const name = sets[key]?.name ?? key;
      const got = r.bought.some((d) => d.type === "buy_voucher" && d.item?.key === key);
      slot(name).offeredVisits++;
      if (got) slot(name).boughtWhenOffered++;
      offered++;
      if (got) took++;
      if (r.entry !== undefined) (got ? entryWhenBought : entryWhenPassed).push(r.entry);
    }
  }
  return {
    bought: bought.length,
    runsWithVouchers: runs.size,
    sequences: [...runs.entries()].map(([k, ds]) => ({ run: k, vouchers: ds.map((d) => `${d.item!.name} (a${d.ante})`) })),
    byAnte: byBucket(bought, (d) => d.ante, (ds) => ({ n: ds.length, ...counts(ds, (d) => d.item!.name) })),
    shelf: { offered, bought: took, boughtPct: pct(took, offered), entryMoneyWhenBought: stats(entryWhenBought), entryMoneyWhenPassed: stats(entryWhenPassed) },
    byVoucher: Object.fromEntries(
      [...byVoucher]
        .sort((a, b) => b[1].n - a[1].n || b[1].offeredVisits - a[1].offeredVisits)
        .map(([name, s]) => [name, { bought: s.n, medianAnte: median(s.antes), antes: s.antes, order: s.order, shelfVisits: s.offeredVisits, boughtFromShelfPct: pct(s.boughtWhenOffered, s.offeredVisits) }]),
    ),
  };
}

// ---------------------------------------------------------------------------------------------
// Consumables: Tarot, Planet and Spectral cards bought, picked, gained, used and sold, by ante.
// ---------------------------------------------------------------------------------------------
const ACTIONS: Record<string, string> = {
  buy_consumable: "bought",
  pack_pick_consumable: "picked",
  gain_consumable: "gained",
  use_consumable: "used",
  sell_consumable: "sold",
};
function consumablePolicy(stake: string, shopVisits: VisitRow[]) {
  const rows = moves.filter((d) => ACTIONS[d.type] && d.item && stakeAt(d.video_id, d.t_seconds) === stake);
  const setOf = (d: Move) => sets[d.item!.key]?.set ?? "?";
  const out: Record<string, unknown> = {};
  for (const set of ["Tarot", "Planet", "Spectral"]) {
    const rs = rows.filter((d) => setOf(d) === set);
    const keys = [...new Set(rs.map((d) => d.item!.name))];
    const shelfOffers = shopVisits.flatMap((r) => r.consumables.filter((k) => sets[k]?.set === set).map((k) => ({ r, k })));
    const shelfBought = shelfOffers.filter(({ r, k }) => r.bought.some((d) => d.type === "buy_consumable" && d.item?.key === k));
    out[set] = {
      actions: counts(rs, (d) => ACTIONS[d.type]),
      byAnte: byBucket(rs, (d) => d.ante, (ds) => counts(ds, (d) => ACTIONS[d.type])),
      usedWhere: counts(
        rs.filter((d) => d.type === "use_consumable"),
        (d) => d.screen ?? "?",
      ),
      shelf: { offered: shelfOffers.length, bought: shelfBought.length, boughtPct: pct(shelfBought.length, shelfOffers.length) },
      byCard: Object.fromEntries(
        keys
          .map((name) => {
            const ds = rs.filter((d) => d.item!.name === name);
            const c = counts(ds, (d) => ACTIONS[d.type]);
            return [name, { ...c, total: ds.length, medianAnte: median(ds.flatMap((d) => (d.ante ? [d.ante] : []))) }] as const;
          })
          .sort((a, b) => b[1].total - a[1].total),
      ),
    };
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Joker sales: by ante, and what came in instead (the next joker acquired within 90 s, or one
// bought up to 15 s before the sale when nothing came after).
// ---------------------------------------------------------------------------------------------
const ACQUIRE = new Set(["buy_joker", "pack_pick_joker", "gain_joker"]);
function salePolicy(stake: string) {
  const sales = moves.filter((d) => d.type === "sell_joker" && d.item && stakeAt(d.video_id, d.t_seconds) === stake);
  const rows = sales.map((d) => {
    const same = moves.filter((x) => x.video_id === d.video_id && ACQUIRE.has(x.type) && x.item && x.item.key !== d.item!.key);
    const after = same.find((x) => x.t_seconds >= d.t_seconds && x.t_seconds <= d.t_seconds + 90);
    const before = same.filter((x) => x.t_seconds < d.t_seconds && x.t_seconds >= d.t_seconds - 15).at(-1);
    const repl = after ?? before;
    const got = moves.filter((x) => x.video_id === d.video_id && ACQUIRE.has(x.type) && x.item?.key === d.item!.key && x.t_seconds < d.t_seconds).at(-1);
    const held = got?.round != null && d.round != null ? d.round - got.round : undefined;
    return { d, repl, held, full: (d.jokers_before?.length ?? 0) >= 5, screen: d.screen ?? "?" };
  });
  const pairs = counts(
    rows.filter((r) => r.repl),
    (r) => `${r.d.item!.name} -> ${r.repl!.item!.name}`,
    25,
  );
  return {
    sold: rows.length,
    replacedPct: pct(rows.filter((r) => r.repl).length, rows.length),
    roundsHeld: stats(rows.flatMap((r) => (r.held !== undefined ? [r.held] : []))),
    where: counts(rows, (r) => r.screen),
    byAnte: byBucket(
      rows,
      (r) => r.d.ante,
      (rs) => ({ sold: rs.length, replaced: rs.filter((r) => r.repl).length, jokers: counts(rs, (r) => r.d.item!.name, 8) }),
    ),
    mostSold: counts(rows, (r) => r.d.item!.name, 20),
    replacements: pairs,
  };
}

// ---------------------------------------------------------------------------------------------
// Hand types played, from plays whose cards were read off the play area (see style.ts), or whose
// lift had all five cards (a play has at most five, so the lift was the whole play).
// ---------------------------------------------------------------------------------------------
function pcard(c: HandCard, index: number): PCard {
  const card: PCard = {
    index,
    id: index,
    rank: c.enhancement === "Stone" ? undefined : normRank(c.rank),
    suit: c.enhancement === "Stone" ? undefined : c.suit?.[0],
    enhancement: c.enhancement?.toUpperCase(),
    edition: normEdition(c.edition),
    seal: c.seal?.toUpperCase(),
    debuff: false,
    hidden: false,
    forced: false,
    label: "",
  };
  card.label = cardLabel(card);
  return card;
}
const rulesOf = (jokers: Item[] | null | undefined): Rules => {
  const has = (k: string) => (jokers ?? []).some((j) => j.key === k);
  return { fourFingers: has("j_four_fingers"), shortcut: has("j_shortcut"), smeared: has("j_smeared"), splash: has("j_splash"), pareidolia: has("j_pareidolia") };
};
function handPolicy(stake: string) {
  const plays = moves.filter(
    (d) =>
      d.type === "play_hand" &&
      d.cards?.length &&
      d.cards.length <= 5 &&
      (/read off the play area/.test(d.detection?.notes ?? "") || d.cards.length === 5) &&
      stakeAt(d.video_id, d.t_seconds) === stake,
  );
  const typed = plays.map((d) => ({ d, hand: evaluateHand(d.cards!.map(pcard), rulesOf(d.jokers_before)).hand as string, size: d.cards!.length }));
  const share = (rs: typeof typed) => {
    const c = counts(rs, (r) => r.hand);
    return Object.fromEntries(Object.entries(c).map(([h, n]) => [h, { n, pct: pct(n, rs.length) }]));
  };
  return {
    plays: moves.filter((d) => d.type === "play_hand" && stakeAt(d.video_id, d.t_seconds) === stake).length,
    playsRead: typed.length,
    byAnte: byBucket(typed, (r) => r.d.ante, (rs) => ({ n: rs.length, cardsPlayedMean: stats(rs.map((r) => r.size)).mean, hands: share(rs) })),
    byDeck: Object.fromEntries(
      [...new Set(typed.map((r) => settingAt(r.d.video_id, r.d.t_seconds).deck))].map((deck) => {
        const rs = typed.filter((r) => settingAt(r.d.video_id, r.d.t_seconds).deck === deck);
        return [deck, { n: rs.length, hands: share(rs) }];
      }),
    ),
  };
}

// ---------------------------------------------------------------------------------------------
const policy: Record<string, unknown> = {
  source: {
    built: new Date().toISOString().slice(0, 10),
    videos: videos.map((v) => {
      const segs = listed.get(v.video_id)?.segments;
      return segs?.length ? `${v.video_id} ${segs.map((s) => `${s.deck}/${s.stake}@${s.start_t}s`).join(", ")}` : `${v.video_id} ${settingAt(v.video_id, 0).deck}/${settingAt(v.video_id, 0).stake}`;
    }),
    notes: [
      "Every number carries its n (visits, packs, sales, plays). Antes 9 and up are pooled as 9+.",
      "Money is HUD OCR; a value counts once a second reading agrees to the dollar. Exit money is read on the blind select screen and the next blind (until its first hand scores, at most 30 s); entry money in the first 10 s of the visit.",
      "Packs come from tools/roffle/packs.py: one per pack opened, its type and size read off the name panel every second. Picks: jokers reaching the joker row during a Buffoon pack (in Arcana and Spectral packs those are jokers made by The Soul, Judgement or Wraith); leftDisplay is a card that left the display while the pack stayed open (a Mega pack's first pick). Tarots, Planets and Spectrals taken from packs are used at once and are otherwise not seen.",
      "Skip opportunities: two per ante reached (Small and Big Blind).",
      "Joker replacement: the next joker acquired within 90 s of the sale, or one bought up to 15 s before it.",
      "Hand types: plays whose cards were read off the play area, or whose lift had five cards; shorter lifts are often partial (a Pair read as one card) and are left out.",
      "Consumable 'picked' is the first pass's pack_pick_consumable: a card that reached the slots during a pack. Pack Tarots, Planets and Spectrals are used at once, so these were made by the card picked (The Emperor, The High Priestess, The Fool), by Hallucination or by Perkeo.",
    ],
  },
};
for (const stake of STAKES) {
  const vs = visits.filter((r) => r.stake === stake);
  if (!vs.length) continue;
  const ps = packs.filter((p) => stakeAt(p.video, p.t) === stake);
  const runs = new Set(vs.map((r) => `${r.video}#${r.run}`));
  policy[stake] = {
    videos: [...new Set(vs.map((r) => r.video))],
    decks: counts(vs, (r) => r.deck),
    runs: runs.size,
    shopVisits: vs.length,
    moneyLeavingShop: { all: moneyPolicy(vs), byAnte: byBucket(vs, (r) => r.ante, moneyPolicy) },
    rerolls: {
      all: rerollPolicy(vs),
      byAnte: byBucket(vs, (r) => r.ante, rerollPolicy),
      byEntryMoney: Object.fromEntries(
        BANDS.map((b) => [b, rerollPolicy(vs.filter((r) => r.entry !== undefined && moneyBand(r.entry) === b))]).filter(([, x]) => (x as { visits: number }).visits),
      ),
      byAnteAndEntryMoney: byBucket(vs, (r) => r.ante, (rs) =>
        Object.fromEntries(
          BANDS.map((b) => {
            const x = rs.filter((r) => r.entry !== undefined && moneyBand(r.entry) === b);
            return [b, { visits: x.length, withRerollPct: pct(x.filter((r) => r.rerolls > 0).length, x.length), rerollsPerVisit: stats(x.map((r) => r.rerolls)).mean ?? 0 }];
          }).filter(([, x]) => (x as { visits: number }).visits),
        ),
      ),
    },
    skips: skipPolicy(stake),
    packs: packPolicy(ps, vs),
    vouchers: voucherPolicy(stake, vs),
    consumables: consumablePolicy(stake, vs),
    jokerSales: salePolicy(stake),
    hands: handPolicy(stake),
  };
}
writeFileSync(resolve(DATA, "policy.json"), JSON.stringify(policy, null, 1) + "\n");

// A short console summary.
for (const stake of STAKES) {
  const p = policy[stake] as Record<string, any> | undefined;
  if (!p) continue;
  console.log(`\n${stake}: ${p.videos.length} videos, ${p.runs} runs, ${p.shopVisits} shop visits (${Object.entries(p.decks).map(([d, n]) => `${d} ${n}`).join(", ")})`);
  const m = p.moneyLeavingShop.byAnte;
  console.log("  money leaving shop, median (n): " + Object.entries(m).map(([a, x]: [string, any]) => `a${a} $${x.exit.median ?? "?"} (${x.exit.n})`).join("  "));
  const r = p.rerolls.byAnte;
  console.log("  rerolls per visit (visits): " + Object.entries(r).map(([a, x]: [string, any]) => `a${a} ${x.rerollsPerVisit} (${x.visits})`).join("  "));
  const s = p.skips;
  console.log("  skips/opportunities: " + Object.entries(s).map(([a, x]: [string, any]) => `a${a} ${x.skippedSmall + x.skippedBig}/${x.opportunities}`).join("  "));
  console.log(`  packs opened ${p.packs.opened}: ` + Object.entries(p.packs.byType).map(([t, x]: [string, any]) => `${t} ${x.opened}`).join(", "));
  console.log(`  vouchers bought ${p.vouchers.bought} (${p.vouchers.shelf.boughtPct}% of ${p.vouchers.shelf.offered} on the shelf)`);
  console.log(`  jokers sold ${p.jokerSales.sold}, replaced ${p.jokerSales.replacedPct}%`);
  console.log(`  plays read ${p.hands.playsRead} of ${p.hands.plays}`);
}
