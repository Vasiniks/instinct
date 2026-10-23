// The agent loop: observe -> extract -> ask -> gate -> act, one tick per game decision.
// Every stage is broadcast so the visualizer can light up the loop live, and every tick is
// appended to runs/*.jsonl (with the raw gamestate) for evaluation and feature discovery later.

import { appendFileSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Game } from "./blinddeck.ts";
import { profileBuild } from "./build.ts";
import type { Assessment } from "./assess.ts";
import { buildCandidates, type Branch, type Candidate, type CandidateSet, type RpcCall, type SimTrace } from "./candidates.ts";
import type { BackendName, Config } from "./config.ts";
import { extract, type Snapshot } from "./extract.ts";
import { loadExpertPriors, type ExpertPriors } from "./expert.ts";
import { applyBuildAnswer, buildOptions, isLocked, planView, updatePlan, type Pivot, type Plan, type PlanView } from "./plan.ts";
import { applyPolicy, type ReviewMode, type Verdict } from "./policy.ts";
import { type RecordedRun, replaySteps, stateDiff } from "./runs.ts";
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
  /** Set on ticks re-sent from a recording: the run and the tick they reproduce. */
  replayOf?: { run: string; n: number };
  /** Every game call the move took, when it took more than one (a swap: sell, then buy). */
  calls?: RpcCall[];
  /** The build plan as it stood after this tick. */
  plan?: PlanView;
  /** Set on the tick where the plan switched builds. */
  pivot?: Pivot;
  /** What the simulation stage ran for this decision. */
  sim?: SimTrace;
  /** The assess stage's reading and the decision tree's forks for this decision. */
  assessment?: Assessment;
  path?: Branch[];
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
  /** Screenshots don't stall the game, so they keep coming while the agent plays. */
  screenLive: boolean;
  /** A recorded run being re-played on the game. */
  replay?: { id: string; seed: string; step: number; total: number };
  message?: string;
}

export type AgentEvent =
  | { type: "status"; data: AgentStatus }
  | { type: "stage"; data: { n: number; stage: Stage; at: number } }
  | { type: "tick"; data: TickRecord }
  | { type: "screen"; data: { at: number } };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const HISTORY = 400;
/** Picture refresh while screenshots are encoded off the game's main thread. */
const SCREEN_LIVE_MS = 300;
/** Phases where the build plan matters; menus and cash-outs skip the profile. */
const PLANNED_PHASES = new Set(["BLIND_SELECT", "SELECTING_HAND", "SHOP", "SMODS_BOOSTER_OPENED"]);

export class Agent {
  game: Game;
  /** Decision engines by backend name; the mock engine is keyed "mock". */
  engines: Record<string, Engine>;
  cfg: Config;
  ticks: TickRecord[] = [];
  /** The build the run is committed to; reset when the seed changes. */
  plan?: Plan;
  /** How an expert treated each joker, from the Roffle dataset; absent when off or not built. */
  expert?: ExpertPriors;
  stage: Stage = "idle";
  running = false;
  awaitingHuman = false;
  message?: string;
  screenAt = 0;
  replaying?: AgentStatus["replay"];
  /** The game encodes screenshots off its main thread, so they can run during play. */
  screenLive = false;
  #stopReplay = false;
  /** The shop visit or pack the build question was last asked for; it is asked once per visit. */
  #buildAsked?: string;
  #bossesSeed?: string;
  #bossesSeen = new Set<string>();
  #lastShot = 0;
  #screenMtime = 0;
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
    this.expert = cfg.expert ? loadExpertPriors() : undefined;
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
      screenLive: this.screenLive,
      replay: this.replaying,
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
    this.#stopReplay = true;
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

