// The agent loop as a decision tree: read the game -> list the moves -> plan the build -> assess
// the situation -> route by phase into one of four lanes, each a short chain of forks the code
// walks (blind: boss, skip; hand: free card, clear now, round tree; shop: outlook, joker row,
// targets; pack: kind, offers) -> value every move -> ask the model -> gates -> combine the
// model's pick with the values -> send, then back to the start. Nodes are HTML in a grid, grouped
// (Read, Think, Decide, Judge, Send) by soft panels drawn behind them; edges are drawn from the
// measured node boxes. The path the shown tick took is drawn in blue: the chosen lane filled, the
// lanes not taken dashed, the gate's outcome in ink. Each lane's forks carry their phase's hue on
// the left edge, as on the trace's timeline. Two layouts: "bench" runs left to right, "rail" (a
// narrow left column) runs top to bottom, the same grid transposed.

import type { Config } from "../src/config.ts";
import type { Stage, TickRecord } from "../src/loop.ts";
import type { ReviewMode } from "../src/policy.ts";
import type { ChoiceAnswer } from "../src/systemone.ts";
import { h, ms, pct, svg, withTip } from "./dom.ts";

type Lane = "blind" | "hand" | "shop" | "pack";
type NodeId =
  | "observe"
  | "extract"
  | "plan"
  | "assess"
  | "synergy"
  | "deck"
  | "bosspool"
  | "planets"
  | "route"
  | "boss"
  | "skip"
  | "free"
  | "clear"
  | "tree"
  | "outlook"
  | "row"
  | "targets"
  | "packkind"
  | "offers"
  | "value"
  | "ask"
  | "gate"
  | "pass"
  | "review"
  | "abstain"
  | "combine"
  | "act";

interface NodeEls {
  el: HTMLElement;
  detail: HTMLElement;
  metric: HTMLElement;
}

export type Layout = "bench" | "rail";

/**
 * Where a node sits in the bench layout: its column, and its row among the four lane rows (none
 * means it spans them all). The rail layout swaps the two.
 */
interface Spot {
  c: number;
  r?: number | string;
}
const NODES: { id: NodeId; title: string; cls: string; at: Spot }[] = [
  { id: "observe", title: "Observe", cls: "main", at: { c: 1 } },
  { id: "extract", title: "Extract", cls: "main", at: { c: 2 } },
  { id: "plan", title: "Plan", cls: "main", at: { c: 3 } },
  { id: "assess", title: "Assess", cls: "main", at: { c: 4 } },
  // What the assess stage reads, side by side: each feeds the route.
  { id: "synergy", title: "Synergy", cls: "fork sub", at: { c: 5, r: 1 } },
  { id: "deck", title: "Deck", cls: "fork sub", at: { c: 5, r: 2 } },
  { id: "bosspool", title: "Boss pool", cls: "fork sub", at: { c: 5, r: 3 } },
  { id: "planets", title: "Planets", cls: "fork sub", at: { c: 5, r: 4 } },
  { id: "route", title: "Route", cls: "main", at: { c: 6 } },
  { id: "boss", title: "Boss", cls: "fork lane", at: { c: 7, r: 1 } },
  { id: "skip", title: "Skip?", cls: "fork lane", at: { c: 8, r: 1 } },
  { id: "free", title: "Free card first?", cls: "fork lane", at: { c: 7, r: 2 } },
  { id: "clear", title: "Clear now?", cls: "fork lane", at: { c: 8, r: 2 } },
  { id: "tree", title: "Round tree", cls: "fork lane", at: { c: 9, r: 2 } },
  { id: "outlook", title: "Outlook", cls: "fork lane", at: { c: 7, r: 3 } },
  { id: "row", title: "Joker row", cls: "fork lane", at: { c: 8, r: 3 } },
  { id: "targets", title: "Targets", cls: "fork lane", at: { c: 9, r: 3 } },
  { id: "packkind", title: "Pack", cls: "fork lane", at: { c: 7, r: 4 } },
  { id: "offers", title: "Offers", cls: "fork lane", at: { c: 8, r: 4 } },
  { id: "value", title: "Value", cls: "main", at: { c: 10 } },
  { id: "ask", title: "Ask", cls: "main model", at: { c: 11 } },
  { id: "gate", title: "Gate", cls: "main", at: { c: 12 } },
  { id: "pass", title: "Passed", cls: "outcome", at: { c: 13, r: 1 } },
  { id: "review", title: "Review", cls: "outcome", at: { c: 13, r: "2 / 4" } },
  { id: "abstain", title: "Abstain", cls: "outcome", at: { c: 13, r: 4 } },
  { id: "combine", title: "Combine", cls: "main", at: { c: 14 } },
  { id: "act", title: "Act", cls: "main act", at: { c: 15 } },
];

