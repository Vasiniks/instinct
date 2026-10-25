"""Early-game detail for the Roffle dataset: which blind is up, skips and their tags, vouchers,
rerolls, and where his mouse was. All local OpenCV and tesseract; analyze.py calls into this.

Blinds are told apart by the HUD plate colour (each boss has its own, from game.lua) and the chip
sprite next to it (BlindChips.png). The order of blinds played then gives ante and round: the
ante goes up after every boss. Tesseract readings are kept only as a cross-check.
Coordinates are for a 1280x720 frame of his layout.
"""

import json
import math
import re
from collections import Counter, defaultdict
from pathlib import Path

import cv2
import numpy as np

CATALOG = Path("data/roffle/catalog")

PLATE = [(62, 62, 92, 84), (290, 62, 318, 84)]  # HUD blind plate, either side of the name
CHIP = (50, 125, 170, 240)  # HUD blind chip
TARGET = (180, 158, 322, 198)  # "Score at least" number
PANELS = [(380, 540), (615, 778), (850, 1012)]  # blind select: small, big, boss columns
REROLL_COST = (420, 388, 515, 425)
REROLL_BTN = (388, 352, 545, 442)
NEXT_ROUND_BTN = (388, 262, 545, 346)
PACK_SKIP_BTN = (830, 612, 960, 690)
ANTE_VOUCHERS = {"v_hieroglyph", "v_petroglyph"}  # each sets the ante back by one


def _lab(hexs):
    bgr = np.uint8([[[int(hexs[4:6], 16), int(hexs[2:4], 16), int(hexs[0:2], 16)]]])
    return cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)[0, 0].astype(float)


def _composite(rgba, bg=60):
    a = rgba[:, :, 3:4].astype(np.float32) / 255
    return (rgba[:, :, :3] * a + bg * (1 - a)).astype(np.uint8)


class Blinds:
    """Which blind the HUD shows: nearest plate colours, then the best chip match among them."""

    def __init__(self):
        self.all = {b["key"]: b for b in json.loads((CATALOG / "blinds.json").read_text())}
        self.lab = {k: _lab(b["colour"]) for k, b in self.all.items() if b["colour"]}
        self.chips = {}
        for k, b in self.all.items():
            strip = cv2.imread(str(CATALOG / b["chip"]), cv2.IMREAD_UNCHANGED)
            g = cv2.cvtColor(_composite(strip[:, :68]), cv2.COLOR_BGR2GRAY)
            self.chips[k] = [cv2.resize(g, (n, n), interpolation=cv2.INTER_AREA) for n in (72, 78, 84)]

    def identify(self, f, plate=PLATE, chip=CHIP):
        """(key, chip match) or None when no blind is shown."""
        px = np.vstack([f[y0:y1, x0:x1].reshape(-1, 3) for x0, y0, x1, y1 in plate])
        c = cv2.cvtColor(np.median(px, axis=0).astype(np.uint8)[None, None], cv2.COLOR_BGR2LAB)[0, 0].astype(float)
        dist = {k: float(np.linalg.norm(c - v)) for k, v in self.lab.items()}
        x0, y0, x1, y1 = chip
        g = cv2.cvtColor(f[y0:y1, x0:x1], cv2.COLOR_BGR2GRAY)
        best = None
        for k in sorted(dist, key=dist.get)[:5]:
            ncc = max(float(cv2.matchTemplate(g, t, cv2.TM_CCOEFF_NORMED).max()) for t in self.chips[k])
            score = ncc - 0.004 * dist[k]
            if best is None or score > best[0]:
                best = (score, k, ncc)
        # Shop sign, blank panels and transitions match no chip well; real blinds score 0.8-0.97.
        return (best[1], round(best[2], 2)) if best and best[2] >= 0.6 else None


class Tags:
    """Tags share one round badge, so only the icon inside it is matched."""

    def __init__(self):
        self.all = {t["key"]: t for t in json.loads((CATALOG / "tags.json").read_text())}
        self.sprites = {}
        for k, t in self.all.items():
            im = cv2.imread(str(CATALOG / t["sprite"]), cv2.IMREAD_UNCHANGED)
            self.sprites[k] = []
            for n in (32, 34, 36, 38, 40):
                tpl = cv2.resize(_composite(im, 40), (n, n), interpolation=cv2.INTER_AREA)
                a, b = int(n * 0.22), int(n * 0.78)
                self.sprites[k].append(tpl[a:b, a:b])

    def identify(self, crop):
        scores = []
        for k, ts in self.sprites.items():
            v = max(float(cv2.matchTemplate(crop, t, cv2.TM_CCOEFF_NORMED).max()) for t in ts if crop.shape[0] >= t.shape[0] and crop.shape[1] >= t.shape[1])
            scores.append((v, k))
        scores.sort(reverse=True)
        (v, k), (v2, _) = scores[0], scores[1]
        # The right icon scored 0.8 against 0.65 for the next one on his frames.
        return (k, round(v, 2)) if v >= 0.6 and v - v2 >= 0.06 else None


