"""Second pass over pack openings: re-read the pack name once a second through every pack screen.

analyze.py read a pack's name at the first pack screen and then not again for 20 s, so two packs
bought back to back (Standard then Arcana, Arcana then Buffoon) were logged as one, and the cards
and picks of the second went to the first one's type. This pass rebuilds `packs` with one entry per
pack opened: when it opened and closed, its type and size (from the name panel, by majority over
its readings), and the cards on offer that fit its type. It also

  - drops pack offers that can't be in that pack: jokers outside Buffoon packs (the hand shown
    under Arcana and Spectral packs, and Standard pack cards, read as Business Card and friends),
    Tarots outside Arcana packs, and so on (The Soul and Black Hole are allowed where the game
    puts them), and pack offers read while no pack was open (shop frames taken for a pack);
  - sets `pack` on each decision made in a pack to that pack's type, and filters its `offered`
    the same way (the first pass's values stay in `pack_first_pass` and `offered_first_pass`).

The first pass's pack offers are kept in `pack_offers_raw` and the per-second readings in
`pack_reads`, so the pass can run again (`--cached` reuses the readings, `--refilter` the openings).

    PYTHONPATH=tools/roffle/.vendor python3 tools/roffle/packs.py -- VIDEO_ID [VIDEO_ID ...]
"""

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

import cv2

sys.path.insert(0, str(Path(__file__).resolve().parent))
from analyze import PACK_NAME, ocr, roi, screen_of  # noqa: E402

ROOT = Path("data/roffle")
SETS = {k: v["set"] for k, v in json.loads((ROOT / "catalog" / "consumables.json").read_text()).items()}
TYPES = ("Buffoon", "Arcana", "Celestial", "Spectral", "Standard")


def fits(key, pack):
    """Whether a card with this key can be offered in a pack of this type."""
    if pack is None:
        return True
    if pack == "Buffoon":
        return key.startswith("j_")
    s = SETS.get(key)
    if pack == "Arcana":
        return s == "Tarot" or key == "c_soul"
    if pack == "Celestial":
        return s == "Planet" or key == "c_black_hole"
    if pack == "Spectral":
        return s == "Spectral"
    return False  # Standard packs hold playing cards, which the item model doesn't read


# The pixel font's first capital is often misread ("fircana Pack"), so types are matched on the rest.
NAME_RE = re.compile(r"(uffoon|rcana|elestial|pectral|tandard)\s*Pa", re.I)
NAME_OF = {"uffoon": "Buffoon", "rcana": "Arcana", "elestial": "Celestial", "pectral": "Spectral", "tandard": "Standard"}


def read_name(f):
    """(type, picks) from the pack's name panel ("Arcana Pack / Choose 2"), or None. picks is 2
    for a Mega pack, 1 for the others, None when the second line wasn't read."""
    x0, y0, x1, y1 = PACK_NAME
    text = ocr(f[y0 : y1 + 30, x0:x1], None, psm=6)
    m = NAME_RE.search(text)
    if not m:
        return None
    c = re.search(r"Choose\s*([12lI|])", text)
    return NAME_OF[m.group(1).lower()], (2 if c.group(1) == "2" else 1) if c else None


def windows(screens, pad=3):
    """Time spans around the pack screens of the first pass, merged."""
    spans = []
    for i, s in enumerate(screens):
        if s["screen"] != "pack":
            continue
        end = screens[i + 1]["t"] if i + 1 < len(screens) else s["t"] + 2
        a, b = s["t"] - pad, end + pad
        if spans and a <= spans[-1][1]:
            spans[-1][1] = max(spans[-1][1], b)
        else:
            spans.append([a, b])
    return spans


BACK = ("shop", "blind_select")  # the deck view reads as cash_out, so only these count


def openings(reads):
    """Pack openings from per-second (t, screen, name) readings.

    The name panel shows only while a pack is open, but it also drops out inside one (a Tarot or
    Immolate animation, the deck view), so a gap alone doesn't end a pack. A new pack starts when
    the panel comes back after he was back on the shop or blind select screen, or when it
    shows a different type twice in a row (one OCR slip doesn't split a pack)."""
    out, cur, back = [], None, True
    for i, (t, scr, name) in enumerate(reads):
        if i and t - reads[i - 1][0] > 1.5:
            back = True  # a separate window of the first pass
        if not name:
            back |= scr in BACK
            continue
        again = i + 1 < len(reads) and reads[i + 1][2] and reads[i + 1][2][0] == name[0]
        if cur is None or back or (name[0] != Counter(n[0] for n in cur["names"]).most_common(1)[0][0] and again):
            cur = {"t": t, "end_t": t, "names": []}
            out.append(cur)
        cur["names"].append(name)
        cur["end_t"] = t
        back = False
    for o in out:
        o["pack"] = Counter(n[0] for n in o["names"]).most_common(1)[0][0]
        picks = [n[1] for n in o["names"] if n[0] == o["pack"] and n[1]]
        o["size"] = ("mega" if Counter(picks).most_common(1)[0][0] == 2 else "normal/jumbo") if picks else "?"
        o["reads"] = len(o["names"])
        del o["names"]
    return out