const ASSESS: NodeId[] = ["synergy", "deck", "bosspool", "planets"];
const LANES: Record<Lane, NodeId[]> = {
  blind: ["boss", "skip"],
  hand: ["free", "clear", "tree"],
  shop: ["outlook", "row", "targets"],
  pack: ["packkind", "offers"],
};
const LANE_OF: Record<string, Lane> = { BLIND_SELECT: "blind", SELECTING_HAND: "hand", SHOP: "shop", SMODS_BOOSTER_OPENED: "pack" };
/** Fork names in a tick's path, by node. */
const FORK_NODE: Record<string, NodeId> = { Boss: "boss", "Skip?": "skip", "Free card first?": "free", "Clear now?": "clear", Outlook: "outlook", "Joker row": "row", Targets: "targets", Pack: "packkind" };

const EDGES: [NodeId, NodeId][] = [
  ["observe", "extract"],
  ["extract", "plan"],
  ["plan", "assess"],
  ...(ASSESS.flatMap((n) => [["assess", n], [n, "route"]]) as [NodeId, NodeId][]),
  ...(Object.values(LANES).flatMap((lane) => [["route", lane[0]], ...lane.slice(1).map((n, i) => [lane[i], n]), [lane[lane.length - 1], "value"]]) as [NodeId, NodeId][]),
  ["value", "ask"],
  ["ask", "gate"],
  ["gate", "pass"],
  ["gate", "review"],
  ["gate", "abstain"],
  ["pass", "combine"],
  ["review", "combine"],
  ["abstain", "combine"],
  ["combine", "act"],
];

/** Soft panels behind related stages. */
const GROUPS: { label: string; nodes: NodeId[] }[] = [
  { label: "Read", nodes: ["observe", "extract"] },
  { label: "Think", nodes: ["plan", "assess", ...ASSESS] },
  { label: "Decide", nodes: ["route", ...Object.values(LANES).flat(), "value"] },
  { label: "Judge", nodes: ["ask", "gate", "pass", "review", "abstain", "combine"] },
  { label: "Send", nodes: ["act"] },
];

const MODE_TEXT: Record<ReviewMode, string> = { blend: "model and code combined", fallback: "heuristic decides", model: "model's pick anyway", pause: "you decide" };
const STAGE_NODE: Partial<Record<Stage, NodeId>> = { observe: "observe", extract: "extract", ask: "ask", gate: "gate", act: "act" };

export function shortModel(model: string): string {
  if (/startlux/i.test(model)) return `StartLux ${model.match(/(\d+B)/)?.[1] ?? ""}`.trim();
  if (/^jev/i.test(model)) return model.replace(/^jev-?/i, "Jev ");
  return model;
}

