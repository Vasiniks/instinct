# Roffle Lite decisions dataset

What Roffle (YouTube: Roffle Lite) chose across twenty Balatro videos (21 runs: 15 at Gold Stake, 5 at
White and 1 at Red, on 9 decks): blinds played and skipped,
jokers and consumables bought, picked, sold and used, vouchers, rerolls, and the cards he played
and discarded. For each choice it records the jokers he held, what the shop or pack offered, what
his mouse rested on before he chose, the ante, and what he was saying. It is made for teaching the
agent long-term build play, with the most detail on the early game (antes 1 to 3).

Everything is extracted locally from the videos and their YouTube auto-captions. No language or
vision model API is used (no Jev, no local StartLux).

## Files

| File | What it holds |
| - | - |
| `videos.json` | The videos: id, title, url, duration, upload date, `kind` (`early` or `endless`) and why each was picked, runs, decision counts by type and phase, ante cross-check |
| `decisions.jsonl` | One decision per line, all videos (schema below) |
| `<video_id>.json` | Per video: joker and consumable lineups, screen segments, HUD readings, shop and pack offers, blinds played, skips, shop visits, runs |
| `<video_id>.decisions.jsonl` | The same decisions, one video at a time |
| `priors.json` | Per joker: times offered, taken (and in antes 1 to 3), sold, looked over and passed. Written by `node tools/roffle/priors.ts`; the agent reads it |
| `style.json` | How he plays hands: hand types by phase and deck, kickers, hands and discards per blind, rerolls, vouchers, skips. Written by `node tools/roffle/style.ts --json` |
| `policy.json` | Numeric policies by stake (White, Gold, Red) and ante, each with its count: money on leaving the shop, rerolls, skips and tags, packs, vouchers, consumables, joker sales, hand types. Written by `node tools/roffle/policy.ts` (see Policies below) |
| `catalog/jokers.json` | All 150 vanilla jokers from the game files: key, name, rarity, cost, sprite position, effect text, config |
| `catalog/consumables.json` | Tarot, planet, spectral and voucher names by key |
| `catalog/blinds.json` | The 30 blinds: name, HUD colour, score multiplier, boss and showdown flags, earliest ante |
| `catalog/tags.json` | The 24 skip tags |
| `videos/`, `catalog/sprites/` | Downloaded videos, captions and sprite crops; kept out of git |

## Decision schema (`decisions.jsonl`)

Fields from the first version keep their names and meaning; everything else was added.

