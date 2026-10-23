"""Joker catalog from the game's own files: key, name, rarity, cost, sprite position, effect text,
and one sprite crop per joker. Reads Balatro.love without modifying it.

    python3 tools/roffle/catalog.py [--love PATH] [--out data/roffle/catalog]
"""

import argparse
import json
import re
import zipfile
from pathlib import Path

import cv2
import numpy as np

LOVE = Path.home() / "Library/Application Support/Steam/steamapps/common/Balatro/Balatro.app/Contents/Resources/Balatro.love"
RARITY = {1: "common", 2: "uncommon", 3: "rare", 4: "legendary"}
W, H = 71, 95  # one card in the 1x atlas


def field(body: str, name: str):
    m = re.search(rf"\b{name}\s*=\s*(\"[^\"]*\"|'[^']*'|[\w.]+)", body)
    if not m:
        return None
    v = m.group(1)
    if v[0] in "\"'":
        return v[1:-1]
    try:
        return int(v)
    except ValueError:
        return v


def pos(body: str, name: str):
    m = re.search(rf"\b{name}\s*=\s*\{{\s*x\s*=\s*(\d+)\s*,\s*y\s*=\s*(\d+)\s*\}}", body)
    return {"x": int(m.group(1)), "y": int(m.group(2))} if m else None


def jokers_from_game(src: str):
    out = []
    for m in re.finditer(r"^\s*(j_\w+)\s*=\s*\{(.*)\},?\s*$", src, re.M):
        key, body = m.group(1), m.group(2)
        if not re.search(r"set\s*=\s*[\"']Joker[\"']", body):
            continue
        cfg = re.search(r"config\s*=\s*(\{.*?\})\s*(?:,\s*unlock_condition|\}?\s*$)", body)
        out.append(
            {
                "key": key,
                "name": field(body, "name"),
                "order": field(body, "order"),
                "rarity": RARITY.get(field(body, "rarity"), str(field(body, "rarity"))),
                "cost": field(body, "cost"),
                "pos": pos(body, "pos"),
                "soul_pos": pos(body, "soul_pos"),
                "blueprint_compat": "blueprint_compat = true" in body,
                "config": cfg.group(1) if cfg else None,
            }
        )
    return out


