"""Turn json3 auto-captions into timestamped plain text, and look up verbatim quotes.

    python3 tools/bu/text.py ID...          # writes data/bu/captions/ID.txt (one line per ~20 s)
                                            # and ID.words.tsv (second<TAB>word, one per line)
    python3 tools/bu/text.py --find ID "some words"   # prints the second the words start at

Words keep the caption's own spelling; the start second of each word comes from the json3
offsets (event tStartMs + seg tOffsetMs). The raw json3 is large and stays local (gitignored);
words.tsv holds the same words and seconds, and is what lookups use when json3 is absent.
"""

import json
import re
import sys
from pathlib import Path

DIR = Path("data/bu/captions")


def words(vid):
    """[(t_seconds, word)] in order, from the json3 captions (or words.tsv without them)."""
    raw = DIR / f"{vid}.en.json3"
    if not raw.exists():
        out = []
        for line in (DIR / f"{vid}.words.tsv").read_text().splitlines():
            t, w = line.split("\t", 1)
            out.append((float(t), w))
        return out
    data = json.load(open(raw))
    out = []
    for ev in data.get("events", []):
        t0 = ev.get("tStartMs", 0)
        for seg in ev.get("segs") or []:
            w = seg.get("utf8", "").strip()
            if not w:
                continue
            for part in w.split():
                out.append(((t0 + seg.get("tOffsetMs", 0)) / 1000.0, part))
    return out


def norm(w):
    return re.sub(r"[^a-z0-9$%+.]", "", w.lower().replace("’", "'")).strip(".")


def find_all(vid, quote, ws=None):
    """Start seconds of every occurrence of quote (normalised word match)."""
    ws = ws or words(vid)
    q = [norm(x) for x in quote.split() if norm(x)]
    n = [norm(w) for _, w in ws]
    return [ws[i][0] for i in range(len(n) - len(q) + 1) if q and n[i:i + len(q)] == q]


def find(vid, quote, ws=None, near=None):
    """Start second of the occurrence of quote nearest to `near` (else the first), or None."""
    hits = find_all(vid, quote, ws)
    if not hits:
        return None
    return min(hits, key=lambda t: abs(t - near)) if near is not None else hits[0]


def write_text(vid, step=20):
    ws = words(vid)
    lines, cur, start = [], [], None
    for t, w in ws:
        if start is None:
            start = t
        cur.append(w)
        if t - start >= step:
            lines.append(f"[{int(start)}] " + " ".join(cur))
            cur, start = [], None
    if cur:
        lines.append(f"[{int(start)}] " + " ".join(cur))
    (DIR / f"{vid}.txt").write_text("\n".join(lines) + "\n")
    (DIR / f"{vid}.words.tsv").write_text("".join(f"{t:.2f}\t{w}\n" for t, w in ws))
    return len(ws)


if __name__ == "__main__":
    args = sys.argv[1:]
    if args and args[0] == "--find":
        print(find(args[1], " ".join(args[2:])))
    else:
        for vid in args:
            print(vid, write_text(vid), "words")
