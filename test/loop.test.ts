import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Config } from "../src/config.ts";
import { Agent, type TickRecord } from "../src/loop.ts";
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
