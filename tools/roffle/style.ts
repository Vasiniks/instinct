// How Roffle plays the hands themselves, counted from the dataset's play_hand, discard, reroll and
// voucher decisions: which hand types he plays by phase and deck, how many cards he plays, how many
// hands and discards a blind takes him, when he rerolls and which vouchers he buys.
//
// Usage: node tools/roffle/style.ts [--json]   (--json writes data/roffle/style.json)

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { cardLabel, normEdition, normRank, type PCard } from "../../src/cards.ts";
import { evaluateHand, type HandName } from "../../src/poker.ts";
import { DATA, type HandCard, loadDataset } from "./visits.ts";

const { videos, decisions, settings } = loadDataset();

interface Move {
  video_id: string;
  t_seconds: number;
  type: string;
  ante: number | null;
  round?: number | null;
  phase?: string;
  cards?: HandCard[] | null;
  hand?: HandCard[] | null;
  money_before: number | null;
  reroll?: { cost: number; index: number } | null;
  item: { key: string; name: string } | null;
  blind?: { key: string; name: string } | null;
  detection?: { notes?: string } | null;
}
const moves = decisions as unknown as Move[];

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

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : undefined;
};
const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : undefined);
const phaseOf = (ante: number | null | undefined) => (!ante ? "unknown" : ante <= 3 ? "early" : ante <= 8 ? "mid" : "endless");
const deckOf = (video: string) => `${settings.get(video)?.deck ?? "?"}/${settings.get(video)?.stake ?? "?"}`;
const PHASES = ["early", "mid", "endless"] as const;

// 1. Hand types played. Only plays whose cards were read off the play area after the play: the rest
// come from the cards seen lifted in hand, which is often partial (a Pair read as one card).
const readOff = (d: Move) => /read off the play area/.test(d.detection?.notes ?? "");
const plays = moves.filter((d) => d.type === "play_hand" && d.cards?.length && d.cards.length <= 5 && readOff(d));
const allPlays = moves.filter((d) => d.type === "play_hand").length;
const typed = plays.map((d) => {
  const cards = d.cards!.map(pcard);
  const ev = evaluateHand(cards);
  return { d, hand: ev.hand as HandName, size: cards.length, scoring: ev.scoring.length, phase: phaseOf(d.ante), deck: deckOf(d.video_id) };
});
const handShare = (rows: typeof typed) => {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.hand, (counts.get(r.hand) ?? 0) + 1);
  return Object.fromEntries([...counts].sort((a, b) => b[1] - a[1]).map(([h, n]) => [h, pct(n, rows.length)]));
};
const handsByPhase = Object.fromEntries(PHASES.map((p) => [p, { plays: typed.filter((r) => r.phase === p).length, share: handShare(typed.filter((r) => r.phase === p)) }]));
const decks = [...new Set(typed.map((r) => r.deck))];
const handsByDeck = Object.fromEntries(
  decks.map((deck) => [deck, Object.fromEntries(PHASES.map((p) => [p, { plays: typed.filter((r) => r.deck === deck && r.phase === p).length, share: handShare(typed.filter((r) => r.deck === deck && r.phase === p)) }]))]),
);

// 2. Cards per play: does he pad a Pair out to five cards (to cycle the deck) or play it bare?
const padded = (rows: typeof typed) => {
  const small = rows.filter((r) => ["Pair", "Two Pair", "Three of a Kind", "High Card"].includes(r.hand));
  return { plays: small.length, fiveCards: pct(small.filter((r) => r.size === 5).length, small.length), bare: pct(small.filter((r) => r.size === r.scoring).length, small.length) };
};
const padding = Object.fromEntries(PHASES.map((p) => [p, padded(typed.filter((r) => r.phase === p))]));

// 3. Hands and discards per blind, and whether he digs (discards) before his first hand.
interface BlindLog {
  video: string;
  round: number;
  ante: number;
  events: { t: number; type: string; n: number }[];
}
const blinds = new Map<string, BlindLog>();
for (const d of moves) {
  if ((d.type !== "play_hand" && d.type !== "discard") || d.round == null || d.ante == null) continue;
  const key = `${d.video_id}:${d.round}`;
  const b = blinds.get(key) ?? blinds.set(key, { video: d.video_id, round: d.round, ante: d.ante, events: [] }).get(key)!;
  b.events.push({ t: d.t_seconds, type: d.type, n: d.cards?.length ?? 0 });
}
const perBlind = Object.fromEntries(
  PHASES.map((p) => {
    const bs = [...blinds.values()].filter((b) => phaseOf(b.ante) === p && b.events.some((e) => e.type === "play_hand"));
    const handsUsed = bs.map((b) => b.events.filter((e) => e.type === "play_hand").length);
    const discardsUsed = bs.map((b) => b.events.filter((e) => e.type === "discard").length);
    const digFirst = bs.filter((b) => [...b.events].sort((x, y) => x.t - y.t)[0].type === "discard").length;
    const discardSizes = bs.flatMap((b) => b.events.filter((e) => e.type === "discard" && e.n > 0).map((e) => e.n));
    return [
      p,
      {
        blinds: bs.length,
        handsMean: mean(handsUsed),
        oneHand: pct(handsUsed.filter((n) => n === 1).length, bs.length),
        discardsMean: mean(discardsUsed),
        noDiscards: pct(discardsUsed.filter((n) => n === 0).length, bs.length),
        discardFirst: pct(digFirst, bs.length),
        cardsPerDiscard: mean(discardSizes),
      },
    ];
  }),
);

