// Visualizer ("Instrument"): the real Balatro window (or the board drawn from the shown tick) and
// the current decision on top; the loop as a flow chart and the run as a trace along the bottom.
// Recorded runs can be viewed again, or replayed on the game from their seed.

import type { Candidate } from "../src/candidates.ts";
import type { Direction } from "../src/direction.ts";
import type { AgentStatus, Prospect, Stage, TickRecord } from "../src/loop.ts";
import type { RunMeta } from "../src/runs.ts";
import type { ChoiceAnswer, NoulAnswer } from "../src/systemone.ts";
import { ENHANCEMENT_TONE, SEAL_TONE, loadArt, renderBoard } from "./board.ts";
import { DecisionBars, meter, type BarRow } from "./charts.ts";
import { h, mount, pageZoom, pct } from "./dom.ts";
import { FlowChart, shortModel, type Layout } from "./flow.ts";
import { PHASE_CLASS, PHASE_NAME, renderTrace } from "./trace.ts";

const STATUS_ICON: Record<string, string> = { ACT: "✓", REVIEW: "?", ABSTAIN: "∅", AUTO: "•", IDLE: "–", ERROR: "!" };
const STATUS_TEXT: Record<string, string> = { ACT: "Acted on the model", REVIEW: "Review", ABSTAIN: "Abstained", AUTO: "Forced step", IDLE: "Idle", ERROR: "Error" };
const SOURCE_TEXT: Record<string, string> = { model: "the model's pick", blend: "the model's and the code's values combined", fallback: "the heuristic pick", auto: "a forced step", human: "your pick", none: "nothing" };
const RISK_LABEL: Record<string, string> = { SELECTING_HAND: "Blind out of reach", SHOP: "Should save money", BLIND_SELECT: "Safe to skip" };
/** The risk question's hue: red for a blind out of reach, gold for saving money, orange for skipping a blind. */
const RISK_TONE: Record<string, string> = { SELECTING_HAND: "mult", SHOP: "money", BLIND_SELECT: "blind" };
/**
 * A move's swatch, by kind: the game's own button colors where it has them (Play Hand blue,
 * Discard red), gold for anything that spends or earns, purple for using or taking a card, orange
 * for playing a blind. Anything else passes (skip, leave the shop, reorder, start): grey.
 */
const KIND_FAMILY: Record<string, string> = {
  play: "play",
  discard: "discard",
  buy: "money",
  sell: "money",
  swap: "money",
  reroll: "money",
  reroll_boss: "money",
  cash_out: "money",
  use: "card",
  pack: "card",
  select: "blind",
};
const RARITY: Record<string, string> = { COMMON: "Common", UNCOMMON: "Uncommon", RARE: "Rare", LEGENDARY: "Legendary" };
const SET_TAG: Record<string, string> = { TAROT: "Tarot", PLANET: "Planet", SPECTRAL: "Spectral" };
/** The needs the game has a color for: chips blue, mult red, money gold. */
const NEED_TONE: Record<string, string> = { chips: "chips", mult: "mult", xmult: "mult", econ: "money" };
/** The prospect's level bands (src/loop.ts prospectLevel): Losing, Fragile, On pace, Dominant. */
const PROSPECT_BANDS = [0.25, 0.5, 0.8];
/** The direction's card groups, in the order a shop offers them. */
const GOAL_GROUPS = [
  ["jokers", "Jokers"],
  ["tarots", "Tarots"],
  ["seals", "Seals"],
  ["enhancements", "Enhancements"],
  ["planets", "Planets"],
] as const;
/** Rarities of the jokers a direction can ask for (src/direction.ts), for their dots. */
const JOKER_RARITY: Record<string, string> = Object.fromEntries(
  Object.entries({
    common: ["Shoot the Moon", "Hanging Chad", "Droll Joker"],
    uncommon: ["Oops! All 6s", "Mime", "Certificate", "Marble Joker", "Bull", "Bootstraps", "To the Moon", "Satellite", "Astronomer", "Cartomancer", "Sock and Buskin", "Pareidolia", "Dusk", "Hack", "Shortcut", "Four Fingers", "Smeared Joker"],
    rare: ["Baron", "Blueprint", "Brainstorm", "DNA", "Wee Joker", "The Tribe"],
  }).flatMap(([rarity, names]) => names.map((n) => [n, rarity])),
);
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
  /** Show the board instead of the game's picture (the simulator has only the board). */
  board: (() => {
    try {
      return localStorage.getItem("instinct-board") === "1";
    } catch {
      return false;
    }
  })(),
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const bars = new DecisionBars((id) => void control({ cmd: "override", id }));
$("reply-bars").replaceWith(bars.el);
const flow = new FlowChart();
$("flow").replaceWith(flow.el);
const layoutNow = (): Layout => (document.documentElement.dataset.layout === "rail" ? "rail" : "bench");
flow.setLayout(layoutNow());

