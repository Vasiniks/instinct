"""Second pass over the blinds played: re-derive ante and round, with two fixes the first pass lacked.

1. A blind that starts with no shop, cash out or blind select screen since the one before is the
   same blind: the chip was misread for a moment (a boss chip flashing in the middle of a Big Blind,
   or the next boss's chip as the last one ends). Kept, it added an ante, and two skips, to
   everything after. The two are merged under the key read longer.
2. A Hieroglyph or Petroglyph bought without the voucher being seen leaves every later ante one
   too high (two with both). Where shifting the rest of a run down by one or two makes clearly more
   of the HUD's ante readings (OCR) agree with the count, the count drops from that blind on.

The offset for a video that starts mid-run is taken from the first six blinds only.

Then ante, round, phase, blind and boss are set again on every decision, ante on the shop visits,
the skips are rebuilt (a skip that is no longer one loses its skip_blind decision), and the merged
blinds lose their select_blind decision. No frames are read.

    python3 tools/roffle/antes.py -- VIDEO_ID [VIDEO_ID ...]
"""

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import early  # noqa: E402

ROOT = Path("data/roffle")
BLINDS = {b["key"]: b for b in json.loads((ROOT / "catalog" / "blinds.json").read_text())}
BREAKS = ("shop", "cash_out", "blind_select")


def merge_unbroken(blinds, breaks, run_starts, max_len=float("inf")):
    """Consecutive blinds with no break between them, in the same run, become one, when the shorter
    of the two lasted at most `max_len` seconds."""
    out, merged = [], []
    for b in blinds:
        prev = out[-1] if out else None
        same_run = prev is not None and not any(prev["start_t"] < r <= b["start_t"] for r in run_starts)
        short = prev is not None and min(prev["end_t"] - prev["start_t"], b["end_t"] - b["start_t"]) <= max_len
        if prev and same_run and short and not any(prev["end_t"] < t < b["start_t"] for t in breaks):
            longer = prev if prev["end_t"] - prev["start_t"] >= b["end_t"] - b["start_t"] else b
            gone = b if longer is prev else prev
            merged.append(gone)
            out[-1] = {**longer, "start_t": prev["start_t"], "end_t": b["end_t"], "score_target": longer.get("score_target") or gone.get("score_target")}
        else:
            out.append(dict(b))
    return out, merged


def segs_of(blinds):
    return [{"key": b["key"], "start": b["start_t"], "end": b["end_t"], "n": 0, "score_target": b.get("score_target")} for b in blinds]


def ocr_diffs(segs, hud, a, b):
    """OCR ante minus derived ante for the HUD readings between a and b."""
    out = []
    for h in hud:
        if h.get("ante") is None or not a <= h["t"] <= b or not 1 <= h["ante"] <= 60:
            continue
        x, _, _ = early.ante_at(h["t"], segs)
        if x is not None:
            out.append(h["ante"] - x)
    return out


def mostly(diffs, value, share=0.6, least=4):
    return len(diffs) >= least and diffs.count(value) >= share * len(diffs) and Counter(diffs).most_common(1)[0][0] == value


def agreement(segs, hud):
    d = ocr_diffs(segs, hud, -1, float("inf"))
    return sum(x == 0 for x in d), len(d)