  /**
   * Re-play a recorded run on the game: start it again from its seed, then send the recorded calls
   * in order. Before each call the live state is checked against the recording; the first
   * difference stops the replay. Replays ignore the Live switch and are not logged as new runs.
   */
  async replay(run: RecordedRun) {
    if (this.#busy || this.running || this.replaying) throw new Error("pause the agent before replaying");
    if (run.meta.game !== (this.cfg.sim ? "simulator" : "blinddeck")) throw new Error(`that run was recorded on the ${run.meta.game}`);
    const steps = replaySteps(run);
    const { seed, deck, stake } = run.meta;
    this.replaying = { id: run.meta.id, seed, step: 0, total: steps.length };
    this.#stopReplay = false;
    this.awaitingHuman = false;
    this.message = undefined;
    this.#busy = true;
    this.#emitStatus();
    try {
      if ((await this.game.call<GameState>("gamestate")).state !== "MENU") await this.game.call("menu");
      await this.game.call("start", { deck, stake, seed });
      for (const [i, step] of steps.entries()) {
        if (this.#stopReplay) {
          this.message = `Replay stopped after ${i} of ${steps.length} actions.`;
          break;
        }
        const n = ++this.#n;
        const t0 = performance.now();
        const { snap } = await this.#observe(n);
        const diff = stateDiff(step.snapshot, snap);
        if (diff) {
          this.message = `Replay diverged before recorded tick ${step.n}: ${diff}.`;
          break;
        }
        const rec: TickRecord = { ...step, n, at: Date.now(), snapshot: snap, error: undefined, replayOf: { run: run.meta.id, n: step.n } };
        this.#setStage(n, "act");
        const t1 = performance.now();
        try {
          for (const call of step.calls ?? [step.call!]) await this.game.call(call.method, call.params);
          rec.result = { ok: true, ms: performance.now() - t1 };
        } catch (e) {
          rec.result = { ok: false, error: (e as Error).message, ms: performance.now() - t1 };
          this.message = `Replay failed at recorded tick ${step.n}: ${(e as Error).message}`;
        }
        rec.timings = { ...step.timings, observe: t1 - t0, act: performance.now() - t1, total: performance.now() - t0 };
        this.#finish(rec, undefined, false);
        this.replaying.step = i + 1;
        this.#emitStatus();
        if (!rec.result.ok) break;
        await sleep(this.cfg.tickDelayMs);
      }
      this.message ??= `Replay finished: all ${steps.length} actions matched the recording.`;
    } catch (e) {
      this.message = `Replay failed: ${(e as Error).message}`;
    } finally {
      this.#busy = false;
      this.replaying = undefined;
      this.#setStage(this.#n, "idle");
      this.#emitStatus();
    }
  }

  /**
   * Stock BlindDeck encodes each screenshot as a full-resolution PNG on the game's main thread,
   * freezing the game for about 0.2 s on a Retina window, so then screenshots only run while the
   * agent is paused. The patched mod (`async: true`) encodes on a background thread instead; then
   * the picture refreshes every SCREEN_LIVE_MS even mid-run, with no stall. The file is watched,
   * so the picture updates when the frame is actually written.
   */
  startScreenLoop() {
    if (this.cfg.sim || this.#screenTimer) return;
    this.#screenTimer = setInterval(() => {
      this.#checkScreenFile();
      if (!this.cfg.screenshots) return;
      const since = Date.now() - this.#lastShot;
      if (this.screenLive) {
        if (since < SCREEN_LIVE_MS) return;
      } else if (this.#busy || this.running || this.replaying || since < this.cfg.screenIntervalMs) return;
      if (this.#screenBackoff > 0) {
        this.#screenBackoff--;
        return;
      }
      void this.#screenshot();
    }, 100);
  }

  stopScreenLoop() {
    if (this.#screenTimer) clearInterval(this.#screenTimer);
    this.#screenTimer = undefined;
  }

  async #screenshot() {
    this.#lastShot = Date.now();
    try {
      const r = await this.game.call<{ async?: boolean }>("screenshot", { path: this.cfg.screenPath, async: true });
      if (Boolean(r?.async) !== this.screenLive) {
        this.screenLive = Boolean(r?.async);
        this.#emitStatus();
      }
      this.#checkScreenFile();
    } catch {
      this.#screenBackoff = 20;
    }
  }

  #checkScreenFile() {
    try {
      const m = statSync(this.cfg.screenPath).mtimeMs;
      if (m <= this.#screenMtime) return;
      this.#screenMtime = m;
      this.screenAt = Date.now();
      this.#emit({ type: "screen", data: { at: this.screenAt } });
    } catch {
      // No frame written yet.
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
          else if (rec.phase === "GAME_OVER" && this.cfg.continuous && this.cfg.autoStart && this.cfg.live) {
            // Keep playing: back to the menu, where the auto-start begins the next run.
            this.message = `${rec.note}; starting the next run`;
            await this.game.call("menu").catch(() => undefined);
          } else if (rec.phase === "GAME_OVER") this.pause(rec.note);
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
    // The plan carries the build across ticks; the profile reads this snapshot against it.
    const planned = PLANNED_PHASES.has(snap.phase);
    let profile = planned ? profileBuild(snap, this.plan?.seed === snap.seed ? this.plan?.build : undefined) : undefined;
    const before = this.plan;
    if (profile) {
      this.plan = updatePlan(this.plan, snap, profile);
      if (this.plan.build !== profile.primary.name) profile = profileBuild(snap, this.plan.build);
    }
    // Bosses met this run, for the boss pool when the game doesn't report the ones it has drawn.
    if (snap.seed !== this.#bossesSeed) [this.#bossesSeed, this.#bossesSeen] = [snap.seed, new Set()];
    for (const b of snap.blinds) if (b.type === "BOSS" && b.name) this.#bossesSeen.add(b.name);
    const set: CandidateSet = buildCandidates(snap, { autoStart: this.cfg.autoStart, endless: this.cfg.endless, maxOptions: 24, plan: this.plan, profile, expert: this.expert, bossesSeen: [...this.#bossesSeen] });
    const visit =
      snap.phase === "SHOP"
        ? `shop:${snap.seed}:${snap.ante}:${snap.round}`
        : snap.phase === "SMODS_BOOSTER_OPENED" && snap.pack.some((i) => i.set === "JOKER")
          ? `pack:${snap.seed}:${snap.ante}:${snap.round}:${snap.pack.map((i) => i.key).join(",")}`
          : undefined;
    const askBuild = Boolean(profile && this.plan && visit && visit !== this.#buildAsked && !isLocked(this.plan, snap) && !this.plan.pending);
    const options = askBuild ? buildOptions(this.plan!, profile!) : [];
    if (options.length > 1) this.#buildAsked = visit;
    const t2 = performance.now();

    const rec: TickRecord = {
      n,
      at: Date.now(),
      phase: snap.phase,
      snapshot: snap,
      candidates: set.candidates,
      auto: set.auto,
      note: set.note,
      sim: set.sim,
      assessment: set.assessment,
      path: set.path,
      verdict: { status: "IDLE", pick: null, source: "none", reason: "" },
      timings: { observe: t1 - t0, extract: t2 - t1, ask: 0, act: 0, total: 0 },
    };

    if (!set.auto && set.candidates.length > 1) {
      this.#setStage(n, "ask");
      const { request, hints } = buildRequest(snap, set, this.model, { plan: this.plan, profile, buildOptions: options });
      rec.request = request;
      try {
        rec.response = await this.engine.ask(request, hints);
      } catch (e) {
        rec.error = `model: ${(e as Error).message}`;
      }
    }
    const t3 = performance.now();
    rec.timings.ask = t3 - t2;

    // The model may pivot the build at a shop or joker pack; it takes effect from the next tick.
    if (this.plan && options.length > 1) this.plan = applyBuildAnswer(this.plan, snap, rec.response?.answers.build as ChoiceAnswer | undefined, options);
    if (this.plan && profile) {
      rec.plan = planView(this.plan, profile, snap);
      const last = this.plan.pivots[this.plan.pivots.length - 1];
      const earlier = before && before.seed === this.plan.seed ? before.pivots.length : 0;
      if (last && this.plan.pivots.length > earlier) rec.pivot = last;
    }

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
    if (cand.calls) rec.calls = cand.calls;
    const t = performance.now();
    if (!this.cfg.live) {
      rec.result = { ok: true, dryRun: true, ms: 0 };
      return;
    }
    try {
      // A swap is two calls (sell, then buy); a failure part way stops the rest.
      for (const call of cand.calls ?? [cand.call]) await this.game.call(call.method, call.params);
      rec.result = { ok: true, ms: performance.now() - t };
    } catch (e) {
      rec.result = { ok: false, error: (e as Error).message, ms: performance.now() - t };
      rec.error = `game: ${(e as Error).message}`;
    }
    rec.timings.act = performance.now() - t;
    // A fresh picture after the move, unless taking it would stall a running game.
    if (this.cfg.screenshots && (this.screenLive || !this.running)) await this.#screenshot();
  }

  #finish(rec: TickRecord, raw: GameState | undefined, log = true) {
    this.ticks.push(rec);
    if (this.ticks.length > HISTORY) this.ticks.splice(0, this.ticks.length - HISTORY);
    if (log) {
      try {
        appendFileSync(this.#logFile, JSON.stringify({ ...rec, game: this.cfg.sim ? "simulator" : "blinddeck", raw }) + "\n");
      } catch {
        // Logging must never stop play.
      }
    }
    this.#emit({ type: "tick", data: rec });
  }
}
