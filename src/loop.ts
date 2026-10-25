// The agent loop: observe -> extract -> ask -> gate -> act, one tick per game decision.
// Every stage is broadcast so the visualizer can light up the loop live, and every tick is
// appended to runs/*.jsonl (with the raw gamestate) for evaluation and feature discovery later.

import { appendFileSync, closeSync, mkdirSync, openSync, readdirSync, readSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Game } from "./blinddeck.ts";
import { profileBuild } from "./build.ts";
import type { Assessment } from "./assess.ts";
import { buildCandidates, type Branch, type Candidate, type CandidateSet, type RpcCall, type SimTrace } from "./candidates.ts";
import type { BackendName, Config } from "./config.ts";
import { directionOf, type Direction } from "./direction.ts";
import { extract, type Snapshot } from "./extract.ts";
import { loadExpertPriors, type ExpertPriors } from "./expert.ts";
import { PRESETS, applyPreset, currentPreset, type PresetId } from "./features.ts";
import { applyBuildAnswer, buildOptions, isLocked, planView, updatePlan, type Pivot, type Plan, type PlanView } from "./plan.ts";
import { applyPolicy, type ReviewMode, type Verdict } from "./policy.ts";
import { type RecordedRun, replaySteps, stateDiff } from "./runs.ts";
import { buildRequest } from "./strategy.ts";
import { useProfile } from "./tuning.ts";
import type { ChoiceAnswer, Engine, SystemOneRequest, SystemOneResponse } from "./systemone.ts";
import type { GameState } from "./types.ts";

export type Stage = "observe" | "extract" | "ask" | "gate" | "act" | "idle";

/** A candidate's calls as one string, to recognise the same move again. */
const callKey = (c: Candidate) => JSON.stringify(c.calls ?? [c.call]);

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
  /** The cards worth looking for, from the jokers built around and the committed build (or Neutral). */
  direction?: Direction;
  /** The long view of the run: the simulated chance of beating the next three bosses, smoothed over shop visits. */
  prospect?: Prospect;
}

export interface Prospect {
  /** 0-1: the simulated chance of beating the next three bosses, the nearest weighted most, averaged over recent shops. */
  value: number;
  level: "Losing" | "Fragile" | "On pace" | "Dominant";
  /** This shop's reading before smoothing, and the bosses it covers. */
  latest: number;
  horizon: string;
}

