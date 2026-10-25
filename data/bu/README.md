# Balatro University strategy claims

What Balatro University (Dr. Spectred, YouTube channel `UCpAwXXH3rPmSIlWYwIOwlEA`, handle
`@drspectred`) says to do in his teaching videos, written as claims precise enough to become a
number or a rule in the agent's code. Each claim carries verbatim auto-caption quotes with a
timestamped link, a `knob` proposing how to test it, and how it relates to the Roffle playbook
(`data/roffle/playbook.json`). Conflicts between the two sources are meant to be settled by
measuring average ante, not by preference.

No language-model API was used to extract these (no Jev, no TypeSafe, no local StartLux). The
captions were read in full by Claude Code agents, and every quote is checked by script against
the caption track.

## Files

| File | What it holds |
| - | - |
| `videos.json` | The 19 videos read: id, title, url, length, upload date, deck, stake, game version, how much is explanation, why picked, claims per video |
| `claims.json` | 176 claims (schema below). 63 of them merge a rule said in several videos |
| `tiers.json` | His tier lists as data: 34 tag rows (original and 1.0.1 update), 52 consumables, all 150 jokers. Each row has the game key (`j_*`, `c_*`, `tag_*`), his words, a derived 0-1 `prior`, and a timestamped url. `worked_numbers` holds the readers' tables (level-1 hand scores, pacing by ante, joker equivalents, scaler growth rates, money by ante, reroll rules, voucher values...) |
| `readers/<A-G>.json` | The per-group claims as the readers wrote them, before merging (`merged_from` in `claims.json` points here) |
| `captions/<id>.txt` | Caption text, one line per ~20 s, `[second] words` |
| `captions/<id>.words.tsv` | Every caption word with its start second; what quote checks use |
| `captions/<id>.meta.json` | Title, length, upload date, description |
| `captions/<id>.en.json3` | Raw YouTube auto-captions (~17 MB in all); gitignored, re-fetch with `fetch.sh` |

## Claim schema (`claims.json`)

| Field | Meaning |
| - | - |
| `id` | `topic.short-slug` |
| `topic` | jokers, economy, scaling, hands, reroll, shop, packs, planets, skips_tags, vouchers, consumables, deck_fixing, bosses, ordering, stake, decks |
| `decision` | The choice it bears on: shop joker buy, joker sell, reroll, money/interest, blind skip and tags, pack open, pack pick, Planet, Tarot/Spectral use, voucher, hand choice/discard, boss reroll, deck fixing, joker order |
| `statement` | The rule, with his numbers (or ones clearly implied; `notes` says "implied") |
| `conditions` | Ante range, deck, stake, build state where it applies |
| `quotes` | Up to 5: `{video, t_seconds, text, url}`. `text` is the caption's own words, misspellings kept ("anti" for ante, "batro"); a `gloss` names a misheard card |
| `said_in` | Every video a reader found it in |
| `confidence` | high = stated clearly and/or in several videos; low = said once in passing |
| `roffle` | `{relation: agrees / conflicts / new, principles: [playbook ids], note}` |
| `knob` | A proposed parameter or rule to test it. Names like `jokerFit`, `packValue`, `TAG_VALUE` refer to the agent's code loosely; nothing here is wired in |
| `notes` | Caveats, version notes, self-contradictions |
| `merged_from` | The readers' claim ids that were merged into this one, with the reader group |

## How it was made

1. **Pick videos.** `yt-dlp --flat-playlist` on the channel listed 1,121 uploads. Picked the
   teaching videos: the four "Balatro Basics" lessons, the skip-tag and consumable tier lists, the
   three joker tier lists, two money-management videos, the White-stake "Beginners Start Here" run,
   a scaling talk and the 2025 "Balatro 101" shorts. `qpCPl7Yo-pU` ("Just. Play. Pairs.") is already
   in the Roffle playbook and was not redone.
2. **Captions.** `tools/bu/fetch.sh` reads each video's info json with yt-dlp (no video) and fetches
   the English auto-captions (json3) with curl, since yt-dlp's own caption requests get HTTP 429.
   `tools/bu/text.py` writes the `.txt` and `.words.tsv` files.
3. **Read.** Seven readers (Claude Code subagents) each read a group of videos in full and wrote
   claims with quotes, looking every quote up with `text.py --find`: A Basics 1 and the shorts,
   B Basics 2 and 4, C Basics 3 and the scaling talk, D the skip-tag and consumable tier lists,
   E the two money videos, F the joker tier lists, G "Beginners Start Here".
4. **Merge.** `tools/bu/merges.py` lists the claims said in more than one video, with the merged
   statement, conditions and knob rewritten by hand; `tools/bu/joker_priors.py` holds the joker
   priors. `tools/bu/build.py` pools the quotes and writes `claims.json`, `videos.json` and
   `tiers.json`.
5. **Check.** `tools/bu/check.py` finds every quote in the caption words and confirms its second
   (all 571 pass; the readers' 748 raw quotes passed the same check).

To re-run:

```bash
IDS="atVF4VLHks4 i_Wr7giQFKI uB-faBXxSyo 2zjJP_WTzag q4PPUfrs8jI TJEsOAc_bmE QkHANP2e9i8 q4YAHDuRUcQ Lx2bAMdKwIs zWNty-x3g_M ab30EDBnscQ eT6X1613CbA -dFEWf4t7yU mHAme_Vo2dc 3P5fzcsuy2Q u5zjR-4vylg ooudv0Yh--g V5zDmtnCjZ0 sgOgbZzXYag"
tools/bu/fetch.sh $IDS                 # needs network: youtube.com, *.googlevideo.com
python3 -I tools/bu/text.py $IDS       # .txt and .words.tsv
python3 -I tools/bu/build.py           # claims.json, videos.json, tiers.json from readers/ + merges.py
python3 -I tools/bu/check.py           # every quote against the captions (--fix rewrites seconds)
python3 -I tools/bu/text.py --find atVF4VLHks4 "one scoring Joker per ante"   # look a phrase up
```

yt-dlp is the vendored copy in `tools/roffle/.vendor` (see `data/roffle/README.md`). Step 3 is
reading, not a script: to add a video, fetch it, read its `.txt`, add claims to a reader file (or a
new one, adding its letter to `GROUPS` in `build.py`), and rebuild.

## Caveats

- **Versions.** Most Basics videos are on 1.0.0 (before patch 1.0.1). Changes that matter: suit
  jokers +4 -> +3 Mult per card, Investment Tag $15 -> $25, tag jokers are free, Gros Michel 1 in 4
  -> 1 in 6. The joker tier lists and the Gold-stake videos are on 1.0.1.
- **Stakes.** The rules come from White (Basics 1, Beginners Start Here, the Yellow-deck money
  video), Red (Basics 2), Green (Basics 3) and Gold (the Green-deck money video, the scaling talk).
  `conditions.stake` says which.
- **Tier lists are partly about fun.** He expels Obelisk ("very strong") for not being fun and
  holds Chicot down for making the game boring. Rows are placed by dragging on screen, so most come
  from what he says aloud; `prior` is a derived number to start from, not his.
- **He contradicts himself** in places (Golden Joker, Square Joker, Gift Card, early packs, skipping
  for edition tags at White). Both sides are kept as separate claims and `notes` points across.
- **Caption errors he makes** are noted on the claims: Small Blind pays $3 (he once says $4), Gros
  Michel's odds, Vagabond's threshold.
