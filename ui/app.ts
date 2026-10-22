// Visualizer: the real Balatro window in the middle, values / calls / reply probabilities on the
// right, the observe -> extract -> ask -> gate -> act loop and the tick timeline along the bottom.

import type { AgentStatus, Stage, TickRecord } from "../src/loop.ts";
import type { ChoiceAnswer, NoulAnswer, ScoreAnswer } from "../src/systemone.ts";
import { DecisionBars, levels, meter, sparkline, type BarRow } from "./charts.ts";
import { h, mount, ms, pct, withTip } from "./dom.ts";

const STAGES: { id: Stage; name: string; does: string }[] = [
  { id: "observe", name: "Observe", does: "BlindDeck gamestate" },
  { id: "extract", name: "Extract", does: "snapshot + legal options" },
  { id: "ask", name: "Ask", does: "System One judgments" },
  { id: "gate", name: "Gate", does: "confidence + none-of-above" },
  { id: "act", name: "Act", does: "BlindDeck call" },
];

const STATUS_ICON: Record<string, string> = { ACT: "✓", REVIEW: "?", ABSTAIN: "∅", AUTO: "•", IDLE: "–", ERROR: "!" };
const STATUS_TEXT: Record<string, string> = { ACT: "Acted on the model", REVIEW: "Review", ABSTAIN: "Abstained", AUTO: "Automatic", IDLE: "Idle", ERROR: "Error" };
const SOURCE_TEXT: Record<string, string> = { model: "the model's pick", fallback: "the heuristic fallback", auto: "a forced step", human: "your pick", none: "nothing" };
const RISK_LABEL: Record<string, string> = { SELECTING_HAND: "Blind looks out of reach", SHOP: "Should save money", BLIND_SELECT: "Safe to skip this blind" };
const POSITION_SHORT = ["Losing", "Fragile", "On pace", "Dominant"];

