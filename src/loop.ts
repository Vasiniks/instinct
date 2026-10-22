// The agent loop: observe -> extract -> ask -> gate -> act, one tick per game decision.
// Every stage is broadcast so the visualizer can light up the loop live, and every tick is
// appended to runs/*.jsonl (with the raw gamestate) for evaluation and feature discovery later.

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Game } from "./blinddeck.ts";
import { buildCandidates, type Candidate, type CandidateSet, type RpcCall } from "./candidates.ts";
import type { BackendName, Config } from "./config.ts";
import { extract, type Snapshot } from "./extract.ts";
import { applyPolicy, type ReviewMode, type Verdict } from "./policy.ts";
import { buildRequest } from "./strategy.ts";
import type { ChoiceAnswer, Engine, SystemOneRequest, SystemOneResponse } from "./systemone.ts";
import type { GameState } from "./types.ts";

export type Stage = "observe" | "extract" | "ask" | "gate" | "act" | "idle";

export interface TickRecord {
  n: number;
  at: number;
  phase: string;
  snapshot: Snapshot;
  candidates: Candidate[];
  auto?: Candidate;
  note?: string;
  request?: SystemOneRequest;
  response?: SystemOneResponse;
  verdict: Verdict;
  call?: RpcCall;
  result?: { ok: boolean; dryRun?: boolean; error?: string; ms: number };
  error?: string;
  timings: { observe: number; extract: number; ask: number; act: number; total: number };
}

export interface AgentStatus {
  running: boolean;
  live: boolean;
  reviewMode: ReviewMode;
  tickDelayMs: number;
  stage: Stage;
  tick: number;
  /** Which decision backend the next request goes to: cloud, local, or mock. */
  backend: string;
  backends: { name: string; label: string; url: string }[];
  /** The model name the request asks for; the response's `model` is what actually answered. */
  model: string;
  game: string;
  gates: Config["gates"];
  awaitingHuman: boolean;
  /** BlindDeck screenshots are on (off while the browser embeds the live window). */
  screen: boolean;
  message?: string;
}

export type AgentEvent =
  | { type: "status"; data: AgentStatus }
  | { type: "stage"; data: { n: number; stage: Stage; at: number } }
  | { type: "tick"; data: TickRecord }
  | { type: "screen"; data: { at: number } };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const HISTORY = 400;

export class Agent {
  game: Game;
  /** Decision engines by backend name; the mock engine is keyed "mock". */
  engines: Record<string, Engine>;
  cfg: Config;
  ticks: TickRecord[] = [];
  stage: Stage = "idle";
  running = false;
  awaitingHuman = false;
  message?: string;
  screenAt = 0;
  #n = 0;
  #busy = false;
  #looping = false;
  #listeners = new Set<(e: AgentEvent) => void>();
  #logFile: string;
  #screenTimer?: ReturnType<typeof setInterval>;
  #screenBackoff = 0;

  constructor(game: Game, engines: Record<string, Engine>, cfg: Config) {
    this.game = game;
    this.engines = engines;
    this.cfg = cfg;
    mkdirSync(cfg.logDir, { recursive: true });
    this.#logFile = join(cfg.logDir, `run-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
  }

  get backend(): string {
    return this.cfg.mockModel ? "mock" : this.cfg.backend;
  }

  get engine(): Engine {
    return this.engines[this.backend];
  }

  get model(): string {
    return this.cfg.mockModel ? "mock" : this.cfg.backends[this.cfg.backend].model;
  }

  subscribe(fn: (e: AgentEvent) => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  #emit(e: AgentEvent) {
    for (const fn of this.#listeners) fn(e);
  }

  status(): AgentStatus {
    return {
      running: this.running,
      live: this.cfg.live,
      reviewMode: this.cfg.reviewMode,
      tickDelayMs: this.cfg.tickDelayMs,
      stage: this.stage,
      tick: this.#n,
      backend: this.backend,
      backends: this.cfg.mockModel
        ? [{ name: "mock", label: "mock model", url: "" }]
        : (["cloud", "local"] as const).map((name) => ({ name, label: this.cfg.backends[name].label, url: this.cfg.backends[name].baseUrl })),
      model: this.model,
      game: this.game.name,
      gates: this.cfg.gates,
      awaitingHuman: this.awaitingHuman,
      screen: this.cfg.screenshots,
      message: this.message,
    };
  }

  #emitStatus() {
    this.#emit({ type: "status", data: this.status() });
  }

