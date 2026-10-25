"""Build data/bu/{claims,videos,tiers}.json from the readers' files and the merge spec.

    python3 -I tools/bu/build.py

Inputs: data/bu/readers/<group>.json (one per group of videos, written by the readers of the
captions), tools/bu/merges.py (claims said in several videos, merged by hand, with the statement
and knob rewritten), tools/bu/joker_priors.py (0-1 joker priors read off the tier-list verdicts),
data/bu/captions/<id>.meta.json and data/roffle/catalog/ (game keys).
"""
import json
import re
import sys
from collections import Counter, OrderedDict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from merges import MERGES  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
S = REPO / "data/bu/readers"
OUT = REPO / "data/bu"
CAP = OUT / "captions"
GROUPS = "ABCDEFG"

raw, tables, vnotes = {}, {}, {}
for g in GROUPS:
    d = json.loads((S / f"{g}.json").read_text())
    for c in d["claims"]:
        key = f"{g}:{c['id']}"
        assert key not in raw, key
        raw[key] = c
    tables[g] = d.get("tables") or {}
    for v in d["videos"]:
        vnotes[v["id"]] = v

VIDEO_ORDER = [
    "atVF4VLHks4", "i_Wr7giQFKI", "uB-faBXxSyo", "2zjJP_WTzag", "q4PPUfrs8jI", "TJEsOAc_bmE",
    "QkHANP2e9i8", "q4YAHDuRUcQ", "Lx2bAMdKwIs", "zWNty-x3g_M", "ab30EDBnscQ", "eT6X1613CbA",
    "-dFEWf4t7yU", "mHAme_Vo2dc", "3P5fzcsuy2Q", "u5zjR-4vylg", "ooudv0Yh--g", "V5zDmtnCjZ0",
    "sgOgbZzXYag",
]
RANK = {v: i for i, v in enumerate(VIDEO_ORDER)}

used = set()
claims = []


def pool_quotes(keys, limit=5, drop=()):
    """Quotes of the members, at most `limit`, spread over videos (one per video first)."""
    allq, seen = [], {(v, t) for v, t in drop}
    for k in keys:
        for q in raw[k]["quotes"]:
            sig = (q["video"], round(q["t_seconds"]))
            if sig in seen:
                continue
            seen.add(sig)
            allq.append(q)
    first, rest, vids = [], [], set()
    for q in allq:
        (rest if q["video"] in vids else first).append(q)
        vids.add(q["video"])
    return (first + rest)[:limit], sorted({q["video"] for q in allq}, key=RANK.get)


for m in MERGES:
    for k in m["members"]:
        assert k in raw, f"missing member {k}"
        assert k not in used, f"member used twice {k}"
        used.add(k)
    quotes, vids = pool_quotes(m["members"], drop=m.get("drop_quotes", ()))
    notes = [m.get("notes")] if m.get("notes") else []
    for k in m["members"]:
        n = raw[k].get("notes")
        if n:
            notes.append(f"[{k.split(':', 1)[1]}] {n}")
    claims.append(OrderedDict(
        id=m["id"], topic=m["topic"], decision=m["decision"], statement=m["statement"],
        conditions=m["conditions"], quotes=quotes, said_in=vids, confidence=m["confidence"],
        roffle=m["roffle"], knob=m["knob"], notes=" ".join(notes) if notes else None,
        merged_from=[k.split(":", 1)[1] + f" ({k[0]})" for k in m["members"]],
    ))

ids = Counter(c["id"] for c in claims)
for k, c in raw.items():
    if k in used:
        continue
    cid = c["id"]
    if cid in ids:
        cid = f"{cid}-{k[0].lower()}"
    ids[cid] += 1
    vids = sorted({q["video"] for q in c["quotes"]}, key=RANK.get)
    r = c.get("roffle") or {"relation": "new", "principles": []}
    claims.append(OrderedDict(
        id=cid, topic=c["topic"], decision=c["decision"], statement=c["statement"],
        conditions=c.get("conditions"), quotes=c["quotes"], said_in=vids,
        confidence=c["confidence"], roffle=r, knob=c["knob"], notes=c.get("notes"),
        merged_from=None,
    ))

dup = [i for i, n in Counter(c["id"] for c in claims).items() if n > 1]
assert not dup, dup

# Notes that name a merged-away id point at the merged claim instead.
alias = {}
for m in MERGES:
    for k in m["members"]:
        old = k.split(":", 1)[1]
        if old != m["id"]:
            alias.setdefault(old, m["id"])