/** Which nodes and edges the tick went through. */
function route(t: TickRecord | undefined) {
  const nodes = new Set<NodeId>();
  const edges = new Set<string>();
  let bypass = false;
  if (!t) return { nodes, edges, bypass };
  const via = (...ids: NodeId[]) => {
    ids.forEach((id, i) => {
      nodes.add(id);
      if (i) edges.add(`${ids[i - 1]}>${id}`);
    });
  };
  const acted = Boolean(t.verdict.chosen);
  const s = t.verdict.status;
  if (s === "AUTO") {
    via("observe", "extract");
    if (acted) {
      nodes.add("act");
      bypass = true;
    }
  } else if (s === "IDLE") via("observe", "extract");
  else {
    const lane = LANES[LANE_OF[t.phase] ?? "shop"];
    const outcome: NodeId = s === "ACT" ? "pass" : s === "ABSTAIN" ? "abstain" : "review";
    via("observe", "extract", "plan", "assess");
    // The assessment's readings run side by side; each one this tick had feeds the route.
    const a = t.assessment;
    const read = ASSESS.filter((n) => (n === "synergy" ? a : n === "deck" ? a?.deck : n === "bosspool" ? a?.pool : a?.planets?.length));
    for (const n of read.length ? read : (["synergy"] as NodeId[])) via("assess", n, "route");
    via("route", ...lane, "value", "ask", "gate", outcome, "combine");
    if (acted) via("combine", "act");
  }
  return { nodes, edges, bypass };
}

export class FlowChart {
  el: HTMLElement;
  #nodes = {} as Record<NodeId, NodeEls>;
  #svg: SVGSVGElement;
  #taken = { nodes: new Set<NodeId>(), edges: new Set<string>(), bypass: false };
  #layout: Layout = "bench";