  #setStage(n: number, stage: Stage) {
    this.stage = stage;
    this.#emit({ type: "stage", data: { n, stage, at: Date.now() } });
  }

  // -------------------------------------------------------------------------------------------
  // Controls
  // -------------------------------------------------------------------------------------------

  run() {
    this.running = true;
    this.awaitingHuman = false;
    this.message = undefined;
    this.#emitStatus();
    void this.#loop();
  }

  pause(message?: string) {
    this.running = false;
    if (message) this.message = message;
    this.#emitStatus();
  }

  async step() {
    if (this.#busy) return;
    this.awaitingHuman = false;
    await this.#safeTick();
    this.#emitStatus();
  }

  set(patch: { live?: boolean; reviewMode?: ReviewMode; tickDelayMs?: number; screenshots?: boolean; backend?: BackendName }) {
    if (patch.live !== undefined) this.cfg.live = patch.live;
    if (patch.screenshots !== undefined && !this.cfg.sim) this.cfg.screenshots = patch.screenshots;
    if (patch.reviewMode) this.cfg.reviewMode = patch.reviewMode;
    if (patch.tickDelayMs !== undefined) this.cfg.tickDelayMs = Math.max(0, patch.tickDelayMs);
    if (patch.backend && patch.backend in this.cfg.backends && !this.cfg.mockModel) {
      this.cfg.backend = patch.backend;
      this.message = undefined;
      void this.#checkBackend(patch.backend);
    }
    this.#emitStatus();
  }

  /** Say so right away when the chosen backend is not answering, instead of on the next decision. */
  async #checkBackend(name: BackendName) {
    const url = this.cfg.backends[name].baseUrl;
    try {
      const res = await fetch(`${url}/${name === "local" ? "health" : "v1/models"}`, {
        headers: name === "cloud" ? { Authorization: `Bearer ${this.cfg.backends.cloud.apiKey}` } : {},
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      if (this.cfg.backend !== name) return;
      this.message = `${this.cfg.backends[name].label} at ${url} is not answering (${(e as Error).message}). Decisions fall back to the heuristic until it does.`;
      this.#emitStatus();
    }
  }

  /** Execute a candidate from the latest tick by hand (the human override). */
  async override(candidateId: string) {
    if (this.#busy || this.running) throw new Error("pause the agent before overriding");
    const last = this.ticks[this.ticks.length - 1];
    const cand = last?.candidates.find((c) => c.id === candidateId) ?? (last?.auto?.id === candidateId ? last.auto : undefined);
    if (!last || !cand) throw new Error(`no candidate ${candidateId} on the latest tick`);
    this.#busy = true;
    try {
      const n = ++this.#n;
      const t0 = performance.now();
      const rec: TickRecord = {
        ...last,
        n,
        at: Date.now(),
        request: undefined,
        response: undefined,
        verdict: { status: "ACT", pick: null, chosen: cand.id, source: "human", reason: "picked by hand in the visualizer" },
        timings: { observe: 0, extract: 0, ask: 0, act: 0, total: 0 },
      };
      await this.#act(rec, cand);
      rec.timings.total = performance.now() - t0;
      this.#finish(rec, undefined);
      this.awaitingHuman = false;
    } finally {
      this.#busy = false;
      this.#setStage(this.#n, "idle");
      this.#emitStatus();
    }
  }

  startScreenLoop() {
    if (this.cfg.sim || this.#screenTimer) return;
    this.#screenTimer = setInterval(() => {
      if (this.#busy || !this.cfg.screenshots) return;
      if (this.#screenBackoff > 0) {
        this.#screenBackoff--;
        return;
      }
      void this.#screenshot();
    }, this.cfg.screenIntervalMs);
  }

  stopScreenLoop() {
    if (this.#screenTimer) clearInterval(this.#screenTimer);
    this.#screenTimer = undefined;
  }

  async #screenshot() {
    try {
      await this.game.call("screenshot", { path: this.cfg.screenPath });
      this.screenAt = Date.now();
      this.#emit({ type: "screen", data: { at: this.screenAt } });
    } catch {
      this.#screenBackoff = 5;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Loop
  // -------------------------------------------------------------------------------------------

  async #loop() {
    if (this.#looping) return;
    this.#looping = true;
    let failures = 0;
    try {
      while (this.running) {
        const rec = await this.#safeTick();
        if (!rec) {
          if (++failures >= 3) this.pause(this.message);
        } else {
          failures = rec.error ? failures + 1 : 0;
          if (failures >= 3) this.pause(`stopped after 3 failing ticks: ${rec.error}`);
          else if (rec.phase === "GAME_OVER") this.pause(rec.note);
          else if (rec.verdict.status === "IDLE") this.pause(rec.note ?? rec.verdict.reason);
          else if (this.awaitingHuman) this.pause("gates failed: pick an action by hand, or change the review mode");
          else if (!this.cfg.live && rec.verdict.chosen) this.pause("dry-run: decided without sending; switch to live to keep playing");
        }
        if (this.running) await sleep(this.cfg.tickDelayMs);
      }
    } finally {
      this.#looping = false;
      this.#emitStatus();
    }
  }

  async #safeTick(): Promise<TickRecord | undefined> {
    if (this.#busy) return undefined;
    this.#busy = true;
    try {
      return await this.#tick();
    } catch (e) {
      this.message = (e as Error).message;
      this.#emitStatus();
      return undefined;
    } finally {
      this.#busy = false;
      this.#setStage(this.#n, "idle");
    }
  }

  async #observe(n: number): Promise<{ raw: GameState; snap: Snapshot }> {
    this.#setStage(n, "observe");
    let raw = await this.game.call<GameState>("gamestate");
    let snap = extract(raw);
    for (let i = 0; !snap.settled && i < 15; i++) {
      await sleep(200);
      raw = await this.game.call<GameState>("gamestate");
      snap = extract(raw);
    }
    return { raw, snap };
  }

  async #tick(): Promise<TickRecord> {
    const n = ++this.#n;
    const t0 = performance.now();
    const { raw, snap } = await this.#observe(n);
    const t1 = performance.now();

    this.#setStage(n, "extract");
    const set: CandidateSet = buildCandidates(snap, { autoStart: this.cfg.autoStart, endless: this.cfg.endless, maxOptions: 24 });
    const t2 = performance.now();

    const rec: TickRecord = {
      n,
      at: Date.now(),
      phase: snap.phase,
      snapshot: snap,
      candidates: set.candidates,
      auto: set.auto,
      note: set.note,
      verdict: { status: "IDLE", pick: null, source: "none", reason: "" },
      timings: { observe: t1 - t0, extract: t2 - t1, ask: 0, act: 0, total: 0 },
    };

    if (!set.auto && set.candidates.length > 1) {
      this.#setStage(n, "ask");
      const { request, hints } = buildRequest(snap, set, this.model);
      rec.request = request;
      try {
        rec.response = await this.engine.ask(request, hints);
      } catch (e) {
        rec.error = `model: ${(e as Error).message}`;
      }
    }
    const t3 = performance.now();
    rec.timings.ask = t3 - t2;

    this.#setStage(n, "gate");
    rec.verdict = applyPolicy(rec.response?.answers.action as ChoiceAnswer | undefined, set, this.cfg.gates, this.cfg.reviewMode);
    this.awaitingHuman = !rec.verdict.chosen && set.candidates.length > 0;

    const cand = rec.verdict.chosen ? (set.auto?.id === rec.verdict.chosen ? set.auto : set.candidates.find((c) => c.id === rec.verdict.chosen)) : undefined;
    if (cand) await this.#act(rec, cand);
    rec.timings.total = performance.now() - t0;
    this.#finish(rec, raw);
    return rec;
  }

  async #act(rec: TickRecord, cand: Candidate) {
    this.#setStage(rec.n, "act");
    rec.call = cand.call;
    const t = performance.now();
    if (!this.cfg.live) {
      rec.result = { ok: true, dryRun: true, ms: 0 };
      return;
    }
    try {
      await this.game.call(cand.call.method, cand.call.params);
      rec.result = { ok: true, ms: performance.now() - t };
    } catch (e) {
      rec.result = { ok: false, error: (e as Error).message, ms: performance.now() - t };
      rec.error = `game: ${(e as Error).message}`;
    }
    rec.timings.act = performance.now() - t;
    if (this.cfg.screenshots) await this.#screenshot();
  }

  #finish(rec: TickRecord, raw: GameState | undefined) {
    this.ticks.push(rec);
    if (this.ticks.length > HISTORY) this.ticks.splice(0, this.ticks.length - HISTORY);
    try {
      appendFileSync(this.#logFile, JSON.stringify({ ...rec, raw }) + "\n");
    } catch {
      // Logging must never stop play.
    }
    this.#emit({ type: "tick", data: rec });
  }
}
