// The simulator benchmark behind the numbers in the README and in features.ts: N seeded games per
// stake on the built-in simulator, the mock model standing in for Jev (it samples from the code's
// own values, so this measures the code), reporting wins and the ante each game reached.
//
//   node tools/simbench.ts                          # 30 games, White and Gold, the advanced preset
//   node tools/simbench.ts --games 40 --stakes WHITE
//   node tools/simbench.ts --preset basic           # a whole preset (basic, standard, advanced)
//   node tools/simbench.ts --off roundSim,padding   # single switches off, to see what each adds
//   node tools/simbench.ts --set dollar=0.04,skipOutlook=false   # TUNING numbers or switches
//   node tools/simbench.ts --profiles p.json        # per-deck and per-stake changes in place of src/tuning.ts PROFILES
//   node tools/simbench.ts --jobs 6                 # games spread over 6 processes
//   node tools/simbench.ts --from 30 --json         # seeds S30X on, one JSON line per game (tools/tune.ts)
//   node tools/simbench.ts --decks RED,BLUE,PLASMA  # game k plays deck k mod 3
//   node tools/simbench.ts --noise 0                # the mock's spread around the code's values (default 0.55)
//   node tools/simbench.ts --logs                   # keep each game's tick log (tools/fidelity.py reads them)
//   node tools/simbench.ts --endless --endless-to 16  # play on past a win; the ante reached is the score
//
// The simulator (src/sim/) deals the vanilla game: 144 jokers at the game's rarities, prices and
// editions, scaling ones growing and economy ones paying; Arcana, Celestial, Buffoon, Standard and
// Spectral packs in all sizes; Tarots, Planets and Spectrals with seals and enhancements; the 32
// vouchers and boss rerolls; all 28 bosses and 24 skip tags; Eternal, Perishable and Rental
// stickers by stake; the 15 decks; The Soul and its Legendaries. It still lacks Hiker's card chips,
// and chance inside a hand's score: Lucky Cards' Mult and Bloodstone score at their expectation, as
// the evaluator assumes. The real game (tools/batch.ts) stays the judge for those.

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.ts";
import { FEATURES, applyPreset, type PresetId } from "../src/features.ts";
import { Agent, type TickRecord } from "../src/loop.ts";
import { simGame } from "../src/sim.ts";
import { mockEngine } from "../src/systemone.ts";
import { applyOverrides, loadProfiles } from "../src/tuning.ts";
import { behavior, type GameResult } from "./benchlib.ts";

const argv = process.argv.slice(2);
const arg = (name: string, fallback?: string) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? "true");
};
const games = Number(arg("games", "30"));
const from = Number(arg("from", "0"));
const jobs = Math.max(1, Number(arg("jobs", "1")));
const json = arg("json") !== undefined;
const stakes = arg("stakes", "WHITE,GOLD")!.split(",");
/** Decks by seed: game k plays decks[k % n], so every arm meets the same deck on the same seed. */
const decks = arg("decks", "RED")!.split(",");
const preset = arg("preset") as PresetId | undefined;
const off = (arg("off") ?? "").split(",").filter(Boolean);
const set = arg("set") ?? "";
const profiles = arg("profiles");
const endless = arg("endless") !== undefined;
const endlessTo = Number(arg("endless-to", "16"));
const noise = arg("noise");
// A game's log is about 6 MB; without --logs none is written.
const keepLogs = arg("logs") !== undefined;


if (preset) applyPreset(preset);
for (const k of off) {
  if (!(k in FEATURES)) throw new Error(`no switch named ${k}; switches: ${Object.keys(FEATURES).join(", ")}`);
  (FEATURES as Record<string, boolean>)[k] = false;
}
const applied = applyOverrides(set, FEATURES as Record<string, boolean>);
if (profiles) loadProfiles(JSON.parse(readFileSync(profiles, "utf8")));

