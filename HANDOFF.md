# Handoff: Jev ↔ StartLux local + Balatro controller

Date: 2026-10-22. Dir: `/Users/admin/Documents/GitHub/instinct` (moved from `~/Desktop/jev test`).

## Goal
Play Balatro with a fast decision model behind a Python policy loop. Cloud Jev first
(verified), then an entirely local 4-bit decision model (verified, including a full
3-question tick), same code, one env var swap, zero ambiguity about which backend answered.

## Status (both backends verified live)
- **Cloud Jev:** `TYPESAFE_API_KEY` (real, 108 chars) linked globally in shell
  `~/.zshrc` + Claude Code `~/.claude/settings.json` env. Verified
  `POST https://api.typesafe.ai/v1/systemone` → `{"model":"jev-1.14.0", ...}`.
- **Local StartLux 4-bit:** `StartLux-Decision-v1.1-4B-Instant-MLX-4bit` served on
  `:8090` via `startlux-decide serve --model models/StartLux-Decision-4B-MLX-4bit
  --backend mlx --port 8090` (from `StartLux-Decision/`). Minimal Noul verified,
  then a full complex tick verified (below).
- **Complex tick result (local 4-bit, Balatro-flavored state):**
  `next_play: play_hand @ conf 0.42 (0.565/0.324/0.022/0.088), none_p 0.009` →
  policy says **REVIEW:play_hand** (confidence < 0.55, genuine play/discard split).
  `take_shop noul 0.23` → don't shop. `hand_quality score 1.09` ("playable") @
  conf 0.26, spread 0.20/0.51/0.29 → hedging. Model field:
  `StartLux-Decision-4B-MLX-4bit`. Loop is end-to-end working; gates caught a
  would-be overconfident auto-execute.
- **Routing rule:** `TYPESAFE_BASE_URL` picks the backend. Response `model` field
  is ground truth (`jev-...` = cloud, `StartLux-Decision-...` = local).

## TypeScript agent + visualizer (2026-10-22, second session)
No build step, no runtime deps: Node 24 runs the `.ts` files directly, and the server strips
types from `ui/*.ts` on the fly. `npm install` only pulls `typescript` + `@types/node` for checks.

- BlindDeck installed at `~/Library/Application Support/Balatro/Mods/balatrobot` (clone of
  FFFishes7/blinddeck, v1.5.2). Balala injects Lovely into the Steam Balatro; the mod serves
  JSON-RPC on `127.0.0.1:12346` by itself. Not yet run against the live game.
- `npm start` -> http://127.0.0.1:8765. Real game + `TYPESAFE_BASE_URL` model, dry-run until the
  Live switch is on. `npm run sim` (simulator + real model), `npm run mock` (simulator + mock model).
  `npm test` (27 tests), `npm run typecheck`.
- `scripts/play.sh` launches Balala with watch-friendly BlindDeck env (60 fps animations,
  gamespeed 2, motion on). Without it the mod uses bot defaults (10 fps animations, 4x speed).
- Center of the UI is the real game only (user rejected a re-rendered board): BlindDeck
  `screenshot` every 0.7 s + after each action, or "Embed Balatro window" = browser
  getDisplayMedia live capture (pauses screenshots). Right: values (run-strength Score +
  sparkline, phase Noul), calls (System One request/response, BlindDeck call), reply
  probabilities (keyed animated bars, heuristic ghost marker, confidence + none gates,
  click-to-send when paused). Bottom: observe/extract/ask/gate/act loop + tick timeline.
- `src/extract.ts` full GameState -> Snapshot + compact model state (hands >16 cards summarized).
  `src/options.ts` play/discard options by rank/suit groups (linear; 104-card hand < 5 ms,
  respects raised `highlighted_limit`). `src/poker.ts` hand detection + joker-aware estimate
  (~50 vanilla jokers by key, unknown/Cryptid jokers use live `value.stats`, flagged approximate).
  `src/candidates.ts` per-phase options (<= 24) with descriptions + exact RPC call.
  `src/strategy.ts` general strategy + questions (`action` Choice, `position` Score, `risk` Noul).
  `src/policy.ts` same gates as the Python controller; review mode fallback/model/pause.
  `src/loop.ts` agent loop, logs every tick + raw gamestate to `runs/*.jsonl`.
- Live runs on the real game (cloud Jev, local 8090 server was down), 0 failed game calls:
  run 1 lost ante 3 big blind (evalatro-formula score 21); after fixing never-discarding,
  Buffoon packs with full slots and spend-to-$0, run 2 lost to The Window at 9221/10000
  (ante 4 boss, score 33.1, 103 decisions in 55 s). Score estimates matched actual chips on
  every play checked. Weakest part now: shop. Model confidence there is almost always < 0.55,
  so the heuristic decides, and with full joker slots it hoards money instead of rerolling
  or replacing weak jokers.
- Still open: evalatro not installed (it runs its own agent over balatrobot with an
  OpenAI-compatible model, so it needs an adapter); targeted Tarot heuristics are rough.