# The arrow cursor, as white pixels with a margin that must not be white. Real cursors score
# 0.85-0.95; text corners and card art stay below 0.8.
_ARROW = np.pad(
    np.array(
        [
            [1, 0, 0, 0, 0, 0],
            [1, 1, 0, 0, 0, 0],
            [1, 1, 1, 0, 0, 0],
            [1, 1, 1, 1, 0, 0],
            [1, 1, 1, 1, 1, 0],
            [1, 1, 1, 1, 1, 0],
            [1, 1, 1, 1, 0, 0],
            [0, 0, 0, 1, 0, 0],
            [0, 0, 0, 0, 1, 0],
        ],
        np.float32,
    ),
    2,
)


def cursor(f):
    """The mouse tip (x, y), or None when it is hidden or over something white."""
    hsv = cv2.cvtColor(f, cv2.COLOR_BGR2HSV)
    white = ((hsv[:, :, 2] > 190) & (hsv[:, :, 1] < 70)).astype(np.float32)
    r = cv2.matchTemplate(white, _ARROW, cv2.TM_CCOEFF_NORMED)
    _, v, _, (x, y) = cv2.minMaxLoc(r)
    return (int(x + 2), int(y + 2)) if v >= 0.85 else None


ORANGE = (np.array([8, 150, 100]), np.array([24, 255, 255]))


def blind_select_state(f, tags):
    """Blind select: which column is up (0 small, 1 big, 2 boss), and the tag on offer for
    skipping it. The column up is raised and carries the orange Select button."""
    hsv = cv2.cvtColor(f, cv2.COLOR_BGR2HSV)
    orange = [float(cv2.inRange(hsv[228:262, x0 + 20 : x1 - 20], *ORANGE).mean() / 255) for x0, x1 in PANELS]
    active = int(np.argmax(orange))
    if orange[active] < 0.35:
        return None
    tag = None
    if active < 2:
        x0 = PANELS[active][0] - 20
        tag = tags.identify(f[537:592, x0 + 15 : x0 + 75])
    return {"active": active, "tag": tag}


def target_box(f, template):
    """Where the HUD's target number is: under its "Score at least" label, which sits lower when a
    boss's rule text is shown above it."""
    g = cv2.cvtColor(f[110:245, 150:330], cv2.COLOR_BGR2GRAY)
    r = cv2.matchTemplate(g, template, cv2.TM_CCOEFF_NORMED)
    _, v, _, (x, y) = cv2.minMaxLoc(r)
    if v < 0.5:
        return None
    x, y = x + 150, y + 110
    return (x + 20, y + 20, min(x + 145, 330), y + 56)


def score_target(text):
    """The blind's "Score at least" as a number, or "naneinf"."""
    low = text.lower().replace(" ", "")
    if "nan" in low or "inf" in low:
        return "naneinf"
    m = re.search(r"(\d[\d.]*)e\+?(\d+)", low)
    if m:
        try:
            return float(m.group(1)) * 10 ** int(m.group(2))
        except (ValueError, OverflowError):
            return None
    # The chip icon in front of the number reads as a stray glyph ("@", "1"): keep the longest
    # run of digits and separators.
    runs = re.findall(r"\d[\d.,]*", text)
    if not runs:
        return None
    digits = re.sub(r"[^\d]", "", max(runs, key=len))
    return int(digits) if digits else None


def scale_of(target):
    if target == "naneinf":
        return "naneinf"
    if not target:
        return None
    return f"1e{int(math.log10(target))}"


def phase_of(ante):
    if ante is None:
        return None
    return "early" if ante <= 3 else "mid" if ante <= 8 else "endless"


# ---------------------------------------------------------------------------------------------
# Blind sequence -> ante, round, skips
# ---------------------------------------------------------------------------------------------


