# Roffle Lite decisions dataset

What Roffle (YouTube: Roffle Lite) chose across twelve Balatro runs: blinds played and skipped,
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
bought), `ante_check` and `cursor_seen` (share of seconds with the cursor found). Run records in
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
     rebuilds the `reroll` decisions and the shop summaries.
5. **Clean-up rules**, all in `analyze.py`, run again by `collect.py`: misread cards that vanish
   and come back, buys next to a pack screen with no shop evidence, Invisible Joker copies, run
   splits (see the code comments). Runs take ante and round reached from the blinds played.
6. **Merge**: `tools/roffle/collect.py` writes `videos.json` and `decisions.jsonl`.

To re-run from scratch:

```bash
python3 -m pip install --use-deprecated=legacy-certs --target tools/roffle/.vendor --no-deps yt-dlp "torchvision==0.27.1" ultralytics
git clone --depth 1 https://github.com/manwhar/BalatroEngine tools/roffle/vendor/BalatroEngine
python3 tools/roffle/catalog.py
IDS="e-xjK3zeAVM OTn6yl2jxGg yefo5lyt6wU nLdGlAmcWAM SkwRy_N5D9A brRkg1_VFAU bb3UmQWsofM LXou4GPdMYY oqiWiv4ygWU XfLcmbk09tc -GUBw5pfwWY IK2QVkr5fzE"
tools/roffle/fetch.sh $IDS
PYTHONPATH=tools/roffle/.vendor python3 tools/roffle/analyze.py -- $IDS
PYTHONPATH=tools/roffle/.vendor python3 tools/roffle/played.py -- $IDS
PYTHONPATH=tools/roffle/.vendor python3 tools/roffle/rerolls.py -- $IDS
python3 tools/roffle/collect.py
```

The `--` matters: one id starts with a dash. torch 2.12 must already be installed; torchvision
0.27.1 is the build that matches it. Homebrew's ffmpeg was broken on this machine (missing
libx265), so frames are read with OpenCV.

## Results (2026-10-22, second pass)

| Video | Kind | Deck/stake | Length | Run reached | Decisions | Blinds played / skipped | Rerolls | Vouchers | Plays / discards | Jokers in / out |
| - | - | - | - | - | - | - | - | - | - | - |
| e-xjK3zeAVM | early | Ghost/Gold | 29 min | ante 12, round 34 | 234 | 34 / 0 | 37 | 3 | 68 / 14 | 18 / 11 |
| OTn6yl2jxGg | early | Ghost/Gold | 30 min | ante 12, round 35 | 285 | 35 / 0 | 32 | 4 | 61 / 46 | 10 / 4 |
| yefo5lyt6wU | early | Checkered/Gold | 36 min | ante 11, round 32 | 333 | 32 / 0 | 70 | 4 | 106 / 29 | 28 / 22 |
| nLdGlAmcWAM | early | Ghost/Gold | 36 min | ante 11, round 32 | 355 | 32 / 0 | 58 | 2 | 64 / 48 | 13 / 7 |
| SkwRy_N5D9A | early | Ghost/Gold | 37 min | ante 13, round 37 | 363 | 37 / 2 | 58 | 5 | 114 / 28 | 19 / 18 |
| brRkg1_VFAU | early | Checkered/Gold | 46 min | ante 13, round 39 | 459 | 39 / 0 | 39 | 2 | 121 / 23 | 42 / 35 |
| bb3UmQWsofM | early | Ghost/Gold | 46 min | ante 13, round 39 | 466 | 39 / 0 | 152 | 2 | 94 / 15 | 25 / 18 |
| LXou4GPdMYY | early | Ghost/Gold | 48 min | ante 13, round 37 | 464 | 37 / 0 | 73 | 5 | 123 / 44 | 29 / 23 |
| oqiWiv4ygWU | early | Checkered/Gold | 50 min | ante 12, round 36 | 509 | 36 / 0 | 108 | 3 | 91 / 29 | 33 / 27 |
| XfLcmbk09tc | early | Yellow/Gold | 40 min | ante 13, round 39 | 358 | 39 / 0 | 25 | 4 | 103 / 56 | 13 / 8 |
| -GUBw5pfwWY | endless | Ghost/White | 25 min | ante 9, round 25 | 278 | 25 / 1 | 91 | 1 | 31 / 18 | 24 / 18 |
| IK2QVkr5fzE | endless | Ghost/White | 38 min | ante 11, round 35 | 495 | 35 / 1 | 236 | 4 | 34 / 17 | 30 / 24 |

