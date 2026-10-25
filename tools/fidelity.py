#!/usr/bin/env python3
"""How close the built-in simulator is to the real game, read from run logs.

  node tools/simbench.ts --logs ...   # then:
  python3 tools/fidelity.py --real runs/run-*.jsonl --sim "$TMPDIR"/simbench-*/run-*.jsonl

Compares what the game deals (shop offers: rarity, editions, card types, packs, vouchers; bosses
and tags by ante; blind targets) and how the game scores (the agent's estimate for the hand it
played against the chips the game gave it, by the jokers held). Agent-dependent numbers (money,
jokers held) are shown too, as context. Real logs are the ones whose ticks say game "blinddeck".
"""
import argparse, collections, glob, json, statistics as st, sys

def ticks(paths, want):
    for p in paths:
        with open(p, errors="ignore") as fh:
            prev = None
            for line in fh:
                try:
                    d = json.loads(line)
                except Exception:
                    continue
                if d.get("game") != want:
                    break
                yield p, d

def q(xs, f):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(f * len(xs)))] if xs else float("nan")

def collect(paths, want):
    out = collections.defaultdict(lambda: collections.Counter())
    ratios = []
    by_joker = collections.defaultdict(list)
    seen_visit = set()
    last = {}
    games = set()
    for p, d in ticks(paths, want):
        s = d.get("snapshot", {})
        raw = d.get("raw") or {}
        ante = min(s.get("ante", 0), 9)
        games.add(p + str(s.get("seed")))
        # Scoring: the played hand's estimate against the game's chips for it.
        prev = last.get(p)
        if prev is not None:
            pd, pchips = prev
            now = (raw.get("round") or {}).get("chips")
            if now is not None and pchips is not None and now >= pchips and pd["est"] > 0:
                gained = now - pchips
                if gained > 0 or d.get("phase") == "SELECTING_HAND":
                    r = gained / pd["est"]
                    ratios.append(r)
                    for k in pd["jokers"]:
                        by_joker[k].append(r)
            last[p] = None
        if d.get("phase") == "SELECTING_HAND" and (d.get("call") or {}).get("method") == "play" and (d.get("result") or {}).get("ok"):
            c = next((x for x in d.get("candidates", []) if x.get("call") == d.get("call")), None)
            if c and c.get("estimate"):
                last[p] = ({"est": c["estimate"]["score"], "jokers": sorted({j["key"] for j in s.get("jokers", [])})}, (raw.get("round") or {}).get("chips"))
        # Shop: the first tick of each visit is what the game dealt.
        if d.get("phase") == "SHOP":
            visit = (p, s.get("seed"), s.get("ante"), s.get("round"))
            if visit not in seen_visit:
                seen_visit.add(visit)
                out["visits"][ante] += 1
                for it in s.get("shop", []):
                    area, kind = it.get("area"), it.get("set")
                    if area == "card":
                        out["card_set"][kind] += 1
                        if kind == "JOKER":
                            out["rarity"][it.get("rarity") or "?"] += 1
                            out["edition"][it.get("edition") or "none"] += 1
                            out["joker_cost"][it.get("cost")] += 1
                    elif area == "pack":
                        out["pack"][it.get("label", "?").replace("Jumbo ", "").replace("Mega ", "")] += 1
                        out["pack_size"]["mega" if "Mega" in it.get("label", "") else "jumbo" if "Jumbo" in it.get("label", "") else "normal"] += 1
                    elif area == "voucher":
                        out["voucher_visits"][ante] += 1
                out["money_in"][ante] += s.get("money", 0)
                out["jokers_held"][ante] += len(s.get("jokers", []))
        if d.get("phase") == "BLIND_SELECT":
            for b in s.get("blinds", []):
                seen = (p, s.get("seed"), s.get("ante"), b.get("type"))
                if seen in seen_visit:
                    continue
                seen_visit.add(seen)
                if b.get("type") == "BOSS":
                    out["boss"][b.get("name")] += 1
                elif b.get("tag"):
                    out["tag"][b["tag"].get("name")] += 1
        # Economy: what each cash out paid, by ante, and the vouchers bought.
        if d.get("phase") == "ROUND_EVAL" and (d.get("call") or {}).get("method") == "cash_out":
            total = ((raw.get("round") or {}).get("cashout_preview") or {}).get("total")
            if total is not None:
                out["cashout_n"][ante] += 1
                out["cashout"][ante] += total
        for c in d.get("calls") or ([d["call"]] if d.get("call") else []):
            if c.get("method") == "buy" and "voucher" in (c.get("params") or {}) and (d.get("result") or {}).get("ok"):
                out["voucher_bought"][ante] += 1
            for b in s.get("blinds", []):
                out["target"][(ante, b.get("type"))] = b.get("target")
    return out, ratios, by_joker, len(games)

