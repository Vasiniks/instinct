// Runtime configuration from env + flags. TYPESAFE_BASE_URL picks the starting backend; both
// backends are configured so the visualizer can switch between them without a restart.

import { resolve } from "node:path";
import type { Gates, ReviewMode } from "./policy.ts";

export type BackendName = "cloud" | "local";

export interface BackendConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  label: string;
}

export interface Config {
  port: number;
  sim: boolean;
  mockModel: boolean;
  balatroUrl: string;
  backend: BackendName;
  backends: Record<BackendName, BackendConfig>;
  gates: Gates;
  reviewMode: ReviewMode;
  /** Send actions to the game. Off means dry-run: decide, show, send nothing. */
  live: boolean;
  tickDelayMs: number;
  screenshots: boolean;
  screenIntervalMs: number;
  screenPath: string;
  autoStart?: { deck: string; stake: string; seed?: string };
  endless: boolean;
  /** Use the expert priors from data/roffle/priors.json when present. */
  expert: boolean;
  /** After a run ends, start the next one instead of pausing (needs autoStart). */
  continuous?: boolean;
  logDir: string;
  /**
   * Simulator recordings kept in logDir: older ones are deleted when a new one starts (0 keeps
   * all). Real-game recordings are never deleted.
   */
  keepRuns?: number;
  /** Write no tick log (the simulator benchmarks, which only want each game's result). */
  noLog?: boolean;
}

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const next = argv[i + 1];
  return next && !next.startsWith("--") ? next : "true";
}

export function loadConfig(argv = process.argv.slice(2), env = process.env): Config {
  const root = resolve(import.meta.dirname, "..");
  const sim = flag(argv, "sim") !== undefined;
  const baseUrl = (env.TYPESAFE_BASE_URL ?? "https://api.typesafe.ai").replace(/\/+$/, "");
  const local = /localhost|127\.0\.0\.1/.test(baseUrl);
  const key = env.TYPESAFE_API_KEY?.trim() ?? "";
  // `||`, not `??`: an exported-but-empty variable means unset.
  const envModel = env.DECISION_MODEL || env.TYPESAFE_DEFAULT_MODEL;
  const reviewMode = (flag(argv, "review") ?? env.REVIEW_MODE ?? "blend") as ReviewMode;
  const backendFlag = flag(argv, "backend");
  const deck = flag(argv, "deck") ?? env.BALATRO_DECK;
  const seed = flag(argv, "seed") ?? env.BALATRO_SEED;
  return {
    port: Number(flag(argv, "port") ?? env.INSTINCT_PORT ?? 8765),
    sim,
    mockModel: flag(argv, "mock-model") !== undefined,
    balatroUrl: env.BALATRO_API_URL ?? "http://127.0.0.1:12346",
    backend: backendFlag === "cloud" || backendFlag === "local" ? backendFlag : local ? "local" : "cloud",
    backends: {
      cloud: {
        baseUrl: local ? "https://api.typesafe.ai" : baseUrl,
        apiKey: key === "local" ? "" : key,
        model: env.CLOUD_MODEL || (!local && envModel) || "jev-latest",
        label: "cloud Jev",
      },
      local: {
        baseUrl: (env.LOCAL_DECISION_URL || (local ? baseUrl : "http://localhost:8090")).replace(/\/+$/, ""),
        // A local server without keys ignores auth; the header only has to be non-empty.
        apiKey: "local",
        model: env.LOCAL_MODEL || (local && envModel) || "StartLux-Decision-v1.1-4B-Instant",
        label: "local StartLux",
      },
    },
    gates: {
      noneThreshold: Number(env.NONE_THRESHOLD ?? 0.2),
      minConfidence: Number(env.MIN_CONFIDENCE ?? 0.55),
    },
    reviewMode: ["blend", "fallback", "model", "pause"].includes(reviewMode) ? reviewMode : "blend",
    live: sim || flag(argv, "live") !== undefined,
    tickDelayMs: Number(flag(argv, "delay") ?? env.TICK_DELAY_MS ?? 600),
    screenshots: !sim && flag(argv, "no-screen") === undefined,
    screenIntervalMs: Number(env.SCREEN_INTERVAL_MS ?? 2000),
    screenPath: resolve(root, "runs", "screen.png"),
    autoStart: sim || deck ? { deck: deck ?? "RED", stake: flag(argv, "stake") ?? env.BALATRO_STAKE ?? "WHITE", ...(seed ? { seed } : {}) } : undefined,
    endless: flag(argv, "endless") !== undefined,
    expert: flag(argv, "no-expert") === undefined,
    continuous: flag(argv, "continuous") !== undefined,
    logDir: resolve(root, "runs"),
    keepRuns: Number(flag(argv, "keep-runs") ?? env.KEEP_RUNS ?? 3),
  };
}