known = {c["id"] for c in claims}
TABLE_AT = {"tag_tiers": "data/bu/tiers.json tags", "consumable_tiers": "data/bu/tiers.json consumables",
            "joker_tiers": "data/bu/tiers.json jokers"}
for g in GROUPS:
    for k in tables[g]:
        TABLE_AT.setdefault(k, f'data/bu/tiers.json worked_numbers["{g}.{k}"]')


def fix_refs(text):
    if not text:
        return text
    text = re.sub(r"\btables\.([a-z_0-9]+)", lambda mo: TABLE_AT.get(mo.group(1), mo.group(0)), text)

    def sub(mo):
        w = mo.group(0)
        return alias.get(w, w) if w not in known else w
    return re.sub(r"\b[a-z_]+\.[a-z0-9-]+\b", sub, text)


for c in claims:
    c["notes"] = fix_refs(c["notes"])
    c["knob"] = fix_refs(c["knob"])
    if c["roffle"].get("note"):
        c["roffle"]["note"] = fix_refs(c["roffle"]["note"])
    if isinstance(c["conditions"], dict) and c["conditions"].get("build_state"):
        c["conditions"]["build_state"] = fix_refs(c["conditions"]["build_state"])
    for q in c["quotes"]:
        q["t_seconds"] = round(q["t_seconds"], 1)
        q["url"] = f"https://www.youtube.com/watch?v={q['video']}&t={int(q['t_seconds'])}s"

TOPICS = ["jokers", "economy", "scaling", "hands", "reroll", "shop", "packs", "planets",
          "skips_tags", "vouchers", "consumables", "deck_fixing", "bosses", "ordering", "stake", "decks"]
CONF = {"high": 0, "medium": 1, "low": 2}
merged_rank = {m["id"]: i for i, m in enumerate(MERGES)}
claims.sort(key=lambda c: (TOPICS.index(c["topic"]) if c["topic"] in TOPICS else 99,
                           CONF[c["confidence"]], -len(c["said_in"]), merged_rank.get(c["id"], 999), c["id"]))

# ---------------------------------------------------------------- videos.json
VMETA = {
    "atVF4VLHks4": ("Red", "White", "1.0.0n", "Basics 1, antes 1-3: one-shot round 1, one scoring joker per ante, bank to $25, joker-by-joker shop verdicts."),
    "i_Wr7giQFKI": ("Red", "Red", "1.0.0n", "Basics 2, antes 2-5: pacing (scoring jokers vs value generators), build order, pack priority by hand, pivots."),
    "uB-faBXxSyo": ("Red", "Green", "1.0.0n", "Basics 3, endgame: what the board needs by antes 6-8, replacing chips and money jokers, Telescope, Glass reserve for the final boss."),
    "2zjJP_WTzag": (None, None, "1.0.0n", "Basics 4: joker valuation as the multiplier it adds on its axis, weakest link to sell, copy target."),
    "q4PPUfrs8jI": ("Red", "White", "1.0.0j", "A full White-stake run explained for beginners: the agent's exact stake. Bank when the boss is covered, buy when it isn't, play every blind."),
    "TJEsOAc_bmE": ("Yellow", "White", "1.0.0k", "Money management at White: reaching $25, saving when the next blind is safe, spreading rerolls."),
    "QkHANP2e9i8": ("Green", "Gold", "1.0.1f", "Money without interest (Green Deck): packs before rerolls, carry a budget to the next shop."),
    "q4YAHDuRUcQ": (None, None, "1.0.0n", "Skip tag tier list: the hidden cost of a skip; almost never skip."),
    "Lx2bAMdKwIs": (None, None, "1.0.1", "Skip tag tier list update for 1.0.1 (current view)."),
    "zWNty-x3g_M": (None, None, "1.0.1c", "Every Tarot, Planet and Spectral ranked for an 8-ante run; Planet value by chips per level."),
    "ab30EDBnscQ": (None, None, "1.0.1f", "Common joker tier list: early flat +Mult, discards and hands as money, money jokers."),
    "eT6X1613CbA": (None, None, "1.0.1f", "Uncommon joker tier list: xMult priority, boss fragility, value generators."),
    "-dFEWf4t7yU": (None, None, "1.0.1f", "Rare and Legendary tier list: copy jokers, hand-xMult rares, bosses halve your score."),
    "mHAme_Vo2dc": ("Ghost, Zodiac", "Gold", "1.0.1m", "Scaling jokers: growth per round and final values of +Mult scalers."),
    "3P5fzcsuy2Q": (None, None, "1.0.1", "2025 short: ante 1 without jokers, score estimates per hand, value of one early Planet."),
    "u5zjR-4vylg": (None, None, "1.0.1", "2025 short: round 1 discard plan and chip thresholds for a 300 one-shot."),
    "ooudv0Yh--g": (None, None, "1.0.1", "2025 short: chips vs Mult, first joker +Mult, then chips."),
    "V5zDmtnCjZ0": (None, None, "1.0.1", "2025 short: why chips jokers are rarer; take early chips jokers."),
    "sgOgbZzXYag": (None, None, None, "Channel index. Read; no decision content beyond 'every White-stake run should be winnable'."),
}
count = Counter(v for c in claims for v in c["said_in"])
videos = []
for vid in VIDEO_ORDER:
    meta = json.loads((CAP / f"{vid}.meta.json").read_text())
    deck, stake, ver, why = VMETA[vid]
    n = vnotes.get(vid, {})
    videos.append(OrderedDict(
        id=vid, title=meta["title"], url=f"https://www.youtube.com/watch?v={vid}",
        duration_s=meta["duration"], upload_date=meta["upload_date"],
        deck=deck, stake=stake, game_version=ver, talk_share=n.get("talk_share"),
        why=why, claims=count.get(vid, 0),
    ))