const app = {
  status: undefined as AgentStatus | undefined,
  ticks: [] as TickRecord[],
  live: { n: 0, stage: "idle" as Stage },
  pinned: null as number | null,
  screenAt: 0,
  /** Live capture of the Balatro window (browser screen-share), when the user embedded it. */
  stream: null as MediaStream | null,
  connected: false,
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const bars = new DecisionBars((id) => void control({ cmd: "override", id }));
$("reply-bars").replaceWith(bars.el);

const current = (): TickRecord | undefined => (app.pinned !== null ? app.ticks.find((t) => t.n === app.pinned) : app.ticks[app.ticks.length - 1]);

async function control(body: Record<string, unknown>) {
  try {
    const res = await fetch("/api/control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    // Status comes back over SSE; the reply here can be older than an event that already arrived.
    if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
  } catch (e) {
    flash((e as Error).message);
  }
  renderTop();
}

function flash(message: string) {
  const el = $("message");
  el.textContent = message;
  el.hidden = false;
}

// ---------------------------------------------------------------------------------------------
// Top bar
// ---------------------------------------------------------------------------------------------

function renderTop() {
  const s = app.status;
  const last = app.ticks[app.ticks.length - 1];
  const served = [...app.ticks].reverse().find((t) => t.response)?.response?.model;
  $("conn").className = `conn ${app.connected ? "on" : "off"}`;
  $("conn").textContent = app.connected ? "connected" : "reconnecting";
  const label = s?.backends.find((b) => b.name === s.backend)?.label ?? s?.backend;
  $("backend").textContent = s ? `${label} · ${served ? `last answer from ${served}` : `asks ${s.model}`}` : "";
  $("game").textContent = s?.game ?? "";
  renderModelSwitch(s);
  const run = $<HTMLButtonElement>("btn-run");
  run.textContent = s?.running ? "Pause" : "Run";
  run.setAttribute("aria-pressed", String(Boolean(s?.running)));
  $<HTMLButtonElement>("btn-step").disabled = Boolean(s?.running);
  $<HTMLInputElement>("live").checked = Boolean(s?.live);
  $("live-label").textContent = s?.live ? "Live: sending actions" : "Dry run: nothing is sent";
  $("live-wrap").classList.toggle("is-live", Boolean(s?.live));
  if (s) $<HTMLSelectElement>("review").value = s.reviewMode;
  if (s && document.activeElement !== $("delay")) $<HTMLInputElement>("delay").value = String(s.tickDelayMs);
  $("delay-value").textContent = `${s?.tickDelayMs ?? 0} ms`;
  const atMenu = last?.phase === "MENU" || last?.phase === "GAME_OVER";
  $("start").hidden = !atMenu;
  const msg = s?.awaitingHuman ? "Gates failed. Pick an action in Reply probabilities, or change “When gates fail”." : s?.message;
  $("message").hidden = !msg;
  $("message").textContent = msg ?? "";
}

/** Cloud Jev / local StartLux. Takes effect on the next decision; the run keeps going. */
function renderModelSwitch(s: AgentStatus | undefined) {
  const wrap = $("model-wrap");
  const list = s?.backends ?? [];
  wrap.hidden = list.length < 2;
  if (wrap.hidden) return;
  const seg = $("model-switch");
  if (seg.dataset.names !== list.map((b) => b.name).join()) {
    seg.dataset.names = list.map((b) => b.name).join();
    mount(
      seg,
      list.map((b) =>
        h(
          "label",
          { title: b.url },
          h("input", { type: "radio", name: "backend", value: b.name, onchange: () => control({ cmd: "set", backend: b.name }) }),
          h("span", null, b.label[0].toUpperCase() + b.label.slice(1)),
        ),
      ),
    );
  }
  for (const input of seg.querySelectorAll<HTMLInputElement>("input")) input.checked = input.value === s?.backend;
}

// ---------------------------------------------------------------------------------------------
// Center: the real game window, scaled into the frame. Two sources:
//   1. "Embed Balatro window": the browser captures the window itself (live, full frame rate).
//   2. Otherwise BlindDeck screenshots of the game, refreshed after every action and on a timer.
// ---------------------------------------------------------------------------------------------

function caption(t: TickRecord | undefined): string {
  if (!t) return "";
  const id = t.verdict.chosen;
  const c = id ? (t.auto?.id === id ? t.auto : t.candidates.find((x) => x.id === id)) : undefined;
  const prefix = app.pinned !== null ? `Tick ${t.n}. ` : "";
  if (!c) return prefix + (t.note ?? t.verdict.reason);
  return `${prefix}${t.result?.dryRun ? "Would send" : "Sent"}: ${c.label}`;
}

function renderCenter() {
  const live = Boolean(app.stream);
  const shot = !live && app.screenAt > 0;
  const sim = app.status?.game === "simulator";
  $("live-video").hidden = !live;
  const img = document.getElementById("screen-img");
  if (img) img.hidden = !shot;
  $("frame-empty").hidden = live || shot;
  $("embed").textContent = live ? "Stop embedding" : "Embed Balatro window";
  $("screen-source").textContent = live
    ? "Live capture of the Balatro window"
    : shot
      ? `BlindDeck screenshots, updated ${new Date(app.screenAt).toLocaleTimeString()}`
      : "";
  $("frame-empty-title").textContent = sim ? "The simulator has no game window" : "No game window yet";
  $("frame-empty-text").textContent = sim
    ? "This run plays the built-in simulator. Start without --sim to drive the real game."
    : "Launch Balatro through Balala so BlindDeck loads. Screenshots from the game appear here on their own once it answers; for a live picture, press Embed Balatro window and pick the Balatro window.";
  $("caption").textContent = caption(current());
}

function refreshScreen() {
  // Created on the first capture so there is never an empty <img>.
  let img = document.getElementById("screen-img") as HTMLImageElement | null;
  if (!img) {
    img = h("img", { id: "screen-img", alt: "Balatro, captured through BlindDeck" });
    $("frame").append(img);
  }
  img.src = `/screen.png?t=${app.screenAt}`;
  renderCenter();
}

async function toggleEmbed() {
  if (app.stream) return stopEmbed();
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: "window", frameRate: { ideal: 30 } },
      audio: false,
      // Chrome-only hints: keep this tab out of the picker, offer windows first.
      ...({ selfBrowserSurface: "exclude", preferCurrentTab: false } as Record<string, unknown>),
    } as DisplayMediaStreamOptions);
    app.stream = stream;
    $<HTMLVideoElement>("live-video").srcObject = stream;
    stream.getVideoTracks()[0]?.addEventListener("ended", stopEmbed);
    // The live picture replaces screenshots, which cost the game a frame each.
    void control({ cmd: "set", screenshots: false });
  } catch (e) {
    if ((e as DOMException).name !== "NotAllowedError") flash(`Could not embed the window: ${(e as Error).message}`);
  }
  renderCenter();
}