def apply(tl, decisions, packs):
    """Give each pack the first pass's offers seen while it was open, filtered to what it can hold,
    drop the rest, and label the decisions made in a pack. Returns (offers dropped, decisions re-labelled)."""
    for p in packs:
        p["offered"] = []
    # Offers of the first pass go to the pack open at that time, filtered to what the pack can hold.
    # One with no pack open (the name panel never showed) is a shop frame the first pass took for
    # a pack, when a tooltip hid Next Round: dropped. The first pass's pack offers are kept aside
    # on the first run, so this pass can run again.
    raw = tl.setdefault("pack_offers_raw", [o for o in tl["offers"] if o["where"] == "pack"])
    kept = [o for o in tl["offers"] if o["where"] != "pack"]
    for o in raw:
        p = next((p for p in packs if p["t"] - 2 <= o["t"] <= p["end_t"] + 2), None)
        items = [x for x in o["items"] if p and fits(x["key"], p["pack"])]
        if p:
            for x in items:
                if all(y["key"] != x["key"] for y in p["offered"]):
                    p["offered"].append(x)
        if items:
            kept.append({**o, "items": items})
    kept.sort(key=lambda o: o["t"])
    dropped = sum(len(o["items"]) for o in raw) - sum(len(o["items"]) for o in kept if o["where"] == "pack")
    tl["offers"], tl["packs"] = kept, packs
    fixed = 0
    for d in decisions:
        if d.get("screen") != "pack" and not d["type"].startswith("pack_pick_"):
            continue
        p = next((p for p in packs if p["t"] - 2 <= d["t_seconds"] <= p["end_t"] + 8), None)
        if not p:
            continue
        d.setdefault("pack_first_pass", d.get("pack"))
        if d.get("offered") or d.get("offered_first_pass"):
            d.setdefault("offered_first_pass", d["offered"])
            d["offered"] = [x for x in d["offered_first_pass"] if fits(x["key"], p["pack"])]
        if d.get("pack") != p["pack"]:
            fixed += 1
        d["pack"] = p["pack"]
    return dropped, fixed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("videos", nargs="+")
    ap.add_argument("--dry", action="store_true", help="print the packs found, write nothing")
    ap.add_argument("--cached", action="store_true", help="reuse the name readings stored by an earlier run instead of reading frames")
    ap.add_argument("--refilter", action="store_true", help="keep the pack openings found earlier; only redo the offers and decisions")
    a = ap.parse_args()
    for vid in a.videos:
        tl_path, d_path = ROOT / f"{vid}.json", ROOT / f"{vid}.decisions.jsonl"
        tl = json.loads(tl_path.read_text())
        decisions = [json.loads(l) for l in d_path.read_text().splitlines() if l.strip()]
        cap = cv2.VideoCapture(str(ROOT / "videos" / f"{vid}.mp4"))
        reads = [(t, scr, tuple(name) if name else None) for t, scr, name in tl.get("pack_reads", [])] if a.cached else []
        for a0, b0 in [] if (a.cached and reads) or a.refilter else windows(tl["screens"]):
            cap.set(cv2.CAP_PROP_POS_MSEC, max(0, a0) * 1000)
            t = max(0, a0)
            while t <= b0:
                ok, f = cap.read()
                if not ok:
                    break
                if f.shape[1] != 1280:
                    f = cv2.resize(f, (1280, 720))
                scr = screen_of(f)
                reads.append((t, scr, read_name(f) if scr in ("pack", "shop", "other") else None))
                # Skip to the next whole second.
                target = (t + 1) * 1000
                while cap.get(cv2.CAP_PROP_POS_MSEC) + 1 < target:
                    if not cap.grab():
                        break
                t += 1
        before = tl.get("packs_pass", {}).get("first_pass_packs", len(tl.get("packs") or []))
        if reads:
            tl["pack_reads"] = [[t, scr, list(name) if name else None] for t, scr, name in reads]
        if a.refilter:
            packs = [{k: v for k, v in p.items() if k != "offered"} for p in tl["packs"]]
        else:
            packs = openings(reads)
            tl["packs_pass"] = {"reads": len(reads), "named": sum(1 for r in reads if r[2]), "first_pass_packs": before}
        dropped, fixed = apply(tl, decisions, packs)
        if a.dry:
            for p in packs:
                print(f"  {p['t']:7.0f}-{p['end_t']:.0f} {p['size']:6} {p['pack']:9} reads {p['reads']:2}  {[x['name'] for x in p['offered']]}")
            print(f"{vid}: {before} packs -> {len(packs)}, {dropped} pack offers dropped, {fixed} decisions re-labelled (dry run)")
            continue
        tl_path.write_text(json.dumps(tl, indent=1, ensure_ascii=False))
        d_path.write_text("".join(json.dumps(d, ensure_ascii=False) + "\n" for d in decisions))
        print(f"{vid}: {before} packs -> {len(packs)} ({dict(Counter(p['pack'] for p in packs))}), {dropped} pack offers dropped, {fixed} decisions re-labelled", flush=True)


if __name__ == "__main__":
    main()
