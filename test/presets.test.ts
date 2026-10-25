import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Config } from "../src/config.ts";
import { FEATURES, PRESETS } from "../src/features.ts";
import { Agent } from "../src/loop.ts";
import { simGame } from "../src/sim.ts";
import { mockEngine } from "../src/systemone.ts";

const config = (): Config => ({
  port: 0,
  sim: true,
  mockModel: true,
  balatroUrl: "",
  backend: "local",
  backends: { cloud: { baseUrl: "", apiKey: "", model: "m", label: "c" }, local: { baseUrl: "", apiKey: "l", model: "l", label: "l" } },
  gates: { noneThreshold: 0.2, minConfidence: 0.55 },
  reviewMode: "blend",
  live: true,
  tickDelayMs: 0,
  screenshots: false,
  screenIntervalMs: 1000,
  screenPath: "",
  autoStart: { deck: "RED", stake: "WHITE", seed: "PRESET" },
  endless: false,
  expert: true,
  logDir: mkdtempSync(join(tmpdir(), "instinct-")),
});

test("the loop runs on one of three presets, switched as a whole", async () => {
  const agent = new Agent(simGame("PRESET"), { mock: mockEngine(1, false) }, config());
  assert.equal(agent.status().preset, "advanced");
  assert.deepEqual(agent.status().presets.map((p) => p.id), ["basic", "standard", "advanced"]);
  agent.set({ preset: "basic" });
  assert.equal(agent.status().preset, "basic");
  assert.ok(Object.values(FEATURES).every((v) => v === false), JSON.stringify(FEATURES));
  // Basic still plays.
  for (let i = 0; i < 30; i++) await agent.step();
  assert.ok(agent.ticks.length > 10 && agent.ticks.every((t) => !t.error));
  agent.set({ preset: "standard" });
  assert.equal(FEATURES.roundSim, true);
  assert.equal(FEATURES.shopSim, false);
  agent.set({ preset: "advanced" });
  assert.deepEqual({ ...FEATURES }, PRESETS.find((p) => p.id === "advanced")!.features);
});