def pct(counter):
    n = sum(counter.values()) or 1
    return {k: round(100 * v / n, 1) for k, v in counter.most_common()}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--real", nargs="+", default=sorted(glob.glob("runs/run-*.jsonl")))
    ap.add_argument("--sim", nargs="+", required=True)
    a = ap.parse_args()
    R, rr, rj, rn = collect(a.real, "blinddeck")
    S, sr, sj, sn = collect(a.sim, "simulator")
    print(f"real: {rn} runs, {sum(R['visits'].values())} shop visits, {len(rr)} scored hands | sim: {sn} runs, {sum(S['visits'].values())} shop visits, {len(sr)} scored hands")
    for key in ["card_set", "rarity", "edition", "pack", "pack_size", "tag", "boss"]:
        print(f"\n{key}:\n  real {pct(R[key])}\n  sim  {pct(S[key])}")
    print("\nvoucher on the shelf, share of visits by ante:")
    for k in sorted(set(R["visits"]) | set(S["visits"])):
        rv, sv = R["visits"][k] or 1, S["visits"][k] or 1
        rc, sc = R["cashout_n"][k] or 1, S["cashout_n"][k] or 1
        print(f"  ante {k}: real {100 * R['voucher_visits'][k] / rv:.0f}%  sim {100 * S['voucher_visits'][k] / sv:.0f}%  bought/visit real {R['voucher_bought'][k] / rv:.2f} sim {S['voucher_bought'][k] / sv:.2f}   cash out: real {R['cashout'][k] / rc:.1f} sim {S['cashout'][k] / sc:.1f}   money in: real {R['money_in'][k] / rv:.0f} sim {S['money_in'][k] / sv:.0f}   jokers: real {R['jokers_held'][k] / rv:.1f} sim {S['jokers_held'][k] / sv:.1f}")
    print("\ntargets that differ (ante, blind): ", [(k, R["target"][k], S["target"][k]) for k in R["target"] if k in S["target"] and R["target"][k] != S["target"][k]][:10])
    print(f"\nscoring, game chips / agent estimate for the hand played:\n  real median {q(rr, .5):.2f}  p10 {q(rr, .1):.2f}  p90 {q(rr, .9):.2f}  share within 5%: {100 * sum(1 for r in rr if abs(r - 1) <= .05) / max(1, len(rr)):.0f}%")
    print(f"  sim  median {q(sr, .5):.2f}  p10 {q(sr, .1):.2f}  p90 {q(sr, .9):.2f}  share within 5%: {100 * sum(1 for r in sr if abs(r - 1) <= .05) / max(1, len(sr)):.0f}%")
    print("\njokers held when the real game scored far from the estimate (median ratio, hands):")
    rows = [(k, st.median(v), len(v)) for k, v in rj.items() if len(v) >= 8]
    for k, m, n in sorted(rows, key=lambda x: abs(x[1] - 1), reverse=True)[:25]:
        print(f"  {k:24} {m:5.2f}  n={n}")

main()
