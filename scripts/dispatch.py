"""Turn the oldest file in queue/ into tests/request.json (building swap decks as needed).

Queue file formats (written by the web app):
  {"mode":"swap","name":..,"base":"SiskoFinal","slots":[{"out":"Cultivate","ins":["Riku of Many Paths"]}],
   "minutes":160,"opponents":[..]}
  {"mode":"decks","name":..,"decks":["SiskoFinal","SiskoV2"],"minutes":160,"opponents":[..]}
Prints the request name, or nothing if the queue is empty.
"""
import glob, json, math, os, re, sys, time
import cache

def read_deck(name):
    path = f"decks/{name}.dck"
    if not os.path.exists(path):
        sys.exit(f"missing deck {path}")
    sec, out = None, {"Commander": [], "Main": []}
    for line in open(path, encoding="utf-8"):
        line = line.rstrip("\n")
        m = re.match(r"\[(\w+)\]", line)
        if m:
            sec = m.group(1); continue
        m = re.match(r"(\d+)\s+(.+)", line)
        if m and sec in out:
            out[sec].append([int(m.group(1)), m.group(2).split("|")[0].strip()])
    return out

def write_deck(name, deck):
    with open(f"decks/{name}.dck", "w", encoding="utf-8") as f:
        f.write(f"[metadata]\nName={name}\n[Commander]\n")
        for n, c in deck["Commander"]: f.write(f"{n} {c}\n")
        f.write("[Main]\n")
        for n, c in deck["Main"]: f.write(f"{n} {c}\n")

def slug(s, k=24):
    return re.sub(r"[^A-Za-z0-9]+", "", s.replace("'", "").title())[:k] or "x"

def swap_deck(base, out_card, in_card):
    d = read_deck(base)
    for row in d["Main"]:
        if row[1] == out_card:
            row[0] -= 1
            break
    else:
        sys.exit(f"{out_card!r} is not in {base}")
    d["Main"] = [r for r in d["Main"] if r[0] > 0]
    if any(c == in_card for _, c in d["Main"] + d["Commander"]):
        sys.exit(f"{in_card!r} is already in {base}")
    d["Main"].append([1, in_card])
    name = f"{base}__{slug(in_card)}__for__{slug(out_card)}"
    write_deck(name, d)
    return name

GPM = 1.1        # games per process-minute (measured on GitHub runners)
MAX_MIN = 170    # keep inside the 200-minute job limit
P_DEFAULT = 0.19


def _p(a):
    return a["prior_wins"] / a["prior_games"] if a["prior_games"] >= 1000 else P_DEFAULT


def plan_games(arms, compare, precision):
    """New games each arm needs so every compared gap has a 95% range of +/- precision points.
    Baselines are brought up to the even-split total; challengers then need only what's left,
    which is less when the baseline already has lots of games."""
    z = (precision / 196.0) ** 2           # allowed variance of the gap
    total = [a["prior_games"] for a in arms]
    for b in sorted({b for b, _ in compare}):
        pq = _p(arms[b]) * (1 - _p(arms[b]))
        total[b] = max(total[b], math.ceil(2 * pq / z))
    for b, i in compare:
        pb, pi = _p(arms[b]), _p(arms[i])
        room = z - pb * (1 - pb) / total[b]
        want = math.ceil(pi * (1 - pi) / room) if room > 0 else 10 ** 9
        total[i] = max(total[i], want)
    return [max(0, t - a["prior_games"]) for t, a in zip(total, arms)]


def allocate(need, todo, procs_total):
    """Give each arm that still needs games a share of the game processes in proportion to its need."""
    tot = sum(need[i] for i in todo)
    share = {i: max(1, round(procs_total * need[i] / tot)) for i in todo}
    while sum(share.values()) > procs_total:
        share[max(share, key=share.get)] -= 1
    while sum(share.values()) < procs_total:
        share[max(todo, key=lambda i: need[i] / share[i])] += 1
    return interleave(share)


def interleave(share):
    """Spread each arm's processes across runners rather than bunching them on a few."""
    left = dict(share); out = []
    while any(left.values()):
        for i in sorted(left):
            if left[i]:
                out.append(i); left[i] -= 1
    return out


def main():
    q = sorted(glob.glob("queue/*.json"))
    if not q:
        return
    src = q[0]
    r = json.load(open(src, encoding="utf-8"))
    arms, compare = [], []
    if r.get("mode", "swap") == "swap":
        base = r["base"]
        for s in r["slots"]:
            b = len(arms)
            arms.append({"deck": base, "card": s["out"]})
            for c in s["ins"]:
                arms.append({"deck": swap_deck(base, s["out"], c), "card": c})
                compare.append([b, len(arms) - 1])
    else:
        for d in r["decks"]:
            read_deck(d)
            arms.append({"deck": d, "card": ""})
        compare = [[0, i] for i in range(1, len(arms))]
    name = re.sub(r"[^a-z0-9_]+", "_", r.get("name", "test").lower()).strip("_")[:80] or "test"
    n, k = name, 2
    while os.path.exists(f"results/{n}.md"):
        n, k = f"{name}_{k}", k + 1
    req = {"name": n, "arms": arms, "compare": compare, "band": 0,
           "minutes": int(r.get("minutes", 160)), "shards": int(r.get("shards", 38)),
           "mode": r.get("mode", "swap"), "queued_from": os.path.basename(src),
           "started": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    if r.get("opponents"):
        req["opponents"] = r["opponents"]
    # reuse cached games, then size the run: either to a precision target (points, 95% range on each gap)
    # or, for old-style requests, to a fixed number of minutes split evenly
    opps = req.get("opponents") or cache.DEFAULT_OPP
    eng, c = cache.engine_sig(), cache.load()
    for a in arms:
        a["key"] = cache.arm_key(a, opps, req["band"], eng)
        e = c.get(a["key"], {})
        a["prior_games"], a["prior_wins"] = e.get("games", 0), e.get("wins", 0)
    procs_total = req["shards"] * 4
    if r.get("precision"):
        req["precision"] = float(r["precision"])
        need = plan_games(arms, compare, req["precision"])
        for a, n_new in zip(arms, need):
            a["target_new"] = n_new
            a["cached"] = n_new == 0
        todo = [i for i, n_new in enumerate(need) if n_new > 0]
        if todo:
            req["procs"] = allocate(need, todo, procs_total)
            per = [req["procs"].count(i) for i in range(len(arms))]
            mins = max(need[i] / (per[i] * GPM) for i in todo)
            req["minutes"] = max(8, min(MAX_MIN, math.ceil(mins * 1.12)))   # 12% margin for slow games
            req["capped"] = mins * 1.12 > MAX_MIN
        else:
            req["minutes"] = 0
    else:
        est = procs_total / len(arms) * req["minutes"] * GPM
        for a in arms:
            a["cached"] = a["prior_games"] >= 0.9 * est
    req["allcached"] = all(a["cached"] for a in arms)
    req["seedbase"] = 10000 + (int(time.time()) // 60 % 1_000_000) * 200   # fresh seeds every run
    with open("tests/request.json", "w", encoding="utf-8") as f:
        json.dump(req, f, indent=2)
    os.remove(src)
    print(n)

main()
