"""Check every quote in data/bu/claims.json against the caption tracks.

    python3 -I tools/bu/check.py          # report
    python3 -I tools/bu/check.py --fix    # also rewrite t_seconds/url to the matched second

A quote passes when its words occur contiguously in the video's json3 captions (case and
punctuation ignored). t_seconds must be within 3 s of the start of the nearest occurrence.
Table rows with a video and t_seconds (tag, consumable and joker tiers) are not quotes and are
only checked for a known video id.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from text import DIR, find, words  # noqa: E402

PATH = Path("data/bu/claims.json")


def main(fix):
    data = json.loads(PATH.read_text())
    cache, bad, moved, total = {}, 0, 0, 0
    for c in data["claims"]:
        for q in c["quotes"]:
            total += 1
            vid = q["video"]
            if vid not in cache:
                cache[vid] = words(vid) if (DIR / f"{vid}.en.json3").exists() or (DIR / f"{vid}.words.tsv").exists() else None
            if cache[vid] is None:
                print(f"NO CAPTIONS {c['id']} {vid}")
                bad += 1
                continue
            t = find(vid, q["text"], cache[vid], near=q.get("t_seconds"))
            if t is None:
                print(f"MISSING {c['id']} {vid}: {q['text'][:70]}")
                bad += 1
            elif abs(t - (q.get("t_seconds") or -99)) > 3:
                moved += 1
                print(f"MOVED {c['id']} {vid}: {q.get('t_seconds')} -> {t}")
                if fix:
                    q["t_seconds"] = round(t, 1)
                    q["url"] = f"https://www.youtube.com/watch?v={vid}&t={int(t)}s"
    print(f"{total} quotes, {bad} missing, {moved} with a different second")
    if fix:
        PATH.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main("--fix" in sys.argv))
