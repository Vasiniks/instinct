// System One over plain HTTP: the same request works against cloud Jev and a local StartLux server.
// No SDK, so there is no request compression for the local server to trip on.

export type Criteria = Record<string, string | null> | string[];

export interface Question {
  type: "choice" | "noul" | "score";
  instructions: string;
  criteria?: Criteria;
}

export interface SystemOneRequest {
  model: string;
  state: unknown;
  questions: Record<string, Question>;
}

export interface ChoiceAnswer {
  type: "choice";
  choice: string | null;
  confidence: number;
  probabilities: Record<string, number>;
  /** Local StartLux servers add this (none_check); cloud Jev omits it. */
  none_probability?: number;
}

export interface NoulAnswer {
  type: "noul";
  noul: number;
}

export interface ScoreAnswer {
  type: "score";
  score: number;
  confidence: number;
  legend: Record<string, unknown>;
  probabilities: Record<string, number>;
}

export type Answer = ChoiceAnswer | NoulAnswer | ScoreAnswer;

export interface SystemOneResponse {
  model: string;
  answers: Record<string, Answer>;
  usage?: { input_tokens: number; output_tokens: number };
  latencyMs: number;
  requestId?: string;
}

/** Heuristic values a mock engine can lean on; real engines ignore them. */
export type Hints = Record<string, Record<string, number> | number>;

export interface Engine {
  name: string;
  ask(req: SystemOneRequest, hints?: Hints): Promise<SystemOneResponse>;
}

export interface HttpEngineConfig {
  baseUrl: string;
  apiKey: string;
  label: string;
  timeoutMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function httpEngine(cfg: HttpEngineConfig): Engine {
  const url = `${cfg.baseUrl.replace(/\/+$/, "")}/v1/systemone`;
  return {
    name: cfg.label,
    async ask(req) {
      let lastError = "";
      for (let attempt = 0; attempt < 4; attempt++) {
        const t0 = performance.now();
        let res: Response;
        try {
          res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}) },
            body: JSON.stringify(req),
            signal: AbortSignal.timeout(cfg.timeoutMs ?? 30_000),
          });
        } catch (e) {
          throw new Error(`System One unreachable at ${url}: ${(e as Error).message}`);
        }
        const text = await res.text();
        if (res.ok) {
          const body = JSON.parse(text) as Omit<SystemOneResponse, "latencyMs">;
          return { ...body, latencyMs: performance.now() - t0, requestId: res.headers.get("x-request-id") ?? undefined };
        }
        lastError = `System One ${res.status}: ${text.slice(0, 400)}`;
        // 429 and 502 are retryable; 401/422 are final.
        if (res.status !== 429 && res.status !== 502) break;
        await sleep(Number(res.headers.get("retry-after") ?? 1) * 1000 * (attempt + 1));
      }
      throw new Error(lastError);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Mock engine: offline stand-in that answers in the real response shape. Choice probabilities are
// the heuristic priors, sharpened and jittered, so the visualizer behaves like it would live.
// ---------------------------------------------------------------------------------------------

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function mockEngine(seed = 7, simulateLatency = true): Engine {
  const rand = mulberry32(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
  const softmax = (xs: number[]) => {
    const m = Math.max(...xs);
    const e = xs.map((x) => Math.exp(x - m));
    const s = e.reduce((a, b) => a + b, 0);
    return e.map((x) => x / s);
  };
  const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
  return {
    name: "mock",
    async ask(req, hints) {
      const t0 = performance.now();
      if (simulateLatency) await sleep(70 + rand() * 160);
      const answers: Record<string, Answer> = {};
      for (const [id, q] of Object.entries(req.questions)) {
        const hint = hints?.[id];
        if (q.type === "choice") {
          const keys = Array.isArray(q.criteria) ? q.criteria : Object.keys(q.criteria ?? {});
          const priors = typeof hint === "object" ? hint : {};
          const probs = softmax(keys.map((k) => Math.log((priors[k] ?? 1 / keys.length) + 1e-4) * 1.3 + gauss() * 0.55));
          const top = probs.indexOf(Math.max(...probs));
          const n = keys.length;
          answers[id] = {
            type: "choice",
            choice: keys[top],
            confidence: n > 1 ? clamp01((probs[top] - 1 / n) / (1 - 1 / n)) : 1,
            probabilities: Object.fromEntries(keys.map((k, i) => [k, Math.round(probs[i] * 1000) / 1000])),
            none_probability: Math.round((rand() < 0.07 ? 0.2 + rand() * 0.3 : rand() * 0.08) * 1000) / 1000,
          };
        } else if (q.type === "noul") {
          const base = typeof hint === "number" ? hint : 0.5;
          answers[id] = { type: "noul", noul: Math.round(clamp01(base + gauss() * 0.08) * 1000) / 1000 };
        } else {
          const levels = Array.isArray(q.criteria) ? q.criteria.length : Object.keys(q.criteria ?? {}).length;
          const center = typeof hint === "number" ? hint : (levels - 1) / 2;
          const probs = softmax(Array.from({ length: levels }, (_, i) => -((i - center - gauss() * 0.3) ** 2) / 0.8));
          const score = probs.reduce((s, p, i) => s + p * i, 0);
          const top = probs.indexOf(Math.max(...probs));
          const spread = probs.reduce((s, p, i) => s + p * Math.abs(i - top), 0);
          const even = Array.from({ length: levels }, (_, i) => Math.abs(i - (levels - 1) / 2)).reduce((a, b) => a + b, 0) / levels;
          answers[id] = {
            type: "score",
            score: Math.round(score * 100) / 100,
            confidence: Math.round(clamp01(1 - spread / (even || 1)) * 100) / 100,
            legend: Object.fromEntries((Array.isArray(q.criteria) ? q.criteria : []).map((c, i) => [String(i), c])),
            probabilities: Object.fromEntries(probs.map((p, i) => [String(i), Math.round(p * 1000) / 1000])),
          };
        }
      }
      return {
        model: "mock-system-one",
        answers,
        usage: { input_tokens: Math.round(JSON.stringify(req).length / 4), output_tokens: 0 },
        latencyMs: performance.now() - t0,
      };
    },
  };
}
