// Visualizer ("Instrument"): the real Balatro window and the current decision on top; the loop as
// a flow chart and the run as a trace along the bottom. Recorded runs can be viewed again, or
// replayed on the game from their seed.

import type { AgentStatus, Stage, TickRecord } from "../src/loop.ts";
import type { RunMeta } from "../src/runs.ts";
import type { ChoiceAnswer, NoulAnswer, ScoreAnswer } from "../src/systemone.ts";
import { DecisionBars, meter, type BarRow } from "./charts.ts";
import { h, mount, pct } from "./dom.ts";
import { FlowChart, shortModel } from "./flow.ts";
import { renderTrace } from "./trace.ts";

const STATUS_ICON: Record<string, string> = { ACT: "✓", REVIEW: "?", ABSTAIN: "∅", AUTO: "•", IDLE: "–", ERROR: "!" };
const STATUS_TEXT: Record<string, string> = { ACT: "Acted on the model", REVIEW: "Review", ABSTAIN: "Abstained", AUTO: "Forced step", IDLE: "Idle", ERROR: "Error" };
const SOURCE_TEXT: Record<string, string> = { model: "the model's pick", blend: "the model's and the code's values combined", fallback: "the heuristic pick", auto: "a forced step", human: "your pick", none: "nothing" };
const RISK_LABEL: Record<string, string> = { SELECTING_HAND: "Blind out of reach", SHOP: "Should save money", BLIND_SELECT: "Safe to skip" };
const POSITION_SHORT = ["Losing", "Fragile", "On pace", "Dominant"];
const BACKEND_SHORT: Record<string, string> = { cloud: "Jev", local: "Local" };

const app = {
  status: undefined as AgentStatus | undefined,
  ticks: [] as TickRecord[],
  live: { n: 0, stage: "idle" as Stage },
  pinned: null as number | null,
  screenAt: 0,
  /** Live capture of the Balatro window (browser screen-share), when the user embedded it. */
  stream: null as MediaStream | null,
  connected: false,
  /** A recorded run opened for viewing; live ticks keep arriving underneath. */
  view: null as { meta: RunMeta; ticks: TickRecord[] } | null,
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const bars = new DecisionBars((id) => void control({ cmd: "override", id }));
$("reply-bars").replaceWith(bars.el);
const flow = new FlowChart();
$("flow").replaceWith(flow.el);

const shown = (): TickRecord[] => app.view?.ticks ?? app.ticks;
const current = (): TickRecord | undefined => {
  const ts = shown();
  return app.pinned !== null ? ts.find((t) => t.n === app.pinned) : ts[ts.length - 1];
};
const phaseName = (phase: string) => phase.replace(/_/g, " ").toLowerCase();
const cap = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
const chosenOf = (t: TickRecord) => (t.verdict.chosen ? (t.auto?.id === t.verdict.chosen ? t.auto : t.candidates.find((c) => c.id === t.verdict.chosen)) : undefined);

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
  const conn = $("conn");
  conn.className = `conn ${app.connected ? "on" : "off"}`;
  conn.title = app.connected ? "Connected" : "Reconnecting";
  conn.setAttribute("aria-label", conn.title);

  const snap = (app.view ? app.view.ticks[app.view.ticks.length - 1] : last)?.snapshot;
  $("run-meta").textContent = snap
    ? [snap.deck && `${cap(snap.deck)} deck`, snap.stake && `${snap.stake.toLowerCase()} stake`, `ante ${snap.ante}`, `round ${snap.round}`, `$${snap.money}`, snap.seed && `seed ${snap.seed}`].filter(Boolean).join(", ")
    : "";
  const label = s?.backends.find((b) => b.name === s.backend)?.label ?? s?.backend;
  $("backend").textContent = s ? `${label}, ${served ? `last answer from ${served}` : `asks for ${s.model}`}` : "";
  $("game").textContent = s?.game ?? "";

  const replaying = Boolean(s?.replay);
  const run = $<HTMLButtonElement>("btn-run");
  run.textContent = s?.running ? "Pause" : "Run";
  run.setAttribute("aria-pressed", String(Boolean(s?.running)));
  run.disabled = replaying;
  $<HTMLButtonElement>("btn-step").disabled = Boolean(s?.running) || replaying;
  $<HTMLInputElement>("live").checked = Boolean(s?.live);
  $("live-label").textContent = s?.live ? "Live" : "Dry run";
  $("live-wrap").classList.toggle("is-live", Boolean(s?.live));
  if (s) $<HTMLSelectElement>("review").value = s.reviewMode;
  if (s && document.activeElement !== $("delay")) $<HTMLInputElement>("delay").value = String(s.tickDelayMs);
  $("delay-value").textContent = `${s?.tickDelayMs ?? 0} ms`;
  $("start").hidden = replaying || !(last?.phase === "MENU" || last?.phase === "GAME_OVER");
  const msg = s?.awaitingHuman ? "Gates failed. Click a move under the decision to send it, or change “When gates fail” in Settings." : s?.message;
  $("message").hidden = !msg;
  $("message").textContent = msg ?? "";

  const banner = $("banner");
  if (s?.replay) {
    banner.hidden = false;
    $("banner-text").textContent = `Replaying seed ${s.replay.seed} on the game: action ${s.replay.step} of ${s.replay.total}.`;
    $("banner-btn").textContent = "Stop replay";
  } else if (app.view) {
    banner.hidden = false;
    $("banner-text").textContent = `Viewing a recorded run: ${runTitle(app.view.meta)}, ${app.view.meta.result}. The game picture is still live.`;
    $("banner-btn").textContent = "Back to live";
  } else banner.hidden = true;
  renderModelSwitch(s);
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
          { title: `${b.label[0].toUpperCase() + b.label.slice(1)}, ${b.url}` },
          h("input", { type: "radio", name: "backend", value: b.name, "aria-label": b.label, onchange: () => control({ cmd: "set", backend: b.name }) }),
          h("span", { "aria-hidden": "true" }, BACKEND_SHORT[b.name] ?? b.label),
        ),
      ),
    );
  }
  for (const input of seg.querySelectorAll<HTMLInputElement>("input")) input.checked = input.value === s?.backend;
}

