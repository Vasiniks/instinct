// Tiny DOM helpers; the UI is plain TypeScript served with types stripped.

type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown> | null;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v as EventListener);
    else if (k === "class") el.className = String(v);
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k === "dataset" && typeof v === "object") Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  append(el, children);
  return el;
}

export function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, ...children: SVGElement[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of children) el.appendChild(c);
  return el;
}

function append(el: Element, children: (Child | Child[])[]) {
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
}

export function mount(target: Element, ...children: (Child | Child[])[]) {
  target.replaceChildren();
  append(target, children);
}

export const pct = (p: number | undefined, digits = 0) => (p === undefined || Number.isNaN(p) ? "–" : `${(p * 100).toFixed(digits)}%`);
export const ms = (n: number | undefined) => (n === undefined ? "–" : n < 1 ? "<1 ms" : n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(1)} s`);
export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// One shared tooltip for every chart.
let tip: HTMLDivElement | undefined;
export function showTip(e: MouseEvent, content: Node | string) {
  tip ??= document.body.appendChild(h("div", { class: "tip", role: "tooltip" }));
  tip.replaceChildren(typeof content === "string" ? document.createTextNode(content) : content);
  tip.hidden = false;
  const pad = 14;
  const { innerWidth: w, innerHeight: hgt } = window;
  const r = tip.getBoundingClientRect();
  tip.style.left = `${Math.min(e.clientX + pad, w - r.width - 8)}px`;
  tip.style.top = `${Math.min(e.clientY + pad, hgt - r.height - 8)}px`;
}
export function hideTip() {
  if (tip) tip.hidden = true;
}
export function withTip<T extends Element>(el: T, content: () => Node | string): T {
  el.addEventListener("mousemove", (e) => showTip(e as MouseEvent, content()));
  el.addEventListener("mouseleave", hideTip);
  return el;
}
