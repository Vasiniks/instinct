// Plays a fixed list of seeds on the real game and reports how far each run got, so a change is
// judged on the same deals. One worker per BlindDeck URL; with several URLs (one per Balatro
// instance) the workers play at the same time.
//
//   node tools/batch.ts --games 20                       # Red deck, White stake, on :12346
//   node tools/batch.ts --games 20 --decks RED,BLUE,PLASMA --stake WHITE
//   node tools/batch.ts --games 6 --urls http://127.0.0.1:12346,http://127.0.0.1:12350
//   node tools/batch.ts --games 3 --mock --sim           # plumbing check: simulator, no model calls
//   --backend local uses StartLux on :8090 instead of cloud Jev
//
// Seeds come from --prefix (default INST) and the game number, so a rerun replays the same deals.
// Results go to runs/batch-<time>/results.json, next to each worker's run log.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blindDeck } from "../src/blinddeck.ts";
import { loadConfig } from "../src/config.ts";
import type { Snapshot } from "../src/extract.ts";
import { Agent, type TickRecord } from "../src/loop.ts";
import { simGame } from "../src/sim.ts";
import { type Engine, httpEngine, mockEngine } from "../src/systemone.ts";

const argv = process.argv.slice(2);
const arg = (name: string, fallback?: string) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? "true");
};
const games = Number(arg("games", "10"));
const decks = arg("decks", "RED")!.split(",");
const stake = arg("stake", "WHITE")!;
const urls = arg("urls", "http://127.0.0.1:12346")!.split(",");
const mock = arg("mock") !== undefined;
const sim = arg("sim") !== undefined;
/** The model backend: cloud Jev unless told otherwise (the config's default follows TYPESAFE_BASE_URL). */
const backend = arg("backend", "cloud")!;
const prefix = (arg("prefix", "INST")!.toUpperCase().replace(/[^A-Z1-9]/g, "") || "INST").slice(0, 4);
const maxTicks = Number(arg("max-ticks", "2500"));

/** Balatro seeds are up to 8 characters with no 0 (it reads as O): the game number in base 9 on digits 1-9. */
const seedOf = (n: number) => prefix + [...n.toString(9).padStart(4, "0")].map((d) => String(Number(d) + 1)).join("");

interface Result {
  game: number;
  seed: string;
  deck: string;
  stake: string;
  url: string;
  won: boolean;
  ante: number;
  round: number;
  ticks: number;
  modelCalls: number;
  sources: Record<string, number>;
  minutes: number;
  /** The blind that ended the run, and the best play the agent saw for it. */
  lostTo?: { blind: string; target: number; best: number };
  error?: string;
}

const out = resolve(import.meta.dirname, "..", "runs", `batch-${new Date().toISOString().replace(/[:.]/g, "-")}`);
mkdirSync(out, { recursive: true });
const queue = Array.from({ length: games }, (_, i) => i);
const results: Result[] = [];

async function worker(url: string) {
  const cfg = { ...loadConfig(["--live", "--no-screen", "--delay", "0", "--backend", backend, ...(mock ? ["--mock-model"] : []), ...(sim ? ["--sim"] : [])]), logDir: join(out, `worker-${urls.indexOf(url) + 1}`) };
  const game = sim ? simGame() : blindDeck(url);
  const engines: Record<string, Engine> = mock ? { mock: mockEngine(7, false) } : { cloud: httpEngine(cfg.backends.cloud), local: httpEngine(cfg.backends.local) };
  const agent = new Agent(game, engines, cfg);
  const ticks: TickRecord[] = [];
  agent.subscribe((e) => {
    if (e.type === "tick") ticks.push(e.data);
  });
  for (let g = queue.shift(); g !== undefined; g = queue.shift()) {
    const deck = decks[g % decks.length];
    const seed = seedOf(g);
    cfg.autoStart = { deck, stake, seed };
    const t0 = Date.now();
    ticks.length = 0;
    let error: string | undefined;
    try {
      const state = await game.call<{ state: string }>("gamestate");
      if (state.state !== "MENU") await game.call("menu");
      let last: Snapshot | undefined;
      for (let i = 0; i < maxTicks; i++) {
        await agent.step();
        last = ticks.at(-1)?.snapshot;
        if (last && (last.phase === "GAME_OVER" || last.won || last.victoryOverlay)) break;
      }
    } catch (e) {
      error = (e as Error).message;
    }
    const snaps = ticks.map((t) => t.snapshot);
    const hands = ticks.filter((t) => t.phase === "SELECTING_HAND");
    const lastHand = hands.at(-1);
    const won = snaps.some((s) => s.won || s.victoryOverlay);
    const sources: Record<string, number> = {};
    for (const t of ticks) sources[t.verdict.source] = (sources[t.verdict.source] ?? 0) + 1;
    const r: Result = {
      game: g + 1,
      seed,
      deck,
      stake,
      url,
      won,
      ante: Math.max(0, ...snaps.map((s) => s.ante)),
      round: Math.max(0, ...snaps.map((s) => s.round)),
      ticks: ticks.length,
      modelCalls: ticks.filter((t) => t.request).length,
      sources,
      minutes: Math.round((Date.now() - t0) / 600) / 100,
      ...(won || !lastHand
        ? {}
        : {
            lostTo: {
              blind: lastHand.snapshot.blind?.name ?? "?",
              target: lastHand.snapshot.blind?.target ?? 0,
              best: Math.max(0, ...hands.filter((t) => t.snapshot.blind?.name === lastHand.snapshot.blind?.name && t.snapshot.ante === lastHand.snapshot.ante).flatMap((t) => t.candidates.map((c) => c.estimate?.score ?? 0))),
            },
          }),
      ...(error ? { error } : {}),
    };
    results.push(r);
    writeFileSync(join(out, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
    console.log(`${r.seed} ${deck}/${stake}: ${won ? "WON" : `lost at ante ${r.ante}${r.lostTo ? ` to ${r.lostTo.blind} (${r.lostTo.target}; best play ${r.lostTo.best})` : ""}`}, ${r.ticks} ticks, ${r.modelCalls} model calls, ${r.minutes} min${error ? `, error: ${error}` : ""}`);
  }
}

console.log(`${games} games, ${decks.join("/")} on ${stake}, ${urls.length} worker${urls.length === 1 ? "" : "s"}${mock ? ", mock model" : ""}. Logs: ${out}`);
await Promise.all(urls.map(worker));
const wins = results.filter((r) => r.won).length;
const antes = results.map((r) => r.ante).sort((a, b) => a - b);
console.log(`\nWon ${wins} of ${results.length} (${Math.round((wins / Math.max(1, results.length)) * 100)}%). Antes reached: ${antes.join(", ")}; median ${antes[Math.floor(antes.length / 2)] ?? "-"}.`);
