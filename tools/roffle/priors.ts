// Writes data/roffle/priors.json: per joker, how often Roffle took it when offered.
// Usage: node tools/roffle/priors.ts

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DATA, computePriors, loadDataset } from "./visits.ts";

const { videos, decisions } = loadDataset();
const priors = computePriors(videos, decisions);
writeFileSync(resolve(DATA, "priors.json"), JSON.stringify(priors, null, 1) + "\n");

const rows = Object.entries(priors.jokers).filter(([, t]) => t.offered > 0);
const offered = rows.reduce((a, [, t]) => a + t.offered, 0);
console.log(`${videos.length} videos, ${priors.source.visits} visits with jokers on offer, ${rows.length} jokers seen, ${offered} offers`);
console.log(`base take rate ${(priors.base * 100).toFixed(0)}% overall, ${(priors.baseEarly * 100).toFixed(0)}% in antes 1-3`);
console.log("most often taken (offered at least 3 times):");
for (const [key, t] of rows.filter(([, t]) => t.offered >= 3).sort((a, b) => b[1].taken / b[1].offered - a[1].taken / a[1].offered).slice(0, 12)) {
  console.log(`  ${key.padEnd(22)} ${t.taken}/${t.offered}`);
}
