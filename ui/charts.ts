// Decision bars, level distributions, meters and the run-strength sparkline.

import { h, hideTip, pct, reducedMotion, showTip, svg, withTip } from "./dom.ts";

export interface BarRow {
  id: string;
  kind: string;
  label: string;
  /** The exact option text the model read. */
  detail: string;
  p: number;
  prior?: number;
  /** The option the code executes this tick. */
  chosen: boolean;
  /** The model's own top option. */
  pick: boolean;
}

interface RowEls {
  row: HTMLElement;
  fill: HTMLElement;
  ghost: HTMLElement;
  value: HTMLElement;
}

/** Keyed rows so probabilities animate in place, Doom-demo style, instead of being redrawn. */
export class DecisionBars {
  el: HTMLElement;
  #rows = new Map<string, RowEls>();
  #key = "";
  #data = new Map<string, BarRow>();
  #onPick: (id: string) => void;

  constructor(onPick: (id: string) => void) {
    this.el = h("div", { class: "bars", role: "list" });
    this.#onPick = onPick;
  }

  update(rows: BarRow[], key: string, interactive: boolean) {
    const sorted = [...rows].sort((a, b) => b.p - a.p || (b.prior ?? 0) - (a.prior ?? 0));
    const fresh = key !== this.#key;
    if (fresh) {
      this.#key = key;
      this.#rows.clear();
      this.el.replaceChildren();
    }
    this.#data = new Map(rows.map((r) => [r.id, r]));
    this.el.classList.toggle("interactive", interactive);
    for (const r of sorted) {
      let els = this.#rows.get(r.id);
      if (!els) {
        els = this.#build(r.id);
        this.#rows.set(r.id, els);
      }
      const { row, fill, ghost, value } = els;
      row.classList.toggle("chosen", r.chosen);
      row.classList.toggle("pick", r.pick);
      row.setAttribute("aria-label", `${r.label}: ${pct(r.p)}${r.chosen ? ", chosen" : ""}${r.pick ? ", model's pick" : ""}`);
      (row.querySelector(".bar-kind") as HTMLElement).textContent = r.kind;
      (row.querySelector(".bar-label") as HTMLElement).textContent = r.label;
      const badges = row.querySelector(".bar-badges") as HTMLElement;
      badges.replaceChildren(...[r.chosen ? h("span", { class: "badge chosen" }, "▶ chosen") : null, r.pick && !r.chosen ? h("span", { class: "badge pick" }, "model's pick") : null].filter((x): x is HTMLSpanElement => Boolean(x)));
      value.textContent = pct(r.p);
      ghost.hidden = r.prior === undefined;
      ghost.style.left = `calc(${(r.prior ?? 0) * 100}% - 1px)`;
      const target = `translateX(${(Math.max(0, Math.min(1, r.p)) - 1) * 100}%)`;
      if (fresh && !reducedMotion()) {
        fill.style.transform = "translateX(-100%)";
        requestAnimationFrame(() => requestAnimationFrame(() => (fill.style.transform = target)));
      } else fill.style.transform = target;
      this.el.appendChild(row);
    }
  }

  #build(id: string): RowEls {
    const fill = h("div", { class: "bar-fill" });
    const ghost = h("div", { class: "bar-ghost" });
    const value = h("span", { class: "bar-value" });
    const row = h(
      "div",
      { class: "bar-row", role: "listitem", tabindex: 0 },
      h("div", { class: "bar-head" }, h("span", { class: "bar-kind" }), h("span", { class: "bar-label" }), h("span", { class: "bar-badges" }), value),
      h("div", { class: "bar-track" }, fill, ghost),
    );
    const pick = () => {
      if (this.el.classList.contains("interactive")) this.#onPick(id);
    };
    row.addEventListener("click", pick);
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        pick();
      }
    });
    withTip(row, () => {
      const r = this.#data.get(id);
      if (!r) return "";
      return h(
        "div",
        null,
        h("p", { class: "tip-title" }, r.label),
        h("p", null, r.detail),
        h("p", { class: "tip-meta" }, `model ${pct(r.p, 1)}`, r.prior !== undefined ? ` · heuristic ${pct(r.prior, 1)}` : ""),
        this.el.classList.contains("interactive") ? h("p", { class: "tip-meta" }, "Click to send this action") : null,
      );
    });
    return { row, fill, ghost, value };
  }
}