def blind_segments(readings, breaks):
    """Runs of the same blind in the HUD (`readings`: [{t, key, conf}]), split at shop, cash out
    and blind select screens (`breaks`: sorted times) so the same blind in two antes stays two."""
    segs = []
    for r in readings:
        last = segs[-1] if segs else None
        split = last is not None and any(last["end"] < b < r["t"] for b in breaks)
        if last and last["key"] == r["key"] and not split:
            last["end"] = r["t"]
            last["n"] += 1
        else:
            segs.append({"key": r["key"], "start": r["t"], "end": r["t"], "n": 1})
    segs = [s for s in segs if s["n"] >= 2]
    # A blind read only twice that starts with no break after the one before is a misread chip in
    # that blind (a boss chip read for 2 s in the middle of a Big Blind, or the next boss's chip
    # flashing as the last one ends); kept, it adds an ante, and two skips, to everything after.
    segs = [s for i, s in enumerate(segs) if not (s["n"] <= 2 and i > 0 and not any(segs[i - 1]["end"] < b < s["start"] for b in breaks))]
    # Glue back a blind split by a stray break (two segments of the same blind in a row).
    out = []
    for s in segs:
        if out and out[-1]["key"] == s["key"]:
            out[-1]["end"] = s["end"]
            out[-1]["n"] += s["n"]
        else:
            out.append(dict(s))
    return out


def derive_antes(segs, blinds, run_starts=(), ante_vouchers=()):
    """Walk the blinds played in order: round +1 per blind, ante +1 after each boss, -1 for an
    ante voucher. A Big or a boss with no blind before it in its ante means one was skipped."""
    starts = sorted(run_starts)
    marks = sorted(ante_vouchers)
    out, skipped = [], []
    ante, rnd, pos = 1, 0, 0  # pos: 0 waiting for small, 1 for big, 2 for the boss
    for s in segs:
        while starts and starts[0] <= s["start"]:
            starts.pop(0)
            ante, rnd, pos = 1, 0, 0
        while marks and marks[0] <= s["start"]:
            marks.pop(0)
            ante = max(1, ante - 1)
        b = blinds[s["key"]]
        kind = 2 if b["boss"] else 1 if s["key"] == "bl_big" else 0
        for missing in range(pos, kind):
            skipped.append({"blind": ("bl_small", "bl_big")[missing], "before": s["start"], "ante": ante})
        rnd += 1
        out.append({**s, "ante": ante, "round": rnd, "boss": b["boss"]})
        if kind == 2:
            ante, pos = ante + 1, 0
        else:
            pos = kind + 1
    return out, skipped


def ante_at(t, segs):
    """Ante and round at time t: those of the blind being played, and after a boss the next ante."""
    prev = [s for s in segs if s["start"] <= t]
    if not prev:
        return None, None, None
    s = prev[-1]
    if s["boss"] and t > s["end"] + 2:
        return s["ante"] + 1, s["round"], s
    return s["ante"], s["round"], s


def anchor(segs, hud):
    """Shift the derived antes by the offset most OCR readings agree on (a video can start mid-run);
    returns the offset and how many readings agree once it is applied."""
    diffs = []
    for h in hud:
        if h.get("ante") is None:
            continue
        a, _, _ = ante_at(h["t"], segs)
        if a is not None:
            diffs.append(h["ante"] - a)
    if not diffs:
        return 0, 0, 0
    off, n = Counter(diffs).most_common(1)[0]
    # OCR alone is not trusted to move the count: only a clear majority does.
    if off != 0 and n < 0.5 * len(diffs):
        off = 0
    return off, sum(d == off for d in diffs), len(diffs)


# ---------------------------------------------------------------------------------------------
# Mouse: what was under it
# ---------------------------------------------------------------------------------------------


def element_at(pos, screen, ctx):
    """The thing under the cursor: an item key, or a UI element like "reroll" or "skip:bl_big".
    ctx holds the latest item boxes per screen."""
    if pos is None:
        return None
    x, y = pos

    def inside(b, grow=(0, 0, 0, 0)):
        return b[0] - grow[0] <= x <= b[2] + grow[2] and b[1] - grow[1] <= y <= b[3] + grow[3]

    if screen == "shop":
        if inside(REROLL_BTN):
            return "reroll"
        if inside(NEXT_ROUND_BTN):
            return "next_round"
        # Buy and Use buttons pop out under or beside a hovered card.
        for it in ctx.get("shelf", []) + ctx.get("voucher", []):
            if inside(it["box"], (0, 0, 10, 45)):
                return it["key"]
    if screen == "pack":
        if inside(PACK_SKIP_BTN):
            return "skip_pack"
        for it in ctx.get("pack", []):
            if inside(it["box"], (0, 0, 10, 45)):
                return it["key"]
    if screen == "blind_select":
        for i, (x0, x1) in enumerate(PANELS):
            blind = ("bl_small", "bl_big", "boss")[i]
            if x0 <= x <= x1:
                if 215 <= y <= 270:
                    return f"select:{blind}"
                if 535 <= y <= 595 and i < 2:
                    return f"skip:{blind}"
                return f"panel:{blind}"
    # Owned jokers and consumables: their Sell and Use buttons sit to the right.
    for it in ctx.get("jokers", []) + ctx.get("cons", []):
        if inside(it["box"], (0, 0, 45, 10)):
            return it["key"]
    return None


