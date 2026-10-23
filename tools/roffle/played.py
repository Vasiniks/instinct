"""Second pass over play_hand decisions: read the played cards off the play area.

analyze.py reads the hand every 2 s, so the lifted cards it saw can be a partial lift. Played cards
sit in the play area for a couple of seconds, so this reads that area with BalatroEngine's card model
just after each play and keeps the read that has the most cards and agrees best with the lift.

    PYTHONPATH=tools/roffle/.vendor python3 tools/roffle/played.py -- VIDEO_ID [VIDEO_ID ...]
"""

import argparse
import contextlib
import io
import json
import os
import sys
from collections import Counter
from pathlib import Path

import cv2

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE / "vendor" / "BalatroEngine"))
import early  # noqa: E402

ROOT = Path("data/roffle")
PLAY = (339, 250, 1053, 465)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("videos", nargs="+")
    a = ap.parse_args()
    os.environ.setdefault("YOLO_CONFIG_DIR", str(Path(os.environ.get("TMPDIR", "/tmp")) / "Ultralytics"))
    from PIL import Image  # noqa: PLC0415

    from classifiers.inference import get_card_pipeline  # noqa: PLC0415

    with contextlib.redirect_stdout(io.StringIO()):
        pipe = get_card_pipeline(device="cpu")
    for vid in a.videos:
        path = ROOT / f"{vid}.decisions.jsonl"
        decisions = [json.loads(l) for l in path.read_text().splitlines() if l.strip()]
        cap = cv2.VideoCapture(str(ROOT / "videos" / f"{vid}.mp4"))
        fixed = 0
        for d in decisions:
            if d["type"] != "play_hand" or "cards_lifted" in d:
                continue
            lifted = d.get("cards") or []
            key = lambda c: (c["rank"], c["suit"])
            want = Counter(key(c) for c in lifted)
            best = None
            for dt in (0, 1, 2):
                cap.set(cv2.CAP_PROP_POS_MSEC, (d["t_seconds"] + dt) * 1000)
                ok, f = cap.read()
                if not ok:
                    break
                x0, y0, x1, y1 = PLAY
                crop = Image.fromarray(cv2.cvtColor(f[y0:y1, x0:x1], cv2.COLOR_BGR2RGB))
                read = [
                    early.card_label({"rank": c.rank, "suit": c.suit, "enhancement": c.enhancement, "edition": c.edition, "seal": c.seal, "debuffed": c.debuffed})
                    for c in pipe.predict(crop, conf=0.5)
                    if c.rank not in (None, "None") and c.suit not in (None, "None")
                ]
                if not read or len(read) > 5:
                    continue
                overlap = sum((Counter(key(c) for c in read) & want).values())
                score = (2 * overlap + len(read), len(read))
                if best is None or score > best[0]:
                    best = (score, read, overlap)
                if len(read) == 5 and overlap == len(lifted):
                    break
            # Only a read that agrees with the lift and adds to it replaces it.
            if best and best[2] >= min(2, len(lifted)) and len(best[1]) > len(lifted):
                d["cards_lifted"] = lifted
                d["cards"] = best[1]
                d["detection"]["notes"] = "; ".join(n for n in (d["detection"]["notes"], "cards read off the play area") if n)
                fixed += 1
        path.write_text("".join(json.dumps(x, ensure_ascii=False) + "\n" for x in decisions))
        print(f"{vid}: {fixed} plays filled in from the play area", flush=True)


if __name__ == "__main__":
    main()