| Field | Meaning |
| - | - |
| `video_id`, `t_seconds`, `youtube_url` | Where it happened; the url jumps to that second |
| `type` | Jokers: `buy_joker`, `pack_pick_joker`, `gain_joker` (made by another card, a tag or Invisible Joker), `sell_joker`, `lose_joker` (destroyed or expired), `reorder_jokers`. Consumables: `buy_consumable`, `pack_pick_consumable`, `gain_consumable`, `use_consumable`, `sell_consumable`. New: `select_blind`, `skip_blind`, `buy_voucher`, `reroll`, `play_hand`, `discard` |
| `item` | `{key, name, edition, stickers}`: the joker, consumable or voucher; the blind for `select_blind`; the tag taken for `skip_blind` (null if not recognised); null for `reorder_jokers`, `reroll`, `play_hand`, `discard` |
| `jokers_before`, `jokers_after` | The joker row, left to right. For the new types both hold the row at that moment |
| `consumables_before`, `consumables_after` | The consumable slots around a consumable decision |
| `screen` | `shop`, `pack`, `blind_select`, `hand`, `cash_out` or `other`: where the choice was made |
| `offered` | What the shop (cards and voucher) or pack showed just before; for `reroll`, the shelf before it |
| `offered_after` | `reroll` only: the shelf it produced |
| `reroll` | `reroll` only: `{cost, index}`, the price paid and which reroll of that shop visit it was |
| `pack` | Pack name read from the screen (for example `Mega Buffoon Pack`), when readable |
| `ante`, `round` | From the order of blinds played (see below); `ante_source` says `blinds`, or `ocr` when no blind had been seen yet |
| `ante_ocr`, `round_ocr` | What tesseract read on the HUD near the decision, kept as a cross-check |
| `phase` | `early` (ante 1 to 3), `mid` (4 to 8) or `endless` (9 and up) |
| `blind` | The blind being played or just played, `{key, name}`; for `skip_blind`, the blind skipped |
| `boss` | The boss of that ante, once it has been played |
| `score_target`, `score_scale` | The blind's "Score at least" number (or `"naneinf"`), and its order of magnitude as `1eN` |
| `money_before`, `money_after` | HUD money near the decision; null when OCR failed |
| `cards`, `hand` | `play_hand` and `discard` only: the cards played or discarded (`{rank, suit, enhancement, edition, seal}`) and the whole hand before |
| `cards_lifted` | `play_hand` only, when `cards` was read off the play area: the partial lift seen in the hand first |
| `play_evidence` | `play_hand` and `discard`: play-area fill within 3 s and 6 s, and hand size before and after, which decided the type |
| `targets` | `use_consumable` only: the cards that left the hand as the tarot was used (The Hanged Man, Strength...) |
| `hovered` | Shop, pack and blind select decisions: what the cursor rested on since the previous choice in that visit, `[{key, name, seconds}]`. Keys are item keys (`j_*`, `c_*`, `v_*`), held jokers, or UI elements (`reroll`, `next_round`, `skip_pack`, `select:bl_small`, `skip:bl_big`, `panel:boss`). A shop item hovered but not bought is something he considered and passed on |
| `cursor_on`, `click_confirmed` | The element under the cursor just before the decision, and whether it was the thing acted on (the card bought, the Reroll button, the column's Select or Skip button). Null when the cursor wasn't seen |
| `transcript` | Auto-caption text from 30 s before to 20 s after |
| `jokers_mentioned` | Jokers named in that text, matched fuzzily against the catalog |
| `reason` | `{label, confidence, evidence}`: rule-based label (`economy`, `xmult`, `scaling`, `synergy`, `replace_weak`, `chips_mult`, `unknown`), a heuristic confidence (not a probability), and the matched keywords |
| `pivot` | `{confidence, evidence}`: heuristic confidence that the choice is part of a pivot |
| `detection` | How the decision was found, the classifier's confidence for the item, an overall `high`/`medium`/`low`, and notes |

`<video_id>.json` adds `blinds` (every blind played: start, end, key, name, ante, round, boss flag,
score target), `skips`, `shops` (per shop visit: ante, rerolls, money spent on them, what was
bought), `packs` (one per pack opened: start, end, type, `size` `mega` or `normal/jumbo`, name
readings, the cards on offer that fit its type), `ante_check` (OCR agreement, offset, blinds merged,
ante vouchers found missing) and `cursor_seen` (share of seconds with the cursor found);
`pack_offers_raw` keeps the first pass's pack offers, and `pack_reads` the per-second name
readings (in the six videos run after it was added; `packs.py --cached` reuses them). Decisions made in a pack keep the first pass's `pack` and `offered` as `pack_first_pass`
and `offered_first_pass`. Run records in
`runs` borrow balatro-run-tracker's field names: `ante_reached`, `round_reached`, `money`, `jokers`.

## How it works

1. **Videos**: `tools/roffle/fetch.sh ID...` downloads 720p video only with yt-dlp, plus English
   auto-captions (json3) with curl, since yt-dlp's caption requests get HTTP 429.
2. **Catalog**: `tools/roffle/catalog.py` reads `game.lua`, `localization/en-us.lua`, the joker,
   blind chip and tag atlases out of `Balatro.love` (read only).
3. **Analysis**: `tools/roffle/analyze.py ID...` (with `early.py`) reads a frame every second for
   the screen and the mouse, and every 2 s for the rest:
   - **Screens**: template matching on UI text cut from his frames (`tools/roffle/templates/`).
   - **Jokers, consumables, shop, vouchers, packs**: BalatroEngine's pretrained shop pipeline
     (YOLO detector plus MobileNet classifier for key, edition, stickers, debuff).
   - **Blinds**: the HUD's blind plate colour (each boss has its own, from `game.lua`) narrows it
     to five, and the chip sprite next to it (`BlindChips.png`) picks one. Real blinds match their
     chip at 0.8 to 0.97, so anything under 0.6 is ignored.
   - **Ante and round**: walking the blinds played in order. The round goes up with every blind
     and the ante after every boss; Hieroglyph and Petroglyph set it back by one; a new run resets
     both; endless keeps counting. A Big Blind or boss with no blind before it in its ante means a
     skip. If most OCR readings agree on a constant offset (a video starting mid-run), the count
     is shifted by it; otherwise OCR is only a cross-check.
   - **Blind select**: which column is up (it carries the orange Select button) and the tag next
     to Skip Blind, matched on the icon inside the tag badge.
   - **Rerolls**: the Reroll price going up by exactly $1 within one shop visit, read twice before
     it counts. **Vouchers**: seen twice in the slot, then gone for the rest of the visit, with the
     money going down.
   - **Plays and discards**: BalatroEngine's card model reads the hand and which cards are lifted.
     Lifted cards that are gone from the hand 2 s later were played if the play area filled with
     cards right after, discarded if not. Cards that leave as a tarot is used become its `targets`.
   - **Mouse**: the white arrow cursor, matched as a shape on the frame's white pixels (0.85 and
     up), mapped to the item boxes and buttons on screen.
   - **HUD**: money and OCR ante with tesseract; the blind target with tesseract on its red
     pixels only.
