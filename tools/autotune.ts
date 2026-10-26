// Searches the TUNING numbers (src/tuning.ts) for the highest average ante on the simulator, one
// number at a time. Each step plays the current settings and the number moved up and down on the
// same fresh seeds, keeps a move only when it beats the current settings by `--z` standard errors
// of the paired difference, and records everything in the state file, so a stopped search resumes
// where it was. A game's score is the ante it reached, a win counting as 9 (with --endless, a won
// run scores the ante it got to before it lost, up to --endless-to).
//
//   node tools/autotune.ts --games 60 --jobs 5 --decks RED,BLUE,YELLOW,GREEN,BLACK,PLASMA
//   node tools/autotune.ts --report            # the settings found so far against the defaults
//   node tools/autotune.ts --profiles          # each stake on the --decks mix and each deck at White, on its own
//   node tools/autotune.ts --profiles --targets stake:GOLD,deck:GREEN
//   node tools/autotune.ts --profiles --report
//   node tools/autotune.ts --profiles --endless     # play on past a win (to ante 16); endless antes count
//
// With --profiles it searches the per-deck and per-stake changes of src/tuning.ts PROFILES instead
// of the shared numbers: one number at a time across every deck and stake, then the next number,
// the ones that moved most on the mix first. A deck plays its own games at White stake, a stake the
// --decks mix at that stake; a number that changes nothing for a deck or stake is not tried there
// again.
//
// Seeds never repeat between steps (block b plays seeds 10000 + b x games on, 200000 on for
// profiles), so a kept move has to win on deals it was never tuned on. Nothing here edits
// tuning.ts: what it finds is applied by hand after a check on fresh seeds and on the real game.

import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tuningDefaults, type Profiles, type TuningKey } from "../src/tuning.ts";
import type { GameResult } from "./benchlib.ts";

const argv = process.argv.slice(2);
const arg = (name: string, fallback?: string) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? "true");
};
const games = Number(arg("games", "60"));
const jobs = Math.max(1, Number(arg("jobs", "5")));
const decks = arg("decks", "RED,BLUE,YELLOW,GREEN,BLACK,PLASMA")!;
const z = Number(arg("z", "1.5"));
const maxSteps = Number(arg("steps", "1000"));
const profileMode = arg("profiles") !== undefined;
const endless = arg("endless") !== undefined;
const endlessTo = arg("endless-to", "16")!;
const statePath = arg("state", profileMode ? "runs/autotune-profiles.json" : "runs/autotune.json")!;

/** The numbers searched, how far a step moves each, and the bounds it stays in. Left out after a
 * pass that moved nothing: skipSafeRatio (unused while skip safety is simulated), debtDollar and
 * conflictCut (they change almost no decision). */
const SPACE: { key: TuningKey; step: number; mul?: boolean; min: number; max: number }[] = [
  { key: "voucherScale", step: 0.2, min: 0.2, max: 2 },
  { key: "dollar", step: 1.35, mul: true, min: 0.01, max: 0.15 },
  { key: "dollarUnderCap", step: 0.2, min: 1, max: 2.5 },
  { key: "interestLoss", step: 1.4, mul: true, min: 0.01, max: 0.3 },
  { key: "leave", step: 0.05, min: 0.2, max: 0.7 },
  { key: "rerollCore", step: 0.06, min: 0.1, max: 0.8 },
  { key: "rerollSurplus", step: 0.004, min: 0, max: 0.03 },
  { key: "rerollBuffer", step: 5, min: 0, max: 40 },
  { key: "simWeight", step: 1.3, mul: true, min: 0.3, max: 4 },
  { key: "swapMargin", step: 0.12, min: 0.05, max: 1.2 },
  { key: "skipCost", step: 0.1, min: -0.2, max: 0.8 },
  { key: "skipSafeOdds", step: 0.03, min: 0.7, max: 0.99 },
  { key: "packBoost", step: 0.08, min: -0.3, max: 0.5 },
  { key: "arcanaBoost", step: 0.08, min: -0.3, max: 0.5 },
  { key: "spectralBoost", step: 0.1, min: -0.2, max: 0.6 },
  { key: "tarotCut", step: 0.06, min: 0, max: 0.4 },
  { key: "expertWeight", step: 0.5, min: 0, max: 3 },
  { key: "buWeight", step: 0.3, min: 0, max: 2 },
  { key: "voucherExpertWeight", step: 0.5, min: 0, max: 3 },
  { key: "buTagWeight", step: 0.2, min: 0, max: 1.5 },
  { key: "buConsumableWeight", step: 0.2, min: 0, max: 1.5 },
  { key: "comboBonus", step: 0.15, min: 0, max: 1 },
  { key: "enablerBonus", step: 0.1, min: 0, max: 0.6 },
  { key: "buildAroundBonus", step: 0.1, min: 0, max: 0.6 },
];