// 4. Rerolls: how many a shop visit, and what was left in the bank after each.
const rerolls = moves.filter((d) => d.type === "reroll");
const rerollStats = Object.fromEntries(
  PHASES.map((p) => {
    const rs = rerolls.filter((d) => phaseOf(d.ante) === p);
    const left = rs.flatMap((d) => (d.money_before != null && d.reroll ? [d.money_before - d.reroll.cost] : []));
    const gold = rs.filter((d) => settings.get(d.video_id)?.stake === "GOLD");
    const goldLeft = gold.flatMap((d) => (d.money_before != null && d.reroll ? [d.money_before - d.reroll.cost] : []));
    return [p, { rerolls: rs.length, medianLeft: median(left), goldRerolls: gold.length, goldLeftAtLeast25: pct(goldLeft.filter((m) => m >= 25).length, goldLeft.length) }];
  }),
);
const shopVisits = videos.flatMap((v) => ((v as { shops?: { ante: number; rerolls: number; reroll_spent: number }[] }).shops ?? []).map((s) => ({ ...s, video: v.video_id })));
const rerollVisits = Object.fromEntries(
  PHASES.map((p) => {
    const ss = shopVisits.filter((s) => phaseOf(s.ante) === p);
    return [p, { visits: ss.length, withReroll: pct(ss.filter((s) => s.rerolls > 0).length, ss.length), meanRerolls: mean(ss.map((s) => s.rerolls)), meanSpent: mean(ss.map((s) => s.reroll_spent)) }];
  }),
);

// 5. Vouchers, and skips.
const vouchers = moves.filter((d) => d.type === "buy_voucher" && d.item).map((d) => ({ key: d.item!.key, name: d.item!.name, ante: d.ante }));
const voucherCounts = Object.entries(vouchers.reduce<Record<string, { n: number; antes: number[] }>>((a, v) => ((a[v.name] ??= { n: 0, antes: [] }).n++, a[v.name].antes.push(v.ante ?? 0), a), {}))
  .sort((a, b) => b[1].n - a[1].n)
  .map(([name, x]) => ({ name, n: x.n, medianAnte: median(x.antes) }));
const selected = moves.filter((d) => d.type === "select_blind").length;
const skipped = moves.filter((d) => d.type === "skip_blind");

const style = {
  source: { videos: videos.map((v) => `${v.video_id} ${deckOf(v.video_id)}`), built: new Date().toISOString().slice(0, 10), plays: allPlays, playsReadInFull: typed.length, blinds: blinds.size },
  handsByPhase,
  handsByDeck,
  padding,
  perBlind,
  rerollStats,
  rerollVisits,
  vouchers: voucherCounts,
  skips: { selected, skipped: skipped.length, tags: skipped.map((d) => d.item?.name ?? "unknown") },
};

if (process.argv.includes("--json")) writeFileSync(resolve(DATA, "style.json"), `${JSON.stringify(style, null, 2)}\n`);

const line = (o: Record<string, number>) => Object.entries(o).map(([k, v]) => `${k} ${v}%`).join(", ");
console.log(`${videos.length} videos, ${blinds.size} blinds, ${allPlays} plays; hand types from the ${typed.length} whose cards were read off the play area.\n`);
console.log("Hand types played:");
for (const p of PHASES) console.log(`  ${p.padEnd(8)} (${handsByPhase[p].plays}): ${line(handsByPhase[p].share)}`);
console.log("\nBy deck:");
for (const deck of decks) for (const p of PHASES) if (handsByDeck[deck][p].plays >= 8) console.log(`  ${deck.padEnd(16)} ${p.padEnd(8)} (${handsByDeck[deck][p].plays}): ${line(handsByDeck[deck][p].share)}`);
console.log("\nPair, Two Pair, Trips and High Card plays: share played as five cards / with no kickers:");
for (const p of PHASES) console.log(`  ${p.padEnd(8)} (${padding[p].plays}): five cards ${padding[p].fiveCards}%, bare ${padding[p].bare}%`);
console.log("\nPer blind:");
for (const p of PHASES) {
  const b = perBlind[p];
  console.log(`  ${p.padEnd(8)} (${b.blinds}): ${b.handsMean} hands (${b.oneHand}% in one), ${b.discardsMean} discards (${b.noDiscards}% none), discards before the first hand ${b.discardFirst}%, ${b.cardsPerDiscard} cards a discard`);
}
console.log("\nRerolls:");
for (const p of PHASES) {
  const r = rerollStats[p];
  const v = rerollVisits[p];
  console.log(`  ${p.padEnd(8)} ${r.rerolls} rerolls, ${v.withReroll}% of ${v.visits} shops, ${v.meanRerolls} a shop ($${v.meanSpent}); median $${r.medianLeft} left after; at Gold ${r.goldLeftAtLeast25}% of ${r.goldRerolls} left $25+`);
}
console.log(`\nVouchers (${vouchers.length}): ${voucherCounts.map((v) => `${v.name} ${v.n} (ante ${v.medianAnte})`).join(", ")}`);
console.log(`Skips: ${skipped.length} of ${selected + skipped.length} blinds (${style.skips.tags.join(", ")})`);