function stopEmbed() {
  for (const track of app.stream?.getTracks() ?? []) track.stop();
  app.stream = null;
  $<HTMLVideoElement>("live-video").srcObject = null;
  void control({ cmd: "set", screenshots: true });
  renderCenter();
}

// ---------------------------------------------------------------------------------------------
// Right column
// ---------------------------------------------------------------------------------------------

function renderValues(t: TickRecord | undefined) {
  const pos = t?.response?.answers.position as ScoreAnswer | undefined;
  const risk = t?.response?.answers.risk as NoulAnswer | undefined;
  const points = app.ticks
    .filter((x) => x.response?.answers.position && (app.pinned === null || x.n <= app.pinned))
    .slice(-60)
    .map((x) => {
      const a = x.response!.answers.position as ScoreAnswer;
      return { n: x.n, v: a.score, label: POSITION_SHORT[Math.round(a.score)] ?? "" };
    });
  const probs = pos ? POSITION_SHORT.map((_, i) => pos.probabilities[String(i)] ?? 0) : undefined;
  mount(
    $("values-body"),
    h("div", { class: "value-block" }, h("h3", null, "Run strength"), probs ? levels(POSITION_SHORT, probs, pos!.score) : h("p", { class: "empty" }, "Asked each time the model is consulted."), sparkline(points, 3)),
    risk && t ? h("div", { class: "value-block" }, meter(risk.noul, { label: RISK_LABEL[t.phase] ?? "Risk", note: "Probability the statement is true." })) : null,
  );
}

function json(value: unknown): HTMLElement {
  return h("pre", { class: "json" }, JSON.stringify(value, null, 2));
}

function renderCalls(t: TickRecord | undefined) {
  const r = t?.response;
  const q = t?.request ? Object.keys(t.request.questions).length : 0;
  const result = t?.result;
  mount(
    $("calls-body"),
    h(
      "div",
      { class: "call" },
      h("div", { class: "call-head" }, h("span", { class: "call-target" }, "System One"), h("span", { class: "call-meta" }, r ? `${ms(r.latencyMs)}` : t?.request ? "no answer" : "not asked")),
      t?.request
        ? h("p", { class: "call-line" }, `${q} questions · ${r?.usage?.input_tokens?.toLocaleString() ?? "?"} tokens in · served by `, h("strong", null, r?.model ?? "–"))
        : h("p", { class: "call-line muted" }, t?.auto ? "Forced step; no judgment needed." : t?.note ?? "Waiting for a decision."),
      t?.request ? h("details", null, h("summary", null, "Request: state and questions"), json(t.request)) : null,
      r ? h("details", null, h("summary", null, "Response"), json({ model: r.model, answers: r.answers, usage: r.usage })) : null,
    ),
    h(
      "div",
      { class: "call" },
      h(
        "div",
        { class: "call-head" },
        h("span", { class: "call-target" }, "BlindDeck"),
        h("span", { class: `call-meta ${result ? (result.ok ? (result.dryRun ? "dry" : "ok") : "bad") : ""}` }, result ? (result.dryRun ? "dry run" : result.ok ? `ok · ${ms(result.ms)}` : "failed") : "–"),
      ),
      t?.call ? h("p", { class: "call-line" }, h("code", null, `${t.call.method}${t.call.params ? ` ${JSON.stringify(t.call.params)}` : ""}`)) : h("p", { class: "call-line muted" }, "No action this tick."),
      result?.error ? h("p", { class: "call-error" }, result.error) : null,
      t?.error && !result?.error ? h("p", { class: "call-error" }, t.error) : null,
    ),
  );
}

