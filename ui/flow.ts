// The agent loop as a decision tree: read the game -> list the moves -> plan the build -> assess
// the situation -> route by phase into one of four lanes, each a short chain of forks the code
// walks (blind: boss, skip; hand: free card, clear now, round tree; shop: outlook, joker row,
// targets; pack: kind, offers) -> value every move -> ask the model -> gates -> combine the
// model's pick with the values -> send, then back to the start. Nodes are HTML in a grid; edges
// are drawn from the measured node boxes. The path the shown tick took is drawn in blue, and each
// fork shows the way it went (hover for why).

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

const col = (c: number, row?: number) => ({ gridColumn: String(c), ...(row ? { gridRow: String(row) } : {}) });
const NODES: { id: NodeId; title: string; cls: string; style?: Partial<CSSStyleDeclaration> }[] = [
  { id: "observe", title: "Observe", cls: "main", style: col(1) },
  { id: "extract", title: "Extract", cls: "main", style: col(2) },
  { id: "plan", title: "Plan", cls: "main", style: col(3) },
  { id: "assess", title: "Assess", cls: "main", style: col(4) },
  // What the assess stage reads, side by side: each feeds the route.
  { id: "synergy", title: "Synergy", cls: "fork", style: col(5, 1) },
  { id: "deck", title: "Deck", cls: "fork", style: col(5, 2) },
  { id: "bosspool", title: "Boss pool", cls: "fork", style: col(5, 3) },
  { id: "planets", title: "Planets", cls: "fork", style: col(5, 4) },
  { id: "route", title: "Route", cls: "main", style: col(6) },
  { id: "boss", title: "Boss", cls: "fork", style: col(7, 1) },
  { id: "skip", title: "Skip?", cls: "fork", style: col(8, 1) },
  { id: "free", title: "Free card first?", cls: "fork", style: col(7, 2) },
  { id: "clear", title: "Clear now?", cls: "fork", style: col(8, 2) },
  { id: "tree", title: "Round tree", cls: "fork", style: col(9, 2) },
  { id: "outlook", title: "Outlook", cls: "fork", style: col(7, 3) },
  { id: "row", title: "Joker row", cls: "fork", style: col(8, 3) },
  { id: "targets", title: "Targets", cls: "fork", style: col(9, 3) },
  { id: "packkind", title: "Pack", cls: "fork", style: col(7, 4) },
  { id: "offers", title: "Offers", cls: "fork", style: col(8, 4) },
  { id: "value", title: "Value", cls: "main", style: col(10) },
  { id: "ask", title: "Ask", cls: "main", style: col(11) },
  { id: "gate", title: "Gate", cls: "main", style: col(12) },
  { id: "pass", title: "Passed", cls: "outcome", style: col(13, 1) },
  { id: "review", title: "Review", cls: "outcome", style: { gridColumn: "13", gridRow: "2 / 4" } },
  { id: "abstain", title: "Abstain", cls: "outcome", style: col(13, 4) },
  { id: "combine", title: "Combine", cls: "main", style: col(14) },
  { id: "act", title: "Act", cls: "act" },
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

  constructor() {
    this.#svg = svg("svg", { class: "flow-edges", "aria-hidden": "true" });
    this.el = h("div", { class: "flow", role: "group", "aria-label": "Agent loop flow chart" }, this.#svg);
    for (const n of NODES) {
      // A node shows its name and time; what it did (and why) shows on hover.
      const detail = h("span", { class: "node-detail" });
      const metric = h("span", { class: "node-metric" });
      const el = h("div", { class: `node ${n.cls}`, style: n.style, tabindex: "0" }, h("span", { class: "node-title" }, n.title), detail, metric);
      withTip(el, () => {
        const why = detail.title && detail.title !== detail.textContent ? detail.title : "";
        return h("div", null, h("p", { class: "tip-title" }, n.title), detail.textContent ? h("p", null, detail.textContent) : null, why ? h("p", { class: "tip-meta" }, why) : null, metric.textContent ? h("p", { class: "tip-meta" }, metric.textContent) : null);
      });
      this.#nodes[n.id] = { el, detail, metric };
      this.el.append(el);
    }
    new ResizeObserver(() => this.#draw()).observe(this.el);
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
    for (const n of NODES) {
      const el = this.#nodes[n.id].el;
      el.classList.toggle("taken", this.#taken.nodes.has(n.id));
      el.classList.toggle("dim", Boolean(t) && !this.#taken.nodes.has(n.id) && n.cls !== "outcome");
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
    // Right-angle edges: across, down or up at the midpoint of the gap, across again. Edges that fan
    // out of one node share that vertical, so a fork reads as one trunk with branches.
    for (const [a, b] of EDGES) {
      const p = rect(a);
      const q = rect(b);
      const mid = Math.round((p.r + q.l) / 2);
      const d = Math.abs(p.cy - q.cy) < 1 ? `M${p.r},${p.cy} H${q.l - 1}` : `M${p.r},${p.cy} H${mid} V${q.cy} H${q.l - 1}`;
      out.push(path(d, this.#taken.edges.has(`${a}>${b}`)));
    }
    // Forced steps skip the model and the gates.
    const ex = rect("extract");
    const act = rect("act");
    const top = 9;
    out.push(path(`M${ex.cx},${ex.t} V${top} H${act.cx} V${act.t - 1}`, this.#taken.bypass, true));
    out.push(svg("text", { x: (ex.cx + act.cx) / 2, y: top - 3, "text-anchor": "middle", class: "edge-label" }));
    (out[out.length - 1] as SVGTextElement).textContent = "forced step";
    // Every tick ends back at the start once the game settles.
    const obs = rect("observe");
    const bottom = box.height / z - 12;
    out.push(path(`M${act.cx},${act.b} V${bottom} H${obs.cx} V${obs.b + 1}`, false));
    out.push(svg("text", { x: (obs.cx + act.cx) / 2, y: bottom + 12, "text-anchor": "middle", class: "edge-label" }));
    (out[out.length - 1] as SVGTextElement).textContent = "next tick";
    this.#svg.replaceChildren(...out);
  }
}