// ---------------------------------------------------------------------------------------------
// The game: the real window, scaled into the frame. Two sources:
//   1. "Embed window": the browser captures the window itself (live, full frame rate).
//   2. Otherwise BlindDeck screenshots, refreshed after every action and on a timer.
// ---------------------------------------------------------------------------------------------

function renderCenter() {
  const live = Boolean(app.stream);
  const shot = !live && app.screenAt > 0;
  const sim = app.status?.game === "simulator";
  $("live-video").hidden = !live;
  const img = document.getElementById("screen-img");
  if (img) img.hidden = !shot;
  $("frame-empty").hidden = live || shot;
  // Screenshots stall the game, so the server stops taking them while the agent plays.
  $("frame-hint").hidden = live || sim || Boolean(app.status?.screenLive) || !(app.status?.running || app.status?.replay);
  $("embed").textContent = live ? "Stop embedding" : "Embed window";
  $("embed").title = live ? "" : "Show the Balatro window live instead of screenshots";
  $("screen-source").textContent = live ? "Live" : shot ? `Screenshot ${new Date(app.screenAt).toLocaleTimeString()}` : "";
  $("frame-empty-title").textContent = sim ? "The simulator has no game window" : "No game window yet";
  $("frame-empty-text").textContent = sim
    ? "Start without --sim to drive the real game."
    : "Launch Balatro through Balala. Screenshots appear once BlindDeck answers, or embed the window for a live picture.";

  const t = current();
  const c = t && chosenOf(t);
  const who = !t ? "" : t.replayOf ? `Replayed tick ${t.replayOf.n}` : app.view ? `Recorded tick ${t.n}` : `Tick ${t.n}`;
  mount(
    $("caption"),
    !t ? "" : c ? [`${who} ${t.result?.dryRun ? "would send" : "sent"} `, h("strong", null, c.label)] : `${who}: ${t.note ?? t.verdict.reason}`,
  );
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
// The decision
// ---------------------------------------------------------------------------------------------

function replyRows(t: TickRecord): BarRow[] {
  const ans = t.response?.answers.action as ChoiceAnswer | undefined;
  if (t.auto) return [{ id: t.auto.id, label: t.auto.label, detail: "A forced step; the model is not asked.", p: 1, chosen: true, pick: false }];
  return t.candidates.map((c) => ({
    id: c.id,
    label: c.label,
    detail: c.description,
    p: ans ? (ans.probabilities[c.id] ?? 0) : c.prior,
    prior: ans ? c.prior : undefined,
    chosen: t.verdict.chosen === c.id,
    pick: ans?.choice === c.id,
  }));
}

function renderDecision(t: TickRecord | undefined) {
  $("follow").hidden = app.pinned === null;
  const raw = $<HTMLDetailsElement>("raw");
  if (!t) {
    $("decision-title").textContent = app.view ? "This recording has no ticks" : "No decision yet";
    mount($("decision-status"));
    $("decision-reason").textContent = "";
    bars.update([], "none", false);
    mount($("gates"));
    mount($("values"));
    mount($("plan"));
    raw.hidden = true;
    return;
  }
  const v = t.verdict;
  const ans = t.response?.answers.action as ChoiceAnswer | undefined;
  $("decision-title").textContent = `Tick ${t.replayOf?.n ?? t.n}, ${phaseName(t.phase)}`;
  mount($("decision-status"), h("span", { class: `status status-${v.status.toLowerCase()}` }, h("span", { "aria-hidden": "true" }, STATUS_ICON[v.status] ?? "·"), STATUS_TEXT[v.status] ?? v.status));
  const isLatest = t === app.ticks[app.ticks.length - 1];
  const interactive = !app.view && !t.replayOf && isLatest && !app.status?.running && !app.status?.replay && t.candidates.length > 0;
  const notes = [
    `${cap(v.reason)}.`,
    /using|trusting|waiting/.test(v.reason) ? "" : `Executes ${SOURCE_TEXT[v.source]}.`,
    !ans && t.candidates.length > 1 ? "The model did not answer, so the bars show the heuristic." : "",
    interactive ? "Paused: click a move to send it." : "",
  ];
  $("decision-reason").textContent = notes.filter(Boolean).join(" ");
  bars.update(replyRows(t), `tick-${app.view ? "view-" : ""}${t.n}`, interactive);

  const g = app.status?.gates;
  mount(
    $("gates"),
    ans && g
      ? [
          meter(ans.confidence, { label: "Confidence", threshold: g.minConfidence, passAbove: true, note: `Reviews below ${pct(g.minConfidence)}` }),
          ans.none_probability !== undefined
            ? meter(ans.none_probability, { label: "None fits", threshold: g.noneThreshold, passAbove: false, note: `Abstains at ${pct(g.noneThreshold)}` })
            : h("p", { class: "meter-note" }, "This backend gives no none-fits score."),
        ]
      : null,
  );
  renderValues(t);
  renderPlan(t);

  raw.hidden = !t.request;
  if (raw.open) fillRaw();
}

/** The build plan the run is committed to: what it is, how it stands, and what it could become. */
function renderPlan(t: TickRecord) {
  const p = t.plan;
  if (!p) {
    mount($("plan"));
    return;
  }
  const list = (title: string, items: string[]) =>
    items.length ? h("div", { class: "plan-list" }, h("span", { class: "plan-label" }, title), h("ul", null, items.map((x) => h("li", null, x)))) : null;
  mount(
    $("plan"),
    h(
      "div",
      { class: "plan-head" },
      h("span", { class: "plan-label" }, "Build"),
      h("strong", null, p.build),
      h("span", { class: "plan-since" }, `since ${p.since}`),
      t.pivot ? h("span", { class: "status status-review", title: t.pivot.why }, `Pivot: ${t.pivot.from} to ${t.pivot.to}`) : null,
    ),
    h("p", { class: "plan-line" }, p.strength),
    p.needs.length ? h("p", { class: "plan-line" }, h("span", { class: "plan-label" }, "Needs "), p.needs.join(", ")) : null,
    p.commitment ? h("p", { class: "plan-line" }, h("span", { class: "plan-label" }, "Commitment "), p.commitment) : null,
    h(
      "details",
      { class: "plan-more" },
      h("summary", null, "Synergy, pivots, economy and deck fixing"),
      list("Current synergy", p.current_synergy),
      list("Dead weight", p.dead_weight),
      list("Pivot options", p.pivot_options),
      list("Economy", [p.economy]),
      list("Deck fixing", [p.deck_fixing]),
      list("Deck and stake", p.deck_and_stake),
      p.last_pivot ? list("Last pivot", [p.last_pivot]) : null,
    ),
  );
}

function fillRaw() {
  const t = current();
  $("raw-json").textContent = t?.request ? JSON.stringify({ request: t.request, response: t.response ?? null }, null, 2) : "";
}

function renderValues(t: TickRecord) {
  const pos = t.response?.answers.position as ScoreAnswer | undefined;
  const risk = t.response?.answers.risk as NoulAnswer | undefined;
  const probs = POSITION_SHORT.map((_, i) => pos?.probabilities[String(i)] ?? 0);
  const top = probs.indexOf(Math.max(...probs));
  mount(
    $("values"),
    pos
      ? h(
          "div",
          { class: "meter", title: POSITION_SHORT.map((n, i) => `${n} ${pct(probs[i])}`).join(", ") },
          h("div", { class: "meter-head" }, h("span", null, "Run strength"), h("span", { class: "meter-value" }, `${POSITION_SHORT[top]} ${pct(probs[top])}`)),
          // Ordered levels as one bar, light (losing) to dark (dominant).
          h("div", { class: "strength-bar" }, probs.map((p, i) => h("span", { class: `strength-seg s${i}`, style: { flexGrow: String(p) } }))),
          h("p", { class: "meter-note" }, "Losing to dominant"),
        )
      : null,
    risk ? meter(risk.noul, { label: RISK_LABEL[t.phase] ?? "Risk", note: "The model's yes probability" }) : null,
  );
}

// ---------------------------------------------------------------------------------------------
// Bottom: the loop as a flow chart, the run as a trace
// ---------------------------------------------------------------------------------------------

function renderFlow() {
  const following = app.pinned === null && !app.view;
  flow.update(current(), { active: following && app.live.stage !== "idle" ? app.live.stage : undefined, gates: app.status?.gates, reviewMode: app.status?.reviewMode });
}

function describe(t: TickRecord): string {
  const conf = (t.response?.answers.action as ChoiceAnswer | undefined)?.confidence;
  const c = chosenOf(t);
  return `Tick ${t.replayOf?.n ?? t.n}, ${phaseName(t.phase)}: ${c?.label ?? t.note ?? "no action"}. ${STATUS_TEXT[t.verdict.status] ?? t.verdict.status}${conf !== undefined ? `, confidence ${pct(conf)}` : ""}.`;
}

function renderTraceAll() {
  const ts = shown();
  const count = (s: string) => ts.filter((t) => t.verdict.status === s).length;
  const asked = ts.filter((t) => t.request).length;
  $("trace-note").textContent = ts.length
    ? `${ts.length} ticks. Of ${asked} model calls, ${count("ACT")} acted, ${count("REVIEW")} went to review, ${count("ABSTAIN")} abstained.`
    : "";
  renderTrace($("trace"), ts, {
    selected: current()?.n,
    following: app.pinned === null,
    gates: app.status?.gates,
    describe,
    onPick: (n) => {
      app.pinned = app.pinned === n ? null : n;
      renderAll();
    },
  });
}

function renderAll() {
  const t = current();
  renderTop();
  renderCenter();
  renderDecision(t);
  renderFlow();
  renderTraceAll();
}

// ---------------------------------------------------------------------------------------------
// Recorded runs
// ---------------------------------------------------------------------------------------------

function runTitle(m: RunMeta) {
  return `${cap(m.deck)} deck, ${m.stake.toLowerCase()} stake, seed ${m.seed}`;
}

async function loadRuns() {
  const list = $("runs-list");
  let runs: RunMeta[];
  try {
    runs = await (await fetch("/api/runs")).json();
  } catch (e) {
    mount(list, h("li", { class: "runs-empty" }, `Could not list runs: ${(e as Error).message}`));
    return;
  }
  const here = app.status?.game === "simulator" ? "simulator" : "blinddeck";
  const busy = Boolean(app.status?.running || app.status?.replay);
  mount(
    list,
    runs.length
      ? runs.map((m) =>
          h(
            "li",
            { class: "run-row" },
            h("span", { class: "run-title" }, runTitle(m)),
            h(
              "span",
              { class: "run-sub" },
              [m.result, `${m.actions} actions`, m.model ? shortModel(m.model) : "", new Date(m.startedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }), m.game === "simulator" ? "simulator" : ""].filter(Boolean).join(", "),
            ),
            h("button", { type: "button", onclick: () => void viewRun(m.id) }, "View"),
            h(
              "button",
              {
                type: "button",
                disabled: m.game !== here || busy || m.actions === 0,
                title: m.game !== here ? `Recorded on the ${m.game}` : busy ? "Pause the agent first" : "Start this seed on the game and send the recorded actions",
                onclick: () => {
                  app.view = null;
                  app.pinned = null;
                  ($("runs") as HTMLDetailsElement).open = false;
                  void control({ cmd: "replay", id: m.id });
                  renderAll();
                },
              },
              "Replay",
            ),
          ),
        )
      : h("li", { class: "runs-empty" }, "No runs recorded yet."),
  );
}