async function play(stake: string, k: number): Promise<GameResult> {
  const seed = `S${k}X`;
  const cfg = { ...loadConfig(["--sim", "--mock-model", "--live", "--delay", "0", ...(endless ? ["--endless"] : [])]), autoStart: { deck: decks[k % decks.length], stake, seed }, logDir: mkdtempSync(join(tmpdir(), "simbench-")), noLog: !keepLogs };
  const agent = new Agent(simGame(seed, { endless }), { mock: mockEngine(k + 1, false, noise !== undefined ? Number(noise) : undefined) }, cfg);
  const ticks: TickRecord[] = [];
  agent.subscribe((e) => {
    if (e.type === "tick") ticks.push(e.data);
  });
  for (let i = 0; i < (endless ? 3000 : 800); i++) {
    await agent.step();
    const last = ticks.at(-1);
    if (last?.phase === "GAME_OVER" || (endless && last && last.snapshot.ante >= endlessTo)) break;
  }
  if (!keepLogs) rmSync(cfg.logDir, { recursive: true, force: true });
  const shops: GameResult["shops"] = [];
  let visit = { rerolls: 0, bought: 0 };
  let skips = 0;
  for (const t of ticks) {
    if (!t.result?.ok) continue;
    for (const c of t.calls ?? (t.call ? [t.call] : [])) {
      if (c.method === "skip") skips++;
      if (t.phase !== "SHOP") continue;
      if (c.method === "reroll") visit.rerolls++;
      if (c.method === "buy") visit.bought++;
      if (c.method === "next_round") {
        shops.push({ ante: t.snapshot.ante, exit: t.snapshot.money, ...visit });
        visit = { rerolls: 0, bought: 0 };
      }
    }
  }
  return {
    stake,
    seed,
    ante: Math.max(...ticks.map((t) => t.snapshot.ante)),
    won: ticks.some((t) => t.snapshot.won || t.snapshot.victoryOverlay),
    failed: ticks.filter((t) => t.result && !t.result.ok).length,
    shops,
    skips,
    decisions: ticks.filter((t) => t.phase !== "GAME_OVER").length,
  };
}


/** Runs games `from..from+games` of one stake in a child process, reading its JSON lines. */
function child(stake: string, start: number, count: number): Promise<GameResult[]> {
  const args = [process.argv[1], "--json", "--stakes", stake, "--decks", decks.join(","), "--from", String(start), "--games", String(count), ...(preset ? ["--preset", preset] : []), ...(off.length ? ["--off", off.join(",")] : []), ...(set ? ["--set", set] : []), ...(profiles ? ["--profiles", profiles] : []), ...(noise !== undefined ? ["--noise", noise] : []), ...(keepLogs ? ["--logs"] : []), ...(endless ? ["--endless", "--endless-to", String(endlessTo)] : [])];
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", ...args], { stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(out.split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l) as GameResult)) : reject(new Error(`simbench child exited ${code}`))));
  });
}

const summary = (stake: string, rs: GameResult[], seconds: number) => {
  const antes = rs.map((r) => r.ante).sort((a, b) => a - b);
  const mean = antes.reduce((a, b) => a + b, 0) / Math.max(1, antes.length);
  const failed = rs.reduce((a, r) => a + r.failed, 0);
  const decisions = rs.reduce((a, r) => a + (r.decisions ?? 0), 0);
  return `${stake}: won ${rs.filter((r) => r.won).length}/${rs.length}, mean ante ${mean.toFixed(2)}, antes ${antes.join(",")}${failed ? `, ${failed} failed calls` : ""}\n${decisions} decisions in ${seconds.toFixed(0)} s: ${(decisions / Math.max(1e-9, seconds)).toFixed(1)} a second`;
};

if (!json) console.log(`${games} games per stake, preset ${preset ?? "advanced"}${off.length ? `, off: ${off.join(", ")}` : ""}${applied.length ? `, set: ${applied.join(", ")}` : ""}${jobs > 1 ? `, ${jobs} processes` : ""}`);
for (const stake of stakes) {
  let results: GameResult[] = [];
  const t0 = performance.now();
  if (jobs > 1 && !json) {
    const per = Math.ceil(games / jobs);
    const chunks = Array.from({ length: jobs }, (_, j) => [from + j * per, Math.min(per, games - j * per)] as const).filter(([, n]) => n > 0);
    results = (await Promise.all(chunks.map(([start, n]) => child(stake, start, n)))).flat();
  } else {
    for (let k = from; k < from + games; k++) {
      const r = await play(stake, k);
      if (json) console.log(JSON.stringify(r));
      results.push(r);
    }
  }
  if (!json) console.log(`${summary(stake, results, (performance.now() - t0) / 1000)}\n${behavior(results)}`);
}