4. **Second passes** over a video's outputs:
   - `tools/roffle/played.py` reads the play area right after each `play_hand` and replaces a
     partial lift with the cards played (the lift is kept as `cards_lifted`);
   - `tools/roffle/rerolls.py` re-reads the Reroll price every second through each shop visit and
     rebuilds the `reroll` decisions and the shop summaries;
   - `tools/roffle/packs.py` re-reads the pack name panel every second through each pack screen
     and rebuilds `packs`, one entry per pack opened, with its type, Mega or not, and the cards on
     offer that fit its type (see Packs below);
   - `tools/roffle/antes.py` re-derives ante and round from the blinds played without reading
     frames: a blind that starts with no shop, cash out or blind select screen since the one before
     is merged into it (a chip misread for a moment), and where shifting the rest of a run down by
     one or two antes makes clearly more of the HUD's OCR ante readings agree (8 readings and 3%
     at least), the count drops there: a Hieroglyph or Petroglyph bought without the voucher being
     seen. Decisions, shop visits and skips are dated again.
5. **Clean-up rules**, all in `analyze.py`, run again by `collect.py`: misread cards that vanish
   and come back, buys next to a pack screen with no shop evidence, Invisible Joker copies, run
   splits (see the code comments). Runs take ante and round reached from the blinds played.
6. **Merge**: `tools/roffle/collect.py` writes `videos.json` and `decisions.jsonl`.

To re-run from scratch:

```bash
python3 -m pip install --use-deprecated=legacy-certs --target tools/roffle/.vendor --no-deps yt-dlp "torchvision==0.27.1" ultralytics
git clone --depth 1 https://github.com/manwhar/BalatroEngine tools/roffle/vendor/BalatroEngine
python3 tools/roffle/catalog.py
IDS="e-xjK3zeAVM OTn6yl2jxGg yefo5lyt6wU nLdGlAmcWAM SkwRy_N5D9A brRkg1_VFAU bb3UmQWsofM LXou4GPdMYY oqiWiv4ygWU XfLcmbk09tc -GUBw5pfwWY IK2QVkr5fzE hj_BuRY6uRc ywRtrJktO5M s2qZNADhAY4 8cuq_dW2V_g vA_acBOHMb4 ylLAEKHkm00 0YQg7HqqF40 o0Dv57c9UhY"
tools/roffle/fetch.sh $IDS
PYTHONPATH=tools/roffle/.vendor python3 tools/roffle/analyze.py -- $IDS
PYTHONPATH=tools/roffle/.vendor python3 tools/roffle/played.py -- $IDS
PYTHONPATH=tools/roffle/.vendor python3 tools/roffle/rerolls.py -- $IDS
PYTHONPATH=tools/roffle/.vendor python3 tools/roffle/packs.py -- $IDS
python3 tools/roffle/antes.py -- $IDS
python3 tools/roffle/collect.py
node tools/roffle/priors.ts && node tools/roffle/style.ts --json && node tools/roffle/policy.ts
```