/** Probability per ordered level (System One Score), with the weighted score marked. */
export function levels(labels: string[], probs: number[], score: number | undefined): HTMLElement {
  const top = probs.indexOf(Math.max(...probs));
  return h(
    "div",
    { class: "levels", role: "list" },
    labels.map((label, i) =>
      withTip(
        h(
          "div",
          { class: `level${i === top ? " top" : ""}`, role: "listitem", "aria-label": `${label}: ${pct(probs[i])}` },
          h("span", { class: "level-label" }, label.split(":")[0]),
          h("span", { class: "level-track" }, h("span", { class: "level-fill", style: { width: `${(probs[i] ?? 0) * 100}%` } })),
          h("span", { class: "level-value" }, pct(probs[i])),
        ),
        () => `${label} (${pct(probs[i], 1)})`,
      ),
    ),
    score !== undefined ? h("p", { class: "levels-score" }, `Weighted level ${score.toFixed(2)} of ${labels.length - 1}`) : null,
  );
}

/** A 0..1 meter with an optional threshold tick. */
export function meter(value: number | undefined, opts: { threshold?: number; label: string; note?: string }): HTMLElement {
  const v = value === undefined ? undefined : Math.max(0, Math.min(1, value));
  const over = v !== undefined && opts.threshold !== undefined && v >= opts.threshold;
  return h(
    "div",
    { class: `meter${over ? " over" : ""}`, role: "meter", "aria-valuemin": 0, "aria-valuemax": 1, "aria-valuenow": v ?? 0, "aria-label": opts.label },
    h("div", { class: "meter-head" }, h("span", null, opts.label), h("span", { class: "meter-value" }, pct(v))),
    h(
      "div",
      { class: "meter-track" },
      h("div", { class: "meter-fill", style: { width: `${(v ?? 0) * 100}%` } }),
      opts.threshold !== undefined ? h("div", { class: "meter-tick", style: { left: `${opts.threshold * 100}%` }, title: `threshold ${opts.threshold}` }) : null,
    ),
    opts.note ? h("p", { class: "meter-note" }, opts.note) : null,
  );
}

export interface SparkPoint {
  n: number;
  v: number;
  label: string;
}

/** Run strength over ticks: 2px line, last point marked, crosshair + tooltip on hover. */
export function sparkline(points: SparkPoint[], max: number): HTMLElement {
  const W = 300;
  const H = 44;
  const pad = 5;
  const wrap = h("div", { class: "spark" });
  if (points.length < 2) {
    wrap.append(h("p", { class: "empty" }, "Run strength appears after a few decisions."));
    return wrap;
  }
  const x = (i: number) => pad + (i / (points.length - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - (v / max) * (H - pad * 2);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const cross = svg("line", { class: "spark-cross", x1: 0, x2: 0, y1: 0, y2: H, visibility: "hidden" });
  const dot = svg("circle", { class: "spark-hover", r: 4, cx: 0, cy: 0, visibility: "hidden" });
  const last = points[points.length - 1];
  const grid = [0, max / 2, max].map((v) => svg("line", { class: "spark-grid", x1: pad, x2: W - pad, y1: y(v), y2: y(v) }));
  const chart = svg(
    "svg",
    { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", role: "img", "aria-label": `Run strength over the last ${points.length} decisions, now ${last.label}` },
    ...grid,
    svg("path", { class: "spark-line", d }),
    svg("circle", { class: "spark-last", r: 4, cx: x(points.length - 1), cy: y(last.v) }),
    cross,
    dot,
  );
  chart.addEventListener("mousemove", (e) => {
    const r = chart.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left) / r.width) * (points.length - 1));
    const p = points[Math.max(0, Math.min(points.length - 1, i))];
    const px = x(points.indexOf(p));
    cross.setAttribute("x1", String(px));
    cross.setAttribute("x2", String(px));
    cross.setAttribute("visibility", "visible");
    dot.setAttribute("cx", String(px));
    dot.setAttribute("cy", String(y(p.v)));
    dot.setAttribute("visibility", "visible");
    showTip(e, `Tick ${p.n}: ${p.label} (${p.v.toFixed(2)})`);
  });
  chart.addEventListener("mouseleave", () => {
    cross.setAttribute("visibility", "hidden");
    dot.setAttribute("visibility", "hidden");
    hideTip();
  });
  wrap.append(chart);
  return wrap;
}