4,599 decisions: 655 early (ante 1 to 3), 2,017 mid, 1,927 endless. By type: 1,010 `play_hand`,
979 `reroll`, 420 `select_blind`, 367 `discard`, 974 consumable decisions, 307 `reorder_jokers`,
166 `buy_joker`, 62 `pack_pick_joker`, 56 `gain_joker`, 179 `sell_joker`, 36 `lose_joker`,
39 `buy_voucher`, 4 `skip_blind`. Deck and stake follow the `sources` of `playbook.json`, except
XfLcmbk09tc, whose deck was read off its card back.

**Ante.** Every decision now has an ante; it was null for 166 of 544 (31%) from OCR alone. 4,591
come from the blinds played and 8 (before the first blind of a video) from OCR. Checks:
- of 248 readable blind targets in antes 1 to 8, 191 equal the stake's target for the derived
  ante, 53 are OCR misreads that match no ante, and 4 match another ante;
- the HUD round counter read by OCR agrees with the derived round in 2,407 of 3,067 readings (78%);
- the HUD ante read by OCR agrees in 2,796 of 3,647 (77%). The disagreements looked at were OCR:
  6 read as 5, and two-digit endless antes losing a digit.

**Spot-check, early game first.** Checked by eye against the video:
- Blinds: the blind sequences of the first ten minutes of two videos (27 blinds) were all right.
- Skips: all 4 checked. 3 are right with the right tag (Charm Tag twice in the naneinf runs,
  Buffoon Tag once). The 4th, at a run start, was inferred from a Small Blind the HUD never showed
  and is likely a miss rather than a skip (it is marked `low`).
- Early joker choices (one video, antes 1 to 3): 5 of 7 fully right, 1 sale logged as a loss,
  1 pick of a joker he already held.
- Vouchers: 2 of 2 right (Reroll Surplus, Director's Cut).
- Rerolls: two shop visits counted frame by frame (3, and 7 for $42) match exactly. The first pass,
  which read the price every 2 s, had found 3 and 5; the per-second pass fixed it.
- Plays and discards (antes 1 to 3, one video): 12 of 13 have the right type. The cards are exact
  for 10 of 13 after reading the play area (6 of 13 from the lifted cards alone), partial for 2.
- Hover: one shop visit followed second by second; the recorded hovers match where the cursor
  was. The first pass's spot-check of 46 joker decisions (38 fully right) still applies to the
  joker and consumable types, whose logic is unchanged.

**Mouse.** The cursor is found in about a third of the seconds. 405 of 1,564 shop decisions carry
hover data, and 105 hovers on shop buys are on items he looked at and did not take. Click
confirmation is weak: 236 yes, 437 no, 1,790 unknown. "No" usually means the cursor was seen on
something nearby (the Buy button area, the next card).

Analysis took 13 to 18 minutes per video on CPU, plus a few minutes per video for the two second
passes (`played.py`, `rerolls.py`).

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
  rarely skips at Gold Stake: the ten Gold Stake runs show every blind played except one skip in
  ante 13. A video that starts after its first blind gets a `low` skip that may not be one.
- **HUD OCR.** Money and the OCR ante slip digits on the pixel font; ante and round come from the
  blind order instead.
- **Reasons are keyword rules.** Treat `reason` and `pivot` as hints with their evidence.
- **Third-party code.** BalatroEngine (github.com/manwhar/BalatroEngine) has no licence file. It is
  cloned locally and kept out of git; nothing from it is redistributed here.