const shown = (): TickRecord[] => app.view?.ticks ?? app.ticks;
const current = (): TickRecord | undefined => {
  const ts = shown();
  return app.pinned !== null ? ts.find((t) => t.n === app.pinned) : ts[ts.length - 1];
};
const phaseName = (phase: string) => phase.replace(/_/g, " ").toLowerCase();
const cap = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
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
  // The money in gold, as the game shows it.
  mount(
    $("run-meta"),
    snap
      ? [
          `${[snap.deck && `${cap(snap.deck)} deck`, snap.stake && `${snap.stake.toLowerCase()} stake`, `ante ${snap.ante}`, `round ${snap.round}`].filter(Boolean).join(", ")}, `,
          h("span", { class: "money" }, `$${snap.money}`),
          snap.seed ? `, seed ${snap.seed}` : "",
        ]
      : null,
  );
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
  renderPreset(s);
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
    $("banner-text").textContent = `Viewing a recorded run: ${runTitle(app.view.meta)}, ${app.view.meta.result}. ${app.status?.game === "simulator" ? "The board follows the recording." : "The board follows the recording; the game picture is still live."}`;
    $("banner-btn").textContent = "Back to live";
  } else banner.hidden = true;
  renderModelSwitch(s);
}

/** The loop's preset (basic, standard, advanced); hidden until the server reports them. */
function renderPreset(s: AgentStatus | undefined) {
  const list = s?.presets ?? [];
  const wrap = $("preset-wrap");
  wrap.hidden = !list.length || !s?.preset;
  if (wrap.hidden) return;
  const select = $<HTMLSelectElement>("preset");
  if (select.dataset.ids !== list.map((p) => p.id).join()) {
    select.dataset.ids = list.map((p) => p.id).join();
    mount(select, list.map((p) => h("option", { value: p.id }, p.label)));
  }
  if (document.activeElement !== select) select.value = s!.preset;
  $("preset-describe").textContent = list.find((p) => p.id === select.value)?.describe ?? "";
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
// Or the board, drawn from the shown tick's snapshot: always in the simulator, which has no
// window, and on request otherwise (it follows a pinned or recorded tick; the picture can't).
// ---------------------------------------------------------------------------------------------

function renderCenter() {
  const t = current();
  const c = t && chosenOf(t);
  const live = Boolean(app.stream);
  const shot = !live && app.screenAt > 0;
  const picture = live || shot;
  const sim = app.status?.game === "simulator";
  const board = Boolean(t) && (!picture || app.board);
  $("board").hidden = !board;
  if (board) renderBoard($("board"), t, c);
  $("frame").classList.toggle("on-board", board);
  $("live-video").hidden = !live || board;
  const img = document.getElementById("screen-img");
  if (img) img.hidden = !shot || board;
  $("frame-empty").hidden = picture || board;
  // Screenshots stall the game, so the server stops taking them while the agent plays.
  $("frame-hint").hidden = board || live || sim || Boolean(app.status?.screenLive) || !(app.status?.running || app.status?.replay);
  $("board-btn").hidden = !picture || !t;
  $("board-btn").textContent = app.board ? "Show picture" : "Show board";
  $("board-btn").setAttribute("aria-pressed", String(app.board));
  $("embed").textContent = live ? "Stop embedding" : "Embed window";
  $("embed").title = live ? "" : "Show the Balatro window live instead of screenshots";
  $("screen-source").textContent = board ? (sim ? "Simulator board" : "Board") : live ? "Live" : shot ? `Screenshot ${new Date(app.screenAt).toLocaleTimeString()}` : "";
  $("frame-empty-title").textContent = sim ? "The simulator is ready" : "No game window yet";
  $("frame-empty-text").textContent = sim
    ? "Start a run and the board draws the game here from every tick, with the chosen move marked."
    : "Launch Balatro through Balala. Screenshots appear once BlindDeck answers, or embed the window for a live picture.";

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

/** The card a move buys, takes, uses or sells, badged as the game does: a joker by its rarity, the rest by set. */
function cardTag(t: TickRecord, c: Candidate): BarRow["tag"] {
  const s = t.snapshot;
  const p = c.call.params ?? {};
  const at = (key: string) => (typeof p[key] === "number" ? (p[key] as number) : undefined);
  let item: { set: string; rarity?: string } | undefined;
  if (c.call.method === "buy") {
    if (at("voucher") !== undefined) return { text: "Voucher", tone: "voucher" };
    if (at("pack") !== undefined) return { text: "Pack", tone: "pack" };
    item = (s.shop ?? []).find((x) => x.area === "card" && x.index === at("card"));
  } else if (c.call.method === "pack") item = (s.pack ?? []).find((x) => x.index === at("card"));
  else if (c.call.method === "use") item = (s.consumables ?? []).find((x) => x.index === at("consumable"));
  else if (c.call.method === "sell")
    item = at("joker") !== undefined ? { set: "JOKER", rarity: (s.jokers ?? []).find((j) => j.index === at("joker"))?.rarity } : (s.consumables ?? []).find((x) => x.index === at("consumable"));
  if (!item) return undefined;
  const rarity = item.set === "JOKER" ? item.rarity?.toUpperCase() : undefined;
  if (rarity && RARITY[rarity]) return { text: RARITY[rarity], tone: rarity.toLowerCase() };
  return SET_TAG[item.set] ? { text: SET_TAG[item.set], tone: item.set.toLowerCase() } : undefined;
}

function replyRows(t: TickRecord): BarRow[] {
  const ans = t.response?.answers.action as ChoiceAnswer | undefined;
  if (t.auto) return [{ id: t.auto.id, label: t.auto.label, detail: "A forced step; the model is not asked.", p: 1, chosen: true, pick: false, kind: KIND_FAMILY[t.auto.kind] }];
  return t.candidates.map((c) => ({
    id: c.id,
    label: c.label,
    detail: c.description,
    p: ans ? (ans.probabilities[c.id] ?? 0) : c.prior,
    prior: ans ? c.prior : undefined,
    chosen: t.verdict.chosen === c.id,
    pick: ans?.choice === c.id,
    kind: KIND_FAMILY[c.kind],
    tag: cardTag(t, c),
    est: c.estimate && { chips: c.estimate.chips, mult: c.estimate.mult, approximate: c.estimate.approximate },
  }));
}

function renderDecision(t: TickRecord | undefined) {
  $("follow").hidden = app.pinned === null;
  const raw = $<HTMLDetailsElement>("raw");
  if (!t) {
    $("decision-title").textContent = app.view ? "This recording has no ticks" : "No decision yet";
    mount($("decision-phase"));
    mount($("decision-status"));
    $("decision-reason").textContent = "";
    bars.update([], "none", false);
    mount($("gates"));
    mount($("values"));
    mount($("plan"));
    mount($("direction"));
    raw.hidden = true;
    return;
  }
  const v = t.verdict;
  const ans = t.response?.answers.action as ChoiceAnswer | undefined;
  $("decision-title").textContent = `Tick ${t.replayOf?.n ?? t.n}`;
  mount($("decision-phase"), h("span", { class: `phase-tag ${PHASE_CLASS[t.phase] ?? "ph-menu"}` }, PHASE_NAME[t.phase] ?? phaseName(t.phase)));
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
  renderDirection(t.direction);

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
    p.needs.length
      ? h("p", { class: "plan-line" }, h("span", { class: "plan-label" }, "Needs "), p.needs.flatMap((n, i) => [i ? ", " : "", NEED_TONE[n] ? h("span", { class: `dot-tag c-${NEED_TONE[n]}` }, n) : n]))
      : null,
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
  const risk = t.response?.answers.risk as NoulAnswer | undefined;
  mount($("values"), prospectMeter(t.prospect), risk ? meter(risk.noul, { label: RISK_LABEL[t.phase] ?? "Risk", note: "The model's yes probability", tone: RISK_TONE[t.phase] }) : null);
}

/**
 * The long view: the simulated chance of beating the next bosses, averaged over shop visits, so it
 * moves only at a shop and holds between them. Its level bands are marked on the track; the thin
 * ink mark is the last shop's own reading, before averaging, so the trend shows.
 */
function prospectMeter(p: Prospect | undefined): HTMLElement {
  const v = p && Math.max(0, Math.min(1, p.value));
  return h(
    "div",
    {
      class: `meter prospect${p ? "" : " is-empty"}`,
      role: "meter",
      "aria-valuemin": 0,
      "aria-valuemax": 1,
      "aria-valuenow": v ?? 0,
      "aria-label": "Run prospect",
      title: "The simulated chance of beating the next bosses, the nearest weighted most, averaged over recent shops. It moves only at a shop.",
    },
    h("div", { class: "meter-head" }, h("span", null, "Run prospect"), h("span", { class: "meter-value" }, p ? `${p.level} ${pct(v)}` : "–")),
    h(
      "div",
      { class: "meter-track" },
      v !== undefined ? h("div", { class: "meter-fill", style: { width: `${v * 100}%` } }) : null,
      PROSPECT_BANDS.map((b) => h("span", { class: "meter-band", style: { left: `${b * 100}%` } })),
      p ? h("span", { class: "meter-latest", style: { left: `${Math.max(0, Math.min(1, p.latest)) * 100}%` }, title: `This shop's reading ${pct(p.latest)}` }) : null,
    ),
    h("p", { class: "meter-note" }, p ? `${sentence(p.horizon)}; this shop read ${pct(p.latest)}` : "Read at the first shop"),
  );
}

/** Where the run is heading: Neutral, or a lean and the cards worth looking for, in their set's or rarity's dot. */
function renderDirection(d: Direction | undefined) {
  const el = $("direction");
  if (!d) return mount(el);
  const tone = (group: (typeof GOAL_GROUPS)[number][0], x: string) =>
    group === "jokers" ? (JOKER_RARITY[x] ?? "neutral") : group === "tarots" ? "tarot" : group === "planets" ? "planet" : group === "seals" ? (SEAL_TONE[x.toUpperCase()] ?? "neutral") : (ENHANCEMENT_TONE[x.toUpperCase()] ?? "neutral");
  const groups = d.theme === "Neutral" ? [] : GOAL_GROUPS.filter(([k]) => d[k].length);
  mount(
    el,
    h("div", { class: "plan-head" }, h("span", { class: "plan-label" }, "Direction"), h("strong", { title: d.why }, d.theme)),
    h("p", { class: "plan-line direction-why" }, `${sentence(d.why)}.`),
    groups.length
      ? h(
          "dl",
          { class: "goals", "aria-label": "Cards worth looking for" },
          groups.flatMap(([k, label]) => [h("dt", { class: "plan-label" }, label), h("dd", null, d[k].map((x) => h("span", { class: `goal dot-tag c-${tone(k, x)}` }, x)))]),
        )
      : null,
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
    laneH: layoutNow() === "rail" ? 22 : 40,
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
$("preset").addEventListener("change", (e) => {
  const id = (e.target as HTMLSelectElement).value;
  $("preset-describe").textContent = app.status?.presets?.find((p) => p.id === id)?.describe ?? "";
  void control({ cmd: "set", preset: id });
});

// ---------------------------------------------------------------------------------------------
// Layout: bench (game and decision on top, loop and trace below) or rail (the loop as a tree down
// the left, the trace as a strip under the game). The borders between panels drag; sizes are kept
// per layout in this browser.
// ---------------------------------------------------------------------------------------------

const root = document.documentElement;
function applyLayout(l: Layout) {
  if (l === "rail") root.dataset.layout = "rail";
  else delete root.dataset.layout;
  $("layout-btn").textContent = l === "rail" ? "Rail" : "Bench";
  $("split-bottom").setAttribute("aria-label", l === "rail" ? "Resize the trace strip" : "Resize the bottom row");
  $("split-loop").setAttribute("aria-label", l === "rail" ? "Resize the loop rail" : "Resize the loop panel");
  try {
    localStorage.setItem("instinct-layout", l);
  } catch {
    // Storage blocked: the choice lasts until reload.
  }
  flow.setLayout(l);
  renderTraceAll();
}
applyLayout(layoutNow());
$("layout-btn").addEventListener("click", () => applyLayout(layoutNow() === "rail" ? "bench" : "rail"));

const SIZES_KEY = "instinct-sizes";
function storeSize(name: string, px: number | null) {
  try {
    const sizes = JSON.parse(localStorage.getItem(SIZES_KEY) ?? "{}") as Record<string, number>;
    if (px === null) delete sizes[name];
    else sizes[name] = Math.round(px);
    localStorage.setItem(SIZES_KEY, JSON.stringify(sizes));
  } catch {
    // Storage blocked: the size lasts until reload.
  }
}
const setSize = (name: string, px: number | null) => (px === null ? root.style.removeProperty(name) : root.style.setProperty(name, `${Math.round(px)}px`));

/**
 * One border: which size it sets in each layout, how a pointer position becomes that size, its
 * limits, the panel whose size it is (for the keyboard), and which arrow key grows it. All
 * positions are screen pixels until divided by the page zoom.
 */
interface Split {
  id: string;
  axis: "v" | "h";
  name: () => string;
  size: (e: PointerEvent, box: DOMRect, z: number) => number;
  range: (box: DOMRect, z: number) => [number, number];
  current: (z: number) => number;
  grow: string;
}
const width = (sel: string, z: number) => (document.querySelector(sel) as HTMLElement).getBoundingClientRect().width / z;
const height = (sel: string, z: number) => (document.querySelector(sel) as HTMLElement).getBoundingClientRect().height / z;
const PAD = 20;
const HALF = 6;
const SPLITS: Split[] = [
  {
    id: "split-decision",
    axis: "v",
    name: () => "--decision-w",
    size: (e, box, z) => (box.right - e.clientX) / z - PAD - HALF,
    range: (box, z) => [320, Math.max(320, box.width / z - 2 * PAD - (layoutNow() === "rail" ? width(".flow-panel", z) + 12 : 0) - 12 - 380)],
    current: (z) => width(".decision", z),
    grow: "ArrowLeft",
  },
  {
    id: "split-loop",
    axis: "v",
    name: () => (layoutNow() === "rail" ? "--rail-w" : "--loop-w"),
    size: (e, box, z) => (e.clientX - box.left) / z - PAD - HALF,
    range: (box, z) => (layoutNow() === "rail" ? [220, 640] : [420, Math.max(420, box.width / z - 2 * PAD - width(".decision", z) - 24)]),
    current: (z) => width(".flow-panel", z),
    grow: "ArrowRight",
  },
  {
    id: "split-bottom",
    axis: "h",
    name: () => (layoutNow() === "rail" ? "--strip-h" : "--bottom-h"),
    size: (e, box, z) => (box.bottom - e.clientY) / z - HALF,
    range: (box, z) => (layoutNow() === "rail" ? [90, Math.max(90, box.height / z - 220)] : [150, Math.max(150, box.height / z - 220)]),
    current: (z) => height(layoutNow() === "rail" ? ".trace-panel" : ".flow-panel", z),
    grow: "ArrowUp",
  },
];
const clamp = (v: number, [lo, hi]: [number, number]) => Math.min(hi, Math.max(lo, v));
for (const sp of SPLITS) {
  const el = $(sp.id);
  const layoutBox = () => $("layout").getBoundingClientRect();
  let dragging = false;
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    dragging = true;
    el.setPointerCapture(e.pointerId);
    el.classList.add("dragging");
    document.body.classList.add("resizing", sp.axis);
    e.preventDefault();
  });
  el.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const z = pageZoom();
    const box = layoutBox();
    setSize(sp.name(), clamp(sp.size(e, box, z), sp.range(box, z)));
  });
  const end = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    el.classList.remove("dragging");
    document.body.classList.remove("resizing", sp.axis);
    const v = root.style.getPropertyValue(sp.name());
    if (v) storeSize(sp.name(), Number.parseFloat(v));
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
  // Double-click puts the border back where it started.
  el.addEventListener("dblclick", () => {
    setSize(sp.name(), null);
    storeSize(sp.name(), null);
  });
  // Arrow keys move the border 16 px.
  const keys = sp.axis === "v" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
  el.addEventListener("keydown", (e) => {
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const z = pageZoom();
    const next = clamp(sp.current(z) + (e.key === sp.grow ? 16 : -16), sp.range(layoutBox(), z));
    setSize(sp.name(), next);
    storeSize(sp.name(), next);
  });
}

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
$("board-btn").addEventListener("click", () => {
  app.board = !app.board;
  try {
    if (app.board) localStorage.setItem("instinct-board", "1");
    else localStorage.removeItem("instinct-board");
  } catch {
    // Storage blocked: the choice lasts until reload.
  }
  renderCenter();
});
$("embed-hint").addEventListener("click", () => void toggleEmbed());
document.addEventListener("click", (e) => {
  for (const d of document.querySelectorAll<HTMLDetailsElement>("details.settings")) if (d.open && !d.contains(e.target as Node)) d.open = false;
});
document.addEventListener("keydown", (e) => {
  const target = e.target as HTMLElement;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || e.metaKey || e.ctrlKey || e.altKey) return;
  // Space runs or pauses and Tab steps, unless focus is on something those keys belong to: a
  // button or summary (Space presses it), the runs list, or a splitter (arrow keys).
  const owned = tag === "BUTTON" || tag === "SUMMARY" || target.closest("#runs, .splitter, details.settings");
  const busy = Boolean(app.status?.replay);
  if (e.key === " " && !owned && !busy) {
    e.preventDefault();
    void control({ cmd: app.status?.running ? "pause" : "run" });
    return;
  }
  if (e.key === "Tab" && !e.shiftKey && !owned && !busy && !app.status?.running) {
    e.preventDefault();
    void control({ cmd: "step" });
    return;
  }
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
// The game's sprites for the board, when tools/textures.py has put them in ui/game/; CSS cards until then.
void loadArt().then((ok) => ok && renderCenter());
