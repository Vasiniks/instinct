// Recorded runs. Every tick the agent logs to runs/*.jsonl carries the state it saw and the call it
// sent, so a run can be listed, viewed again, or replayed on the game from the same seed. Balatro is
// deterministic for a seed and the same actions, so a replay re-plays the run; it checks the state
// before every action against the recording and stops at the first difference.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { Snapshot } from "./extract.ts";
import type { TickRecord } from "./loop.ts";

export interface RunMeta {
  /** `<log file stem>~<run index in that file>` */
  id: string;
  startedAt: number;
  seed: string;
  deck: string;
  stake: string;
  /** The game the run was recorded on; a replay needs the same one. */
  game: "simulator" | "blinddeck";
  ticks: number;
  /** Calls that reached the game: what a replay sends. */
  actions: number;
  ante: number;
  result: string;
  model?: string;
}

export interface RecordedRun {
  meta: RunMeta;
  ticks: TickRecord[];
}

type LogLine = TickRecord & { raw?: unknown; game?: string };

const FILE = /^run-[\w-]+\.jsonl$/;
// The list keeps only each file's run summaries; a run's ticks are read again when it is opened.
const cache = new Map<string, { mtime: number; metas: RunMeta[] }>();

/** The ticks of a recorded run that sent a call to the game, minus starting it. */
export function replaySteps(run: RecordedRun): TickRecord[] {
  return run.ticks.filter((t) => t.call && t.result?.ok && !t.result.dryRun && t.call.method !== "start" && t.call.method !== "menu");
}

function parse(path: string): RecordedRun[] {
  const lines: LogLine[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      lines.push(JSON.parse(line));
    } catch {
      // A line cut off by a crash; the rest of the file is still good.
    }
  }
  // One log file is one server session, which can hold several runs. A run begins at the first
  // in-game tick after a start call, a new seed, or the round count going back down (a run started
  // from the visualizer's form, which is not a tick). Menu ticks still show the last run's seed.
  const groups: LogLine[][] = [];
  let seed: string | undefined;
  let round = 0;
  let started = false;
  for (const l of lines) {
    const inGame = l.snapshot && l.snapshot.phase !== "MENU" && l.snapshot.seed;
    if (inGame && (started || l.snapshot.seed !== seed || l.snapshot.round < round)) {
      groups.push([]);
      started = false;
    }
    if (inGame) {
      seed = l.snapshot.seed;
      round = l.snapshot.round;
    }
    if (l.call?.method === "start") started = true;
    if (!groups.length) groups.push([]);
    groups[groups.length - 1].push(l);
  }
  const stem = basename(path, ".jsonl");
  // A continuous session starts a new file per run, so a file can open on the menu ticks after the
  // last run ended; a run needs at least one in-game tick.
  return groups
    .filter((g) => g.some((l) => l.snapshot?.seed && l.snapshot.phase !== "MENU"))
    .map((g, index) => {
      const ticks = g.map(({ raw: _raw, game: _game, ...t }) => t as TickRecord);
      const first = g.find((l) => l.snapshot?.seed)!;
      const last = ticks[ticks.length - 1];
      const models = new Map<string, number>();
      for (const t of ticks) if (t.response?.model) models.set(t.response.model, (models.get(t.response.model) ?? 0) + 1);
      const s = last.snapshot;
      const over = ticks.find((t) => t.phase === "GAME_OVER");
      const seedName = first.snapshot.seed!;
      const meta: RunMeta = {
        id: `${stem}~${index}`,
        startedAt: g[0].at,
        seed: seedName,
        deck: first.snapshot.deck ?? "RED",
        stake: first.snapshot.stake ?? "WHITE",
        game: first.game === "simulator" || (!first.game && /^SIM\d+$/.test(seedName)) ? "simulator" : "blinddeck",
        ticks: ticks.length,
        actions: 0,
        ante: s.ante,
        result: over ? (over.snapshot.won ? `won at ante ${over.snapshot.ante}` : `lost at ante ${over.snapshot.ante}`) : `stopped at ante ${s.ante}, ${s.phase.replace(/_/g, " ").toLowerCase()}`,
        model: [...models.entries()].sort((a, b) => b[1] - a[1])[0]?.[0],
      };
      const run = { meta, ticks };
      meta.actions = replaySteps(run).length;
      return run;
    });
}

function metasIn(logDir: string, file: string): RunMeta[] {
  const path = join(logDir, file);
  try {
    const mtime = statSync(path).mtimeMs;
    const hit = cache.get(path);
    if (hit && hit.mtime === mtime) return hit.metas;
    const metas = parse(path).map((r) => r.meta);
    cache.set(path, { mtime, metas });
    return metas;
  } catch {
    // A file too big to read whole (over 512 MB) stays out of the list rather than breaking it.
    return [];
  }
}

/** Every recorded run, newest first. */
export function listRuns(logDir: string): RunMeta[] {
  let files: string[];
  try {
    files = readdirSync(logDir).filter((f) => FILE.test(f));
  } catch {
    return [];
  }
  return files
    .flatMap((f) => metasIn(logDir, f))
    .sort((a, b) => b.startedAt - a.startedAt);
}

export function loadRun(logDir: string, id: string): RecordedRun {
  const [stem, index] = id.split("~");
  const file = `${stem}.jsonl`;
  if (!FILE.test(file)) throw new Error(`no recorded run ${id}`);
  const run = parse(join(logDir, file))[Number(index)];
  if (!run) throw new Error(`no recorded run ${id}`);
  return run;
}

/** The first way the live state differs from the recording, or null when they match. */
export function stateDiff(want: Snapshot, got: Snapshot): string | null {
  const labels = (xs: { label: string }[]) => xs.map((x) => x.label).join(", ");
  const pairs: [string, unknown, unknown][] = [
    ["phase", want.phase, got.phase],
    ["ante", want.ante, got.ante],
    ["round", want.round, got.round],
    ["money", want.money, got.money],
    ["hand", labels(want.hand), labels(got.hand)],
    ["jokers", labels(want.jokers), labels(got.jokers)],
    ["shop", labels(want.shop), labels(got.shop)],
  ];
  for (const [name, a, b] of pairs) if (a !== b) return `${name} should be ${a || "empty"} but is ${b || "empty"}`;
  return null;
}