  constructor() {
    this.#svg = svg("svg", { class: "flow-edges", "aria-hidden": "true" });
    this.el = h("div", { class: "flow", role: "group", "aria-label": "Agent loop flow chart" }, this.#svg);
    for (const n of NODES) {
      // A node shows its name and time; what it did (and why) shows on hover.
      const detail = h("span", { class: "node-detail" });
      const metric = h("span", { class: "node-metric" });
      const lane = (Object.keys(LANES) as Lane[]).find((l) => LANES[l].includes(n.id));
      const el = h("div", { class: `node ${n.cls}${lane ? ` ph-${lane}` : ""}`, tabindex: "0" }, h("span", { class: "node-title" }, n.title), detail, metric);
      withTip(el, () => {
        const why = detail.title && detail.title !== detail.textContent ? detail.title : "";
        return h("div", null, h("p", { class: "tip-title" }, n.title), detail.textContent ? h("p", null, detail.textContent) : null, why ? h("p", { class: "tip-meta" }, why) : null, metric.textContent ? h("p", { class: "tip-meta" }, metric.textContent) : null);
      });
      this.#nodes[n.id] = { el, detail, metric };
      this.el.append(el);
    }
    this.setLayout("bench");
    new ResizeObserver(() => this.#draw()).observe(this.el);
  }

  /** Bench runs left to right; rail is the same grid transposed, top to bottom. */
  setLayout(layout: Layout) {
    this.#layout = layout;
    for (const n of NODES) {
      const across = String(n.at.c);
      const along = n.at.r === undefined ? "1 / 5" : String(n.at.r);
      const el = this.#nodes[n.id].el;
      el.style.gridColumn = layout === "bench" ? across : along;
      el.style.gridRow = layout === "bench" ? along : across;
    }
    this.#draw();
  }

  update(t: TickRecord | undefined, opts: { active?: Stage; gates?: Config["gates"]; reviewMode?: ReviewMode }) {
    const g = opts.gates;
    const mode = MODE_TEXT[opts.reviewMode ?? "blend"];
    const ans = t?.response?.answers.action as ChoiceAnswer | undefined;
    const set = (id: NodeId, detail: string, metric = "") => {
      this.#nodes[id].detail.textContent = detail;
      this.#nodes[id].detail.title = detail;
      this.#nodes[id].metric.textContent = metric;
      this.#nodes[id].metric.hidden = !metric;
    };
    const phase = t ? t.phase.replace(/_/g, " ").toLowerCase() : "waiting";
    set("observe", t ? `Read the game: ${phase}` : "Read the game state", t ? ms(t.timings.observe) : "");
    set("extract", t ? (t.auto ? "Forced step, no choice" : `${t.candidates.length} legal moves`) : "List the legal moves", t ? ms(t.timings.extract - (t.sim?.ms ?? 0) - (t.assessment?.ms ?? 0)) : "");
    set("plan", t?.plan ? `${t.plan.build} build${t.plan.commitment ? `; ${t.plan.commitment}` : ""}` : "Track the build: hand, jokers, deck");
    const a = t?.assessment;
    set(
      "assess",
      a ? `${a.outlook.status[0].toUpperCase()}${a.outlook.status.slice(1)}${a.boss ? `; ${a.boss.name} threat ${a.boss.threat}` : ""}; ${a.economy.status}` : "Synergy, boss, targets, money, outlook",
      a ? ms(a.ms) : "",
    );
    this.#nodes.assess.detail.title = a ? [a.synergy.text, a.outlook.text, a.boss?.text, a.economy.text].filter(Boolean).join("\n") : "";
    const pts = (x: number) => `${x >= 0 ? "+" : ""}${Math.round(x * 100)}`;
    set("synergy", a?.synergy.jokerShare !== undefined ? `Jokers ${pct(a.synergy.jokerShare)} of the score${a.synergy.lift ? `; ${pct(a.synergy.lift.all)} vs ${pct(a.synergy.lift.none)} with none` : ""}` : a ? a.synergy.text : "Who carries the score");
    this.#nodes.synergy.detail.title = a?.synergy.text ?? "";
    const fix = a?.deck?.fixes[0];
    set("deck", a?.deck ? `${a.deck.size} cards${fix ? `; ${fix.label.split(" (")[0]} ${pts(fix.gain)}` : ""}` : "What the deck needs");
    this.#nodes.deck.detail.title = a?.deck?.text ?? "";
    set("bosspool", a?.pool ? `${a.boss?.name ?? "Boss"} ${pts(-a.pool.currentDrop)} vs pool ${pts(-a.pool.expectedDrop)}` : a?.boss ? `${a.boss.name}: threat ${a.boss.threat}` : "Bosses a reroll could draw");
    this.#nodes.bosspool.detail.title = [a?.boss?.text, a?.pool?.text].filter(Boolean).join("\n");
    const planet = a?.planets?.[0];
    set("planets", planet ? `${planet.planet} ${pts(planet.gain)}` : "Which level helps most");
    this.#nodes.planets.detail.title = a?.planets?.map((x) => `${x.planet} (${x.hand}) ${pts(x.gain)}`).join(", ") ?? "";
    const lane = t ? LANE_OF[t.phase] : undefined;
    set("route", lane ? `${lane[0].toUpperCase()}${lane.slice(1)} lane` : "Pick the phase's lane");
    // Forks: the way each went on this tick, with why on hover.
    const forks = new Map((t?.path ?? []).map((b) => [FORK_NODE[b.node], b] as const));
    const idle: Record<NodeId, string> = {
      boss: "Reroll a boss that hurts the build?",
      skip: "Skip for the tag, or play for the shop?",
      free: "Use a Tarot or Planet first?",
      clear: "Does a play beat the blind now?",
      tree: "Play out the round per move",
      outlook: "Behind the next bosses: spend; else bank",
      row: "Full row: pick who goes",
      targets: "Jokers the build is missing",
      packkind: "What the pack holds",
      offers: "Simulate each card in it",
    } as Record<NodeId, string>;
    for (const id of Object.keys(idle) as NodeId[]) {
      const b = forks.get(id);
      set(id, b ? b.branch : idle[id]);
      this.#nodes[id].detail.title = b ? b.why : "";
    }
    const sim = t?.sim;
    if (sim && sim.kind === "round") set("tree", `${sim.compared} moves x ${sim.samples} finishes. ${sim.summary}`, ms(sim.ms));
    if (sim && t?.phase === "SMODS_BOOSTER_OPENED") set("offers", `${sim.compared} setups x ${sim.samples} rounds. ${sim.summary}`, ms(sim.ms));
    if (sim && t?.phase === "SHOP" && forks.has("targets")) this.#nodes.targets.metric.textContent = ms(sim.ms + (a?.ms ?? 0));
    const best = t && !t.auto ? [...t.candidates].sort((x, y) => y.utility - x.utility)[0] : undefined;
    set("value", best ? `Code's top: ${best.label}` : "Score each move: build, data, odds", best ? `${pct(best.prior)}` : "");
    set(
      "ask",
      t?.response ? `${shortModel(t.response.model)}, ${t.response.usage?.input_tokens?.toLocaleString() ?? "?"} tokens` : t?.request ? "No answer" : "Ask the model",
      t?.request ? ms(t.timings.ask) : "",
    );
    set("gate", ans ? `Confidence ${pct(ans.confidence)}, none fits ${pct(ans.none_probability)}` : "Check confidence and none fits", t && ans ? t.verdict.status.toLowerCase() : "");
    set("pass", g ? `Confidence ${pct(g.minConfidence)} or more` : "");
    set("review", g ? `Below ${pct(g.minConfidence)}: ${mode}` : "");
    set("abstain", g ? `None fits ${pct(g.noneThreshold)} or more: ${mode}` : "");
    const chosen = t?.candidates.find((c) => c.id === t.verdict.chosen);
    set(
      "combine",
      chosen ? `${t!.verdict.source === "blend" ? "Values outweigh the pick" : t!.verdict.source === "model" ? "Model's pick" : t!.verdict.source === "fallback" ? "Code's pick" : t!.verdict.source}: ${chosen.label}` : `Weigh the model against the values (${mode})`,
      "",
    );
    const r = t?.result;
    set(
      "act",
      t?.call ? `${t.call.method}${t.call.params ? ` ${JSON.stringify(t.call.params)}` : ""}` : "Nothing sent",
      r ? (r.dryRun ? "dry run" : r.ok ? ms(r.ms) : "failed") : "",
    );

    this.#taken = route(t);
    const activeNode = opts.active ? STAGE_NODE[opts.active] : undefined;
    const routed = this.#taken.nodes.has("route");
    for (const n of NODES) {
      const el = this.#nodes[n.id].el;
      const taken = this.#taken.nodes.has(n.id);
      // When the tick took a lane, the others are drawn dashed; Act is dashed when nothing was
      // sent; any other stage the tick skipped fades.
      const untaken = Boolean(t) && routed && n.cls.includes("lane") && !taken;
      const held = n.id === "act" && Boolean(t) && !t?.call;
      el.classList.toggle("taken", taken);
      el.classList.toggle("untaken", untaken);
      el.classList.toggle("held", held);
      el.classList.toggle("dim", Boolean(t) && !taken && !untaken && !held && n.cls !== "outcome");
      el.classList.toggle("active", activeNode === n.id);
      el.classList.toggle("failed", (n.id === "act" && Boolean(r && !r.ok)) || (n.id === "ask" && Boolean(t?.request && !t.response)));
    }
    this.#draw();
  }

  #draw() {
    const box = this.el.getBoundingClientRect();
    if (!box.width) return;
    // Boxes come in screen pixels; the SVG draws in the page's (zoomed) CSS pixels.
    const z = box.width / (this.el.offsetWidth || box.width);
    const rect = (id: NodeId) => {
      const b = this.#nodes[id].el.getBoundingClientRect();
      const l = (b.left - box.left) / z;
      const t = (b.top - box.top) / z;
      const w = b.width / z;
      const hh = b.height / z;
      return { l, r: l + w, t, b: t + hh, cx: l + w / 2, cy: t + hh / 2 };
    };
    const marker = (id: string, cls: string) =>
      svg(
        "marker",
        { id, viewBox: "0 0 8 8", refX: 7, refY: 4, markerWidth: 8, markerHeight: 8, markerUnits: "userSpaceOnUse", orient: "auto-start-reverse" },
        svg("path", { d: "M0,0 L8,4 L0,8 z", class: cls }),
      );
    const defs = svg("defs", {}, marker("flow-arrow", "arrow"), marker("flow-arrow-taken", "arrow taken"));
    const path = (d: string, taken: boolean, dashed = false) =>
      svg("path", { d, class: `edge${taken ? " taken" : ""}${dashed ? " dashed" : ""}`, "marker-end": `url(#${taken ? "flow-arrow-taken" : "flow-arrow"})` });
    const out: SVGElement[] = [defs];
    const rail = this.#layout === "rail";
    const W = box.width / z;
    const H = box.height / z;
    const text = (x: number, y: number, label: string, cls: string, rotate = 0) => {
      const el = svg("text", { x, y, class: cls, "text-anchor": cls === "edge-label" ? "middle" : "start", ...(rotate ? { transform: `rotate(${rotate} ${x} ${y})` } : {}) });
      el.textContent = label;
      return el;
    };
    // Groups first, so they sit behind the edges and the nodes; their labels go on top at the end.
    const labels: SVGElement[] = [];
    for (const g of GROUPS) {
      const rs = g.nodes.map(rect);
      const l = Math.min(...rs.map((x) => x.l));
      const r = Math.max(...rs.map((x) => x.r));
      const t = Math.min(...rs.map((x) => x.t));
      const b = Math.max(...rs.map((x) => x.b));
      if (rail) {
        // Full-width bands; the label sits in the corner, beside the group's first (centred) stage.
        out.push(svg("rect", { x: 16, y: t - 6, width: W - 32, height: b - t + 12, rx: 8, class: "group" }));
        labels.push(text(23, t + 7, g.label, "group-label"));
      } else {
        out.push(svg("rect", { x: l - 4, y: t - 20, width: r - l + 8, height: b - t + 25, rx: 8, class: "group" }));
        labels.push(text(l + 2, t - 7, g.label, "group-label"));
      }
    }
    // Right-angle edges, in the layout's direction. An edge turns in the gap next to the end with
    // several edges: just after a fork, just before a merge. So a fork or a merge reads as one
    // trunk, and lanes of different lengths run along their own row into the merge.
    const fanOut = new Set(EDGES.map(([a]) => a).filter((a, i, all) => all.indexOf(a) !== i));
    for (const [a, b] of EDGES) {
      const p = rect(a);
      const q = rect(b);
      let d: string;
      if (rail) {
        const turn = Math.round(fanOut.has(a) ? p.b + 8 : q.t - 8);
        d = Math.abs(p.cx - q.cx) < 1 ? `M${p.cx},${p.b} V${q.t - 1}` : `M${p.cx},${p.b} V${turn} H${q.cx} V${q.t - 1}`;
      } else {
        const turn = Math.round(fanOut.has(a) ? p.r + 7 : q.l - 7);
        d = Math.abs(p.cy - q.cy) < 1 ? `M${p.r},${p.cy} H${q.l - 1}` : `M${p.r},${p.cy} H${turn} V${q.cy} H${q.l - 1}`;
      }
      out.push(path(d, this.#taken.edges.has(`${a}>${b}`)));
    }
    // Forced steps skip the model and the gates; every tick ends back at the start.
    const ex = rect("extract");
    const act = rect("act");
    const obs = rect("observe");
    if (rail) {
      const right = W - 7;
      out.push(path(`M${ex.r},${ex.cy} H${right} V${act.cy} H${act.r + 1}`, this.#taken.bypass, true));
      out.push(text(right - 4, (ex.cy + act.cy) / 2, "forced step", "edge-label", 90));
      const left = 7;
      out.push(path(`M${act.l},${act.cy} H${left} V${obs.cy} H${obs.l - 1}`, false));
      out.push(text(left + 4, (obs.cy + act.cy) / 2, "next tick", "edge-label", -90));
    } else {
      const top = 7;
      out.push(path(`M${ex.cx},${ex.t} V${top} H${act.cx} V${act.t - 1}`, this.#taken.bypass, true));
      out.push(text((ex.cx + act.cx) / 2, top - 2, "forced step", "edge-label"));
      const bottom = H - 10;
      out.push(path(`M${act.cx},${act.b} V${bottom} H${obs.cx} V${obs.b + 1}`, false));
      out.push(text((obs.cx + act.cx) / 2, bottom + 10, "next tick", "edge-label"));
    }
    this.#svg.replaceChildren(...out, ...labels);
  }
}