def missed_drops(segs, hud, run_starts, most=4):
    """Where the ante count drops by one or two (Hieroglyph and Petroglyph, often both in endless,
    bought without the voucher being seen): (blind index, shift) pairs.

    Each candidate shifts the rest of its run; the one that makes the most OCR readings over the
    whole video agree with the count is taken (it must add 8 readings and 3% at least), then the
    next. OCR slips that come and go (a 6 read as 5 at ante 6 only) don't qualify: shifting the
    rest of the run would break the antes after them."""
    drops = []
    for _ in range(most):
        base, n = agreement(segs, hud)
        best = None
        for i in range(1, len(segs)):
            run_end = min([r for r in run_starts if r > segs[i]["start"]] + [float("inf")])
            moved = [s for s in segs[i:] if s["start"] < run_end]
            for shift in (-1, -2):
                for s in moved:
                    s["ante"] += shift
                gain = agreement(segs, hud)[0] - base
                for s in moved:
                    s["ante"] -= shift
                if gain >= max(8, 0.03 * n) and (best is None or gain > best[1]):
                    best = (i, gain, moved, shift)
        if best is None:
            break
        for s in best[2]:
            s["ante"] += best[3]
        drops.append((best[0], best[3]))
    return drops


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("videos", nargs="+")
    a = ap.parse_args()
    for vid in a.videos:
        tl_path, d_path = ROOT / f"{vid}.json", ROOT / f"{vid}.decisions.jsonl"
        tl = json.loads(tl_path.read_text())
        decisions = [json.loads(l) for l in d_path.read_text().splitlines() if l.strip()]
        breaks = [s["t"] for s in tl["screens"] if s["screen"] in BREAKS]
        run_starts = [r["start_t"] for r in (tl.get("runs") or [])[1:]]
        old = tl.get("blinds") or []
        marks = sorted(d["t_seconds"] for d in decisions if d["type"] == "buy_voucher" and (d.get("item") or {}).get("key") in early.ANTE_VOUCHERS)

        def derive(bs):
            # The offset (a video that starts mid-run) is read off the first six blinds only: later
            # readings are what the drops below are for, and in a long endless run they outnumber
            # the early ones (one missed Hieroglyph made the first pass shift the whole run).
            segs, skipped = early.derive_antes(segs_of(bs), BLINDS, run_starts, marks)
            first = segs[:6]
            early_hud = [h for h in tl["hud"] if first and h["t"] <= first[-1]["end"] + 20]
            offset, _, _ = early.anchor(first, early_hud) if early_hud else early.anchor(segs, tl["hud"])
            for s in segs + skipped:
                s["ante"] += offset
            return segs, skipped, offset

        # A blind read for 4 s or less with no break before it is merged outright; a longer one only
        # when the merge makes the count agree better with the HUD (a break can be missed too).
        blinds, merged = merge_unbroken(old, breaks, run_starts, max_len=4)
        every, every_merged = merge_unbroken(old, breaks, run_starts)
        if len(every_merged) > len(merged) and agreement(derive(every)[0], tl["hud"])[0] > agreement(derive(blinds)[0], tl["hud"])[0]:
            blinds, merged = every, every_merged
        segs, skipped, offset = derive(blinds)
        drops = missed_drops(segs, tl["hud"], run_starts)
        for k in skipped:
            # A skip belongs to the blind after it; that blind's ante (after any drop) is the skip's.
            nxt = next((s for s in segs if s["start"] >= k["before"]), None)
            if nxt:
                k["ante"] = nxt["ante"]
        _, agree, checked = early.anchor(segs, tl["hud"])

        bname = lambda k: BLINDS[k]["name"] if k in BLINDS else k  # noqa: E731
        tl["blinds"] = [
            {"start_t": s["start"], "end_t": s["end"], "key": s["key"], "name": bname(s["key"]), "ante": s["ante"], "round": s["round"], "boss": s["boss"], "score_target": s["score_target"]}
            for s in segs
        ]
        old_skips = tl.get("skips") or []
        tl["skips"] = [{**k, "blind_name": bname(k["blind"])} for k in skipped]
        for shop in tl.get("shops") or []:
            shop["ante"] = early.ante_at(shop["start_t"], segs)[0]
        tl["ante_check"] = {**(tl.get("ante_check") or {}), "offset": offset, "ocr_readings": checked, "agree": agree, "merged_blinds": (tl.get("ante_check") or {}).get("merged_blinds", 0) + len(merged), "missed_ante_vouchers": -sum(x for _, x in drops)}

        # Decisions: drop the select_blind of a merged blind. Skips and skip_blind decisions are
        # matched one to one (the latest decision before the blind after the skip); a decision left
        # over is a skip that is gone. Two skipped antes in a row gave the first pass two copies of
        # the first ante's skip decisions (same time, same tag): a copy matched to the later skip
        # moves next to it and loses the tag, which was never read for it.
        gone_starts = {(b["start_t"], b["key"]) for b in merged}
        skip_ds = sorted((d for d in decisions if d["type"] == "skip_blind"), key=lambda d: d["t_seconds"])
        owner = {}
        for k in sorted(skipped, key=lambda k: k["before"]):
            cands = [d for d in skip_ds if id(d) not in owner and (d.get("blind") or {}).get("key") == k["blind"] and -60 <= k["before"] - d["t_seconds"] <= 130]
            if cands:
                owner[id(cands[-1])] = k
        prev_end = lambda t: max([s["end"] for s in segs if s["end"] < t] + [-1])  # noqa: E731
        kept, dropped_skips, retimed = [], 0, 0
        for d in decisions:
            if d["type"] == "select_blind" and (d["t_seconds"], (d.get("item") or {}).get("key")) in gone_starts:
                continue
            if d["type"] == "skip_blind":
                k = owner.get(id(d))
                if k is None:
                    dropped_skips += 1
                    continue
                if d["t_seconds"] < prev_end(k["before"]):
                    d["t_seconds"] = round(k["before"] - 5, 1)
                    d["item"] = None
                    d["detection"]["notes"] = "; ".join(n for n in (d["detection"].get("notes"), "tag not read: a copy of the previous ante's skip") if n)
                    d["detection"]["confidence"] = "low"
                    retimed += 1
            kept.append(d)
        kept.sort(key=lambda d: d["t_seconds"])
        missing = [k for k in skipped if k not in owner.values()]
        changed = 0
        for d in kept:
            t = d["t_seconds"]
            x, r, seg = early.ante_at(t, segs)
            if x is None:
                continue
            if (d.get("ante"), d.get("round")) != (x, r):
                changed += 1
            d["ante"], d["round"], d["ante_source"] = x, r, "blinds"
            d["phase"] = early.phase_of(x)
            if seg and d["type"] != "skip_blind":
                d["blind"] = {"key": seg["key"], "name": bname(seg["key"])}
            boss = next((s for s in segs if s["boss"] and s["ante"] == x and s["start"] >= (seg["start"] if seg else 0) - 400), None)
            d["boss"] = {"key": boss["key"], "name": bname(boss["key"])} if boss else d.get("boss")
            if d["type"] == "skip_blind":
                k = owner[id(d)]
                d["ante"], d["phase"] = k["ante"], early.phase_of(k["ante"])
        tl_path.write_text(json.dumps(tl, indent=1, ensure_ascii=False))
        d_path.write_text("".join(json.dumps(d, ensure_ascii=False) + "\n" for d in kept))
        print(
            f"{vid}: {len(old)} blinds -> {len(segs)} ({len(merged)} merged), offset {offset}, {-sum(x for _, x in drops)} missed ante vouchers, "
            f"skips {len(old_skips)} -> {len(skipped)} ({dropped_skips} skip decisions dropped, {retimed} re-timed, {len(missing)} skips with no decision), "
            f"{changed} decisions re-dated, OCR ante agrees {agree}/{checked}",
            flush=True,
        )


if __name__ == "__main__":
    main()