/** The numbers searched per deck and stake, in the order they moved on the mix; the expert-data weights stay shared. */
const PROFILE_KEYS: TuningKey[] = ["simWeight", "rerollCore", "packBoost", "tarotCut", "leave", "voucherScale", "skipCost", "dollar", "interestLoss", "dollarUnderCap", "swapMargin", "spectralBoost", "arcanaBoost", "rerollSurplus", "rerollBuffer", "skipSafeOdds", "comboBonus", "buildAroundBonus"];
const STAKES = ["RED", "GREEN", "BLACK", "BLUE", "PURPLE", "ORANGE", "GOLD"];
const DECKS = ["RED", "BLUE", "YELLOW", "GREEN", "BLACK", "MAGIC", "NEBULA", "GHOST", "ABANDONED", "CHECKERED", "ZODIAC", "PAINTED", "ANAGLYPH", "PLASMA", "ERRATIC"];
type Target = { kind: "deck" | "stake"; name: string };
const only = arg("targets")?.split(",");
const TARGETS: Target[] = [...STAKES.map((name) => ({ kind: "stake" as const, name })), ...DECKS.map((name) => ({ kind: "deck" as const, name }))].filter((t) => !only || only.includes(`${t.kind}:${t.name}`));

interface Step {
  at: string;
  key: TuningKey;
  tried: number[];
  block: number;
  /** Mean score of each arm (current, up, down) and the paired difference to the current one. */
  means: number[];
  diffs: { mean: number; se: number }[];
  wins: number[];
  kept?: number;
  /** With --profiles, the deck or stake searched ("stake:GOLD"). */
  target?: string;
}
interface State {
  current: Partial<Record<TuningKey, number>>;
  /** Step size per number; halved after a full pass keeps nothing. */
  steps: Partial<Record<TuningKey, number>>;
  cursor: number;
  block: number;
  history: Step[];
  /** With --profiles: the changes found per deck and stake, and the deck or stake and number pairs that change nothing. */
  profiles?: Profiles;
  dead?: string[];
}

const defaults = tuningDefaults();
const state: State = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : { current: {}, steps: {}, cursor: 0, block: 0, history: [] };
if (profileMode) {
  state.profiles ??= { deck: {}, stake: {} };
  state.dead ??= [];
}
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 1));
const valueOf = (k: TuningKey) => state.current[k] ?? defaults[k];
const spec = (over: Partial<Record<TuningKey, number>>) => Object.entries({ ...state.current, ...over }).map(([k, v]) => `${k}=${+Number(v).toFixed(5)}`).join(",");
/** The ante reached, a win counting as 9; in endless the ante a won run got to. */
const scoreOf = (r: GameResult) => (r.won ? Math.max(9, r.ante) : r.ante);
const fmt = (v: number) => +v.toFixed(4);