## Files in this dir
- `balatro_controller.py` — decision loop. One System One call per tick with three
  speculative questions: `next_play` (Choice over legal actions), `take_shop`
  (Noul), `hand_quality` (Score weak/playable/strong). Policy gates in
  `apply_policy`: `none_probability >= 0.2` → ABSTAIN (StartLux guidance),
  `choice is None` (allow_none) → ABSTAIN, `confidence < 0.55` → REVIEW.
  Dry-run by default; `--execute` + `BALATRO_API_URL` sends (stub TODO).
  Compile-checked (`COMPILE_OK`, `--help` works).
- `requirements.txt` — `typesafe-sdk`.
- `.env.example` — backend swap template (local default).
- `StartLux-Decision/` — upstream clone (do not edit; reference for
  `docs/api.md`, `docs/deployment.md`, `docs/engines.md`).
- `HANDOFF.md` — this file.

## Backend swap (global, unambiguous)
| Want | `TYPESAFE_BASE_URL` | `DECISION_BACKEND` | Served `model` shows |
|---|---|---|---|
| Local 4-bit (current) | `http://localhost:8090` | `local-startlux-4bit-mlx` | `StartLux-Decision-...` |
| Cloud Jev | `https://api.typesafe.ai` | `cloud-jev` | `jev-...` |

Set in **both** `~/.zshrc` and `~/.claude/settings.json` env, then restart Claude
Code. Check any time: `python balatro_controller.py --check`. Local server must be
running for the local row (user's own terminal — sandboxed tools cannot reach
`localhost`).

## Run
```bash
pip install -r requirements.txt
# local 4-bit server (from Startlux-Decision/):
startlux-decide serve --model models/StartLux-Decision-4B-MLX-4bit --backend mlx --port 8090
# backend proof (user terminal — sandbox cannot reach localhost):
curl -s localhost:8090/v1/systemone -H 'Content-Type: application/json' -d '{"state":"test","questions":{"x":{"type":"noul","instructions":"Is this a test?"}}}'
# controller:
python balatro_controller.py --check
python balatro_controller.py --glance glance.txt --actions play_hand,discard,shop,skip_blind
```

## Balatro plan (next session)
1. Get state without writing Lua: use **BlindDeck** (`glance`/`query`, OpenRPC at
   `src/lua/utils/openrpc.json`) or **balatro-agent** (MCP) on top of **BalatroBot**
   JSON-RPC. Custom Lua only if a needed field is missing.
2. Finish `send_to_game` TODO: map `verdict["action"]` to BlindDeck methods.
3. Open decision from this session: add exact-hand evaluator hook so
   `play_hand vs discard` stops being a model coin flip (model stays semantic
   layer: shop timing, skip judgment), OR narrow the Choice / tune `min-confidence`
   on logged outcomes. User has not picked yet — ask.
4. Milestones: legal-hand tick → full run → Ante 8. Score runs on `evalatro`.
5. Later optimization: composite scores + weights in code, then feature-discovery
   loop (judgments → CatBoost). Same loop shape as now.

## Gotchas learned
- zsh: never paste commands with trailing `# comment` (→ `bad pattern`). MLX
  extra is `pip install -e '.[mlx]'` (pyproject: vllm/transformers/llamacpp/mlx).
- Serve **must** pass `--backend mlx` on Mac (default is vllm → errors about
  `--vllm-url`). Never `ollama pull` this model: causal read loses ~27pts.
- `soundfile`/`libsndfile` breakage blocked first serve: fixed by
  `brew reinstall libsndfile` + `pip install --force-reinstall --no-cache-dir
  soundfile` (env is pyenv 3.14.2; fallback would be Python 3.12/3.13).
- My sandboxed Bash cannot reach `localhost:8090` (`Operation not permitted`);
  always test the local server from the user's own terminal.
- 4-bit chosen over 8-bit (smaller/faster; 96.3–97.5% BF16 agreement vs
  99.5–99.6%). Keep the 0.2 `none_probability` gate — game moves are already its
  weakest case per StartLux Limitations.
- StartLux limits: no `Box`, max 26 options/pass (knockout rounds above), Instant
  never thinks (`think_mode auto/always` → 422), confidence overstates selection
  accuracy → keep own thresholds.
- License: StartLux weights `CC BY-NC-4.0` (research/non-commercial; commercial
  needs StartLux Labs license). Jev cloud is the commercial path.

## Links
- TypeSafe quickstart / function-calling / fan-out / composite-scoring:
  `https://docs.typesafe.ai/introduction/quickstart.md`,
  `https://docs.typesafe.ai/cookbooks/function_calling.md`,
  `https://docs.typesafe.ai/patterns/fan-out.md`,
  `https://docs.typesafe.ai/patterns/composite-scoring.md`
- StartLux model / API / repo:
  `https://huggingface.co/startlux-models/StartLux-Decision-v1.1-4B-Instant`,
  `https://github.com/StartLuxLabs/StartLux-Decision/blob/main/docs/api.md`
- Balatro: `https://github.com/coder/balatrobot`,
  `https://github.com/Attol8/balatro-ai`,
  `https://github.com/FFFishes7/blinddeck`,
  `https://github.com/Arcadi4/balatro-agent`,
  `https://github.com/alesha-pro/evalatro`