function replyRows(t: TickRecord): BarRow[] {
  const ans = t.response?.answers.action as ChoiceAnswer | undefined;
  if (t.auto) return [{ id: t.auto.id, kind: "auto", label: t.auto.label, detail: "A forced step; the model is not asked.", p: 1, chosen: true, pick: false }];
  return t.candidates.map((c) => ({
    id: c.id,
    kind: c.kind.replace("_", " "),
    label: c.label,
    detail: c.description,
    p: ans ? (ans.probabilities[c.id] ?? 0) : c.prior,
    prior: ans ? c.prior : undefined,
    chosen: t.verdict.chosen === c.id,
    pick: ans?.choice === c.id,
  }));
}

function renderReply(t: TickRecord | undefined) {
  const verdict = $("verdict");
  const gates = $("gates");
  if (!t) {
    bars.update([], "none", false);
    mount(verdict, h("p", { class: "empty" }, "No decision yet."));
    mount(gates);
    return;
  }
  const ans = t.response?.answers.action as ChoiceAnswer | undefined;
  const isLatest = t === app.ticks[app.ticks.length - 1];
  const interactive = isLatest && !app.status?.running && t.candidates.length > 0;
  bars.update(replyRows(t), `tick-${t.n}`, interactive);
  const v = t.verdict;
  mount(
    verdict,
    h("span", { class: `status status-${v.status.toLowerCase()}` }, h("span", { "aria-hidden": "true" }, STATUS_ICON[v.status] ?? "·"), STATUS_TEXT[v.status] ?? v.status),
    h("p", { class: "verdict-reason" }, `${v.reason}. Executes ${SOURCE_TEXT[v.source]}.`),
    !ans && t.candidates.length > 1 ? h("p", { class: "verdict-note" }, "Bars show the heuristic only: the model did not answer.") : null,
    interactive ? h("p", { class: "verdict-note" }, "Paused: click any option to send it.") : null,
  );
  const g = app.status?.gates;
  mount(
    gates,
    ans && g
      ? [
          meter(ans.confidence, { label: `Confidence (gate ${g.minConfidence})`, threshold: g.minConfidence }),
          ans.none_probability !== undefined
            ? meter(ans.none_probability, { label: `None of the above (gate ${g.noneThreshold})`, threshold: g.noneThreshold })
            : h("p", { class: "meter-note" }, "No none-of-the-above score from this backend."),
        ]
      : null,
  );
  gates.classList.toggle("conf-pass", Boolean(ans && g && ans.confidence >= g.minConfidence));
}

// ---------------------------------------------------------------------------------------------
// Bottom: the loop and the timeline
// ---------------------------------------------------------------------------------------------

function renderPipeline() {
  const t = current();
  const following = app.pinned === null;
  const active = following && app.status?.running !== undefined ? app.live.stage : "idle";
  const timing: Record<string, number | undefined> = t ? { observe: t.timings.observe, extract: t.timings.extract, ask: t.timings.ask, gate: undefined, act: t.timings.act } : {};
  mount(
    $("pipeline"),
    STAGES.flatMap((st, i) => [
      h(
        "div",
        { class: `stage${active === st.id ? " active" : ""}${st.id === "ask" && !t?.request ? " skipped" : ""}`, "aria-current": active === st.id ? "step" : undefined },
        h("span", { class: "stage-name" }, st.name),
        h("span", { class: "stage-does" }, st.does),
        h("span", { class: "stage-time" }, st.id === "gate" ? (t ? t.verdict.status.toLowerCase() : "–") : ms(timing[st.id])),
      ),
      i < STAGES.length - 1 ? h("span", { class: "stage-arrow", "aria-hidden": "true" }, "→") : null,
    ]),
    h("span", { class: "stage-loop", "aria-hidden": "true" }, "↺"),
    h("div", { class: "tick-id" }, h("span", null, t ? `Tick ${t.n}` : "No ticks"), h("span", { class: "muted" }, t ? `${t.phase.replace(/_/g, " ").toLowerCase()} · ${ms(t.timings.total)}` : "")),
  );
}

