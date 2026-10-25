// Visualizer server: serves the UI (TypeScript stripped on the fly, no build step), streams agent
// events over SSE, takes control commands, and serves the latest game screenshot.
//
//   npm start                 real game via BlindDeck, real model from TYPESAFE_BASE_URL (dry-run until LIVE)
//   npm start -- --live       same, sending actions from the start
//   npm run sim               built-in simulator + real model
//   npm run mock              simulator + mock model: no game, no model, everything visible

import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { stripTypeScriptTypes } from "node:module";
import { extname, join, normalize, resolve } from "node:path";
import { blindDeck } from "./blinddeck.ts";
import { loadConfig } from "./config.ts";
import { Agent, type AgentEvent } from "./loop.ts";
import { enableParallel } from "./parallel.ts";
import type { ReviewMode } from "./policy.ts";
import { listRuns, loadRun } from "./runs.ts";
import { simGame } from "./sim.ts";
import { type Engine, httpEngine, mockEngine } from "./systemone.ts";
import type { GameState } from "./types.ts";

const cfg = loadConfig();
// The round simulations on worker threads: same numbers, a few times faster.
enableParallel();
const uiDir = resolve(import.meta.dirname, "..", "ui");
const game = cfg.sim ? simGame(undefined, { endless: cfg.endless }) : blindDeck(cfg.balatroUrl);
// The mock model answers at once: it is code, and waiting out a made-up network delay only slows play.
const engines: Record<string, Engine> = cfg.mockModel
  ? { mock: mockEngine(7, false) }
  : { cloud: httpEngine(cfg.backends.cloud), local: httpEngine(cfg.backends.local) };
const agent = new Agent(game, engines, cfg);
agent.startScreenLoop();

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".ts": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

const stripped = new Map<string, { mtime: number; code: string }>();
function serveStatic(res: ServerResponse, path: string) {
  const file = normalize(join(uiDir, path === "/" ? "index.html" : path));
  if (!file.startsWith(uiDir) || !existsSync(file) || !statSync(file).isFile()) return send(res, 404, "not found");
  const ext = extname(file);
  if (ext === ".ts") {
    const mtime = statSync(file).mtimeMs;
    let hit = stripped.get(file);
    if (!hit || hit.mtime !== mtime) {
      hit = { mtime, code: stripTypeScriptTypes(readFileSync(file, "utf8"), { mode: "strip" }) };
      stripped.set(file, hit);
    }
    res.writeHead(200, { "Content-Type": MIME[".ts"], "Cache-Control": "no-cache" });
    return res.end(hit.code);
  }
  res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream", "Cache-Control": "no-cache" });
  createReadStream(file).pipe(res);
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": typeof body === "string" ? "text/plain" : "application/json" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let data = "";
  for await (const chunk of req) data += chunk;
  return data ? (JSON.parse(data) as Record<string, unknown>) : {};
}

const clients = new Set<ServerResponse>();
function sse(res: ServerResponse, e: AgentEvent | { type: "hello"; data: unknown }) {
  res.write(`event: ${e.type}\ndata: ${JSON.stringify(e.data)}\n\n`);
}
agent.subscribe((e) => {
  for (const c of clients) sse(c, e);
});

async function control(body: Record<string, unknown>) {
  switch (body.cmd) {
    case "run":
      agent.run();
      break;
    case "pause":
      agent.pause();
      break;
    case "step":
      await agent.step();
      break;
    case "set":
      agent.set({
        live: typeof body.live === "boolean" ? body.live : undefined,
        reviewMode: typeof body.reviewMode === "string" ? (body.reviewMode as ReviewMode) : undefined,
        tickDelayMs: typeof body.tickDelayMs === "number" ? body.tickDelayMs : undefined,
        screenshots: typeof body.screenshots === "boolean" ? body.screenshots : undefined,
        backend: body.backend === "cloud" || body.backend === "local" ? body.backend : undefined,
        preset: body.preset === "basic" || body.preset === "standard" || body.preset === "advanced" ? body.preset : undefined,
      });
      break;
    case "override":
      await agent.override(String(body.id));
      break;
    case "replay": {
      const run = loadRun(cfg.logDir, String(body.id));
      // Runs as long as the recording; progress and the result come back over SSE.
      void agent.replay(run).catch((e) => agent.pause(`Replay failed: ${(e as Error).message}`));
      break;
    }
    case "stop_replay":
      agent.pause();
      break;
    case "start_run":
      if ((await game.call<GameState>("gamestate")).state !== "MENU") await game.call("menu");
      await game.call("start", { deck: String(body.deck ?? "RED"), stake: String(body.stake ?? "WHITE"), ...(body.seed ? { seed: String(body.seed) } : {}) });
      await agent.step();
      break;
    default:
      throw new Error(`unknown command ${String(body.cmd)}`);
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (url.pathname === "/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      clients.add(res);
      sse(res, { type: "hello", data: { status: agent.status(), ticks: agent.ticks.slice(-150), screenAt: agent.screenAt } });
      req.on("close", () => clients.delete(res));
      return;
    }
    if (url.pathname === "/api/control" && req.method === "POST") {
      await control(await readJson(req));
      return send(res, 200, agent.status());
    }
    if (url.pathname === "/api/status") return send(res, 200, agent.status());
    if (url.pathname === "/api/ticks") return send(res, 200, agent.ticks);
    if (url.pathname === "/api/runs") return send(res, 200, listRuns(cfg.logDir));
    if (url.pathname.startsWith("/api/runs/")) return send(res, 200, loadRun(cfg.logDir, decodeURIComponent(url.pathname.slice("/api/runs/".length))));
    if (url.pathname === "/screen.png") {
      if (!existsSync(cfg.screenPath)) return send(res, 404, "no screenshot yet");
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
      return createReadStream(cfg.screenPath).pipe(res);
    }
    return serveStatic(res, url.pathname);
  } catch (e) {
    return send(res, 400, { error: (e as Error).message });
  }
});

server.listen(cfg.port, "127.0.0.1", () => {
  const lines = [
    `instinct visualizer  http://127.0.0.1:${cfg.port}`,
    `game     ${game.name}${cfg.live ? "" : "  (dry-run: toggle LIVE in the UI to send actions)"}`,
    `model    ${cfg.mockModel ? "mock answers" : `${cfg.backends[cfg.backend].label} -> ${cfg.backends[cfg.backend].baseUrl} (switch in the UI)`}`,
    `gates    none_probability >= ${cfg.gates.noneThreshold} abstains, confidence < ${cfg.gates.minConfidence} reviews (${cfg.reviewMode})`,
    `log      ${cfg.logDir}`,
  ];
  console.log(lines.join("\n"));
});
