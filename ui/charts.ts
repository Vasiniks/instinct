// Decision bars and gate meters.

import { h, mount, pct, reducedMotion, withTip } from "./dom.ts";

export interface BarRow {
  id: string;
  label: string;
  /** The exact option text the model read. */
  detail: string;
  p: number;
  prior?: number;
  /** The option the code executes this tick. */
  chosen: boolean;
  /** The model's own top option. */
  pick: boolean;
  /** The move's kind as a swatch family (play, discard, money, card, blind, pass). */
  kind?: string;
  /** The card the move touches, badged as the game does: a joker by rarity, others by set. */
  tag?: { text: string; tone: string };
  /** A play's estimated score, chips x mult. */
  est?: { chips: number; mult: number; approximate: boolean };
}

interface RowEls {
  row: HTMLElement;
  kind: HTMLElement;
  tags: HTMLElement;
  fill: HTMLElement;
  ghost: HTMLElement;
  value: HTMLElement;
}

const num = (x: number) => (Number.isInteger(x) ? x.toLocaleString() : x.toFixed(1));

/** Chips x mult in the game's blue and red boxes; "~" when the score is approximate. */
function score(e: NonNullable<BarRow["est"]>): HTMLElement {
  return h("span", { class: "score" }, e.approximate ? "~" : "", h("b", { class: "score-chips" }, num(e.chips)), "×", h("b", { class: "score-mult" }, num(e.mult)));
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
      const { row, kind, tags, fill, ghost, value } = els;
      row.classList.toggle("chosen", r.chosen);
      row.classList.toggle("pick", r.pick);
      const said = [r.tag?.text.toLowerCase(), r.est && `${num(r.est.chips)} chips times ${num(r.est.mult)} mult`].filter(Boolean).join(", ");
      row.setAttribute("aria-label", `${r.label}${said ? ` (${said})` : ""}: ${pct(r.p)}${r.chosen ? ", chosen" : ""}${r.pick ? ", model's pick" : ""}`);
      kind.className = `bar-kind k-${r.kind ?? "pass"}`;
      (row.querySelector(".bar-label") as HTMLElement).textContent = r.label;
      mount(tags, r.est ? score(r.est) : null, r.tag ? h("span", { class: `dot-tag c-${r.tag.tone}` }, r.tag.text) : null);
      // The chosen row is styled; only a model pick the gates overruled needs words.
      (row.querySelector(".bar-badges") as HTMLElement).textContent = r.pick && !r.chosen ? "model's pick" : "";
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
    const kind = h("span", { class: "bar-kind", "aria-hidden": "true" });
    const tags = h("span", { class: "bar-tags" });
    const fill = h("div", { class: "bar-fill" });
    const ghost = h("div", { class: "bar-ghost" });
    const value = h("span", { class: "bar-value" });
    const row = h(
      "div",
      { class: "bar-row", role: "listitem", tabindex: 0 },
      h("div", { class: "bar-head" }, kind, h("span", { class: "bar-label" }), tags, h("span", { class: "bar-badges" }), value),
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
    return { row, kind, tags, fill, ghost, value };
  }
}

/** A 0..1 meter with an optional threshold tick; `tone` colors a meter that isn't a probability gate (style.css .tone-*). */
export function meter(value: number | undefined, opts: { threshold?: number; label: string; note?: string; title?: string; passAbove?: boolean; tone?: string }): HTMLElement {
  const v = value === undefined ? undefined : Math.max(0, Math.min(1, value));
  const over = v !== undefined && opts.threshold !== undefined && v >= opts.threshold;
  const state = v === undefined || opts.threshold === undefined || opts.passAbove === undefined ? "" : over === opts.passAbove ? " pass" : " fail";
  return h(
    "div",
    { class: `meter${state}${opts.tone ? ` tone-${opts.tone}` : ""}`, role: "meter", "aria-valuemin": 0, "aria-valuemax": 1, "aria-valuenow": v ?? 0, "aria-label": opts.label, title: opts.title },
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

