"""Roffle Lite run analysis: the jokers and consumables he holds over time, and the choices that
changed them, with what the shop or pack offered and what he said around each choice.

Everything is local and free, no model API:
  - items: BalatroEngine's pretrained shop pipeline (YOLO detector + MobileNet classifier for every
    joker and consumable, with edition and stickers), vendored in tools/roffle/vendor/BalatroEngine;
  - screens: OpenCV template matching on UI text cut from his own frames (tools/roffle/templates);
  - money, ante, round, pack names: tesseract on upscaled HUD crops;
  - reasons and pivots: keyword rules over the YouTube auto-transcript.
Coordinates are for a 1280x720 frame of his layout (game full screen, facecam bottom right).

    python3 tools/roffle/analyze.py VIDEO_ID [VIDEO_ID ...] [--step 2] [--start 0] [--end 0]
"""

import argparse
import contextlib
import difflib
import io
import json
import os
import re
import subprocess
import sys
import time
from collections import Counter
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import early  # noqa: E402

HERE = Path(__file__).resolve().parent
ROOT = Path("data/roffle")
VIDEOS = ROOT / "videos"
CATALOG = ROOT / "catalog"
ENGINE = HERE / "vendor" / "BalatroEngine"

# Regions, 1280x720.
JOKER_ROI = (213, 7, 1067, 173)  # BalatroEngine's joker bar; jokers sit left of x=935
JOKER_ROI_ALT = (300, 7, 1067, 173)  # same row, shifted: catches the leftmost card the first crop misses
CONS_ROI = (833, 7, 1113, 173)  # consumable slots, right of the jokers
SHELF_ROI = (548, 240, 1018, 448)  # cards for sale
VOUCHER_ROI = (395, 465, 705, 692)
PACK_ROI = (340, 360, 1060, 705)  # a pack's cards on offer
BG_PROBE = (400, 200, 1000, 232)  # felt between the joker row and the table
MONEY = (170, 555, 320, 602)
ANTE = (170, 645, 210, 680)
ROUND = (255, 645, 320, 680)
JCOUNT = (348, 183, 400, 203)  # "4/5" under the joker row
PACK_NAME = (580, 622, 815, 668)
JOKER_SPLIT_X = 935
HAND_ROI = (339, 379, 1053, 594)  # BalatroEngine's card_hand region


def roi(f, box):
    x0, y0, x1, y1 = box
    return f[y0:y1, x0:x1]


def hsv_mean(f, box):
    return cv2.cvtColor(roi(f, box), cv2.COLOR_BGR2HSV).reshape(-1, 3).mean(axis=0)


def frac(f, box, lo, hi):
    """Share of pixels in box whose HSV lies within [lo, hi] (OpenCV hue 0..180)."""
    m = cv2.inRange(cv2.cvtColor(roi(f, box), cv2.COLOR_BGR2HSV), np.array(lo), np.array(hi))
    return float(m.mean() / 255)


# ---------------------------------------------------------------------------------------------
# Screens
# ---------------------------------------------------------------------------------------------

PANEL = ([90, 15, 40], [120, 90, 110])  # dark slate UI panel
TEMPLATES = HERE / "templates"
# UI text cut from his frames, and where each can appear.
UI = {
    "next_round": (380, 265, 550, 345),
    "skip": (830, 612, 960, 690),
    "sort_hand": (630, 592, 765, 636),
    "up_the_ante": (820, 515, 1040, 600),
    "shop_sign": (60, 60, 325, 205),
    "hud_score_at_least": (150, 120, 320, 175),
}
# Tuned on his frames: the shop sign's lights blink, upcoming blinds are greyed out and boss
# blinds recolour the HUD text, so those three need lower bars.
THRESH = {"next_round": 0.8, "skip": 0.72, "sort_hand": 0.72, "up_the_ante": 0.38, "shop_sign": 0.55, "hud_score_at_least": 0.52}
SHOP_GREEN = (74, 134)  # hue, saturation of the felt in the shop
_tpl = {}


def template(name):
    if name not in _tpl:
        _tpl[name] = cv2.cvtColor(cv2.imread(str(TEMPLATES / f"{name}.png")), cv2.COLOR_BGR2GRAY)
    return _tpl[name]


def found(f, name, box, thresh):
    t = template(name)
    g = cv2.cvtColor(roi(f, box), cv2.COLOR_BGR2GRAY)
    if g.shape[0] < t.shape[0] or g.shape[1] < t.shape[1]:
        return False
    return float(cv2.matchTemplate(g, t, cv2.TM_CCOEFF_NORMED).max()) >= thresh


def screen_of(f) -> str:
    """shop, pack, blind_select, hand, cash_out or other."""
    has = lambda name: found(f, name, UI[name], THRESH[name])
    if has("next_round"):
        return "shop"
    if has("shop_sign"):
        # Packs bought in the shop keep the sign; the felt changes colour and Next Round goes.
        if has("skip"):
            return "pack"
        h, s, _ = hsv_mean(f, BG_PROBE)
        return "shop" if abs(h - SHOP_GREEN[0]) < 6 and abs(s - SHOP_GREEN[1]) < 40 else "pack"
    if has("skip"):
        return "pack"  # a pack from a skip tag
    if has("up_the_ante"):
        return "blind_select"
    if has("sort_hand"):
        return "hand"
    # The round's payout: one wide slate panel where the blinds would be.
    if frac(f, (420, 300, 980, 600), *PANEL) > 0.7:
        return "cash_out"
    # A blind in progress shows its target on the left even while the buttons are hidden.
    if has("hud_score_at_least"):
        return "hand"
    return "other"


# ---------------------------------------------------------------------------------------------
# HUD numbers
# ---------------------------------------------------------------------------------------------


