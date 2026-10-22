"""Balatro decision loop: BlindDeck state -> System One judgment -> action.

Backend is chosen by ONE env var (no code change):
  Cloud Jev:    TYPESAFE_BASE_URL=https://api.typesafe.ai  TYPESAFE_API_KEY=<real key>
  Local 4-bit:  TYPESAFE_BASE_URL=http://localhost:8090    TYPESAFE_API_KEY=local (any non-empty string)

The serving backend is unambiguous: every response echoes its own `model`
(`jev-...` = cloud, `StartLux-Decision-...` = local). This script prints it.

Questions per tick (speculative fan-out, one request):
  next_play    Choice  which legal action fits this state
  take_shop    Noul    should the agent act on shop/economy now
  hand_quality Score   how strong is the current position (weak/playable/strong)

Policy gates (code owns the decision, model only judges):
  - none_probability >= NONE_THRESHOLD (default 0.2, StartLux guidance) -> abstain
  - choice is None (allow_none) -> abstain
  - confidence < MIN_CONFIDENCE (default 0.55) -> flag for review, use fallback

Safe by default: DRY-RUN prints the action it WOULD take. Nothing touches the
game unless --execute is passed AND BALATRO_API_URL is set. BlindDeck/BalatroBot
JSON-RPC send is stubbed with exact TODOs so a new session can finish it.

Usage:
  python balatro_controller.py --check
      Minimal Noul against the configured backend. Proves routing unambiguously.

  python balatro_controller.py --glance glance.txt --actions play,discard,shop,skip
      Decide one tick from a BlindDeck `glance` dump (text file).

  python balatro_controller.py --glance glance.txt --execute
      Same, but POST the chosen action to BALATRO_API_URL (stub - see TODO).

Docs:
  TypeSafe quickstart .... https://docs.typesafe.ai/introduction/quickstart.md
  Function calling ........ https://docs.typesafe.ai/cookbooks/function_calling.md
  Speculative fan-out ..... https://docs.typesafe.ai/patterns/fan-out.md
  Composite scoring ....... https://docs.typesafe.ai/patterns/composite-scoring.md
  StartLux API ............ https://github.com/StartLuxLabs/StartLux-Decision/blob/main/docs/api.md
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request


def get_backend() -> tuple[str, str, str]:
    """Return (base_url, model, backend_label). No ambiguity: caller prints all three."""
    base_url = os.environ.get("TYPESAFE_BASE_URL", "https://api.typesafe.ai").rstrip("/")
    model = os.environ.get(
        "DECISION_MODEL", os.environ.get("TYPESAFE_DEFAULT_MODEL", "jev-latest")
    )
    label = os.environ.get("DECISION_BACKEND", "cloud-jev" if "api.typesafe.ai" in base_url else "local")
    return base_url, model, label


def get_api_key(base_url: str) -> str:
    """SDK requires a non-empty key. Local StartLux servers without keys ignore it."""
    key = os.environ.get("TYPESAFE_API_KEY", "")
    if not key.strip():
        if "localhost" in base_url or "127.0.0.1" in base_url:
            return "local"
        raise SystemExit(
            "TYPESAFE_API_KEY is missing. Cloud Jev needs the real key; "
            "local StartLux needs any non-empty string (e.g. export TYPESAFE_API_KEY=local)."
        )
    return key


def build_client():
    from typesafe_sdk import TypeSafeClient

    base_url, model, _label = get_backend()
    return TypeSafeClient(api_key=get_api_key(base_url), base_url=base_url, model=model)


def load_glance(path: str) -> dict:
    """Load a BlindDeck `glance` dump. Accepts raw text or JSON; returns structured state."""
    with open(path) as f:
        raw = f.read()
    try:
        return {"glance": json.loads(raw), "format": "json"}
    except json.JSONDecodeError:
        return {"glance": raw.strip(), "format": "text"}


def build_questions(actions: list[str]) -> dict:
    """Three judgments, one request. Speculative: code ignores what does not apply."""
    from typesafe_sdk import Choice, Noul, Score

    criteria = {a: f"Take the {a} action in Balatro" for a in actions}
    return {
        "next_play": Choice(
            instructions=(
                "Which ONE legal Balatro action fits this state best? "
                "Match the meaning of each option to the board, hand, money, and blind."
            ),
            criteria=criteria,
        ),
        "take_shop": Noul(
            instructions="Should the agent act on the shop/economy now rather than playing on?"
        ),
        "hand_quality": Score(
            instructions="How strong is the current run position?",
            criteria=["weak, behind the blind", "playable, on pace", "strong, ahead of the blind"],
        ),
    }


def decide(state: dict, actions: list[str]) -> tuple[object, str, str]:
    """Ask all three questions in one System One call. Returns (result, model, label)."""
    client = build_client()
    _, _, label = get_backend()
    with client:
        result = client.system_one(state=state, questions=build_questions(actions))
    model = getattr(result, "model", None) or getattr(getattr(result, "usage", None), "model", "?")
    # SDK surfaces model on the response envelope; fall back to raw dump if shape differs.
    if model == "?":
        try:
            model = result.model  # type: ignore[attr-defined]
        except AttributeError:
            model = "?"
    return result, str(model), label


def apply_policy(result, none_threshold: float = 0.2, min_confidence: float = 0.55) -> dict:
    """Code-side gates. Returns a dict describing action/abstain + reasons."""
    nxt = result.choices["next_play"]
    shop = result.nouls["take_shop"]
    quality = result.scores["hand_quality"]

    choice = nxt.choice
    confidence = float(nxt.confidence)
    none_p = float(getattr(nxt, "none_probability", 0.0) or 0.0)
    probs = dict(nxt.probabilities)

    verdict: dict = {
        "choice": choice,
        "confidence": confidence,
        "none_probability": none_p,
        "probabilities": probs,
        "take_shop": float(shop.noul),
        "hand_quality": float(quality.score),
    }

    if choice is None:
        verdict.update(action="ABSTAIN", reason="allow_none: model picked 'None of the above'")
    elif none_p >= none_threshold:
        verdict.update(
            action="ABSTAIN",
            reason=f"none_probability {none_p:.2f} >= {none_threshold} (no listed action fits)",
        )
    elif confidence < min_confidence:
        verdict.update(
            action=f"REVIEW:{choice}",
            reason=f"confidence {confidence:.2f} < {min_confidence} (needs human or fallback)",
        )
    else:
        verdict.update(action=choice, reason="gates passed")
    return verdict


def check_backend() -> int:
    """Minimal Noul. Prints backend label + serving model. Exit 0 on success."""
    from typesafe_sdk import Noul

    base_url, configured_model, label = get_backend()
    print(f"backend : {label}")
    print(f"base_url: {base_url}")
    print(f"asked   : {configured_model}")
    client = build_client()
    with client:
        result = client.system_one(
            state="Our API integration started returning 500 errors.",
            questions={
                "is_urgent": Noul(instructions="The message conveys urgency or time-sensitivity")
            },
        )
    served = getattr(result, "model", "?")
    print(f"served  : {served}")
    print(f"noul    : {result.nouls['is_urgent'].noul}")
    print("OK - unambiguous: served model is the backend that answered.")
    return 0


def send_to_game(action: str, dry_run: bool = True) -> None:
    """TODO(new session): POST action to BlindDeck/BalatroBot JSON-RPC at BALATRO_API_URL.

    BlindDeck exposes JSON-RPC with OpenRPC spec at src/lua/utils/openrpc.json
    (methods like play/select/buy/pack via friendly helpers). Wire the chosen
    `action` to the matching method here. DRY-RUN prints instead of sending.
    """
    game_url = os.environ.get("BALATRO_API_URL", "")
    if dry_run or not game_url:
        print(f"[dry-run] would send to game ({game_url or 'BALATRO_API_URL unset'}): {action}")
        return
    payload = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "TODO.map_action", "params": {"action": action}}).encode()
    req = urllib.request.Request(game_url, data=payload, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        print(resp.status, resp.read().decode()[:500])


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Balatro System One decision loop (dry-run safe).")
    ap.add_argument("--check", action="store_true", help="Minimal backend check, then exit.")
    ap.add_argument("--glance", help="Path to BlindDeck glance dump (text or JSON).")
    ap.add_argument(
        "--actions",
        default="play_hand,discard,shop,skip_blind",
        help="Comma-separated legal actions for this tick.",
    )
    ap.add_argument("--execute", action="store_true", help="Actually POST to BALATRO_API_URL (default: dry-run).")
    ap.add_argument("--none-threshold", type=float, default=0.2)
    ap.add_argument("--min-confidence", type=float, default=0.55)
    args = ap.parse_args(argv)

    if args.check:
        return check_backend()

    if not args.glance:
        ap.error("--glance is required unless --check is passed.")
    actions = [a.strip() for a in args.actions.split(",") if a.strip()]
    if len(actions) > 26:
        print("WARNING: >26 options triggers knockout rounds on StartLux (groups of 25).", file=sys.stderr)

    state = load_glance(args.glance)
    state.update({"legal_actions": actions, "goal": "clear the blind within hands/discards"})
    result, served_model, label = decide(state, actions)
    verdict = apply_policy(result, args.none_threshold, args.min_confidence)

    print(f"backend: {label} | served model: {served_model}")
    print(json.dumps(verdict, indent=2))
    send_to_game(verdict["action"], dry_run=not args.execute)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