async function viewRun(id: string) {
  try {
    const res = await fetch(`/api/runs/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
    app.view = await res.json();
    app.pinned = null;
    ($("runs") as HTMLDetailsElement).open = false;
    renderAll();
  } catch (e) {
    flash(`Could not open the run: ${(e as Error).message}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------------------------

$("btn-run").addEventListener("click", () => control({ cmd: app.status?.running ? "pause" : "run" }));
$("btn-step").addEventListener("click", () => control({ cmd: "step" }));

// Theme: automatic (follows the system), light or dark; remembered in this browser only.
const THEMES = ["auto", "light", "dark"] as const;
function applyTheme(t: (typeof THEMES)[number]) {
  if (t === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  $("theme").textContent = t === "auto" ? "Auto" : t === "light" ? "Light" : "Dark";
  try {
    if (t === "auto") localStorage.removeItem("instinct-theme");
    else localStorage.setItem("instinct-theme", t);
  } catch {
    // Storage blocked: the choice lasts until reload.
  }
}
applyTheme((document.documentElement.dataset.theme as (typeof THEMES)[number] | undefined) ?? "auto");
$("theme").addEventListener("click", () => {
  const now = (document.documentElement.dataset.theme as (typeof THEMES)[number] | undefined) ?? "auto";
  applyTheme(THEMES[(THEMES.indexOf(now) + 1) % THEMES.length]);
});
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
$("banner-btn").addEventListener("click", () => {
  if (app.status?.replay) void control({ cmd: "stop_replay" });
  else {
    app.view = null;
    app.pinned = null;
    renderAll();
  }
});
$("runs").addEventListener("toggle", () => {
  if (($("runs") as HTMLDetailsElement).open) void loadRuns();
});
$("raw").addEventListener("toggle", fillRaw);
$("embed").addEventListener("click", () => void toggleEmbed());
$("embed-hint").addEventListener("click", () => void toggleEmbed());
document.addEventListener("click", (e) => {
  for (const d of document.querySelectorAll<HTMLDetailsElement>("details.settings")) if (d.open && !d.contains(e.target as Node)) d.open = false;
});
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
    renderCenter();
    if (!app.view) {
      renderDecision(current());
      renderFlow();
    }
  });
  es.addEventListener("stage", (e) => {
    app.live = JSON.parse((e as MessageEvent).data);
    if (!app.view && app.pinned === null) renderFlow();
  });
  es.addEventListener("tick", (e) => {
    app.ticks.push(JSON.parse((e as MessageEvent).data));
    if (app.ticks.length > 400) app.ticks.splice(0, app.ticks.length - 400);
    if (app.view) renderTop();
    else if (app.pinned === null) renderAll();
    else {
      renderTop();
      renderTraceAll();
    }
  });
  es.addEventListener("screen", (e) => {
    app.screenAt = JSON.parse((e as MessageEvent).data).at;
    refreshScreen();
  });
}

connect();
renderAll();