def visits(fine):
    """Stretches of one screen (shop, pack, blind select) in the per-second samples. Tooltips and
    animations read as "other" for a moment, and a pack opened in the shop sits inside the shop
    visit, so a visit only ends when a hand or another main screen starts."""
    out, cur = [], None
    for s in fine:
        sc = s["screen"]
        if cur and sc == cur["screen"]:
            cur["end"] = s["t"]
            cur["samples"].append(s)
            continue
        if cur and (sc == "other" or (cur["screen"] == "shop" and sc == "pack")) and s["t"] - cur["end"] <= 30:
            continue  # inside the visit
        if sc in ("shop", "pack", "blind_select"):
            cur = {"screen": sc, "start": s["t"], "end": s["t"], "samples": [s]}
            out.append(cur)
        else:
            cur = None
    return out


def hovered_between(fine, t0, t1, names, screen):
    """Seconds the cursor spent on each item or element of `screen` between t0 and t1 (1 s samples)."""
    secs = Counter(s["under"] for s in fine if t0 <= s["t"] <= t1 and s.get("under") and s["screen"] == screen)
    return [{"key": k, "name": names.get(k, k), "seconds": n} for k, n in secs.most_common()]


def under_before(fine, t, screen, back=6):
    """Elements of `screen` under the cursor in the last `back` seconds before t, most recent first."""
    return [s["under"] for s in reversed(fine) if t - back <= s["t"] <= t + 2 and s.get("under") and s["screen"] == screen]


EXPECT = {
    "buy_joker": "item",
    "buy_consumable": "item",
    "buy_voucher": "item",
    "pack_pick_joker": "item",
    "pack_pick_consumable": "item",
    "sell_joker": "item",
    "sell_consumable": "item",
    "use_consumable": "item",
    "reroll": "reroll",
}


def confirm(d, fine):
    """Whether the cursor was on the thing the decision acted on just before it: the card for a
    buy, pick, sell or use, the Reroll button, or the column's Select or Skip button."""
    screen = "blind_select" if d["type"] in ("select_blind", "skip_blind") else d.get("screen")
    seen = under_before(fine, d["t_seconds"], screen)
    if not seen:
        return None, None
    want = None
    if d["type"] in EXPECT:
        want = "reroll" if EXPECT[d["type"]] == "reroll" else (d.get("item") or {}).get("key")
    elif d["type"] == "select_blind":
        b = (d.get("item") or {}).get("key", "")
        want = f"select:{b if b in ('bl_small', 'bl_big') else 'boss'}"
    elif d["type"] == "skip_blind":
        want = f"skip:{(d.get('blind') or {}).get('key')}"
    if want is None:
        return seen[0], None
    return seen[0], want in seen


# ---------------------------------------------------------------------------------------------
# Hands: the cards he lifted, and whether they were played or thrown away
# ---------------------------------------------------------------------------------------------

PLAY_AREA = (380, 250, 1000, 375)  # played cards are shown here for a moment; discards fly off
RANK = {"Ace": "A", "King": "K", "Queen": "Q", "Jack": "J"}


def play_area(f, bg):
    """Share of the play area that is not felt: 0.4-0.6 while a played hand is shown, under 0.2 otherwise."""
    x0, y0, x1, y1 = PLAY_AREA
    body = cv2.cvtColor(f[y0:y1, x0:x1], cv2.COLOR_BGR2HSV).astype(np.int16)
    felt = (np.abs(body[:, :, 0] - bg[0]) < 10) & (np.abs(body[:, :, 1] - bg[1]) < 50) & (np.abs(body[:, :, 2] - bg[2]) < 50)
    return round(float(1 - felt.mean()), 2)


