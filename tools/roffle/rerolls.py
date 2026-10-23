"""Second pass over shop visits: rerolls from the Reroll price read every second.

analyze.py reads the price every 2 s and wants it read twice before it counts, so when he rerolls
once a second the first steps are missed. This reads the price at 1 s through every shop visit in
<video>.json and keeps a price when the next read is the same or higher (one misread digit can't
start a chain); each step up of $1 to $3 is that many rerolls. The video's reroll decisions and its
shop summaries are replaced; hover and cursor fields are carried over from the first pass's reroll
nearest in time, when there was one.

    python3 tools/roffle/rerolls.py -- VIDEO_ID [VIDEO_ID ...]
"""

import argparse
import json
import re
import sys
from pathlib import Path

import cv2

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import analyze as A  # noqa: E402
import early  # noqa: E402

ROOT = Path("data/roffle")


def prices(cap, t0, t1):
    out = []
    t = t0
    while t <= t1:
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
        ok, f = cap.read()
        if not ok:
            break
        if f.shape[1] != 1280:
            f = cv2.resize(f, (1280, 720))
        if A.screen_of(f) == "shop":
            m = re.fullmatch(r"\$(\d{1,3})", A.ocr(A.roi(f, early.REROLL_COST), "$0123456789").replace(" ", ""))
            if m:
                out.append((t, int(m.group(1))))
        t += 1
    return out


def steps(reads):
    """Rerolls from a visit's price reads: [(t, cost paid)]."""
    kept = [(t, v) for i, (t, v) in enumerate(reads) if i + 1 < len(reads) and reads[i + 1][1] >= v]
    out, last = [], None
    for i, (t, v) in enumerate(kept):
        if last is not None and last < v <= last + 3:
            out += [(t, c) for c in range(last, v)]
            last = v
        elif last is None:
            last = v
        elif v < last and i + 1 < len(kept) and kept[i + 1][1] == v:
            # A lower price read twice: a voucher (Reroll Surplus, Reroll Glut) or Chaos the
            # Clown's free reroll reset it. Count from there.
            last = v
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("videos", nargs="+")
    a = ap.parse_args()
    catalog = json.loads((A.CATALOG / "jokers.json").read_text())
    names = {j["key"]: j["name"] for j in catalog}
    names.update({k: v["name"] for k, v in json.loads((A.CATALOG / "consumables.json").read_text()).items()})
    aliases = A.aliases_of(catalog)
    for vid in a.videos:
        tl_path, d_path = ROOT / f"{vid}.json", ROOT / f"{vid}.decisions.jsonl"
        tl = json.loads(tl_path.read_text())
        decisions = [json.loads(l) for l in d_path.read_text().splitlines() if l.strip()]
        old = [d for d in decisions if d["type"] == "reroll"]
        keep = [d for d in decisions if d["type"] != "reroll"]
        transcript = A.load_transcript(vid)
        segs = [{"start": b["start_t"], "end": b["end_t"], "key": b["key"], "ante": b["ante"], "round": b["round"], "boss": b["boss"]} for b in tl["blinds"]]
        cap = cv2.VideoCapture(str(ROOT / "videos" / f"{vid}.mp4"))
        new = []
        for shop in tl["shops"]:
            events = steps(prices(cap, shop["start_t"], shop["end_t"]))
            shop["rerolls"], shop["reroll_spent"] = len(events), sum(c for _, c in events)
            for i, (t, cost) in enumerate(events, 1):
                held = [x for x in tl["joker_lineups"] if x["t"] <= t]
                before = [o for o in tl["offers"] if o["where"] == "shop" and shop["start_t"] - 2 <= o["t"] <= t]
                after = [o for o in tl["offers"] if o["where"] == "shop" and t < o["t"] <= shop["end_t"] + 2]
                money_b = [h["money"] for h in tl["hud"] if h["t"] <= t and h["money"] is not None]
                money_a = [h["money"] for h in tl["hud"] if h["t"] >= t and h["money"] is not None]
                ante, rnd, seg = early.ante_at(t, segs)
                text = A.window(transcript, t)
                said = A.mentions(text, aliases)
                reason, pivot_words, _ = A.label_reason(text, None, said)
                near = min(old, key=lambda d: abs(d["t_seconds"] - t), default=None)
                near = near if near and abs(near["t_seconds"] - t) <= 3 else None
                boss = next((s for s in segs if s["boss"] and s["ante"] == ante), None)
                new.append(
                    {
                        "video_id": vid,
                        "t_seconds": float(t),
                        "youtube_url": f"https://www.youtube.com/watch?v={vid}&t={int(t)}s",
                        "type": "reroll",
                        "item": None,
                        "jokers_before": held[-1]["jokers"] if held else None,
                        "jokers_after": held[-1]["jokers"] if held else None,
                        "consumables_before": None,
                        "consumables_after": None,
                        "screen": "shop",
                        "offered": before[-1]["items"] if before else None,
                        "pack": None,
                        "ante": ante,
                        "round": rnd,
                        "money_before": money_b[-1] if money_b else None,
                        "money_after": money_a[0] if money_a else None,
                        "transcript": text[:700],
                        "jokers_mentioned": [A.pretty(x, names) for x, _ in said.most_common(6)],
                        "reason": reason,
                        "pivot": {"confidence": round(min(0.9, 0.2 * len(pivot_words)), 2), "evidence": pivot_words},
                        "detection": {"method": "Reroll price read every second went up by $1", "item_conf": None, "confidence": "high", "notes": ""},
                        "offered_after": after[0]["items"] if after else None,
                        "reroll": {"cost": cost, "index": i},
                        "ante_ocr": None,
                        "round_ocr": None,
                        "ante_source": "blinds" if ante is not None else None,
                        "phase": early.phase_of(ante),
                        "blind": {"key": seg["key"], "name": A.pretty(seg["key"], names)} if seg else None,
                        "boss": {"key": boss["key"], "name": boss["key"]} if boss else None,
                        "score_target": next((b["score_target"] for b in tl["blinds"] if seg and b["start_t"] == seg["start"]), None),
                        "score_scale": None,
                        "hovered": near["hovered"] if near else None,
                        "cursor_on": near["cursor_on"] if near else None,
                        "click_confirmed": near["click_confirmed"] if near else None,
                    }
                )
        # Blind names, bosses and targets come from the timeline, as in the first pass.
        bnames = {b["key"]: b["name"] for b in tl["blinds"]}
        for d in new:
            if d["boss"]:
                d["boss"]["name"] = bnames.get(d["boss"]["key"], d["boss"]["key"])
            if d["blind"]:
                d["blind"]["name"] = bnames.get(d["blind"]["key"], d["blind"]["key"])
            d["score_scale"] = early.scale_of(d["score_target"])
        out = sorted(keep + new, key=lambda d: d["t_seconds"])
        d_path.write_text("".join(json.dumps(x, ensure_ascii=False) + "\n" for x in out))
        tl_path.write_text(json.dumps(tl, indent=1, ensure_ascii=False))
        print(f"{vid}: {len(old)} rerolls before, {len(new)} after", flush=True)


if __name__ == "__main__":
    main()
