import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCandidates } from "../src/candidates.ts";
import { extract } from "../src/extract.ts";
import type { RawCard } from "../src/types.ts";
import { handState, joker } from "./helpers.ts";

const opts = { endless: false, maxOptions: 24 };
const deck52 = [..."23456789TJQKA"].flatMap((r) => [..."SHDC"].map((su) => `${r}${su}`));

test("a voucher that adds a hand each round is valued by the simulated bosses", () => {
  const g = handState([], { deck: deck52, jokers: [{ ...joker("j_jolly", { mult: 8 }), id: 900 }] });
  g.state = "SHOP";
  g.ante_num = 2;
  g.money = 30;
  g.blinds = { small: { type: "SMALL", status: "UPCOMING", name: "Small Blind", effect: "", score: 800 } };
  const grabber: RawCard = { id: 601, key: "v_grabber", set: "VOUCHER", label: "Grabber", value: { effect: "Permanently gain +1 hand per round" }, modifier: {}, state: {}, cost: { buy: 10, sell: 0 } };
  g.vouchers = { count: 1, limit: 1, cards: [grabber] };
  const buy = buildCandidates(extract(g), opts).candidates.find((c) => c.label.startsWith("Buy Grabber"))!;
  assert.match(buy.description, /with one more hand a round/);
});

test("a held Planet for the hand in play is judged by the round after using it", () => {
  const jupiter: RawCard = { id: 701, key: "c_jupiter", set: "PLANET", label: "Jupiter", value: { effect: "Level up Flush" }, modifier: {}, state: {}, cost: { buy: 3, sell: 1 } };
  const g = handState(["AH", "KH", "9H", "6H", "3H", "4S", "7C", "2D"], { remaining: 2600, hands: 2, discards: 1, deck: deck52.slice(0, 30), jokers: [{ ...joker("j_droll", { mult: 10 }), id: 900 }] });
  g.consumables = { count: 1, limit: 2, cards: [jupiter] };
  const list = buildCandidates(extract(g), opts).candidates;
  const use = list.find((c) => c.kind === "use" && c.label.includes("Jupiter"))!;
  assert.match(use.description, /Simulated: after it, the best move beats the blind in \d+%/);
  const flush = list.find((c) => c.estimate?.hand === "Flush")!;
  assert.ok(use.chance! >= flush.chance!, `after Jupiter ${use.chance}, flush now ${flush.chance}`);
});
