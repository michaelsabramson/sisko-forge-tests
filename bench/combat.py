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

def games(folder, proc="b"):
    for path in sorted(glob.glob(os.path.join(folder, "**", proc + "*_*.log"), recursive=True)):
        cur = []; dec = {}; tracked = None
        for line in open(path, errors="ignore"):
            if line.startswith("POD ") and tracked is None:
                tracked = line[4:].strip().strip("[]").split(",")[0].strip().replace(" ", "_")
            if line.startswith("SMART "):
                SMART[line.split()[1]] += 1
                kv = dict(x.split("=", 1) for x in line.split()[2:] if "=" in x)
                if "p" in kv:
                    dec[(kv["p"], int(kv["t"]))] = line.split()[1]
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
                yield cur, (m.group(1).replace(" ", "_") if m else None), tracked, dec
                cur = []; dec = {}

SMART = Counter()

def tracked_deaths(turns, winner, tracked, dec, d):
    """Why the tested deck lost: who knocked it out, and what it did on its last turn before that."""
    if not tracked:
        return
    d["games"] += 1
    if winner == tracked:
        d["won"] += 1
        return
    kill = next((i for i, t in enumerate(turns) if tracked in t["dead"]), None)
    own = [i for i, t in enumerate(turns) if t["p"] == tracked and (kill is None or i < kill)]
    if kill is None and not own:
        return
    d["died"] += 1
    if kill is None:
        d["noCombatTurn"] += 1
        return
    k = turns[kill]; rnd = (k["t"] - 1) // 4 + 1
    d["r" + ("1-6" if rnd <= 6 else "7-9" if rnd <= 9 else "10-12" if rnd <= 12 else "13+")] += 1
    if not own:
        return
    last = turns[own[-1]]
    opps = [o for o in last["opps"] if o["life"] > 0]
    big = max(opps, key=lambda o: o["boardPow"])["name"] if opps else None
    d["byBiggest" if k["p"] == big else "byOther"] += 1
    if last["att"] > 0:
        d["lastAttacked"] += 1; d["lastAttPow"] += 100 * last["attPow"] / max(1, last["ablePow"])
        if k["p"] not in last["tgt"] and kill - own[-1] <= 3:
            d["exposed"] += 1
    else:
        d["lastHeld"] += 1
    kind = dec.get((tracked, last["t"]))
    if kind:
        d["kind" + kind] += 1

def pct(a, b):
    return f"{100 * a / b:.1f}%" if b else "n/a"

def main(folder, proc="b"):
    missed = Counter(); examples = []; c = Counter(); by_round = defaultdict(lambda: [0, 0]); dmg = []; ngames = 0
    deaths = Counter()
    for turns, winner, tracked, dec in games(folder, proc):
        tracked_deaths(turns, winner, tracked, dec, deaths)
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
                    else:
                        why = "no attack" if not t["att"] else "attacked this player" if o["name"] in t["tgt"] else "attacked someone else"
                        missed[why] += 1
                        if len(examples) < 15:
                            examples.append(f"t={t['t']} {t['p']} able={t['able']} ablePow={t['ablePow']} att={t['att']} tgt={t['tgt']} dmg={t['dmg']} -> {o['name']} life={o['life']}")
                    break
            if t["att"] > 0:
                dmg.append(min(t["dmg"], sum(max(0, o["life"]) for o in opps))); c["attTurns"] += 1   # infinite-combo life loss capped at what the table had
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
    print(f"## Combat diagnostics{' (' + proc + ')' if proc != 'b' else ''}\n\n{ngames} games, {c['able']} turns with a creature able to attack.\n")
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
    print("  - missed: " + ", ".join(f"{k} {v}" for k, v in missed.most_common()))
    for e in examples:
        print("    - " + e)
    print("\n**What combat costs** (per attacking turn)")
    n = max(1, c['attTurns'])
    print(f"- {c['attackers'] / n:.1f} attackers, {sum(dmg) / n:.1f} life dealt, {c['attDied'] / n:.2f} attackers died, {c['blocks'] / n:.2f} blocks, {c['blkDied'] / n:.2f} blockers died")
    if SMART:
        print("\n**New attack planner decisions**: " + ", ".join(f"{k} {v}" for k, v in SMART.most_common()))
    if deaths:
        n = deaths["games"]
        print(f"\n**How the tested deck goes out** ({n} games: won {pct(deaths['won'], n)}, knocked out {pct(deaths['died'], n)})")
        d = max(1, deaths["died"])
        print(f"- killed by the opponent with the biggest board {pct(deaths['byBiggest'], d)}, by another {pct(deaths['byOther'], d)}; outside its opponents' combat (own turn, combo, drain) {pct(deaths['noCombatTurn'], d)}")
        print(f"- on its last turn it had attacked: {pct(deaths['lastAttacked'], d)} (sending {deaths['lastAttPow'] / max(1, deaths['lastAttacked']):.0f}% of its power on average); held everything back: {pct(deaths['lastHeld'], d)}")
        print(f"- killed in the round right after attacking, by a player it did not attack: {pct(deaths['exposed'], d)}")
        print(f"- knocked out by round: " + ", ".join(f"{k} {deaths['r' + k]}" for k in ("1-6", "7-9", "10-12", "13+")))
        ks = sorted((k[4:], v) for k, v in deaths.items() if k.startswith("kind"))
        if ks:
            print("- its last attack decision before going out: " + ", ".join(f"{k} {v}" for k, v in sorted(ks, key=lambda x: -x[1])))
    print("\n**Picking the eventual winner** (rounds 4-10, among a player's opponents)")
    print(f"- Forge's threat score {pct(c['predThreat'], c['predN'])} · biggest board {pct(c['predBoard'], c['predN'])} · highest life {pct(c['predLife'], c['predN'])} · random {pct(c['predRand'], c['predN'])}")

main(sys.argv[1] if len(sys.argv) > 1 else "out", sys.argv[2] if len(sys.argv) > 2 else "b")
