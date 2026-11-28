"""Summarise combat-decision diagnostics from an engine bench in combat mode (-Dsisko.combatLog=true).

    python3 bench/combat.py out

Reads the COMBAT lines (one per player turn) and the G line that ends each game, and reports how the AI uses combat:
how often it attacks with what it has, whom it attacks (the biggest threat by Forge's own score, or the most open
player), lethal it leaves on the table, what combat costs, and how well Forge's threat score picks the eventual winner.
"""
import glob, os, re, sys
from collections import Counter, defaultdict

def parse_opps(s):
    out = []
    if s == "-":
        return out
    for part in s.split(","):
        n, life, th, bl, blp, bp, ncr = part.rsplit(":", 6)
        out.append(dict(name=n, life=int(life), threat=int(th), bl=int(bl), blPow=int(blp), boardPow=int(bp), ncr=int(ncr)))
    return out

def games(folder):
    for path in sorted(glob.glob(os.path.join(folder, "**", "b*_*.log"), recursive=True)):
        cur = []
        for line in open(path, errors="ignore"):
            if line.startswith("COMBAT "):
                kv = dict(x.split("=", 1) for x in line.split()[1:] if "=" in x)
                kv["opps"] = parse_opps(kv.get("opps", "-"))
                tg = {} if kv["tgt"] == "-" else {a: int(b) for a, b in (x.rsplit(":", 1) for x in kv["tgt"].split(","))}
                kv["tgt"] = tg
                for k in ("t", "able", "ablePow", "att", "attPow", "dmg", "attDied", "blocks", "blkDied"):
                    kv[k] = int(kv[k])
                kv["dead"] = set() if kv["dead"] == "-" else set(kv["dead"].split(","))
                cur.append(kv)
            elif re.match(r"^G\d+ ", line):
                m = re.search(r"winner=(\S+)", line)
                yield cur, (m.group(1).replace(" ", "_") if m else None)
                cur = []

def pct(a, b):
    return f"{100 * a / b:.1f}%" if b else "n/a"

def main(folder):
    c = Counter(); by_round = defaultdict(lambda: [0, 0]); dmg = []; ngames = 0
    for turns, winner in games(folder):
        ngames += 1
        for t in turns:
            rnd = (t["t"] - 1) // 4 + 1
            bucket = "1-4" if rnd <= 4 else "5-8" if rnd <= 8 else "9-12" if rnd <= 12 else "13+"
            opps = t["opps"]
            if t["able"] > 0:
                c["able"] += 1; by_round[bucket][1] += 1
                c["ablePow"] += t["ablePow"]; c["attPowAble"] += t["attPow"]
                if t["att"] > 0:
                    c["attacked"] += 1; by_round[bucket][0] += 1
            # lethal on an open player: no untapped blockers and enough power among creatures able to attack
            for o in opps:
                if o["bl"] == 0 and o["life"] > 0 and t["ablePow"] >= o["life"]:
                    c["openLethal"] += 1
                    if o["name"] in t["dead"]:
                        c["openLethalTaken"] += 1
                    break
            if t["att"] > 0:
                dmg.append(t["dmg"]); c["attTurns"] += 1
                c["attackers"] += t["att"]; c["attDied"] += t["attDied"]; c["blocks"] += t["blocks"]; c["blkDied"] += t["blkDied"]
                live = [o for o in opps if o["life"] > 0]
                if len(live) >= 2 and t["tgt"]:
                    c["multi"] += 1
                    main_t = max(t["tgt"], key=t["tgt"].get)
                    if len(t["tgt"]) > 1:
                        c["split"] += 1
                    top = max(live, key=lambda o: o["threat"])["name"]
                    opn = min(live, key=lambda o: (o["blPow"], o["bl"]))["name"]
                    big = max(live, key=lambda o: o["boardPow"])["name"]
                    c["atTop"] += main_t == top; c["atOpen"] += main_t == opn; c["atBig"] += main_t == big
                    tgo = next((o for o in live if o["name"] == main_t), None)
                    if tgo and tgo["blPow"] >= t["attPow"] and any(o["bl"] == 0 for o in live if o["name"] != main_t):
                        c["walledWhileOpen"] += 1
                    # runaway leader: board power at least double every other opponent's and at least 20
                    srt = sorted(live, key=lambda o: -o["boardPow"])
                    if srt[0]["boardPow"] >= 20 and srt[0]["boardPow"] >= 2 * max(1, srt[1]["boardPow"]):
                        c["leaderTurns"] += 1; c["atLeader"] += main_t == srt[0]["name"]
            # how well does Forge's threat score pick the eventual winner (among this player's opponents)?
            live = [o for o in opps if o["life"] > 0]
            if winner and len(live) >= 2 and any(o["name"] == winner for o in live) and 4 <= rnd <= 10:
                c["predN"] += 1; c["predRand"] += 1 / len(live)
                c["predThreat"] += max(live, key=lambda o: o["threat"])["name"] == winner
                c["predBoard"] += max(live, key=lambda o: o["boardPow"])["name"] == winner
                c["predLife"] += max(live, key=lambda o: o["life"])["name"] == winner
    print(f"## Combat diagnostics\n\n{ngames} games, {c['able']} turns with a creature able to attack.\n")
    print("**Attacking at all**")
    print(f"- attacked on {pct(c['attacked'], c['able'])} of turns it could; committed {pct(c['attPowAble'], c['ablePow'])} of the power able to attack")
    for b in ("1-4", "5-8", "9-12", "13+"):
        a, n = by_round[b]
        print(f"  - rounds {b}: attacked {pct(a, n)} of {n} turns")
    print("\n**Whom it attacks** (attacking turns with 2+ opponents alive)")
    print(f"- {c['multi']} turns; split between players {pct(c['split'], c['multi'])}")
    print(f"- main target was Forge's top threat {pct(c['atTop'], c['multi'])}, the biggest board {pct(c['atBig'], c['multi'])}, the most open player {pct(c['atOpen'], c['multi'])}")
    print(f"- attacked into blockers at least as strong as the attack while another player had no blockers: {pct(c['walledWhileOpen'], c['multi'])}")
    print(f"- with a runaway leader at the table (board power 2x everyone else's, 20+): attacked the leader {pct(c['atLeader'], c['leaderTurns'])} of {c['leaderTurns']} turns")
    print("\n**Lethal left on the table**")
    print(f"- {c['openLethal']} turns had lethal on an open player (no untapped blockers, enough power); that player died that turn {pct(c['openLethalTaken'], c['openLethal'])}")
    print("\n**What combat costs** (per attacking turn)")
    n = max(1, c['attTurns'])
    print(f"- {c['attackers'] / n:.1f} attackers, {sum(dmg) / n:.1f} life dealt, {c['attDied'] / n:.2f} attackers died, {c['blocks'] / n:.2f} blocks, {c['blkDied'] / n:.2f} blockers died")
    print("\n**Picking the eventual winner** (rounds 4-10, among a player's opponents)")
    print(f"- Forge's threat score {pct(c['predThreat'], c['predN'])} · biggest board {pct(c['predBoard'], c['predN'])} · highest life {pct(c['predLife'], c['predN'])} · random {pct(c['predRand'], c['predN'])}")

main(sys.argv[1] if len(sys.argv) > 1 else "out")