def card_label(c):
    out = {"rank": RANK.get(c["rank"], c["rank"]), "suit": c["suit"]}
    for k in ("enhancement", "edition", "seal"):
        if c.get(k) and c[k] != "None":
            out[k] = c[k]
    if c.get("debuffed"):
        out["debuffed"] = True
    return out


def hand_events(hand_samples, fine):
    """Lifted cards in one hand sample, most of which are gone from the hand in the next: a play if
    the play area filled right after (0.27 and up on his frames, under 0.2 otherwise), else a
    discard. The cards reported are the ones lifted in that sample; the card model's reads of the
    rest of the hand vary too much between samples to diff whole hands."""
    out = []
    known = lambda c: c["rank"] not in (None, "None") and c["suit"] not in (None, "None") and not c.get("face_down")
    ident = lambda c: (c["rank"], c["suit"])
    for a, b in zip(hand_samples, hand_samples[1:]):
        if b["t"] - a["t"] > 4.5:
            continue
        sel = [c for c in a["cards"] if c["selected"] and known(c)]
        if not sel:
            continue
        gone = Counter(ident(c) for c in sel) - Counter(ident(c) for c in b["cards"])
        if sum(gone.values()) < len(sel) / 2:
            continue
        area = lambda t0, t1: max([s["play_area"] for s in fine if t0 <= s["t"] <= t1 and s["screen"] == "hand" and s.get("play_area") is not None] or [None], key=lambda v: -1 if v is None else v)
        near, late = area(a["t"], b["t"] + 3), area(a["t"], b["t"] + 6)
        # A discard is refilled at once; a played hand stays short while it scores. That also
        # catches plays whose cards reach the play area late, without the next play's cards
        # turning a discard into a play.
        short = len(b["cards"]) <= len(a["cards"]) - max(1, len(sel) - 1)
        played = (near is not None and near >= 0.24) or (short and late is not None and late >= 0.24)
        out.append(
            {
                "type": "play_hand" if played else "discard",
                "t": b["t"],
                "cards": [card_label(c) for c in sel],
                "hand": [card_label(c) for c in a["cards"]],
                "area": near,
                "evidence": {"area_3s": near, "area_6s": late, "hand_before": len(a["cards"]), "hand_after": len(b["cards"])},
            }
        )
    return out


# ---------------------------------------------------------------------------------------------
# Shop: vouchers bought, rerolls
# ---------------------------------------------------------------------------------------------


def shop_events(shop_samples, shop_visits):
    """From 2 s shop samples ({t, voucher, shelf, reroll_cost, money}) grouped by shop visit:
    - a voucher bought: seen at least twice, then gone for the rest of the visit, money down;
    - a reroll: the Reroll price went up by exactly $1 (it resets only with a new shop).
    Recognizer misses and tooltips make single-sample changes common, so neither trusts one."""
    out = []
    for v in shop_visits:
        ss = [s for s in shop_samples if v["start"] - 1 <= s["t"] <= v["end"] + 1]
        if len(ss) < 2:
            continue
        seen = Counter(x["key"] for s in ss for x in s["voucher"] if x["key"].startswith("v_"))
        for k, n in seen.items():
            last = max(i for i, s in enumerate(ss) if any(x["key"] == k for x in s["voucher"]))
            after = ss[last + 1 :]
            if n < 2 or len(after) < 2:
                continue
            m0 = next((s["money"] for s in reversed(ss[: last + 1]) if s.get("money") is not None), None)
            m1 = next((s["money"] for s in after if s.get("money") is not None), None)
            if m0 is not None and m1 is not None and m1 >= m0:
                continue  # nothing was paid: the slot was hidden, not emptied
            item = next(x for x in ss[last]["voucher"] if x["key"] == k)
            out.append({"type": "buy_voucher", "t": after[0]["t"], "key": k, "item": item, "before": ss[last], "after": after[0]})
        costs = [(s["t"], s["reroll_cost"], s) for s in ss if s.get("reroll_cost") is not None]
        # A price must be read twice before it counts, so one misread digit can't make a reroll.
        steady = []
        for i, (t, c, s) in enumerate(costs):
            if i + 1 < len(costs) and costs[i + 1][1] == c and (not steady or steady[-1][1] != c):
                steady.append((t, c, s))
        for (ta, ca, sa), (tb, cb, sb) in zip(steady, steady[1:]):
            if cb > ca and cb - ca <= 3:
                for j in range(cb - ca):  # several quick rerolls between two reads
                    out.append({"type": "reroll", "t": tb, "cost": ca + j, "before": sa, "after": sb, "by": "price"})
    return sorted(out, key=lambda e: e["t"])
