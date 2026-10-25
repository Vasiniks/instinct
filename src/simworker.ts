// A worker thread for src/parallel.ts: runs its share of `roundOdds` setups or `roundOutcomes`
// moves and writes the numbers into the shared buffer it was given.

import { parentPort } from "node:worker_threads";
import { bossEffects, roundOdds, roundOutcomes, type Move, type Setup } from "./round.ts";
import type { Snapshot } from "./extract.ts";

interface OddsArgs {
  s: Snapshot;
  setups: Setup[];
  target: number;
  hands: number;
  discards: number;
  samples: number;
  boss?: { name: string; handSize: number };
  ahead: number;
}

interface OutcomesArgs {
  s: Snapshot;
  moves: Move[];
  samples: number;
}

parentPort!.on("message", (m: { kind: "odds" | "outcomes"; args: unknown; offset: number; ctrl: SharedArrayBuffer; out: SharedArrayBuffer }) => {
  const ctrl = new Int32Array(m.ctrl);
  const out = new Float64Array(m.out);
  try {
    if (m.kind === "odds") {
      const a = m.args as OddsArgs;
      const odds = roundOdds(a.s, a.setups, a.target, a.hands, a.discards, a.samples, a.boss ? bossEffects(a.boss.name, a.boss.handSize) : undefined, a.ahead);
      odds.forEach((v, i) => (out[m.offset + i] = v));
    } else {
      const a = m.args as OutcomesArgs;
      const res = roundOutcomes(a.s, a.moves, a.samples);
      res.forEach((o, i) => out.set([o.clear, o.reach, o.spare, o.samples], m.offset + 4 * i));
    }
  } catch {
    Atomics.store(ctrl, 1, 1);
  }
  Atomics.add(ctrl, 0, 1);
  Atomics.notify(ctrl, 0);
});
