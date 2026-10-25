#!/usr/bin/env python3
"""The game's own sprites for the dashboard, read from your Balatro.love without modifying it.

    python3 tools/textures.py [--love PATH]

Copies the 2x texture atlases the board uses into ui/game/ and writes ui/game/sprites.json:
for every joker, consumable, voucher, booster, enhancement, deck back, seal, tag, blind and
playing card, which atlas it is on and its cell. The UI draws a sprite as that atlas with a
background offset. ui/game/ is gitignored: the art belongs to LocalThunk and Playstack, so it is
taken from the copy of the game on this machine and never committed.
"""

import argparse
import json
import re
import zipfile
from pathlib import Path

LOVE = Path.home() / "Library/Application Support/Steam/steamapps/common/Balatro/Balatro.app/Contents/Resources/Balatro.love"
OUT = Path(__file__).resolve().parent.parent / "ui" / "game"

# Atlas name -> file and one cell at 1x (the files are 2x, so cells are twice this).
ATLASES = {
    "cards": ("8BitDeck.png", 71, 95),
    "cards_hc": ("8BitDeck_opt2.png", 71, 95),
    "centers": ("Enhancers.png", 71, 95),
    "Joker": ("Jokers.png", 71, 95),
    "Tarot": ("Tarots.png", 71, 95),
    "Voucher": ("Vouchers.png", 71, 95),
    "Booster": ("boosters.png", 71, 95),
    "stickers": ("stickers.png", 71, 95),
    "tags": ("tags.png", 34, 34),
    "blind_chips": ("BlindChips.png", 34, 34),
    "chips": ("chips.png", 29, 29),
}
SET_ATLAS = {"Joker": "Joker", "Tarot": "Tarot", "Planet": "Tarot", "Spectral": "Tarot", "Voucher": "Voucher", "Booster": "Booster", "Enhanced": "centers", "Default": "centers", "Back": "centers"}
# From game.lua's shared_seals and card.lua's sticker sprites.
SEALS = {"GOLD": (2, 0), "PURPLE": (4, 4), "RED": (5, 4), "BLUE": (6, 4)}
STICKERS = {"eternal": (0, 0), "perishable": (0, 2), "rental": (1, 2)}


def pos_of(body):
    m = re.search(r"\bpos\s*=\s*\{\s*x\s*=\s*(\d+)\s*,\s*y\s*=\s*(\d+)\s*\}", body)
    return (int(m.group(1)), int(m.group(2))) if m else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--love", default=str(LOVE))
    a = ap.parse_args()
    z = zipfile.ZipFile(a.love)
    src = z.read("game.lua").decode("utf8", "ignore")
    OUT.mkdir(parents=True, exist_ok=True)
    atlases = {}
    for name, (file, w, h) in ATLASES.items():
        data = z.read(f"resources/textures/2x/{file}")
        (OUT / file).write_bytes(data)
        atlases[name] = {"file": file, "w": w * 2, "h": h * 2}

    sprites = {k: {} for k in ["jokers", "consumables", "vouchers", "boosters", "enhancers", "backs", "tags", "blinds", "cards"]}
    group = {"Joker": "jokers", "Tarot": "consumables", "Planet": "consumables", "Spectral": "consumables", "Voucher": "vouchers", "Booster": "boosters", "Enhanced": "enhancers", "Default": "enhancers", "Back": "backs"}
    for m in re.finditer(r"^\s*(\w+)\s*=\s*\{(.*)\},?\s*$", src, re.M):
        key, body = m.group(1), m.group(2)
        p = pos_of(body)
        if not p:
            continue
        sm = re.search(r"\bset\s*=\s*[\"'](\w+)[\"']", body)
        s = sm.group(1) if sm else None
        if s in group:
            atlas = re.search(r"\batlas\s*=\s*[\"'](\w+)[\"']", body)
            entry = {"atlas": atlas.group(1) if atlas and atlas.group(1) in atlases else SET_ATLAS[s], "x": p[0], "y": p[1]}
            soul = re.search(r"soul_pos\s*=\s*\{\s*x\s*=\s*(\d+)\s*,\s*y\s*=\s*(\d+)\s*\}", body)
            if soul:
                entry["soul"] = {"x": int(soul.group(1)), "y": int(soul.group(2))}
            sprites[group[s]][key] = entry
        elif s == "Tag" or key.startswith("tag_"):
            sprites["tags"][key] = {"atlas": "tags", "x": p[0], "y": p[1]}
        elif key.startswith("bl_"):
            sprites["blinds"][key] = {"atlas": "blind_chips", "x": 0, "y": p[1]}
        elif re.fullmatch(r"[HCDS]_[2-9TJQKA]", key):
            sprites["cards"][key] = {"atlas": "cards", "x": p[0], "y": p[1]}
    sprites["seals"] = {k: {"atlas": "centers", "x": x, "y": y} for k, (x, y) in SEALS.items()}
    sprites["stickers"] = {k: {"atlas": "stickers", "x": x, "y": y} for k, (x, y) in STICKERS.items()}
    (OUT / "sprites.json").write_text(json.dumps({"atlases": atlases, **sprites}, indent=1))
    print({k: len(v) for k, v in sprites.items()}, "->", OUT)


main()
