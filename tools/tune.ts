// Paired arms on the simulator: every arm plays the same seeds, so a difference in average ante is
// the change, not the deals. The first arm is the baseline; each other arm reports its mean ante,
// the paired difference with its standard error, and how many seeds it did better and worse on.
//
//   node tools/tune.ts --arms "base; dollar=0.04; dollar=0.02" --games 60 --stakes WHITE --jobs 10
//   node tools/tune.ts --sweep dollar=0.02,0.03,0.04 --games 60 --behavior   # plus shop money and rerolls by ante
//   node tools/tune.ts ... --out runs/tune-a.jsonl      # every game appended there; rerun to resume
//
// Arms are TUNING numbers (src/tuning.ts) or FEATURES switches (src/features.ts), as `key=value`
// pairs joined by commas; arms are separated by semicolons, and an empty arm or "base" is the
// defaults. Games run through tools/simbench.ts --json in a pool of `--jobs` processes.

import { spawn } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { behavior, type GameResult } from "./benchlib.ts";

const argv = process.argv.slice(2);
const arg = (name: string, fallback?: string) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? "true");
};
const games = Number(arg("games", "40"));
const from = Number(arg("from", "0"));
const jobs = Math.max(1, Number(arg("jobs", "8")));
const stakes = arg("stakes", "WHITE")!.split(",");
const chunk = Number(arg("chunk", "5"));
const decks = arg("decks", "RED")!;
const sweep = arg("sweep");
const arms = sweep
  ? (() => {
      const [k, vs] = sweep.split("=");
      return vs.split(",").map((v) => `${k}=${v}`);
    })()
  : (arg("arms", "base") ?? "base").split(";").map((a) => a.trim());
const spec = (a: string) => (a === "base" ? "" : a);

// Every game runs on a copy of the code taken now, so edits made while the sweep runs can't split
// its arms across two versions.
const root = join(import.meta.dirname, "..");
const frozen = mkdtempSync(join(tmpdir(), "tune-code-"));
for (const p of ["package.json", "src", "tools/simbench.ts", "tools/benchlib.ts", "data/roffle/priors.json", "data/roffle/catalog/jokers.json", "data/bu/tiers.json"]) cpSync(join(root, p), join(frozen, p), { recursive: true });
const simbench = join(frozen, "tools", "simbench.ts");
function run(arm: string, stake: string, start: number, count: number): Promise<GameResult[]> {
  const args = ["--disable-warning=ExperimentalWarning", simbench, "--json", "--stakes", stake, "--decks", decks, "--from", String(start), "--games", String(count), ...(spec(arm) ? ["--set", spec(arm)] : [])];
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(out.split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l) as GameResult)) : reject(new Error(`${arm}: simbench exited ${code}`))));
  });
}

// With --out, each finished game is appended there (with its arm), and games already in the file
// are not played again: a sweep that dies part way resumes where it stopped.
const outFile = arg("out");
const results = new Map<string, GameResult[]>(arms.map((a) => [a, []]));
const done0 = new Set<string>();
if (outFile && existsSync(outFile)) {
  for (const line of readFileSync(outFile, "utf8").split("\n").filter(Boolean)) {
    const r = JSON.parse(line) as GameResult & { arm: string };
    if (!results.has(r.arm)) continue;
    results.get(r.arm)!.push(r);
    done0.add(`${r.arm}|${r.stake}|${r.seed}`);
  }
}
const tasks: { arm: string; stake: string; start: number; count: number }[] = [];
for (const stake of stakes)
  for (let s = from; s < from + games; s += chunk)
    for (const arm of arms) {
      const count = Math.min(chunk, from + games - s);
      if (Array.from({ length: count }, (_, i) => done0.has(`${arm}|${stake}|S${s + i}X`)).every(Boolean)) continue;
      tasks.push({ arm, stake, start: s, count });
    }
const t0 = Date.now();
let next = 0;
let done = 0;
async function worker() {
  while (next < tasks.length) {
    const t = tasks[next++];
    // A chunk whose process was killed is tried once more before the sweep gives up on it.
    const rs = await run(t.arm, t.stake, t.start, t.count).catch(() => run(t.arm, t.stake, t.start, t.count));
    const fresh = rs.filter((r) => !done0.has(`${t.arm}|${r.stake}|${r.seed}`));
    results.get(t.arm)!.push(...fresh);
    if (outFile) for (const r of fresh) appendFileSync(outFile, JSON.stringify({ arm: t.arm, ...r }) + "\n");
    done++;
    if (process.stderr.isTTY) process.stderr.write(`\r${done}/${tasks.length} chunks, ${Math.round((Date.now() - t0) / 1000)}s`);
  }
}
await Promise.all(Array.from({ length: Math.min(jobs, tasks.length) }, worker));
if (process.stderr.isTTY) process.stderr.write("\n");

const key = (r: GameResult) => `${r.stake}/${r.seed}`;
const base = new Map(results.get(arms[0])!.map((r) => [key(r), r]));
console.log(`${games} seeds x ${stakes.join(",")}, ${arms.length} arms, ${Math.round((Date.now() - t0) / 1000)}s`);
for (const arm of arms) {
  const rs = results.get(arm)!;
  const mean = rs.reduce((a, r) => a + r.ante, 0) / rs.length;
  const wins = rs.filter((r) => r.won).length;
  const failed = rs.reduce((a, r) => a + r.failed, 0);
  let line = `${(arm || "base").padEnd(34)} won ${String(wins).padStart(3)}/${rs.length}  mean ante ${mean.toFixed(2)}`;
  if (arm !== arms[0]) {
    const d = rs.map((r) => r.ante - (base.get(key(r))?.ante ?? r.ante));
    const m = d.reduce((a, b) => a + b, 0) / d.length;
    const sd = Math.sqrt(d.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, d.length - 1));
    line += `  diff ${m >= 0 ? "+" : ""}${m.toFixed(2)} ± ${(sd / Math.sqrt(d.length)).toFixed(2)}  better ${d.filter((x) => x > 0).length}, worse ${d.filter((x) => x < 0).length}`;
  }
  console.log(line + (failed ? `  ${failed} failed calls` : ""));
  if (argv.includes("--behavior")) console.log(behavior(rs));
}
