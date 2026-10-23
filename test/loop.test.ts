import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Config } from "../src/config.ts";
import { Agent, type TickRecord } from "../src/loop.ts";
import { listRuns, loadRun } from "../src/runs.ts";
import { simGame } from "../src/sim.ts";
import { mockEngine } from "../src/systemone.ts";

function config(): Config {
  return {
    port: 0,
    sim: true,
    mockModel: true,
    balatroUrl: "",
    backend: "local",
    backends: {
      cloud: { baseUrl: "", apiKey: "", model: "jev-latest", label: "cloud Jev" },
      local: { baseUrl: "", apiKey: "local", model: "local", label: "local StartLux" },
    },
    gates: { noneThreshold: 0.2, minConfidence: 0.55 },
    reviewMode: "fallback",
    live: true,
    tickDelayMs: 0,
    screenshots: false,
    screenIntervalMs: 1000,
    screenPath: "",
    autoStart: { deck: "RED", stake: "WHITE", seed: "LOOPTEST" },
    endless: false,
    expert: false,
    logDir: mkdtempSync(join(tmpdir(), "instinct-")),
  };
}

test("the loop plays the simulator through phases with legal actions until the run ends", async () => {
  const agent = new Agent(simGame("LOOPTEST"), { mock: mockEngine(3, false) }, config());
  const ticks: TickRecord[] = [];
  agent.subscribe((e) => {
    if (e.type === "tick") ticks.push(e.data);
  });
  for (let i = 0; i < 400; i++) {
    await agent.step();
    const last = ticks[ticks.length - 1];
    if (last?.phase === "GAME_OVER") break;
  }
  const phases = new Set(ticks.map((t) => t.phase));
  for (const p of ["MENU", "BLIND_SELECT", "SELECTING_HAND", "ROUND_EVAL", "SHOP"]) assert.ok(phases.has(p), `never saw ${p}`);
  const failed = ticks.filter((t) => t.result && !t.result.ok);
  assert.deepEqual(failed.map((t) => t.result?.error), []);
  assert.ok(ticks.some((t) => t.response?.answers.action), "model was asked");
  assert.equal(ticks[ticks.length - 1].phase, "GAME_OVER");
  // The build question goes out once per shop visit, not on every move in it.
  const asked = new Map<string, number>();
  for (const t of ticks) {
    if (t.phase !== "SHOP" || !t.request?.questions.build) continue;
    const visit = `${t.snapshot.ante}:${t.snapshot.round}`;
    asked.set(visit, (asked.get(visit) ?? 0) + 1);
  }
  assert.ok(asked.size > 0, "the build question was never asked");
  assert.ok([...asked.values()].every((n) => n === 1), JSON.stringify([...asked]));
});

test("a recorded run replays move for move from its seed", async () => {
  const cfg = config();
  const agent = new Agent(simGame("REC"), { mock: mockEngine(5, false) }, cfg);
  for (let i = 0; i < 60; i++) await agent.step();
  const [meta] = listRuns(cfg.logDir);
  assert.equal(meta.seed, "LOOPTEST");
  assert.equal(meta.game, "simulator");
  assert.ok(meta.actions > 10, `only ${meta.actions} actions recorded`);

  const replayer = new Agent(simGame("OTHER"), { mock: mockEngine(9, false) }, { ...config(), logDir: cfg.logDir });
  await replayer.replay(loadRun(cfg.logDir, meta.id));
  assert.match(replayer.message ?? "", /Replay finished/);
  assert.equal(replayer.ticks.length, meta.actions);
  assert.ok(replayer.ticks.every((t) => t.result?.ok && t.replayOf));
});

test("a replay stops where the game no longer matches the recording", async () => {
  const cfg = config();
  const agent = new Agent(simGame("REC"), { mock: mockEngine(5, false) }, cfg);
  for (let i = 0; i < 30; i++) await agent.step();
  const run = loadRun(cfg.logDir, listRuns(cfg.logDir)[0].id);
  run.meta.seed = "ANOTHERSEED";
  const replayer = new Agent(simGame("OTHER"), { mock: mockEngine(9, false) }, { ...config(), logDir: cfg.logDir });
  await replayer.replay(run);
  assert.match(replayer.message ?? "", /diverged/);
});

test("dry-run decides but sends nothing", async () => {
  const cfg = { ...config(), live: false };
  const game = simGame("DRY");
  await game.call("start", { deck: "RED", stake: "WHITE" });
  const agent = new Agent(game, { mock: mockEngine(1, false) }, cfg);
  await agent.step();
  const rec = agent.ticks[0];
  assert.equal(rec.phase, "BLIND_SELECT");
  assert.equal(rec.result?.dryRun, true);
  assert.equal(game.state().state, "BLIND_SELECT");
});