def ocr(img, whitelist="0123456789$/-", psm=7) -> str:
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    g = cv2.resize(g, None, fx=4, fy=4, interpolation=cv2.INTER_CUBIC)
    _, b = cv2.threshold(g, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    if b.mean() < 128:
        b = 255 - b
    b = cv2.copyMakeBorder(b, 20, 20, 20, 20, cv2.BORDER_CONSTANT, value=255)
    _, png = cv2.imencode(".png", b)
    cmd = ["tesseract", "stdin", "stdout", "--psm", str(psm)]
    if whitelist:
        cmd += ["-c", f"tessedit_char_whitelist={whitelist}"]
    r = subprocess.run(cmd, input=png.tobytes(), capture_output=True)
    return r.stdout.decode("utf-8", "replace").strip()


def ocr_red(img) -> str:
    """Red text only (the blind's target), so the grey chip icon in front of it is not read."""
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    m = cv2.inRange(hsv, np.array([0, 100, 120]), np.array([10, 255, 255])) | cv2.inRange(hsv, np.array([170, 100, 120]), np.array([180, 255, 255]))
    m = cv2.resize(m, None, fx=4, fy=4, interpolation=cv2.INTER_NEAREST)
    b = cv2.copyMakeBorder(255 - m, 20, 20, 20, 20, cv2.BORDER_CONSTANT, value=255)
    _, png = cv2.imencode(".png", b)
    r = subprocess.run(["tesseract", "stdin", "stdout", "--psm", "7"], input=png.tobytes(), capture_output=True)
    return r.stdout.decode("utf-8", "replace").strip()


def read_hud(f) -> dict:
    money = re.fullmatch(r"\$?(-?\d{1,4})", ocr(roi(f, MONEY)).replace(" ", ""))
    ante = re.fullmatch(r"(\d{1,2})", ocr(roi(f, ANTE), "0123456789"))
    rnd = re.fullmatch(r"(\d{1,3})", ocr(roi(f, ROUND), "0123456789"))
    return {
        "money": int(money.group(1)) if money else None,
        "ante": int(ante.group(1)) if ante else None,
        "round": int(rnd.group(1)) if rnd else None,
    }


def joker_count(f):
    """Jokers held, from the "4/5" under the row, or None. Only a clean "n/m" read counts:
    on coloured boss felt tesseract drops or invents digits."""
    m = re.fullmatch(r"(\d{1,2})/(\d{1,2})", ocr(roi(f, JCOUNT), "0123456789/"))
    return int(m.group(1)) if m and int(m.group(1)) <= int(m.group(2)) + 10 else None


def face_down(f) -> bool:
    """Jokers flipped over (The Amber Acorn): the deck back, cut from the draw pile at the bottom
    right, shows up in the joker row. The classifier would read the backs as random jokers."""
    back = cv2.cvtColor(roi(f, (1078, 548, 1158, 650)), cv2.COLOR_BGR2GRAY)
    strip = cv2.cvtColor(roi(f, (335, 20, 940, 200)), cv2.COLOR_BGR2GRAY)
    return float(cv2.matchTemplate(strip, back, cv2.TM_CCOEFF_NORMED).max()) > 0.8


def occupied(f, x, card_w=100):
    """Whether a card still covers the row at x: most of its body is not felt-coloured."""
    bg = hsv_mean(f, BG_PROBE)
    body = cv2.cvtColor(roi(f, (x + 12, 45, x + card_w - 12, 160)), cv2.COLOR_BGR2HSV).astype(np.int16)
    if body.size == 0:
        return False
    felt = (np.abs(body[:, :, 0] - bg[0]) < 10) & (np.abs(body[:, :, 1] - bg[1]) < 50) & (np.abs(body[:, :, 2] - bg[2]) < 50)
    return felt.mean() < 0.4


def pack_name(f):
    text = ocr(roi(f, PACK_NAME), None)
    m = re.search(r"(Mega |Jumbo )?(Buffoon|Arcana|Celestial|Spectral|Standard)", text, re.I)
    return m.group(0).title() if m else None


# ---------------------------------------------------------------------------------------------
# Items: BalatroEngine's pretrained shop pipeline
# ---------------------------------------------------------------------------------------------


class Items:
    def __init__(self):
        os.environ.setdefault("YOLO_CONFIG_DIR", str(Path(os.environ.get("TMPDIR", "/tmp")) / "Ultralytics"))
        sys.path.insert(0, str(ENGINE))
        from PIL import Image  # noqa: PLC0415

        from classifiers.inference import get_shop_pipeline  # noqa: PLC0415

        self.Image = Image
        with contextlib.redirect_stdout(io.StringIO()):
            self.pipe = get_shop_pipeline(device="cpu")
        self.calls = 0
        self.card_calls = 0
        self._cards = None
        self._cache = {}

    def _predict(self, f, box):
        x0, y0 = box[:2]
        crop = self.Image.fromarray(cv2.cvtColor(roi(f, box), cv2.COLOR_BGR2RGB))
        self.calls += 1
        return [
            {
                "key": it.key,
                "type": it.card_type,
                "edition": None if it.edition == "None" else it.edition,
                "stickers": [s for s in ("eternal", "perishable", "rental") if getattr(it, s)],
                "debuffed": it.debuffed,
                "x": it.box[0] + x0,
                "box": [it.box[0] + x0, it.box[1] + y0, it.box[2] + x0, it.box[3] + y0],
                "conf": round(float(it.confidences.get("key", 0)), 2),
            }
            for it in self.pipe.predict(crop, conf_threshold=0.35)
        ]

    def read_cards(self, f):
        """The hand, left to right, with which cards are lifted (BalatroEngine's card model)."""
        if self._cards is None:
            from classifiers.inference import get_card_pipeline  # noqa: PLC0415

            with contextlib.redirect_stdout(io.StringIO()):
                self._cards = get_card_pipeline(device="cpu")
        small = cv2.resize(cv2.cvtColor(roi(f, HAND_ROI), cv2.COLOR_BGR2GRAY), (96, 32)).astype(np.int16)
        hit = self._cache.get("hand")
        if hit is not None and np.abs(small - hit[0]).mean() < 3.0:
            return hit[1]
        x0, y0 = HAND_ROI[:2]
        crop = self.Image.fromarray(cv2.cvtColor(roi(f, HAND_ROI), cv2.COLOR_BGR2RGB))
        self.card_calls += 1
        out = [
            {
                "rank": c.rank,
                "suit": c.suit,
                "enhancement": c.enhancement,
                "edition": c.edition,
                "seal": c.seal,
                "selected": bool(c.selected),
                "debuffed": bool(c.debuffed),
                "face_down": bool(c.face_down),
                "x": c.box[0] + x0,
            }
            for c in self._cards.predict(crop, conf=0.5)
        ]
        self._cache["hand"] = (small, out)
        return out

    def read(self, f, box, name, retry=None):
        """Items in box, left to right; reuses the last answer while the region looks the same.
        The detector now and then drops a card it saw a moment ago; when the count falls, a second,
        shifted crop (`retry`) is read and the two are merged."""
        small = cv2.resize(cv2.cvtColor(roi(f, box), cv2.COLOR_BGR2GRAY), (96, 32)).astype(np.int16)
        hit = self._cache.get(name)
        if hit is not None and np.abs(small - hit[0]).mean() < 3.0:
            return hit[1]
        out = self._predict(f, box)
        seen = self._cache.get(name + "/max", 0)
        if retry and len(out) < seen:
            for extra in self._predict(f, retry):
                if all(abs(extra["x"] - x["x"]) > 40 for x in out):
                    out.append(extra)
            out.sort(key=lambda x: x["x"])
        self._cache[name] = (small, out)
        self._cache[name + "/max"] = len(out)
        return out


# ---------------------------------------------------------------------------------------------
# Transcript
# ---------------------------------------------------------------------------------------------


def load_transcript(video_id):
    p = VIDEOS / f"{video_id}.en.json3"
    if not p.exists():
        return []
    out = []
    for e in json.loads(p.read_text()).get("events", []):
        text = "".join(s.get("utf8", "") for s in e.get("segs", [])).replace("\n", " ").strip()
        if text:
            out.append((e.get("tStartMs", 0) / 1000, text))
    return out


def window(transcript, t, before=30, after=20):
    return " ".join(x for s, x in transcript if t - before <= s <= t + after)


REASONS = {
    "economy": [r"\bmoney\b", r"\binterest\b", r"\becon\w*", r"\bcash\b", r"\bdollars?\b", r"\brich\b", r"\bgold\b", r"\bpay(s|out)?\b", r"\bsell value\b"],
    "xmult": [r"\bx ?mult\b", r"\btimes mult\b", r"\bmultiplier\b", r"\bpolychrome\b", r"\bx(2|3|4)\b", r"\bexponential\w*"],
    "scaling": [r"\bscal(e|es|ing)\b", r"\bgrow(s|ing)?\b", r"\bstack(s|ing)?\b", r"\bevery (round|hand|time)\b", r"\bpermanent\w*", r"\bgains?\b"],
    "synergy": [r"\bsynerg\w*", r"\bcombo\b", r"\bgoes (well )?with\b", r"\bworks with\b", r"\bpairs? (well )?with\b", r"\bcop(y|ies|ying)\b", r"\bblueprint\b", r"\bbrainstorm\b"],
    "replace_weak": [r"\breplac\w*", r"\bget rid of\b", r"\bsell(ing)?\b", r"\bupgrade\b", r"\bdon'?t need\b", r"\buseless\b", r"\bworse\b"],
    "chips_mult": [r"\bchips\b", r"(?<!x )(?<!times )\bmult\b"],
}
PIVOT = [r"\bpivot\w*", r"\bswitch(ing)? to\b", r"\bgo(ing)? for\b", r"\btransition\w*", r"\binstead\b", r"\bnew build\b", r"\bmove (in)?to\b", r"\bcommit\w*", r"\bchange (the )?plan", r"\babandon\w*"]
GENERIC = {"joker", "card", "the", "and", "of", "mr.", "mr", "a"}


def aliases_of(catalog):
    """Spoken forms per joker: its full name, plus its one distinctive word for longer names."""
    out = []
    for j in catalog:
        name = j["name"].lower()
        out.append((name, j["key"]))
        words = [w for w in re.findall(r"[a-z.']+", name) if w not in GENERIC and len(w) >= 5]
        if len(name.split()) > 1 and len(words) == 1:
            out.append((words[0], j["key"]))
    return out


def mentions(text, aliases):
    """Jokers named in a transcript window, tolerant of auto-caption spelling."""
    words = re.findall(r"[a-z.']+", text.lower())
    found_ = Counter()
    for alias, key in aliases:
        n = len(alias.split())
        for i in range(len(words) - n + 1):
            chunk = " ".join(words[i : i + n])
            if chunk == alias or (len(alias) >= 6 and difflib.SequenceMatcher(None, chunk, alias).ratio() >= 0.86):
                found_[key] += 1
    return found_


def label_reason(text, key, said):
    """The reason group with the most keyword hits. Confidence is a heuristic, not a probability:
    it grows with the number of hits and when the item itself is named nearby."""
    low = text.lower()
    hits = {g: sorted({m.group(0) for p in pats for m in re.finditer(p, low)}) for g, pats in REASONS.items()}
    hits = {g: v for g, v in hits.items() if v}
    pivot = sorted({m.group(0) for p in PIVOT for m in re.finditer(p, low)})
    named = bool(key and said.get(key))
    if not hits:
        return {"label": "unknown", "confidence": 0.1 if named else 0.0, "evidence": []}, pivot, named
    best = max(hits, key=lambda g: len(hits[g]))
    conf = min(0.85, 0.25 + 0.12 * len(hits[best]) + (0.2 if named else 0))
    return {"label": best, "confidence": round(conf, 2), "evidence": hits[best]}, pivot, named


# ---------------------------------------------------------------------------------------------
# Sampling, lineups, decisions
# ---------------------------------------------------------------------------------------------


def frames(path, step, start, end):
    cap = cv2.VideoCapture(str(path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    total = cap.get(cv2.CAP_PROP_FRAME_COUNT) / fps
    end = min(end or total, total)
    stride = max(1, round(step * fps))
    if start:
        cap.set(cv2.CAP_PROP_POS_MSEC, start * 1000)
    i = round(start * fps)
    while i / fps <= end:
        ok, f = cap.read()
        if not ok:
            break
        if f.shape[1] != 1280:
            f = cv2.resize(f, (1280, 720))
        yield i / fps, f
        for _ in range(stride - 1):
            if not cap.grab():
                return
        i += stride


def smooth(samples, field, win=7):
    """Per item, the median count over a window of samples: a card missed or misread for up to
    three samples (a hover tooltip, a drag, an animation) does not count as a change."""
    out = []
    h = win // 2
    for i, s in enumerate(samples):
        near = samples[max(0, i - h) : i + h + 1]
        counts = [Counter(x["key"] for x in n[field]) for n in near]
        keep = []
        for key in set().union(*counts):
            c = int(np.median([cn.get(key, 0) for cn in counts]))
            if c:
                best = max(near, key=lambda n: sum(x["key"] == key for x in n[field]))
                keep += [x for x in best[field] if x["key"] == key][:c]
        out.append({**s, field: sorted(keep, key=lambda x: x["x"])})
    return out


def stable(samples, field, need=2):
    """Lineups that held for `need` samples in a row after smoothing."""
    out, run, last, since = [], 0, None, 0.0
    for s in smooth(samples, field):
        key = tuple(x["key"] for x in s[field])
        if key != last:
            run, since = 0, s["t"]
        run += 1
        last = key
        # Timed from the first sample that showed it, not from when it was confirmed.
        if run == need and (not out or tuple(x["key"] for x in out[-1]["items"]) != key):
            out.append({"t": since, "items": s[field]})
    return out


def pretty(key, names):
    if key in names:
        return names[key]
    m = re.fullmatch(r"p_(\w+?)_(normal|jumbo|mega)_\d+", key)  # booster packs
    if m:
        size = "" if m.group(2) == "normal" else m.group(2).title() + " "
        return f"{size}{m.group(1).title()} Pack"
    return key


def label(x, names):
    return {k: v for k, v in {"key": x["key"], "name": pretty(x["key"], names), "edition": x.get("edition"), "stickers": x.get("stickers") or None}.items() if v}


def analyze(video_id, step, start, end, items, aliases, names, blinds, tags):
    info = json.loads((VIDEOS / f"{video_id}.info.json").read_text())
    transcript = load_transcript(video_id)
    samples, hud, offers, packs = [], [], [], []
    # Per second: screen and mouse. Every `step` seconds the heavier reads below.
    fine, readings, bs_states, shop_samples, hand_samples, targets = [], [], [], [], [], {}
    ctx = {}  # latest item boxes per region, for what the mouse is over
    last_hud_t, t0, prev_jokers, calls0, cards0, next_heavy = -99.0, time.time(), [], items.calls, items.card_calls, start
    for t, f in frames(VIDEOS / f"{video_id}.mp4", 1.0, start, end):
        t = round(t, 1)
        screen = screen_of(f)
        pos = early.cursor(f)
        fine.append({"t": t, "screen": screen, "cursor": pos, "under": early.element_at(pos, screen, ctx), "play_area": early.play_area(f, hsv_mean(f, BG_PROBE)) if screen == "hand" else None})
        if screen == "blind_select":
            state = early.blind_select_state(f, tags)
            if state:
                bs_states.append({"t": t, **state})
        if t + 1e-6 < next_heavy:
            continue
        next_heavy = t + step
        if screen == "hand" and not face_down(f):
            hand_samples.append({"t": t, "cards": items.read_cards(f)})
        if screen not in ("shop", "pack", "blind_select"):
            got = blinds.identify(f)
            if got:
                readings.append({"t": t, "key": got[0], "conf": got[1]})
                if got[0] not in targets or targets[got[0]][-1][0] < t - 30 or targets[got[0]][-1][1] is None:
                    box = early.target_box(f, template("hud_score_at_least"))
                    targets.setdefault(got[0], []).append((t, early.score_target(ocr_red(roi(f, box))) if box else None))
        if face_down(f):
            jokers = prev_jokers  # unreadable while flipped: assume nothing changed
        else:
            jokers = [x for x in items.read(f, JOKER_ROI, "jokers", retry=JOKER_ROI_ALT) if x["key"].startswith("j_") and x["x"] < JOKER_SPLIT_X]
        if len(jokers) < len(prev_jokers):
            # The detector misses some cards for long stretches (Mail-In Rebate on coloured boss
            # felt). Carry a missing card over while the game's count says it is held or, when
            # the count can't be read, while a card still covers its spot; on that weaker
            # evidence only for 30 samples in a row, so a sold card can't linger.
            n = joker_count(f)
            missing = [p for p in prev_jokers if all(abs(p["x"] - j["x"]) > 40 for j in jokers)]
            if n is not None:
                missing = [{**m, "carried": 1} for m in missing[: max(0, n - len(jokers))]]
            else:
                missing = [{**m, "carried": m.get("carried", 0) + 1} for m in missing if occupied(f, m["x"]) and m.get("carried", 0) < 30]
            jokers = sorted(jokers + missing, key=lambda x: x["x"])
        prev_jokers = jokers
        cons =[x for x in items.read(f, CONS_ROI, "cons") if x["key"].startswith("c_") and x["x"] >= JOKER_SPLIT_X - 10]
        ctx.update(jokers=jokers, cons=cons)
        samples.append({"t": t, "screen": screen, "jokers": jokers, "cons": cons})
        if screen in ("shop", "hand", "blind_select", "cash_out") and t - last_hud_t >= 4:
            hud.append({"t": t, **read_hud(f)})
            last_hud_t = t
        if screen == "shop":
            cards, vouchers = items.read(f, SHELF_ROI, "shelf"), items.read(f, VOUCHER_ROI, "voucher")
            shelf = cards + vouchers
            ctx.update(shelf=cards, voucher=vouchers)
            cost = re.fullmatch(r"\$(\d{1,3})", ocr(roi(f, early.REROLL_COST), "$0123456789").replace(" ", ""))
            money = re.fullmatch(r"\$?(-?\d{1,4})", ocr(roi(f, MONEY)).replace(" ", ""))
            shop_samples.append({"t": t, "shelf": cards, "voucher": vouchers, "reroll_cost": int(cost.group(1)) if cost else None, "money": int(money.group(1)) if money else None})
            if shelf and (not offers or offers[-1]["where"] != "shop" or [x["key"] for x in offers[-1]["items"]] != [x["key"] for x in shelf]):
                offers.append({"t": t, "where": "shop", "items": shelf})
        elif screen == "pack":
            shown = items.read(f, PACK_ROI, "pack")
            ctx.update(pack=shown)
            if shown and (not offers or [x["key"] for x in offers[-1]["items"]] != [x["key"] for x in shown]):
                offers.append({"t": t, "where": "pack", "items": shown})
            if not packs or t - packs[-1]["t"] > 20:
                name = pack_name(f)
                if name:
                    packs.append({"t": t, "pack": name})

    def money_at(t, after):
        xs = [h for h in hud if h["money"] is not None and (h["t"] >= t if after else h["t"] <= t)]
        return (xs[0] if after else xs[-1])["money"] if xs else None

    def hud_near(t):
        """Ante and round as the most common reading of the last five, since OCR slips a digit now and then."""
        xs = [h for h in hud if h["t"] <= t + 5][-5:]
        pick = lambda k: (Counter(h[k] for h in xs if h[k] is not None).most_common(1) or [(None, 0)])[0][0]
        return {"ante": pick("ante"), "round": pick("round"), "money": xs[-1]["money"] if xs else None}

    def screen_before(t, back=10):
        seen = [s["screen"] for s in samples if t - back <= s["t"] <= t and s["screen"] != "other"]
        return seen[-1] if seen else "other"

    def offer_before(t, where):
        xs = [o for o in offers if o["where"] == where and t - 90 <= o["t"] <= t]
        return [label(x, names) for x in xs[-1]["items"]] if xs else None

    def offered_in(k, t, where, back):
        """Whether k was on offer in a pack or the shop shortly before t (with a little slack after,
        since the change is timed by the smoothed row)."""
        return any(o["where"] == where and t - back <= o["t"] <= t + 6 and any(x["key"] == k for x in o["items"]) for o in offers)

    def gained_as(k, kind, here, t):
        # What was on offer is better evidence than the screen at the moment the row changed.
        if offered_in(k, t, "pack", 45):
            return f"pack_pick_{kind}", "pack"
        if offered_in(k, t, "shop", 90):
            return f"buy_{kind}", "shop"
        return {"shop": f"buy_{kind}", "pack": f"pack_pick_{kind}"}.get(here, f"gain_{kind}"), here

    decisions = []
    for field, kind in (("jokers", "joker"), ("cons", "consumable")):
        lineup = stable(samples, field)
        for prev, cur in zip(lineup, lineup[1:]):
            before = Counter(x["key"] for x in prev["items"])
            after = Counter(x["key"] for x in cur["items"])
            gained, lost = list((after - before).elements()), list((before - after).elements())
            t = cur["t"]
            here = screen_before(t)
            m0, m1 = money_at(prev["t"], False), money_at(t, True)
            delta = m1 - m0 if m0 is not None and m1 is not None else None
            events = []
            for k in gained:
                events.append((*gained_as(k, kind, here, t), k))
            for k in lost:
                if kind == "joker":
                    sold = (delta is not None and delta > 0 and not gained) or here in ("shop", "blind_select", "pack", "cash_out")
                    events.append(("sell_joker" if sold else "lose_joker", here, k))
                else:
                    events.append(("sell_consumable" if delta is not None and delta > 0 and not gained else "use_consumable", here, k))
            if kind == "joker" and not events and prev["items"] != cur["items"]:
                events.append(("reorder_jokers", here, None))
            text = window(transcript, t)
            said = mentions(text, aliases)
            for type_, where, k in events:
                reason, pivot_words, named = label_reason(text, k, said)
                recent = [d for d in decisions if 0 <= t - d["t_seconds"] <= 120 and d["type"] in ("buy_joker", "sell_joker", "pack_pick_joker")]
                pivot = min(0.9, 0.2 * len(pivot_words) + (0.3 if len(recent) >= 2 else 0) + (0.1 if reason["label"] == "replace_weak" else 0))
                h = hud_near(t)
                item = next((x for x in cur["items"] + prev["items"] if x["key"] == k), {"key": k}) if k else None
                decisions.append(
                    {
                        "video_id": video_id,
                        "t_seconds": t,
                        "youtube_url": f"https://www.youtube.com/watch?v={video_id}&t={int(t)}s",
                        "type": type_,
                        "item": label(item, names) if item else None,
                        "jokers_before": [label(x, names) for x in (prev["items"] if kind == "joker" else [])] or None,
                        "jokers_after": [label(x, names) for x in (cur["items"] if kind == "joker" else [])] or None,
                        "consumables_before": [label(x, names) for x in prev["items"]] if kind == "consumable" else None,
                        "consumables_after": [label(x, names) for x in cur["items"]] if kind == "consumable" else None,
                        "screen": where,
                        "offered": offer_before(t + 6, where) if where in ("shop", "pack") else None,
                        "pack": next((p["pack"] for p in reversed(packs) if t - 60 <= p["t"] <= t + 6), None) if where == "pack" else None,
                        "ante": h["ante"],
                        "round": h["round"],
                        "money_before": m0,
                        "money_after": m1,
                        "transcript": text[:700],
                        "jokers_mentioned": [pretty(x, names) for x, _ in said.most_common(6)],
                        "reason": reason,
                        "pivot": {"confidence": round(pivot, 2), "evidence": pivot_words + (["2+ joker changes within 2 min"] if len(recent) >= 2 else [])},
                        "detection": {
                            "method": f"{kind} row recognised by BalatroEngine every {step:g} s, smoothed over 7 samples, change held for 2",
                            "item_conf": item.get("conf") if item else None,
                            "confidence": "high"
                            if (item or {}).get("conf", 0) >= 0.9 and (offered_in(k, t, "pack", 45) or offered_in(k, t, "shop", 90) or type_.startswith(("sell", "use")))
                            else "medium"
                            if where != "other"
                            else "low",
                            "notes": "; ".join(
                                n
                                for n in (
                                    "item named in the transcript" if named else "",
                                    "seen on offer just before" if k and (offered_in(k, t, "pack", 45) or offered_in(k, t, "shop", 90)) else "",
                                    "carried over a detector miss" if item and item.get("carried") else "",
                                )
                                if n
                            ),
                        },
                    }
                )
    decisions = invisible_copies(drop_flicker(retype_pack_picks(decisions, compress([(s["t"], s["screen"]) for s in samples]))))
    jl =[{"t": x["t"], "jokers": [label(j, names) for j in x["items"]]} for x in stable(samples, "jokers")]
    runs = runs_of(hud, jl)

    # ---- Early-game detail: the blinds played give ante and round; skips, vouchers, rerolls, mouse.
    breaks = [s["t"] for s in samples if s["screen"] in ("shop", "cash_out", "blind_select")]
    all_visits = early.visits(fine)
    events = early.shop_events(shop_samples, [v for v in all_visits if v["screen"] == "shop"])
    ante_marks = [e["t"] for e in events if e["type"] == "buy_voucher" and e["key"] in early.ANTE_VOUCHERS]
    segs, skipped = early.derive_antes(early.blind_segments(readings, breaks), blinds.all, [r["start_t"] for r in runs[1:]], ante_marks)
    offset, agree, checked = early.anchor(segs, hud)
    for s in segs:
        s["ante"] += offset
    for s in skipped:
        s["ante"] += offset
    bname = lambda k: blinds.all[k]["name"] if k in blinds.all else k

    def lineup_at(t):
        xs = [x for x in jl if x["t"] <= t]
        return xs[-1]["jokers"] if xs else []

    def record(t, type_, item, where, method, notes="", conf=None, confidence="medium", **extra):
        text = window(transcript, t)
        said = mentions(text, aliases)
        reason, pivot_words, _ = label_reason(text, (item or {}).get("key"), said)
        held = lineup_at(t) or None
        return {
            "video_id": video_id,
            "t_seconds": t,
            "youtube_url": f"https://www.youtube.com/watch?v={video_id}&t={int(t)}s",
            "type": type_,
            "item": item,
            "jokers_before": held,
            "jokers_after": held,
            "consumables_before": None,
            "consumables_after": None,
            "screen": where,
            "offered": extra.pop("offered", None),
            "pack": None,
            "ante": hud_near(t)["ante"],
            "round": hud_near(t)["round"],
            "money_before": money_at(t - 1, False),
            "money_after": money_at(t, True),
            "transcript": text[:700],
            "jokers_mentioned": [pretty(x, names) for x, _ in said.most_common(6)],
            "reason": reason,
            "pivot": {"confidence": round(min(0.9, 0.2 * len(pivot_words)), 2), "evidence": pivot_words},
            "detection": {"method": method, "item_conf": conf, "confidence": confidence, "notes": notes},
            **extra,
        }

    added = []
    for s in segs:
        conf = max((r["conf"] for r in readings if r["key"] == s["key"] and s["start"] <= r["t"] <= s["end"]), default=None)
        added.append(record(s["start"], "select_blind", {"key": s["key"], "name": bname(s["key"])}, "blind_select", "HUD plate colour and chip", conf=conf, confidence="high" if (conf or 0) >= 0.85 else "medium"))
    for k in skipped:
        idx = 0 if k["blind"] == "bl_small" else 1
        seen = [b for b in bs_states if k["before"] - 120 <= b["t"] <= k["before"] and b["active"] == idx]
        tags_seen = Counter(b["tag"][0] for b in seen if b.get("tag"))
        tag = tags_seen.most_common(1)[0][0] if tags_seen else None
        t = round(seen[-1]["t"] + 1, 1) if seen else round(k["before"] - 5, 1)
        added.append(
            record(
                t,
                "skip_blind",
                {"key": tag, "name": tags.all[tag]["name"]} if tag else None,
                "blind_select",
                "blind order: a later blind was played with this one never shown in the HUD",
                notes="; ".join(n for n in ("seen on the blind select screen" if seen else "skip not seen, inferred from the order", "" if tag else "tag not recognised") if n),
                confidence="high" if seen and tag else "medium" if seen else "low",
                blind={"key": k["blind"], "name": bname(k["blind"])},
            )
        )
    shop_index = Counter()
    for e in events:
        before = [label(x, names) for x in e["before"]["shelf"] + e["before"]["voucher"]]
        if e["type"] == "buy_voucher":
            added.append(record(e["t"], "buy_voucher", label(e["item"], names), "shop", "voucher left its slot while the shop stayed open", conf=e["item"].get("conf"), confidence="high", offered=before))
        else:
            visit = next((v for v in all_visits if v["screen"] == "shop" and v["start"] - 2 <= e["t"] <= v["end"] + 2), None)
            shop_index[visit["start"] if visit else e["t"]] += 1
            added.append(
                record(
                    e["t"],
                    "reroll",
                    None,
                    "shop",
                    "Reroll price went up by $1" if e["by"] == "price" else "whole shelf changed at once",
                    confidence="high" if e["by"] == "price" else "medium",
                    offered=before,
                    offered_after=[label(x, names) for x in e["after"]["shelf"] + e["after"]["voucher"]],
                    reroll={"cost": e["cost"], "index": shop_index[visit["start"] if visit else e["t"]]},
                )
            )
    uses = [d for d in decisions if d["type"] == "use_consumable"]
    for e in early.hand_events(hand_samples, fine):
        # Cards that leave the hand right as a tarot is used were its targets (The Hanged Man).
        use = next((d for d in uses if abs(d["t_seconds"] - e["t"]) <= 4), None)
        if use:
            use["targets"] = e["cards"]
            continue
        added.append(
            record(
                e["t"],
                e["type"],
                None,
                "hand",
                "lifted cards (BalatroEngine card model) left the hand; play if the play area filled",
                confidence="medium",
                cards=e["cards"],
                hand=e["hand"],
                play_evidence=e["evidence"],
                notes=f"play area {e['area']}" if e["area"] is not None else "play area not seen",
            )
        )
    decisions = sorted(decisions + added, key=lambda d: d["t_seconds"])

    for i, d in enumerate(decisions):
        t = d["t_seconds"]
        a, r, seg = early.ante_at(t, segs)
        d["ante_ocr"], d["round_ocr"] = d["ante"], d["round"]
        if a is not None:
            d["ante"], d["round"], d["ante_source"] = a, r, "blinds"
        else:
            d["ante_source"] = "ocr" if d["ante"] is not None else None
        d["phase"] = early.phase_of(d["ante"])
        if seg and d["type"] != "skip_blind":
            d["blind"] = {"key": seg["key"], "name": bname(seg["key"])}
        d.setdefault("blind", None)
        boss = next((s for s in segs if s["boss"] and s["ante"] == d["ante"]), None)
        d["boss"] = {"key": boss["key"], "name": bname(boss["key"])} if boss else None
        tg = [v for tt, v in targets.get(seg["key"], []) if seg["start"] - 2 <= tt <= seg["end"] + 2 and v] if seg else []
        d["score_target"] = tg[0] if tg else None
        d["score_scale"] = early.scale_of(d["score_target"])
        visit = next((v for v in all_visits if v["screen"] == d["screen"] and v["start"] - 2 <= t <= v["end"] + 6), None)
        if visit:
            since = max([visit["start"]] + [x["t_seconds"] for x in decisions[:i] if x["screen"] == d["screen"] and x["t_seconds"] >= visit["start"]])
            d["hovered"] = early.hovered_between(fine, since, t + 1, names, d["screen"])
        else:
            d["hovered"] = None
        d["cursor_on"], d["click_confirmed"] = early.confirm(d, fine)

    shops = []
    for v in all_visits:
        if v["screen"] != "shop":
            continue
        inside = [d for d in decisions if v["start"] - 2 <= d["t_seconds"] <= v["end"] + 6 and d["screen"] == "shop"]
        rer = [d for d in inside if d["type"] == "reroll"]
        shops.append(
            {
                "start_t": v["start"],
                "end_t": v["end"],
                "ante": early.ante_at(v["start"], segs)[0],
                "rerolls": len(rer),
                "reroll_spent": sum(d["reroll"]["cost"] or 0 for d in rer),
                "bought": [d["item"]["key"] for d in inside if d["type"].startswith("buy_") and d.get("item")],
            }
        )
    timeline = {
        "video_id": video_id,
        "title": info.get("title"),
        "step_seconds": step,
        "analysed": [start, end or info.get("duration")],
        "joker_lineups": jl,
        "consumable_lineups": [{"t": x["t"], "consumables": [label(j, names) for j in x["items"]]} for x in stable(samples, "cons")],
        "screens": compress([(s["t"], s["screen"]) for s in samples]),
        "hud": hud,
        "packs": packs,
        "offers": [{"t": o["t"], "where": o["where"], "items": [label(x, names) for x in o["items"]]} for o in offers],
        "runs": runs,
        "blinds": [{"start_t": s["start"], "end_t": s["end"], "key": s["key"], "name": bname(s["key"]), "ante": s["ante"], "round": s["round"], "boss": s["boss"], "score_target": next((v for tt, v in targets.get(s["key"], []) if s["start"] - 2 <= tt <= s["end"] + 2 and v), None)} for s in segs],
        "skips": [{**k, "blind_name": bname(k["blind"])} for k in skipped],
        "shops": shops,
        "ante_check": {"offset": offset, "ocr_readings": checked, "agree": agree},
        "cursor_seen": round(sum(1 for s in fine if s["cursor"]) / max(1, len(fine)), 2),
        "recognizer_calls": items.calls - calls0,
        "card_model_calls": items.card_calls - cards0,
        "seconds_to_analyse": round(time.time() - t0, 1),
    }
    return timeline, decisions


GAIN = ("buy_", "pack_pick_", "gain_")
LOSS = ("sell_", "lose_", "use_")


def drop_flicker(decisions, window=20):
    """Detector misreads, removed in pairs: a joker lost and back within `window` seconds, a joker
    that appears and is gone again that fast without having been on offer, and a consumable lost
    and back within 12 s. Buying a tarot and using it at once is normal play and is kept."""
    out = sorted(decisions, key=lambda d: d["t_seconds"])
    gone = set()
    for i, a in enumerate(out):
        if i in gone or not a.get("item"):
            continue
        joker = a["type"].endswith("joker")
        for j in range(i + 1, len(out)):
            b = out[j]
            if b["t_seconds"] - a["t_seconds"] > (window if joker else 12):
                break
            if j in gone or not b.get("item") or b["video_id"] != a["video_id"] or b["item"]["key"] != a["item"]["key"]:
                continue
            back = a["type"].startswith(LOSS) and b["type"].startswith(GAIN)
            blip = joker and a["type"].startswith(GAIN) and b["type"].startswith(LOSS) and "seen on offer" not in a["detection"]["notes"]
            if back or blip:
                gone |= {i, j}
                break
    # A reorder undone within 6 s is two overlapping cards' boxes trading places. Slower swaps
    # back and forth are real: he moves Blueprint between Raised Fist and Mail-In Rebate each hand.
    names = lambda xs: [x["key"] for x in xs or []]
    for i, a in enumerate(out):
        if i in gone or a["type"] != "reorder_jokers":
            continue
        for j in range(i + 1, len(out)):
            b = out[j]
            if b["t_seconds"] - a["t_seconds"] > 6:
                break
            if j not in gone and b["type"] == "reorder_jokers" and b["video_id"] == a["video_id"] and names(b["jokers_after"]) == names(a["jokers_before"]):
                gone |= {i, j}
                break
    return [d for i, d in enumerate(out) if i not in gone]


def retype_pack_picks(decisions, screens, slack=8):
    """A card that arrives while a pack screen shows within `slack` seconds came from the pack,
    even when the pack's cards weren't recognised (Arcana and Spectral packs show them low, under
    the hand). A card seen on the shop shelf just before stays a buy: he often opens a pack right
    after buying. `screens` are the compressed segments [{t, screen}]."""
    spans = [(s["t"], screens[i + 1]["t"] if i + 1 < len(screens) else s["t"] + 2) for i, s in enumerate(screens) if s["screen"] == "pack"]
    for d in decisions:
        # A gained joker away from the shop is more often Invisible Joker, Riff-Raff or Judgement.
        if not (d["type"] in ("buy_joker", "buy_consumable") or d["type"] == "gain_consumable") or "seen on offer" in d["detection"]["notes"]:
            continue
        t = d["t_seconds"]
        if any(a <= t + slack and b >= t - slack for a, b in spans):
            d["type"] = "pack_pick_" + d["type"].split("_", 1)[1]
            d["screen"] = "pack"
            d["detection"]["notes"] = "; ".join(n for n in (d["detection"]["notes"], "pack screen within 8 s") if n)
    return decisions


def invisible_copies(decisions, slack=4):
    """Selling Invisible Joker copies a held joker: a 'pick' or 'buy' of a joker he already had,
    at the moment Invisible Joker goes, is that copy."""
    sold = [d["t_seconds"] for d in decisions if d["type"] == "sell_joker" and (d.get("item") or {}).get("key") == "j_invisible"]
    for d in decisions:
        if not d["type"].endswith("_joker") or not d["type"].startswith(GAIN) or not d.get("item"):
            continue
        held = {x["key"] for x in d.get("jokers_before") or []}
        if d["item"]["key"] in held and any(abs(d["t_seconds"] - t) <= slack for t in sold):
            d["type"] = "gain_joker"
            d["detection"]["notes"] = "; ".join(n for n in (d["detection"]["notes"], "copied by selling Invisible Joker") if n)
    return decisions


def compress(pairs):
    out = []
    for t, s in pairs:
        if not out or out[-1]["screen"] != s:
            out.append({"t": t, "screen": s})
    return out


def runs_of(hud, lineups):
    """Runs in a video; field names follow balatro-run-tracker. A new run starts only when the HUD
    reads ante 1 in round 3 or earlier twice in a row after a later ante, so OCR slips don't split
    a run. Ante and round reached are the highest values read at least twice, for the same reason.
    `lineups` are labelled joker lineups ({"t", "jokers"})."""
    def jokers_at(t):
        held = [x for x in lineups if x["t"] <= t]
        return len(held[-1]["jokers"]) if held else 0

    groups, low = [[]], 0
    for h in hud:
        if h.get("ante") is None:
            continue
        seen = [x["ante"] for x in groups[-1]]
        # A fresh run also has at most one joker: tesseract reads "8/8" as 1 now and then.
        if h["ante"] == 1 and (h.get("round") or 0) <= 3 and seen and max(seen) >= 3 and jokers_at(h["t"]) <= 1:
            low += 1
            if low == 2:
                groups.append(groups[-1][-1:])  # the first low reading starts the new run
                groups[-2].pop()
        else:
            low = 0
        groups[-1].append(h)

    def reached(xs, k):
        c = Counter(x[k] for x in xs if x.get(k) is not None)
        twice = [v for v, n in c.items() if n >= 2]
        return max(twice) if twice else max(c) if c else None

    runs = []
    for g in groups:
        if not g:
            continue
        held = [x for x in lineups if x["t"] <= g[-1]["t"]]
        money = [x["money"] for x in g if x.get("money") is not None]
        runs.append(
            {
                "start_t": g[0]["t"],
                "end_t": g[-1]["t"],
                "ante_reached": reached(g, "ante"),
                "round_reached": reached(g, "round"),
                "money": money[-1] if money else None,
                "jokers": held[-1]["jokers"] if held else [],
            }
        )
    return runs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("videos", nargs="+")
    ap.add_argument("--step", type=float, default=2.0)
    ap.add_argument("--start", type=float, default=0)
    ap.add_argument("--end", type=float, default=0)
    a = ap.parse_args()
    catalog = json.loads((CATALOG / "jokers.json").read_text())
    names = {j["key"]: j["name"] for j in catalog}
    names.update({k: v["name"] for k, v in json.loads((CATALOG / "consumables.json").read_text()).items()})
    items = Items()
    blinds, tags = early.Blinds(), early.Tags()
    names.update({b: v["name"] for b, v in blinds.all.items()})
    names.update({k: v["name"] for k, v in tags.all.items()})
    aliases = aliases_of(catalog)
    for vid in a.videos:
        timeline, decisions = analyze(vid, a.step, a.start, a.end, items, aliases, names, blinds, tags)
        (ROOT / f"{vid}.json").write_text(json.dumps(timeline, indent=1, ensure_ascii=False))
        (ROOT / f"{vid}.decisions.jsonl").write_text("".join(json.dumps(d, ensure_ascii=False) + "\n" for d in decisions))
        kinds = Counter(d["type"] for d in decisions)
        print(f"{vid}: {len(timeline['joker_lineups'])} joker lineups, {dict(kinds)}, {timeline['recognizer_calls']} recognizer calls, {timeline['seconds_to_analyse']} s", flush=True)


if __name__ == "__main__":
    main()