The `--` matters: one id starts with a dash. torch 2.12 must already be installed; torchvision
0.27.1 is the build that matches it. Homebrew's ffmpeg was broken on this machine (missing
libx265), so frames are read with OpenCV.

## Results (2026-10-23: 20 videos)

| Video | Kind | Deck/stake | Length | Run reached | Decisions | Blinds played / skipped | Rerolls | Vouchers | Plays / discards | Jokers in / out |
| - | - | - | - | - | - | - | - | - | - | - |
| e-xjK3zeAVM | early | Ghost/Gold | 29 min | ante 12, round 34 | 234 | 34 / 0 | 37 | 3 | 68 / 14 | 18 / 11 |
| OTn6yl2jxGg | early | Ghost/Gold | 30 min | ante 12, round 35 | 285 | 35 / 0 | 32 | 4 | 61 / 46 | 10 / 4 |
| yefo5lyt6wU | early | Checkered/Gold | 36 min | ante 11, round 32 | 333 | 32 / 0 | 70 | 4 | 106 / 29 | 28 / 22 |
| nLdGlAmcWAM | early | Ghost/Gold | 36 min | ante 10, round 32 | 355 | 32 / 0 | 58 | 2 | 64 / 48 | 13 / 7 |
| SkwRy_N5D9A | early | Ghost/Gold | 37 min | ante 11, round 37 | 363 | 37 / 2 | 58 | 5 | 114 / 28 | 19 / 18 |
| brRkg1_VFAU | early | Checkered/Gold | 46 min | ante 12, round 39 | 459 | 39 / 0 | 39 | 2 | 121 / 23 | 42 / 35 |
| bb3UmQWsofM | early | Ghost/Gold | 46 min | ante 12, round 39 | 466 | 39 / 0 | 152 | 2 | 94 / 15 | 25 / 18 |
| LXou4GPdMYY | early | Ghost/Gold | 48 min | ante 13, round 37 | 464 | 37 / 0 | 73 | 5 | 123 / 44 | 29 / 23 |
| oqiWiv4ygWU | early | Checkered/Gold | 50 min | ante 12, round 36 | 509 | 36 / 0 | 108 | 3 | 91 / 29 | 33 / 27 |
| XfLcmbk09tc | early | Yellow/Gold | 40 min | ante 13, round 39 | 358 | 39 / 0 | 25 | 4 | 103 / 56 | 13 / 8 |
| -GUBw5pfwWY | endless | Ghost/White | 25 min | ante 9, round 25 | 278 | 25 / 1 | 91 | 1 | 31 / 18 | 24 / 18 |
| IK2QVkr5fzE | endless | Ghost/White | 38 min | ante 11, round 35 | 495 | 35 / 1 | 236 | 4 | 34 / 17 | 30 / 24 |
| hj_BuRY6uRc | white | Red/White, then Yellow/Red | 49 min | won at ante 8 (round 24); then ante 8, round 15 | 272 | 39 / 10 | 41 | 5 | 81 / 17 | 30 / 22 |
| ywRtrJktO5M | endless | Ghost/White | 25 min | ante 8, round 25 | 251 | 25 / 1 | 73 | 3 | 26 / 17 | 25 / 18 |
| s2qZNADhAY4 | endless | Ghost/White | 39 min | ante 13, round 44 | 483 | 44 / 1 | 144 | 3 | 42 / 28 | 31 / 23 |
| 8cuq_dW2V_g | early | Erratic/Gold | 46 min | ante 14, round 43 | 440 | 43 / 0 | 79 | 3 | 127 / 38 | 32 / 27 |
| vA_acBOHMb4 | early | Abandoned/Gold | 45 min | ante 12, round 36 | 397 | 36 / 1 | 72 | 6 | 94 / 16 | 28 / 22 |
| ylLAEKHkm00 | early | Black/Gold | 36 min | ante 11, round 33 | 254 | 33 / 0 | 22 | 5 | 64 / 31 | 16 / 10 |
| 0YQg7HqqF40 | early | Plasma/Gold | 44 min | ante 10, round 28 | 305 | 28 / 0 | 8 | 4 | 103 / 55 | 23 / 18 |
| o0Dv57c9UhY | early | Blue/Gold | 33 min | ante 10, round 32 | 239 | 32 / 0 | 30 | 5 | 102 / 24 | 12 / 6 |