def descriptions(loc: str):
    """j_key -> (name, effect text) from localization/en-us.lua, formatting codes removed."""
    start = loc.index("Joker={")
    out = {}
    for m in re.finditer(r"(j_\w+)=\{\s*name=\"([^\"]*)\",\s*text=\{(.*?)\},\s*\}", loc[start:], re.S):
        lines = re.findall(r"\"([^\"]*)\"", m.group(3))
        text = " ".join(re.sub(r"\{[^}]*\}", "", l) for l in lines)
        out.setdefault(m.group(1), (m.group(2), re.sub(r"\s+", " ", text).strip()))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--love", default=str(LOVE))
    ap.add_argument("--out", default="data/roffle/catalog")
    a = ap.parse_args()
    out = Path(a.out)
    (out / "sprites").mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(a.love) as z:
        game = z.read("game.lua").decode("utf-8", "replace")
        loc = z.read("localization/en-us.lua").decode("utf-8", "replace")
        atlas = cv2.imdecode(np.frombuffer(z.read("resources/textures/2x/Jokers.png"), np.uint8), cv2.IMREAD_UNCHANGED)
    desc = descriptions(loc)
    jokers = jokers_from_game(game)
    s = 2  # 2x atlas
    for j in jokers:
        name, text = desc.get(j["key"], (j["name"], ""))
        j["name"] = name or j["name"]
        # Misprint's text is drawn by code, not localized.
        j["effect"] = text or ("+0 to +23 Mult, random each hand" if j["key"] == "j_misprint" else "")
        p = j["pos"]
        card = atlas[p["y"] * H * s : (p["y"] + 1) * H * s, p["x"] * W * s : (p["x"] + 1) * W * s].copy()
        if j["soul_pos"]:  # legendaries: the face floats over the card
            q = j["soul_pos"]
            soul = atlas[q["y"] * H * s : (q["y"] + 1) * H * s, q["x"] * W * s : (q["x"] + 1) * W * s]
            a_ = soul[:, :, 3:4].astype(np.float32) / 255
            card[:, :, :3] = (soul[:, :, :3] * a_ + card[:, :, :3] * (1 - a_)).astype(np.uint8)
        cv2.imwrite(str(out / "sprites" / f"{j['key']}.png"), card)
        j["sprite"] = f"sprites/{j['key']}.png"
    jokers.sort(key=lambda j: j["order"] or 999)
    (out / "jokers.json").write_text(json.dumps(jokers, indent=1, ensure_ascii=False))
    # Tarots, planets, spectrals and vouchers: names only, for labelling.
    others = {}
    for m in re.finditer(r"^\s*([cv]_\w+)\s*=\s*\{(.*)\},?\s*$", game, re.M):
        kind = re.search(r"set\s*=\s*[\"'](Tarot|Planet|Spectral|Voucher)[\"']", m.group(2))
        if kind:
            others[m.group(1)] = {"name": field(m.group(2), "name"), "set": kind.group(1)}
    (out / "consumables.json").write_text(json.dumps(others, indent=1, ensure_ascii=False))

    # Blinds: name, HUD colour, chip animation strip, boss range. Small and Big have no colour in
    # game.lua; theirs were measured off the HUD plate in his videos.
    with zipfile.ZipFile(a.love) as z:
        chips = cv2.imdecode(np.frombuffer(z.read("resources/textures/2x/BlindChips.png"), np.uint8), cv2.IMREAD_UNCHANGED)
        tags_png = cv2.imdecode(np.frombuffer(z.read("resources/textures/2x/tags.png"), np.uint8), cv2.IMREAD_UNCHANGED)
    measured = {"bl_small": "096ea8", "bl_big": "9d6c03"}
    blinds = []
    (out / "sprites" / "chips").mkdir(parents=True, exist_ok=True)
    for m in re.finditer(r"^\s*(bl_\w+)\s*=\s*\{(.*)\},?\s*$", game, re.M):
        key, body = m.group(1), m.group(2)
        colour = re.search(r"boss_colour\s*=\s*HEX\('([0-9a-fA-F]{6})'\)", body)
        boss = re.search(r"boss\s*=\s*\{([^}]*)\}", body)
        p = pos(body, "pos")
        cv2.imwrite(str(out / "sprites" / "chips" / f"{key}.png"), chips[p["y"] * 68 : (p["y"] + 1) * 68])
        blinds.append(
            {
                "key": key,
                "name": field(body, "name"),
                "colour": (colour.group(1) if colour else measured.get(key, "")).lower(),
                "mult": float(re.search(r"\bmult\s*=\s*([\d.]+)", body).group(1)),
                "boss": bool(boss),
                "showdown": bool(boss and "showdown = true" in boss.group(1)),
                "min_ante": int(re.search(r"min\s*=\s*(\d+)", boss.group(1)).group(1)) if boss else None,
                "chip": f"sprites/chips/{key}.png",
            }
        )
    (out / "blinds.json").write_text(json.dumps(blinds, indent=1, ensure_ascii=False))

    tags = []
    (out / "sprites" / "tags").mkdir(parents=True, exist_ok=True)
    for m in re.finditer(r"^\s*(tag_\w+)\s*=\s*\{(.*)\},?\s*$", game, re.M):
        key, body = m.group(1), m.group(2)
        p = pos(body, "pos")
        cv2.imwrite(str(out / "sprites" / "tags" / f"{key}.png"), tags_png[p["y"] * 68 : (p["y"] + 1) * 68, p["x"] * 68 : (p["x"] + 1) * 68])
        ante = field(body, "min_ante")
        tags.append({"key": key, "name": field(body, "name"), "min_ante": None if ante == "nil" else ante, "sprite": f"sprites/tags/{key}.png"})
    (out / "tags.json").write_text(json.dumps(tags, indent=1, ensure_ascii=False))
    print(f"{len(jokers)} jokers, {len(others)} consumables and vouchers, {len(blinds)} blinds, {len(tags)} tags -> {out}")


if __name__ == "__main__":
    main()
