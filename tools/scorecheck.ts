// The evaluator against the real game: every hand played in the real-game logs, re-estimated
// with the current code from the logged state, against the chips the game gave it. The simulator
// scores with this same evaluator, so wherever it is wrong here the simulator is wrong too.
//
//   node tools/scorecheck.ts [runs/run-*.jsonl ...] [--worst 20]

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { extract, type Snapshot } from "../src/extract.ts";
import { scoreContext } from "../src/options.ts";
import { estimateScore } from "../src/poker.ts";

const argv = process.argv.slice(2);
const worst = Number(argv[argv.indexOf("--worst") + 1] || 0) || 15;
const files = argv.filter((a) => a.endsWith(".jsonl"));
const paths = files.length ? files : readdirSync("runs").filter((f) => f.endsWith(".jsonl")).map((f) => join("runs", f));

interface Row { ratio: number; est: number; got: number; jokers: string[]; hand: string; file: string; n: number; cards: string }
const rows: Row[] = [];
for (const path of paths) {
  const lines = readFileSync(path, "utf8").split("\n");
  let pending: { est: number; chips: number; jokers: string[]; hand: string; n: number; cards: string } | undefined;
  for (const line of lines) {
    if (!line) continue;
    let d: any;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (d.game !== "blinddeck") break;
    const chips = d.raw?.round?.chips;
    if (pending && typeof chips === "number" && chips >= pending.chips) {
      const got = chips - pending.chips;
      if (got > 0) rows.push({ ratio: got / pending.est, est: pending.est, got, jokers: pending.jokers, hand: pending.hand, file: path, n: pending.n, cards: pending.cards });
    }
    pending = undefined;
    if (d.phase !== "SELECTING_HAND" || d.call?.method !== "play" || !d.result?.ok) continue;
    // Re-read from the raw game state, so the current extractor's view is the one checked.
    const s: Snapshot = d.raw ? extract(d.raw) : d.snapshot;
    if (s.blind?.type === "BOSS" && ["The Psychic", "The Eye", "The Mouth", "The Ox", "The Tooth", "Crimson Heart"].includes(s.blind.name)) continue;
    const ids: number[] = d.call.params?.cards ?? [];
    const played = ids.map((i) => s.hand[i]).filter(Boolean);
    if (!played.length || played.some((c) => c.hidden && !c.rank)) continue;
    const e = estimateScore(played, scoreContext(s, played));
    if (e.score > 0 && typeof chips === "number") pending = { est: e.score, chips, jokers: s.jokers.map((j) => j.key), hand: e.hand, n: d.n, cards: played.map((c) => `${c.rank}${c.suit}${c.enhancement ? ":" + c.enhancement : ""}${c.edition ? ":" + c.edition : ""}${c.seal ? ":" + c.seal : ""}`).join(" ") };
  }
}

const within = (r: Row) => Math.abs(r.ratio - 1) <= 0.05;
console.log(`${rows.length} real hands; the current evaluator is within 5% on ${Math.round((100 * rows.filter(within).length) / rows.length)}%, under by more than 5% on ${Math.round((100 * rows.filter((r) => r.ratio > 1.05).length) / rows.length)}%, over on ${Math.round((100 * rows.filter((r) => r.ratio < 0.95).length) / rows.length)}%`);
// A joker's blame: the share of hands with it that miss, against hands without it.
const keys = new Set(rows.flatMap((r) => r.jokers));
const blame = [...keys]
  .map((k) => {
    const withK = rows.filter((r) => r.jokers.includes(k));
    const miss = withK.filter((r) => !within(r)).length / withK.length;
    return { k, n: withK.length, miss, under: withK.filter((r) => r.ratio > 1.05).length, over: withK.filter((r) => r.ratio < 0.95).length };
  })
  .filter((x) => x.n >= 6)
  .sort((a, b) => b.miss - a.miss);
console.log("\njokers by share of their hands the evaluator misses (n, under, over):");
for (const b of blame.slice(0, 30)) console.log(`  ${b.k.padEnd(22)} ${Math.round(b.miss * 100)}% of ${b.n}  under ${b.under} over ${b.over}`);
console.log(`\nworst ${worst} misses:`);
for (const r of [...rows].filter((r) => !within(r)).sort((a, b) => Math.abs(Math.log(b.ratio)) - Math.abs(Math.log(a.ratio))).slice(0, worst)) console.log(`  x${r.ratio.toFixed(2)} est ${r.est} got ${r.got} ${r.hand} [${r.cards}] jokers ${r.jokers.join(",")} (${r.file.slice(-28)} #${r.n})`);