if (arg("report") !== undefined) {
  console.log(`${state.history.length} steps, ${state.history.filter((h) => h.kept !== undefined).length} kept`);
  for (const k of Object.keys(state.current) as TuningKey[]) console.log(`  ${k}: ${defaults[k]} -> ${state.current[k]}`);
  if (state.profiles) {
    for (const kind of ["stake", "deck"] as const)
      for (const [name, changes] of Object.entries(state.profiles[kind]))
        if (Object.keys(changes).length) console.log(`  ${kind} ${name}: ${Object.entries(changes).map(([k, d]) => `${k} ${fmt(defaults[k as TuningKey])} -> ${fmt(defaults[k as TuningKey] + d!)}`).join(", ")}`);
    console.log(`  ${state.dead?.length ?? 0} deck or stake and number pairs change nothing and are skipped`);
  }
  for (const h of state.history.slice(-12)) console.log(`  ${h.target ? `${h.target} ` : ""}${h.key} ${h.tried.map(fmt).join(" | ")}: ${h.means.map((m) => m.toFixed(2)).join(" | ")} wins ${h.wins.join("/")}${h.kept !== undefined ? ` -> kept ${fmt(h.kept)}` : ""}`);
  process.exit(0);
}

// Every game runs on a copy of the code taken now (see tools/tune.ts).
const root = join(import.meta.dirname, "..");
const frozen = mkdtempSync(join(tmpdir(), "autotune-code-"));
for (const p of ["package.json", "src", "tools/simbench.ts", "tools/benchlib.ts", "data/roffle/priors.json", "data/roffle/policy.json", "data/roffle/catalog/jokers.json", "data/roffle/catalog/consumables.json", "data/bu/tiers.json"]) cpSync(join(root, p), join(frozen, p), { recursive: true });
const simbench = join(frozen, "tools", "simbench.ts");

/** One arm: `--set` overrides or a profiles file, played on these decks at this stake. */
interface Arm {
  set?: string;
  profiles?: string;
  decks: string;
  stake: string;
}

function run(arm: Arm, start: number, count: number): Promise<GameResult[]> {
  const args = ["--disable-warning=ExperimentalWarning", simbench, "--json", "--stakes", arm.stake, "--decks", arm.decks, "--from", String(start), "--games", String(count), ...(arm.set ? ["--set", arm.set] : []), ...(arm.profiles ? ["--profiles", arm.profiles] : []), ...(endless ? ["--endless", "--endless-to", endlessTo] : [])];
  return new Promise((resolve, reject) => {
    // Games run with the tuner's own node flags, so `node --single-threaded tools/autotune.ts` holds each to one core.
    const p = spawn(process.execPath, [...process.execArgv, ...args], { stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(out.split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l) as GameResult)) : reject(new Error(`simbench exited ${code}`))));
  });
}

async function playArms(arms: Arm[], from: number): Promise<GameResult[][]> {
  const chunk = 5;
  const tasks: { arm: number; start: number; count: number }[] = [];
  for (let s = from; s < from + games; s += chunk) for (let a = 0; a < arms.length; a++) tasks.push({ arm: a, start: s, count: Math.min(chunk, from + games - s) });
  const out: GameResult[][] = arms.map(() => []);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const t = tasks[next++];
      const rs = await run(arms[t.arm], t.start, t.count).catch(() => run(arms[t.arm], t.start, t.count));
      out[t.arm].push(...rs);
    }
  };
  await Promise.all(Array.from({ length: Math.min(jobs, tasks.length) }, worker));
  return out;
}

const paired = (a: GameResult[], b: GameResult[]) => {
  const base = new Map(b.map((r) => [r.seed, scoreOf(r)]));
  const d = a.filter((r) => base.has(r.seed)).map((r) => scoreOf(r) - base.get(r.seed)!);
  const mean = d.reduce((x, y) => x + y, 0) / Math.max(1, d.length);
  const sd = Math.sqrt(d.reduce((x, y) => x + (y - mean) ** 2, 0) / Math.max(1, d.length - 1));
  return { mean, se: sd / Math.sqrt(Math.max(1, d.length)) };
};

/** An arm on the mix: the numbers found so far with these moved. */
const mixArm = (over: Partial<Record<TuningKey, number>>): Arm => ({ set: spec(over), decks, stake: "WHITE" });

