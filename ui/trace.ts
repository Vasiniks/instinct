// The run as a trace: one column per tick and one lane per signal (confidence, none of the above,
// ask time, run strength), with the gates drawn across their lanes and the game phase on top.
// Click a column to pin that tick everywhere else.

import type { Config } from "../src/config.ts";
import type { TickRecord } from "../src/loop.ts";
import type { ChoiceAnswer, ScoreAnswer } from "../src/systemone.ts";
import { h, mount, ms, pct, withTip } from "./dom.ts";

const LANE_H = 40;
const PHASE_H = 20;
const COL = 14;
const GAP = 3;
const SHOWN = 240;

const PHASE_NAME: Record<string, string> = {
  MENU: "Menu",
  BLIND_SELECT: "Blind",
  SELECTING_HAND: "Hands",
  ROUND_EVAL: "Cash out",
  SHOP: "Shop",
  SMODS_BOOSTER_OPENED: "Pack",
  GAME_OVER: "Game over",
};

interface Lane {
  name: string;
  scale: string;
  value: (t: TickRecord) => number | undefined;
  max: number;
  gate?: number;
  fill: (t: TickRecord) => string;
}

const action = (t: TickRecord) => t.response?.answers.action as ChoiceAnswer | undefined;

export function renderTrace(
  root: HTMLElement,
  all: TickRecord[],
  opts: { selected?: number; following: boolean; gates?: Config["gates"]; onPick: (n: number) => void; describe: (t: TickRecord) => string },
) {
  const ticks = all.slice(-SHOWN);
  if (!ticks.length) {
    mount(root, h("p", { class: "trace-empty" }, "Each decision adds a column here."));
    return;
  }
  const g = opts.gates;
  const maxAsk = Math.max(1000, ...ticks.map((t) => (t.request ? t.timings.ask : 0)));
  const lanes: Lane[] = [
    { name: "Confidence", scale: g ? `gate ${pct(g.minConfidence)}` : "0 to 100%", value: (t) => action(t)?.confidence, max: 1, gate: g?.minConfidence, fill: (t) => `fill-${t.verdict.status.toLowerCase()}` },
    { name: "None fits", scale: g ? `0 to 25%, gate ${pct(g.noneThreshold)}` : "0 to 25%", value: (t) => action(t)?.none_probability, max: 0.25, gate: g?.noneThreshold, fill: () => "fill-none" },
    { name: "Ask time", scale: `0 to ${ms(maxAsk)}`, value: (t) => (t.request ? t.timings.ask : undefined), max: maxAsk, fill: () => "fill-ask" },
    { name: "Run strength", scale: "Losing to Dominant", value: (t) => (t.response?.answers.position as ScoreAnswer | undefined)?.score, max: 3, fill: () => "fill-strength" },
  ];

  // Columns, with a small gap where a new round starts.
  const items: (TickRecord | "gap")[] = [];
  for (const [i, t] of ticks.entries()) {
    if (i && t.snapshot.round !== ticks[i - 1].snapshot.round) items.push("gap");
    items.push(t);
  }

  const phases: HTMLElement[] = [];
  for (let i = 0; i < items.length; ) {
    const it = items[i];
    if (it === "gap") {
      phases.push(h("span", { class: "round-gap" }));
      i++;
      continue;
    }
    let k = 1;
    while (i + k < items.length && items[i + k] !== "gap" && (items[i + k] as TickRecord).phase === it.phase) k++;
    const name = PHASE_NAME[it.phase] ?? it.phase.replace(/_/g, " ").toLowerCase();
    phases.push(h("span", { class: "phase", title: `${name}, ante ${it.snapshot.ante}`, style: { width: `${k * COL + (k - 1) * GAP}px` } }, k >= 3 ? name : ""));
    i += k;
  }

  const cols = items.map((it) => {
    if (it === "gap") return h("span", { class: "round-gap" });
    const failed = it.result && !it.result.ok;
    return withTip(
      h(
        "button",
        {
          class: `tcol${opts.selected === it.n ? " selected" : ""}${failed ? " failed" : ""}`,
          "aria-label": `Tick ${it.n}`,
          onclick: () => opts.onPick(it.n),
        },
        lanes.map((lane) => {
          const v = lane.value(it);
          return h(
            "span",
            { class: "cell" },
            v === undefined ? null : h("span", { class: `cell-fill ${lane.fill(it)}`, style: { height: `${Math.max(2, Math.round((Math.min(v, lane.max) / lane.max) * (LANE_H - 1)))}px` } }),
          );
        }),
        h("span", { class: `chip fill-${it.verdict.status.toLowerCase()}` }),
      ),
      () => opts.describe(it),
    );
  });

  const gates = lanes.flatMap((lane, i) =>
    lane.gate === undefined ? [] : [h("span", { class: "gate-line", style: { top: `${PHASE_H + i * LANE_H + Math.round((1 - lane.gate / lane.max) * (LANE_H - 1))}px` } })],
  );

  let scroll = root.querySelector<HTMLElement>(".trace-scroll");
  const keep = scroll?.scrollLeft ?? 0;
  scroll = h("div", { class: "trace-scroll" }, h("div", { class: "trace-content" }, h("div", { class: "phase-row" }, phases), h("div", { class: "cols" }, cols), gates));
  mount(
    root,
    h(
      "div",
      { class: "trace" },
      h(
        "div",
        { class: "trace-labels", "aria-hidden": "true" },
        h("span", { style: { height: `${PHASE_H}px` } }),
        lanes.map((l) => h("div", { class: "lane-label" }, h("span", { class: "lane-name" }, l.name), h("span", { class: "lane-scale" }, l.scale))),
      ),
      scroll,
    ),
  );
  scroll.scrollLeft = opts.following ? scroll.scrollWidth : keep;
}