function renderTimeline() {
  const el = $("timeline");
  const ticks = app.ticks.slice(-160);
  const nodes: HTMLElement[] = [];
  let round: number | undefined;
  for (const t of ticks) {
    if (round !== undefined && t.snapshot.round !== round) nodes.push(h("span", { class: "round-break", "aria-hidden": "true" }));
    round = t.snapshot.round;
    const chosen = t.verdict.chosen ? (t.auto?.id === t.verdict.chosen ? t.auto : t.candidates.find((c) => c.id === t.verdict.chosen)) : undefined;
    const conf = (t.response?.answers.action as ChoiceAnswer | undefined)?.confidence;
    nodes.push(
      withTip(
        h(
          "button",
          {
            class: `tick status-${t.verdict.status.toLowerCase()}${current() === t ? " selected" : ""}${t.result && !t.result.ok ? " failed" : ""}`,
            "aria-label": `Tick ${t.n}, ${t.phase}, ${t.verdict.status}`,
            onclick: () => {
              app.pinned = app.pinned === t.n ? null : t.n;
              renderAll();
            },
          },
          STATUS_ICON[t.verdict.status] ?? "·",
        ),
        () => `Tick ${t.n} · ${t.phase.replace(/_/g, " ").toLowerCase()} · ${chosen?.label ?? t.note ?? "no action"} · ${t.verdict.status}${conf !== undefined ? ` ${pct(conf)}` : ""}`,
      ),
    );
  }
  mount(el, nodes.length ? nodes : h("p", { class: "empty" }, "Ticks appear here as the agent decides."));
  if (app.pinned === null) el.scrollLeft = el.scrollWidth;
  $("follow").hidden = app.pinned === null;
}

function renderAll() {
  const t = current();
  renderTop();
  renderCenter();
  renderValues(t);
  renderCalls(t);
  renderReply(t);
  renderPipeline();
  renderTimeline();
}

// ---------------------------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------------------------

$("btn-run").addEventListener("click", () => control({ cmd: app.status?.running ? "pause" : "run" }));
$("btn-step").addEventListener("click", () => control({ cmd: "step" }));
$("live").addEventListener("change", (e) => control({ cmd: "set", live: (e.target as HTMLInputElement).checked }));
$("review").addEventListener("change", (e) => control({ cmd: "set", reviewMode: (e.target as HTMLSelectElement).value }));
$("delay").addEventListener("input", (e) => ($("delay-value").textContent = `${(e.target as HTMLInputElement).value} ms`));
$("delay").addEventListener("change", (e) => control({ cmd: "set", tickDelayMs: Number((e.target as HTMLInputElement).value) }));
$("start").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = new FormData(e.target as HTMLFormElement);
  void control({ cmd: "start_run", deck: f.get("deck"), stake: f.get("stake"), seed: f.get("seed") || undefined });
});
$("follow").addEventListener("click", () => {
  app.pinned = null;
  renderAll();
});
$("embed").addEventListener("click", () => void toggleEmbed());
document.addEventListener("keydown", (e) => {
  const tag = (e.target as HTMLElement).tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || e.metaKey || e.ctrlKey) return;
  if (e.key === "s") void control({ cmd: "step" });
  if (e.key === "Escape" && app.pinned !== null) {
    app.pinned = null;
    renderAll();
  }
});

function connect() {
  const es = new EventSource("/events");
  es.addEventListener("open", () => {
    app.connected = true;
    renderTop();
  });
  es.addEventListener("error", () => {
    app.connected = false;
    renderTop();
  });
  es.addEventListener("hello", (e) => {
    const d = JSON.parse((e as MessageEvent).data) as { status: AgentStatus; ticks: TickRecord[]; screenAt: number };
    app.status = d.status;
    app.ticks = d.ticks;
    app.screenAt = d.screenAt;
    if (app.screenAt) refreshScreen();
    // A restarted server comes back with screenshots on; the embedded window already covers it.
    if (app.stream && d.status.screen) void control({ cmd: "set", screenshots: false });
    renderAll();
  });
  es.addEventListener("status", (e) => {
    app.status = JSON.parse((e as MessageEvent).data);
    renderTop();
    renderReply(current());
  });
  es.addEventListener("stage", (e) => {
    app.live = JSON.parse((e as MessageEvent).data);
    renderPipeline();
  });
  es.addEventListener("tick", (e) => {
    app.ticks.push(JSON.parse((e as MessageEvent).data));
    if (app.ticks.length > 400) app.ticks.splice(0, app.ticks.length - 400);
    if (app.pinned === null) renderAll();
    else renderTimeline();
  });
  es.addEventListener("screen", (e) => {
    app.screenAt = JSON.parse((e as MessageEvent).data).at;
    refreshScreen();
  });
}

connect();
renderAll();
