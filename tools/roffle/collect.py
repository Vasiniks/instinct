"""Merge the per-video outputs of analyze.py into the dataset files: videos.json and decisions.jsonl.

    python3 tools/roffle/collect.py
"""

import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from analyze import drop_flicker, invisible_copies, retype_pack_picks, runs_of  # noqa: E402

ROOT = Path("data/roffle")

# Why each was picked, from titles and descriptions (not from watching). "early": a full Gold
# Stake run whose story is in the first antes (pivots, odd builds, comebacks). "endless": a run
# played past the win, toward naneinf (score overflow).
META = {
    "e-xjK3zeAVM": ("early", "Short full run; title points at a build made of synergies."),
    "OTn6yl2jxGg": ("early", "Title points at unusual money play (seven antes in debt)."),
    "yefo5lyt6wU": ("early", "Title points at re-valuing a joker he used to pass on."),
    "nLdGlAmcWAM": ("early", "Title points at a run turned around by one Blueprint."),
    "SkwRy_N5D9A": ("early", "Title points at an off-meta joker (Loyalty Card) carrying a build."),
    "brRkg1_VFAU": ("early", "Comeback: an early double-Brainstorm plan stalled until Glass Joker and Justice tarots saved it."),
    "bb3UmQWsofM": ("early", "Odd build: early Immolates and Hermits, then Trading Card, thin the deck to seven cards by ante 8."),
    "LXou4GPdMYY": ("early", "Long-term plan: a speculative early Mime carried for several antes until Steel cards came online."),
    "oqiWiv4ygWU": ("early", "Comeback: a slow ante 1 turned around when Riff-Raff spawned a natural negative Hanging Chad."),
    "-GUBw5pfwWY": ("endless", "naneinf by ante 9: negative Business Card from Judgement and an early Baron, a fast endless finish."),
    "IK2QVkr5fzE": ("endless", "naneinf speedrun built on copied Immolates (an 11-card deck) and a Baron-centred endless build."),
    "XfLcmbk09tc": ("early", "Pair build: an early Wraith into Burnt Joker carried the early game while he levelled Pair (166 levels)."),
    # Added 2026-10-23 for White stake and deck variety. White stake runs are rare on the channel: since
    # mid 2024 every normal run is Gold Stake, so White comes from launch week and the naneinf speedruns.
    "hj_BuRY6uRc": ("white", "Launch day (game 1.0.0): a White Stake Red Deck win at ante 8, then a Red Stake Yellow Deck run."),
    "ywRtrJktO5M": ("endless", "White Stake naneinf speedrun (Brainstorm mod Perkeo start) finished in 23 minutes."),
    "s2qZNADhAY4": ("endless", "White Stake naneinf speedrun (Brainstorm mod Perkeo start); three key pieces came early."),
    "8cuq_dW2V_g": ("early", "Erratic Deck: a start with nine Kings pushed a Photograph and Hanging Chad (Photochad) build."),
    "vA_acBOHMb4": ("early", "Abandoned Deck (no face cards) and he still went for a face card build after close early calls."),
    "ylLAEKHkm00": ("early", "Black Deck: a strong Holographic Joker carried the early game; sold a top joker for Baseball Card."),
    "0YQg7HqqF40": ("early", "Plasma Deck: weak scoring jokers all run, carried by foil jokers, Plasma balancing and Saturns."),
    "o0Dv57c9UhY": ("early", "Blue Deck: an early Spare Trousers and Square Joker scaled into the late antes."),
}
# Deck and stake, as listed in the sources of data/roffle/playbook.json (another agent's file).
DECK = {
    "e-xjK3zeAVM": ("Ghost", "Gold"),
    "OTn6yl2jxGg": ("Ghost", "Gold"),
    "SkwRy_N5D9A": ("Ghost", "Gold"),
    "nLdGlAmcWAM": ("Ghost", "Gold"),
    "bb3UmQWsofM": ("Ghost", "Gold"),
    "LXou4GPdMYY": ("Ghost", "Gold"),
    "yefo5lyt6wU": ("Checkered", "Gold"),
    "brRkg1_VFAU": ("Checkered", "Gold"),
    "oqiWiv4ygWU": ("Checkered", "Gold"),
    "-GUBw5pfwWY": ("Ghost", "White"),
    "IK2QVkr5fzE": ("Ghost", "White"),
    # Not in that list: deck read from the draw pile's card back (closest colour of the
    # Abandoned/Red/Yellow backs, which share one pattern), stake from the video description.
    "XfLcmbk09tc": ("Yellow", "Gold"),
    # Added 2026-10-23. Stake from the video description, the HUD blind targets (White and Red share
    # the base scaling, Gold's Small Blind pays nothing) or what he says; deck from the card back
    # and the starting hands and discards.
    "hj_BuRY6uRc": ("Red", "White", [(0, "Red", "White"), (1690, "Yellow", "Red")]),
    "ywRtrJktO5M": ("Ghost", "White"),
    "s2qZNADhAY4": ("Ghost", "White"),
    "8cuq_dW2V_g": ("Erratic", "Gold"),
    "vA_acBOHMb4": ("Abandoned", "Gold"),
    "ylLAEKHkm00": ("Black", "Gold"),
    "0YQg7HqqF40": ("Plasma", "Gold"),
    "o0Dv57c9UhY": ("Blue", "Gold"),
}


