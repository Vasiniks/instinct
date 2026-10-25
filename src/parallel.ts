// Spreads the round simulations over worker threads without changing a single result. Every setup
// in `roundOdds` and every move in `roundOutcomes` is simulated with its own seeded generator, so
// splitting them across threads gives exactly the numbers one thread would. The callers stay
// synchronous: the main thread hands out the chunks and blocks on shared memory until the workers
// have written their results back, which keeps the decision code as it is.
//
// Off unless enabled (`enableParallel`): the dashboard and real-game batches turn it on; the
// simulator benchmarks already run many processes and leave it off.

import { cpus } from "node:os";
import { Worker } from "node:worker_threads";

let size = 0;
let workers: Worker[] = [];

/** Use up to `n` worker threads for the round simulations (0 turns it off). */
export function enableParallel(n = Math.max(1, Math.min(6, cpus().length - 2))): void {
  size = Math.max(0, Math.floor(n));
}

export const parallelism = () => size;

function pool(): Worker[] {
  while (workers.length < size) {
    const w = new Worker(new URL("./simworker.ts", import.meta.url));
    w.unref();
    workers.push(w);
  }
  return workers.slice(0, size);
}

export interface Chunk {
  /** The arguments for one worker's share, plain data. */
  args: unknown;
  /** How many numbers it writes back. */
  width: number;
}

/**
 * Runs `kind` on each chunk in a worker and returns each chunk's numbers, or undefined when a
 * worker failed or took too long (the caller then simulates on its own thread).
 */
export function fanOut(kind: "odds" | "outcomes", chunks: Chunk[], timeoutMs = 60_000): number[][] | undefined {
  const ws = pool();
  if (!ws.length || chunks.length < 2) return undefined;
  const total = chunks.reduce((a, c) => a + c.width, 0);
  const ctrl = new Int32Array(new SharedArrayBuffer(8));
  const out = new Float64Array(new SharedArrayBuffer(8 * Math.max(1, total)));
  let offset = 0;
  chunks.forEach((c, i) => {
    ws[i % ws.length].postMessage({ kind, args: c.args, offset, ctrl: ctrl.buffer, out: out.buffer });
    offset += c.width;
  });
  const deadline = Date.now() + timeoutMs;
  // ctrl[0] counts finished chunks; ctrl[1] is set when one failed.
  while (Atomics.load(ctrl, 0) < chunks.length) {
    const seen = Atomics.load(ctrl, 0);
    if (Date.now() > deadline) return undefined;
    Atomics.wait(ctrl, 0, seen, 1000);
  }
  if (Atomics.load(ctrl, 1)) return undefined;
  const results: number[][] = [];
  offset = 0;
  for (const c of chunks) {
    results.push(Array.from(out.subarray(offset, offset + c.width)));
    offset += c.width;
  }
  return results;
}