(OUT / "videos.json").write_text(json.dumps({
    "channel": "Balatro University (Dr. Spectred), youtube.com/channel/UCpAwXXH3rPmSIlWYwIOwlEA",
    "generated": "2026-10-23",
    "note": "Strategy/teaching videos picked from the channel's 1,121 uploads; captions read in full. qpCPl7Yo-pU ('Just. Play. Pairs.') is in data/roffle/playbook.json and not repeated here. game_version is what the video shows or says; 1.0.0 videos predate the 1.0.1 balance patch.",
    "videos": videos,
}, indent=1, ensure_ascii=False) + "\n")

# ---------------------------------------------------------------- tiers.json
def school_row_score(s):
    if not s:
        return None
    m = re.match(r"\s*([1-5])-", s)
    if m:
        return {1: 1.0, 2: 0.75, 3: 0.5, 4: 0.25, 5: 0.0}[int(m.group(1))]
    return None


from joker_priors import NOTE as PRIOR_NOTE, PRIOR  # noqa: E402


CATDIR = REPO / "data/roffle/catalog"
norm = lambda s: re.sub(r"[^a-z0-9]", "", s.lower().replace("the ", ""))
JKEY = {norm(j["name"]): j["key"] for j in json.loads((CATDIR / "jokers.json").read_text())}
CKEY = {}
for k, v in json.loads((CATDIR / "consumables.json").read_text()).items():
    CKEY[norm(v if isinstance(v, str) else v.get("name", k))] = k
TKEY = {norm(x["name"]): x["key"] for x in json.loads((CATDIR / "tags.json").read_text())}
TKEY.update({norm(x["name"].replace(" Tag", "")): x["key"] for x in json.loads((CATDIR / "tags.json").read_text())})


MANUAL_KEY = {"Seance": "j_seance", "Speed Tag": "tag_skip"}


def keyof(table, name):
    if name in MANUAL_KEY:
        return MANUAL_KEY[name]
    n = norm(name)
    if n in table:
        return table[n]
    n2 = norm(re.sub(r"\s*\(.*\)", "", name))
    return table.get(n2)


jt = []
for r in tables["F"]["joker_tiers"]:
    assert r["joker"] in PRIOR, r["joker"]
    row = OrderedDict(key=keyof(JKEY, r["joker"]), joker=r["joker"], rarity=r["rarity"], said=r.get("tier"), row=r.get("row"),
                      prior=PRIOR[r["joker"]], prior_note=PRIOR_NOTE.get(r["joker"]),
                      when_good=r.get("when_good"), when_bad=r.get("when_bad"),
                      video=r["video"], t_seconds=round(r["t_seconds"], 1),
                      url=f"https://www.youtube.com/watch?v={r['video']}&t={int(r['t_seconds'])}s",
                      phrase=r.get("quote"), gloss=r.get("gloss"))
    jt.append(row)

