// What tools/simbench.ts reports per game and how tools/tune.ts sums it up; kept apart so tune.ts can
// import it without running a benchmark.

export interface GameResult {
  stake: string;
  seed: string;
  ante: number;
  won: boolean;
  failed: number;
  /** How it played, to set against expert play (data/roffle/policy.json): each shop left, by ante. */
  shops: { ante: number; exit: number; rerolls: number; bought: number }[];
  skips: number;
  /** Decisions the agent made (ticks short of the game's end). */
  decisions?: number;
}

/** Median shop-exit money and rerolls per visit by ante, the numbers expert play is read for. */
export function behavior(rs: GameResult[]): string {
  const byAnte = new Map<number, GameResult["shops"]>();
  for (const r of rs) for (const v of r.shops) byAnte.set(Math.min(v.ante, 9), [...(byAnte.get(Math.min(v.ante, 9)) ?? []), v]);
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
  const antes = [...byAnte.keys()].sort((a, b) => a - b);
  const visits = rs.reduce((a, r) => a + r.shops.length, 0);
  return `  shop exit $ (median) by ante: ${antes.map((a) => `${a}:${median(byAnte.get(a)!.map((v) => v.exit))}`).join(" ")}\n  rerolls per visit by ante: ${antes.map((a) => `${a}:${(byAnte.get(a)!.reduce((x, v) => x + v.rerolls, 0) / byAnte.get(a)!.length).toFixed(1)}`).join(" ")}\n  skips: ${rs.reduce((a, r) => a + r.skips, 0)} in ${rs.length} games; buys per visit ${(rs.reduce((a, r) => a + r.shops.reduce((x, v) => x + v.bought, 0), 0) / Math.max(1, visits)).toFixed(2)}`;
}