7,240 decisions: 1,151 early (ante 1 to 3), 3,592 mid, 2,496 endless, 1 with no ante. By type:
1,649 `play_hand`, 1,448 `reroll`, 700 `select_blind`, 593 `discard`, 1,380 consumable decisions,
538 `reorder_jokers`, 271 `buy_joker`, 104 `pack_pick_joker`, 106 `gain_joker`, 281 `sell_joker`,
80 `lose_joker`, 73 `buy_voucher`, 17 `skip_blind`. The first twelve videos' deck and stake follow
the `sources` of `playbook.json` (XfLcmbk09tc's deck from its card back).

**The eight videos added on 2026-10-23**, for White Stake and for decks other than Ghost and
Checkered. White Stake runs are rare on the channel: since mid 2024 every normal run is Gold Stake
(the descriptions say so), so White comes from two places:
- hj_BuRY6uRc, launch day (20 February 2024, game 1.0.0): a White Stake Red Deck win at ante 8,
  then a Red Stake Yellow Deck run (`segments` in `videos.json`; stake and deck from what he says
  and the run setup screen). 1.0.0 scaled antes 3 and 4 higher (Small Blind 2,800 and 6,000 at
  White). It is his first week with the game, and the old layout puts the facecam over the right
  edge;
- two more naneinf speedruns on Ghost Deck at White Stake (ywRtrJktO5M, s2qZNADhAY4), with the
  Brainstorm mod rerolling for a Perkeo start, like the two already here. Their White Stake is
  read off the blind targets (ante 7 Big Blind 52,500, ante 8 boss 100,000).

And five Gold Stake runs on other decks, from the descriptions and the card backs: Erratic
(8cuq_dW2V_g), Abandoned (vA_acBOHMb4), Black (ylLAEKHkm00), Plasma (0YQg7HqqF40, a sponsor overlay
covers the deck pile) and Blue (o0Dv57c9UhY). Looked at and left out: the pre-launch videos of
11 to 18 February 2024 (an early build with other blind targets, several decks a video) and the
April 2024 Deck Creator mod challenges (a deck of 52 Stone cards). ylLAEKHkm00 opens with a few
seconds of its ending (ante 12); its run is counted from its first blind.

**Ante.** 7,227 decisions take their ante from the blinds played, 12 from OCR. `antes.py` merged two
misread blinds (a Pillar chip read for 2 s inside a Big Blind on launch day; a Verdant Leaf chip for
4 s after Cerulean Bell in 8cuq_dW2V_g, which had made the first pass shift that whole video one
ante down and invent two skips) and found 8 antes of missed Hieroglyphs and Petroglyphs in 7 videos
(SkwRy_N5D9A two; nLdGlAmcWAM, brRkg1_VFAU, bb3UmQWsofM, ywRtrJktO5M, o0Dv57c9UhY, s2qZNADhAY4
one). The corrected endings of four of the first twelve now match the HUD readings noted in
`playbook.json` (SkwRy_N5D9A ante 11, nLdGlAmcWAM ante 10, brRkg1_VFAU and bb3UmQWsofM ante 12;
this table had 13, 11, 13 and 13). Checks:
- of 454 readable blind targets in antes 1 to 8, 362 equal the stake's target for the derived
  ante (launch day against 1.0.0's table), 6 match another ante and 86 are OCR misreads;
- the HUD ante read by OCR agrees in 5,078 of 5,978 readings (85%; 77% before `antes.py`).

**Packs.** The first pass named a pack at its first pack screen and then not for 20 s, so packs
bought back to back (Standard then Arcana, Arcana then Buffoon) were one pack, with the second's
cards and picks under the first's type; and the pixel font's first capital often read "fircana",
which matched no type. With Arcana and Spectral packs the hand shows under the pack and its face
cards read as jokers (Business Card most often), and on launch day shop frames with a tooltip over
Next Round passed for packs. `packs.py` fixes all of these: the first twelve videos went from 336
packs to 569, 916 over all twenty, and 10 of 10 sampled openings had the right type and size.

**Spot-check of the new videos** (6 decisions each, at -3, 0 and +3 s; 10 on launch day):
- Erratic, Blue, Plasma: 6 of 6 each (buys, sales, vouchers, rerolls, a Judgement joker out of an
  Arcana pack, a discard). In Erratic the antes were one low for 24 minutes until `antes.py`.
- Abandoned: 6 of 6, but a reroll right after a Hieroglyph in the same shop keeps the ante from
  before the voucher (the voucher takes effect at once; the count changes at the next blind).
- Black: 5 of 6; a To Do List buy is logged at the next blind's start (the row read late).
- Launch day: 10 of 10 (two skips, two Overstocks, Gros Michel and Jolly Joker buys, two sales,
  two rerolls), with antes matching the HUD after the merge.
- The two naneinf runs: 9 of 12. A Sixth Sense bought and sold three minutes apart in s2qZNADhAY4
  looks like a row misread, a Cartomancer buy in ywRtrJktO5M couldn't be confirmed, and one play
  has only one of its five cards (The Psychic forced five).

**Agreement** (`node tools/roffle/agree.ts --weights 0,0.5,1,1.5`, leave one video out). On the
first twelve videos before these changes: pick 47/52/53/55% of 173 visits, take 62/65/66/66% of
493. On all twenty: pick 48/51/53/53% of 268, take 67/68/69/69% of 795, sell 35% of 271 (chance
22%). The first twelve scored with priors from the other nineteen: pick 49/53/55/54%, take
63/66/66/67%. The five White videos: pick 37/38/38/40% of 81 (chance 24%), take 74-75% of 178.

**Mouse.** 678 of 2,409 shop decisions carry hover data. Click confirmation: 421 yes, 727 no,
3,850 unknown.

Analysis took 15 to 33 minutes per video on CPU with four running at once, plus a few minutes for
the second passes.

## Policies (`policy.json`)

`node tools/roffle/policy.ts` turns the dataset into numbers an agent can use, kept apart by stake
(`WHITE`, `GOLD`, and `RED` for launch day's second run), by ante (1 to 8, then 9+ pooled), each
with its count: money on leaving the shop (`moneyLeavingShop`: exit and entry money, share at $25
or more, under $5, on an interest step), rerolls per shop visit by ante, by money held on entering
and by both, skips and tags per ante, packs (`packs`: opened by type and ante, bought per shop
visit, Mega share, what was taken), vouchers (order and ante per run, how often one on the shelf
was bought), Tarots, Planets and Spectrals (bought, used, sold, by card and ante, shelf buy rate),
joker sales (by ante, rounds held, what replaced them) and hand types by ante and deck.

White is 5 runs and 156 shop visits, 4 of them Perkeo-start naneinf speedruns on Ghost Deck; Gold
is 15 runs and 540 visits over 8 decks. Read White as "what he does when the stake is easy and
the run is aimed at endless", not as a normal White run. Highlights:
- **Money.** Ante 1: he spends to $0-5 (two thirds of ante 1 exits are under $5, both stakes).
  From ante 3-4 he leaves at about the interest cap, not far above: median exit $23-29 at Gold
  antes 3 to 9+ (n 45-173 a bucket), at least $25 in 42-79% of visits; White $27-31 in antes 3 to
  7, more in the naneinf endgame ($36 at ante 8, $62 in endless).
- **Rerolls.** Rare early, then routine: share of shop visits with a reroll at Gold 0% (ante 1),
  16% (2), 31% (3), about 50% (4 to 7), 67% (8), 72% (9+); 0.2 to 1.8 rerolls a visit through ante
  8. White rerolls far more (60-95% of visits from ante 3, 3.3-4.8 rerolls a visit from ante 4). Both stop with about
  $31-41 left (median, n 279 Gold, 105 White): above the cap. By money on entering at Gold: under
  $30, 7-27% of visits reroll; $30-49, 56%; $50 or more, 83% (3.3 a visit).
- **Skips.** Gold: 3 of 352 skippable blinds. White: 5 of 98, four of them the ante 1 Small Blind
  for a Charm Tag in the Perkeo runs. Red Stake (Small Blind pays nothing): 9 of 16.
- **Packs.** About one and a half packs a shop visit at Gold from ante 3 (one at antes 1-2), 0.5 to
  1.4 at White. Arcana 37% and Celestial 29% of packs at Gold, Standard 15%, Buffoon 12%, Spectral
  7%; ante 1's packs are mostly Buffoon (18 of 28). He took a joker from 47 of 89
  Buffoon packs at Gold (10 of 18 at White).
- **Vouchers.** He buys 16% of the vouchers he sees at Gold (57 of 366 shelf appearances), 12% at
  White (13 of 105). Gold's most bought: Reroll Surplus 7, Wasteful 6, Blank 4, Director's Cut 4,
  Grabber 4; never Magic Trick (0 of 29 shelf visits). Seed Money 2 of 18.
- **Consumables.** Planets on the shop shelf almost never (3 of 394 at Gold, 0 of 196 at White);
  Tarots 19% at Gold and 4% at White, Spectrals 29% and 6%. Tarots used most at Gold: Strength,
  The Hanged Man, The Fool, The Devil, The Empress.
- **Joker sales.** About 13 a run at Gold (192), 17 at White (85), 92-96% with a joker bought or
  picked within 90 s; held 2-3 rounds (median). Most sold: Chaos the Clown, Mail-In Rebate and
  Business Card at Gold, Reserved Parking, Mail-In Rebate and Gros Michel at White: early money
  and utility jokers.
- **Hands.** At Gold (657 plays read in full): Flush leads ante 1 (Checkered Deck), then Pair and
  Two Pair; from ante 4 Pair 24-33%, Flush 17-37%, High Card 8-18%; Flush Five 17% in endless.
  Almost every play has five cards (4.7-4.9 on average).

Gaps: tags taken are read for 9 of 17 skips; consumable `picked` counts are cards that reached the
slots during a pack (pack cards themselves are used at once and not seen); money is OCR.

## Known gaps and error modes

- **Missed cards.** The detector drops some cards for long stretches, for example Mail-In Rebate on
  coloured boss felt. A missing card is carried over while the game's joker count still includes
  it, or while a card still covers its spot. Longer misses survive as a loss and a later re-buy.
- **Cards played.** The hand is read every 2 s, so a quick lift-and-play can leave `cards` partial
  even after `played.py` (when the play area wasn't readable either). Spectral cards that destroy
  cards from the hand can look like a discard.
- **Click confirmation.** Weak: the cursor is often seen beside the thing clicked rather than on
  its box, so `click_confirmed: false` doesn't mean the decision is wrong.
- **Sell vs. destroyed.** A joker gone in the shop, blind select, a pack or cash out is called sold;
  during a hand it is called lost unless the money went up. Smoothing can push a shop sale into the
  next blind, where it reads as a loss.
- **Mouse.** The cursor is found in about a third of the seconds (it vanishes over white card art),
  and sampled once a second, so `hovered` seconds are a floor, and short hovers are missed.
- **Skips.** Inferred from the blind order, with the tag read on the blind select screen. He
  rarely skips at Gold Stake: 3 skips in 352 skippable blinds. A video that starts after its first
  blind gets a `low` skip that may not be one. Two skipped antes in a row gave the first pass two
  copies of the first ante's skip decisions; `antes.py` moves the copy and drops its tag.
- **Pack picks.** Tarots, Planets and Spectrals taken from a pack are used at once and never reach
  the slots, so they are not seen, except when a Mega pack's first pick leaves the display. Jokers
  from Buffoon packs are seen. A consumable "picked" during a pack was made by something else.
- **Ante right after an ante voucher.** Hieroglyph and Petroglyph lower the ante at once; the count
  lowers it at the next blind, so the rest of that shop visit keeps the old ante.
- **Launch day.** Game 1.0.0 (other blind targets at antes 3 and 4) and his first week with the
  game: weigh its choices below the later videos'.
- **HUD OCR.** Money and the OCR ante slip digits on the pixel font; ante and round come from the
  blind order instead.
- **Reasons are keyword rules.** Treat `reason` and `pivot` as hints with their evidence.
- **Third-party code.** BalatroEngine (github.com/manwhar/BalatroEngine) has no licence file. It is
  cloned locally and kept out of git; nothing from it is redistributed here.
