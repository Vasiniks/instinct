// An in-process Balatro stand-in that speaks BlindDeck's methods and GameState shape, so the loop,
// the visualizer and the benchmark (tools/simbench.ts) run end to end without the game. Scoring
// reuses the agent's own evaluator on the true cards; everything around it follows the game's
// rules: the vanilla joker pool with growth and economy jokers, booster packs, Tarots, Planets and
// Spectrals, vouchers, skip tags, every boss, stakes and decks. The parts live in src/sim/.

export { simGame } from "./sim/game.ts";
