"""Speed curve for Rank runs: share of games the deck has won by the end of each round, to compare with the pool's
par (cache/par.json: the average opponent's share, from full-length games). Stalls (time limit with 2+ players still
alive, which Forge credits to an arbitrary survivor) count as no win."""
import re
ROUNDS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
G = re.compile(r'G\d+ winner=(\S+) turn=\d+ \(round ([\d.]+)\) \d+ms\s+(.*)$')


def game(line, me):
    """(won, round, stall) from a G line, or None"""
    m = G.match(line.rstrip('\n'))
    if not m: return None
    w, rnd, life = m.group(1), float(m.group(2)), m.group(3).split()
    alive = [p for p in life if not p.endswith('x') and p.split('=')[1].lstrip('-').isdigit() and int(p.split('=')[1]) > 0]
    stall = w == 'Draw' or (w != 'TrackedOut' and len(alive) > 1)
    return (w == me and not stall, rnd, stall)


def tally(games, into=None):
    t = into if into else {"games": 0, "stalls": 0, "won": [0] * len(ROUNDS)}
    for won, rnd, stall in games:
        t["games"] += 1; t["stalls"] += stall
        if won:
            for i, b in enumerate(ROUNDS):
                if rnd < b + 1: t["won"][i] += 1
    return t


def summarize(t):
    if t["games"] < 1000: return None
    return {"rounds": ROUNDS, "won": [round(100 * w / t["games"], 2) for w in t["won"]],
            "games": t["games"], "stalls": round(100 * t["stalls"] / t["games"], 1)}