tags = []
for r in tables["D"]["tag_tiers"]:
    tags.append(OrderedDict(key=keyof(TKEY, r["tag"]), tag=r["tag"], list=r["list"], tier=r["tier"], prior=school_row_score(r["tier"]),
                            placement=r.get("placement"), relative=r.get("relative"), conditions=r.get("conditions"),
                            video=r["video"], t_seconds=round(r["t_seconds"], 1),
                            url=f"https://www.youtube.com/watch?v={r['video']}&t={int(r['t_seconds'])}s",
                            phrase=r.get("phrase")))
cons = []
for r in tables["D"]["consumable_tiers"]:
    cons.append(OrderedDict(key=keyof(CKEY, r["card"]), card=r["card"], set=r["set"], tier=r["tier"], prior=school_row_score(r["tier"]),
                            placement=r.get("placement"), relative=r.get("relative"), use_rule=r.get("use_rule"),
                            video=r["video"], t_seconds=round(r["t_seconds"], 1),
                            url=f"https://www.youtube.com/watch?v={r['video']}&t={int(r['t_seconds'])}s",
                            phrase=r.get("phrase")))

other = {f"{g}.{k}": v for g in "ABCEG" for k, v in tables[g].items()}
(OUT / "tiers.json").write_text(json.dumps(OrderedDict(
    generated="2026-10-23",
    notes=[
        "He ranks on a five-row school scale, top to bottom: Graduating with honors (he equates it with S), Solo group project, See me after class / midterm talk, You're in the wrong class / don't meet the prereqs, Expelled. Rows are set by dragging cards on screen; captions only carry what he says aloud.",
        "prior is a derived 0-1 number for code to start from, not his: tags and consumables map rows 1..5 to 1.0, 0.75, 0.5, 0.25, 0.0 (the 'updated' tag rows are the current 1.0.1 view). Joker priors are read by hand off his verdict words ('easy smash' ~0.85-0.95, 'smash' ~0.75, 'smash, not proud' ~0.6, 'gentle/conditional' ~0.45-0.5, 'mid' ~0.4, 'pass' ~0.15-0.2, Expelled ~0.05) and his stated comparisons, within rarity (a common's 0.85 is not an uncommon's 0.85); null where he never places the joker aloud. Measure before trusting.",
        "Joker rows are partly about fun: Obelisk is 'very strong' but expelled for not being fun, Vagabond for being work, Chicot held down for making the game boring. Commons are judged against commons. Several placements moved during the stream; 'said' keeps the final words.",
        "'relative' (tags, consumables) holds his stated comparisons and is more reliable than the row.",
        "A tag's row is how good the tag is, not whether to skip for it: he ranks Economy Tag top yet rarely skips for it. Skip decisions are in claims.json (skips_tags.play-every-blind and the per-tag claims).",
    ],
    scale={"jokers": tables["F"].get("scale"), "tags_and_consumables": tables["D"].get("tier_scale")},
    tags=tags, consumables=cons, jokers=jt, worked_numbers=other,
), indent=1, ensure_ascii=False) + "\n")

# ---------------------------------------------------------------- claims.json
(OUT / "claims.json").write_text(json.dumps(OrderedDict(
    version=1, generated="2026-10-23",
    notes=[
        "Claims are what Balatro University says to do, as rules precise enough to become code; each carries verbatim auto-caption quotes (check with tools/bu/check.py). 'knob' is a proposal for testing it, not existing code.",
        "Claims said in several videos are merged (merged_from lists the readers' original ids and reader group, see data/bu/readers/); said_in lists every video a reader found it in, while quotes shows up to 5.",
        "roffle.relation compares with data/roffle/playbook.json principle ids: agrees, conflicts or new. Conflicts are to be settled by measuring average ante, not by preference.",
        "Most videos are at White to Green stake; the Gold-stake ones are marked in conditions. Videos on 1.0.0 predate patch 1.0.1 (e.g. suit jokers +4 -> +3 per card, Investment Tag $15 -> $25, Gros Michel 1 in 4 -> 1 in 6).",
        "Where he contradicts himself, both claims are kept and notes say so.",
    ],
    claims=claims,
), indent=1, ensure_ascii=False) + "\n")

print("claims", len(claims), "merged", len(MERGES), "from", len(used), "raw; pass-through", len(claims) - len(MERGES))
print(Counter(c["topic"] for c in claims))
print(Counter(c["roffle"]["relation"] for c in claims))
print(Counter(c["confidence"] for c in claims))
print("quotes", sum(len(c["quotes"]) for c in claims))
print("no key", [r.get("joker") or r.get("tag") or r.get("card") for r in jt + tags + cons if not r["key"]])
print("joker priors null", [r["joker"] for r in jt if r["prior"] is None], "of", len(jt))