/** Prospect levels by the smoothed, weighted chance of beating the next bosses. */
const prospectLevel = (v: number): Prospect["level"] => (v < 0.25 ? "Losing" : v < 0.5 ? "Fragile" : v < 0.8 ? "On pace" : "Dominant");
/** This ante's boss counts most; the bosses after it say whether the build keeps up. */
const BOSS_WEIGHTS = [0.5, 0.35, 0.15];

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
  /** The loop preset in use, and the ones the dashboard can pick from. */
  preset: PresetId;
  presets: { id: PresetId; label: string; describe: string }[];
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
  /** The run's direction as last read where the plan is live. */
  #direction?: Direction & { seed?: string };
  /** The long view, updated once per shop visit (see Prospect). */
  #prospect?: Prospect & { seed?: string; visit?: string };
  /** Calls the game refused at `#refusedAt` (the same state, by its key numbers). */
  #refused = new Set<string>();
  #refusedAt = "";
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
    this.#logFile = this.#newLog();
  }

  #newLog(): string {
    const file = join(this.cfg.logDir, `run-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
    if ((this.cfg.keepRuns ?? 0) > 0) pruneRuns(this.cfg.logDir, this.cfg.keepRuns! - 1);
    return file;
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
      preset: currentPreset(),
      presets: PRESETS.map(({ id, label, describe }) => ({ id, label, describe })),
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

  set(patch: { live?: boolean; reviewMode?: ReviewMode; tickDelayMs?: number; screenshots?: boolean; backend?: BackendName; preset?: PresetId }) {
    if (patch.preset && PRESETS.some((p) => p.id === patch.preset)) {
      const preset = applyPreset(patch.preset);
      this.expert = preset.expert ? loadExpertPriors() : undefined;
    }
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
            // One log file per run: a night of continuous play would otherwise be one file too big
            // to read back.
            this.#logFile = this.#newLog();
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
    // The numbers for this deck and stake (src/tuning.ts PROFILES), before anything is valued.
    useProfile(snap.deck, snap.stake);
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
    // A move the game refused in this same spot is not offered again: retrying it would loop.
    const spot = `${snap.seed}:${snap.phase}:${snap.ante}:${snap.round}:${snap.money}:${snap.hand.length}:${snap.jokers.length}:${snap.consumables.length}`;
    if (spot !== this.#refusedAt) [this.#refusedAt, this.#refused] = [spot, new Set()];
    if (this.#refused.size) {
      const kept = set.candidates.filter((c) => !this.#refused.has(callKey(c)));
      if (kept.length) set.candidates = kept;
      if (set.auto && this.#refused.has(callKey(set.auto))) set.auto = undefined;
    }
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
    // Macro view: the direction from the jokers held and the committed build, and the long-term
    // prospect, which moves once per shop visit and is averaged so one bad hand doesn't swing it.
    // Read where the plan is live; between those (cash out, menus) the last reading stands.
    if (this.#direction && this.#direction.seed !== snap.seed) this.#direction = undefined;
    if (profile && this.plan) this.#direction = { ...directionOf(snap, { name: this.plan.build, backers: profile.jokers.filter((r) => r.fits).length }), seed: snap.seed };
    if (this.#direction) {
      const { seed: _, ...direction } = this.#direction;
      rec.direction = direction;
    }
    if (this.#prospect && this.#prospect.seed !== snap.seed) this.#prospect = undefined;
    const bosses = set.assessment?.outlook.bosses;
    const visitKey = `${snap.seed}:${snap.ante}:${snap.round}`;
    if (snap.phase === "SHOP" && bosses?.length && this.#prospect?.visit !== visitKey) {
      const w = BOSS_WEIGHTS.slice(0, bosses.length);
      const latest = bosses.reduce((a, b, i) => a + (w[i] ?? 0) * b.odds, 0) / w.reduce((a, b) => a + b, 0);
      const value = this.#prospect ? 0.65 * this.#prospect.value + 0.35 * latest : latest;
      this.#prospect = { value, latest, level: prospectLevel(value), horizon: `bosses of antes ${bosses[0].ante}-${bosses[bosses.length - 1].ante}`, seed: snap.seed, visit: visitKey };
    }
    if (this.#prospect) rec.prospect = { value: this.#prospect.value, level: this.#prospect.level, latest: this.#prospect.latest, horizon: this.#prospect.horizon };
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
      this.#refused.add(callKey(cand));
    }
    rec.timings.act = performance.now() - t;
    // A fresh picture after the move, unless taking it would stall a running game.
    if (this.cfg.screenshots && (this.screenLive || !this.running)) await this.#screenshot();
  }

  #finish(rec: TickRecord, raw: GameState | undefined, log = true) {
    this.ticks.push(rec);
    if (this.ticks.length > HISTORY) this.ticks.splice(0, this.ticks.length - HISTORY);
    if (log && !this.cfg.noLog) {
      try {
        appendFileSync(this.#logFile, JSON.stringify({ ...rec, game: this.cfg.sim ? "simulator" : "blinddeck", raw }) + "\n");
      } catch {
        // Logging must never stop play.
      }
    }
    this.#emit({ type: "tick", data: rec });
  }
}

/**
 * Deletes simulator recordings in `dir` past the newest `keep` (a new one is about to start).
 * A recording's first tick names its game; real-game recordings, and files it can't read, stay.
 */
export function pruneRuns(dir: string, keep: number): void {
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => /^run-[\w-]+\.jsonl$/.test(f)).sort().reverse();
  } catch {
    return;
  }
  const head = (path: string) => {
    const fd = openSync(path, "r");
    try {
      const buf = Buffer.alloc(65536);
      return buf.toString("utf8", 0, readSync(fd, buf, 0, buf.length, 0));
    } finally {
      closeSync(fd);
    }
  };
  let kept = 0;
  for (const f of files) {
    const path = join(dir, f);
    try {
      const first = head(path);
      // The game field sits after the tick's large fields, so an empty or cut-short first line
      // (a run still starting) counts as a simulator one only when it says so.
      if (!first.includes('"game":"simulator"') && !/"seed":"SIM\d+"/.test(first)) continue;
      if (kept++ < keep) continue;
      rmSync(path, { force: true });
    } catch {
      // Logging must never stop play.
    }
  }
}