def main():
    videos, lines, summary = [], [], {}
    for path in sorted(ROOT.glob("*.decisions.jsonl")):
        vid = path.name.removesuffix(".decisions.jsonl")
        info = json.loads((ROOT / "videos" / f"{vid}.info.json").read_text())
        timeline = json.loads((ROOT / f"{vid}.json").read_text())
        # Runs are cheap to recompute from the stored HUD readings, so rule changes don't need a re-analysis.
        timeline["runs"] = runs_of(timeline["hud"], timeline["joker_lineups"])
        # Ante and round reached come from the blinds played when there are any; OCR otherwise.
        for r in timeline["runs"]:
            played = [b for b in timeline.get("blinds") or [] if r["start_t"] - 30 <= b["start_t"] <= r["end_t"] + 30]
            if played:
                r["ante_reached"], r["round_reached"], r["source"] = max(b["ante"] for b in played), max(b["round"] for b in played), "blinds"
        (ROOT / f"{vid}.json").write_text(json.dumps(timeline, indent=1, ensure_ascii=False))
        # Also applied by analyze.py; repeated here so outputs from older runs get the same rules.
        raw = [json.loads(l) for l in path.read_text().splitlines() if l.strip()]
        decisions = invisible_copies(drop_flicker(retype_pack_picks(raw, timeline["screens"])))
        path.write_text("".join(json.dumps(d, ensure_ascii=False) + "\n" for d in decisions))
        lines += decisions
        summary[vid] = dict(Counter(d["type"] for d in decisions))
        videos.append(
            {
                "id": vid,
                "title": info.get("title"),
                "url": f"https://www.youtube.com/watch?v={vid}",
                "channel": info.get("channel"),
                "duration_seconds": info.get("duration"),
                "upload_date": info.get("upload_date"),
                "kind": META.get(vid, ("", ""))[0],
                "deck": DECK.get(vid, (None, None))[0],
                "stake": DECK.get(vid, (None, None))[1],
                # A video with runs on different decks or stakes: where each setting starts.
                **({"segments": [{"start_t": t, "deck": d, "stake": st} for t, d, st in DECK[vid][2]]} if len(DECK.get(vid, ())) > 2 else {}),
                "why_chosen": META.get(vid, ("", ""))[1],
                "analysed_seconds": timeline.get("analysed"),
                "runs": timeline.get("runs"),
                "decisions": summary[vid],
                "decisions_by_phase": dict(Counter(d.get("phase") or "unknown" for d in decisions)),
                "ante_from_blinds": round(sum(d.get("ante_source") == "blinds" for d in decisions) / max(1, len(decisions)), 3),
                "ante_check": timeline.get("ante_check"),
                "skips": len(timeline.get("skips") or []),
                "rerolls": sum(s["rerolls"] for s in timeline.get("shops") or []),
            }
        )
    (ROOT / "videos.json").write_text(json.dumps(videos, indent=1, ensure_ascii=False))
    (ROOT / "decisions.jsonl").write_text("".join(json.dumps(d, ensure_ascii=False) + "\n" for d in lines))
    print(f"{len(videos)} videos, {len(lines)} decisions")
    for vid, kinds in summary.items():
        print(vid, kinds)


if __name__ == "__main__":
    main()