/** An arm of a profile step: the changes found so far, with this deck's or stake's `key` made `value`. */
function profileArm(t: Target, key: TuningKey, value: number, i: number): Arm {
  const profiles = structuredClone(state.profiles!);
  (profiles[t.kind][t.name] ??= {})[key] = value - defaults[key];
  const file = join(frozen, `arm-${i}.json`);
  writeFileSync(file, JSON.stringify(profiles));
  return { profiles: file, decks: t.kind === "deck" ? t.name : decks, stake: t.kind === "stake" ? t.name : "WHITE" };
}

function keepChange(t: Target, key: TuningKey, value: number) {
  const changes = (state.profiles![t.kind][t.name] ??= {});
  const d = +(value - defaults[key]).toFixed(6);
  if (d) changes[key] = d;
  else delete changes[key];
}

let quietPass = 0;
const passLength = profileMode ? PROFILE_KEYS.length * TARGETS.length : SPACE.length;
for (let n = 0; n < maxSteps; n++) {
  let p = SPACE[state.cursor % SPACE.length];
  let now = valueOf(p.key);
  let target: Target | undefined;
  if (profileMode) {
    target = TARGETS[state.cursor % TARGETS.length];
    const key = PROFILE_KEYS[Math.floor(state.cursor / TARGETS.length) % PROFILE_KEYS.length];
    if (state.dead!.includes(`${target.kind}:${target.name}:${key}`)) {
      state.cursor++;
      continue;
    }
    p = SPACE.find((s) => s.key === key)!;
    now = defaults[key] + (state.profiles![target.kind][target.name]?.[key] ?? 0);
  }
  const id = target && `${target.kind}:${target.name}`;
  const step = state.steps[p.key] ?? p.step;
  const clamp = (v: number) => Math.min(p.max, Math.max(p.min, v));
  const up = clamp(p.mul ? now * step : now + step);
  const down = clamp(p.mul ? now / step : now - step);
  const tried = [now, up, down];
  const from = (profileMode ? 200000 : 10000) + state.block * games;
  const t0 = Date.now();
  const arms = target ? tried.map((v, i) => profileArm(target, p.key, v, i)) : [mixArm({}), mixArm({ [p.key]: up }), mixArm({ [p.key]: down })];
  const results = await playArms(arms, from);
  const means = results.map((rs) => rs.reduce((a, r) => a + scoreOf(r), 0) / Math.max(1, rs.length));
  const diffs = results.map((rs) => paired(rs, results[0]));
  const best = [1, 2].filter((i) => tried[i] !== now && diffs[i].mean > 0.05 && diffs[i].mean > z * diffs[i].se).sort((a, b) => diffs[b].mean - diffs[a].mean)[0];
  const rec: Step = { at: new Date().toISOString(), key: p.key, tried, block: state.block, means, diffs, wins: results.map((rs) => rs.filter((r) => r.won).length), ...(id ? { target: id } : {}) };
  if (best !== undefined) {
    if (target) keepChange(target, p.key, tried[best]);
    else state.current[p.key] = tried[best];
    rec.kept = tried[best];
    quietPass = 0;
  } else quietPass++;
  // Every game scored the same whichever value: the number does nothing on this deck or stake.
  if (target && diffs.every((d) => d.mean === 0 && d.se === 0)) state.dead!.push(`${id}:${p.key}`);
  state.history.push(rec);
  state.block++;
  state.cursor++;
  // A whole pass with nothing kept: smaller steps from here.
  if (quietPass >= passLength) {
    for (const s of SPACE) state.steps[s.key] = s.mul ? Math.sqrt(state.steps[s.key] ?? s.step) : (state.steps[s.key] ?? s.step) / 2;
    quietPass = 0;
  }
  save();
  console.log(`${id ? `${id} ` : ""}${p.key}: ${tried.map(fmt).join(" | ")} -> ${means.map((m) => m.toFixed(2)).join(" | ")} (diff ${diffs.slice(1).map((d) => `${d.mean >= 0 ? "+" : ""}${d.mean.toFixed(2)}±${d.se.toFixed(2)}`).join(", ")}; wins ${rec.wins.join("/")} of ${games})${rec.kept !== undefined ? `  KEPT ${fmt(rec.kept)}` : ""}  ${Math.round((Date.now() - t0) / 1000)}s`);
}
