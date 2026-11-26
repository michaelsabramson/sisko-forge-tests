"""Turn the oldest file in queue/ into tests/request.json (building swap decks as needed).

Queue file formats (written by the web app):
  {"mode":"swap","name":..,"base":"SiskoFinal","slots":[{"out":"Cultivate","ins":["Riku of Many Paths"]}],
   "minutes":160,"opponents":[..]}
  {"mode":"decks","name":..,"decks":["SiskoFinal","SiskoV2"],"minutes":160,"opponents":[..]}
Prints the request name, or nothing if the queue is empty.
"""
import glob, hashlib, json, math, os, re, sys, time
import cache

def read_deck(name):
    path = f"decks/{name}.dck"
    if not os.path.exists(path) and os.path.exists(f"decks/ref/{name}.dck"): path = f"decks/ref/{name}.dck"   # reference decks
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

GPM = 1.1        # fallback games per process-minute, used until runs have measured the real speed
MAX_MIN = 170    # keep inside the 200-minute job limit
P_DEFAULT = 0.19
STARTUP_MIN = 1.5   # loading Forge's card database before the first game


DEFAULT_PROFILE = "Default"   # Hard without the lookahead is Default plus defending at 5 life; with it, no gain was measured
DEFAULT_MC = "max"            # lookahead on for the tested lists (2026-11-25): +1.9 ± 1.5 clean wins with a 6-minute limit
DEFAULT_TIMEOUT = 900         # seconds before a game is cut off: only a safety net now that games end at a round cap
DEFAULT_ROUND_CAP = 15        # rounds before an unfinished game is ended as a draw shared by the players still in it


def speed_profile(a, req):
    """the cache/speed.json profile label of an arm: its AI profile, plus "+mc" with the lookahead (as aggregate.py writes it)"""
    p = a.get("profile") or req.get("profile")
    if a.get("mc") or req.get("opp_mc"): p = (p or "Default") + "+mc"
    return p


def measured_gpm(deck, opps, profile=None):
    """Games per process-minute from recent runs (cache/speed.json, written by aggregate.py):
    this deck against these opponents if measured, else the average of all recent runs, else the fallback."""
    try:
        sp = json.load(open("cache/speed.json"))
    except Exception:
        return GPM
    def rate(rows):
        g = sum(r[0] for r in rows); ms = sum(r[1] for r in rows)
        return g / (ms / 60000) if g >= 50 and ms > 0 else None
    if profile and profile != "Default":
        # a stronger AI profile thinks longer: use its own measurements, else assume ~2.5x slower until measured
        return (rate(sp.get(deck + "|" + ",".join(opps) + "|" + profile, [])) or rate(sp.get("*|" + profile, []))
                or (rate(sp.get("*", [])) or GPM) / 2.5)
    return rate(sp.get(deck + "|" + ",".join(opps), [])) or rate(sp.get("*", [])) or GPM


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


def audit_games(arm, precision):
    """Total games so each card's gap (seen early vs not) has a 95% range of +/- precision points.
    A card is in the kept hand + next 3 draws in about 10% of games."""
    p = _p(arm); share = 0.10
    total = math.ceil(p * (1 - p) * (1 + share / (1 - share)) / (share * (precision / 196.0) ** 2))
    return [max(0, total - arm["prior_games"])]


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


def package_deck(base, outs, ins):
    d = read_deck(base)
    for o in outs:
        for row in d["Main"]:
            if row[1] == o and row[0] > 0:
                row[0] -= 1
                break
        else:
            sys.exit(f"{o!r} is not in {base}")
    d["Main"] = [r for r in d["Main"] if r[0] > 0]
    have = {c for _, c in d["Main"] + d["Commander"]}
    for c in ins:
        if c in have and not re.match(r"^(Plains|Island|Swamp|Mountain|Forest|Wastes)$", c):
            sys.exit(f"{c!r} is already in {base}")
        for row in d["Main"]:
            if row[1] == c:
                row[0] += 1
                break
        else:
            d["Main"].append([1, c])
    tag = hashlib.sha1(("|".join(sorted(outs)) + ">" + "|".join(sorted(ins))).encode()).hexdigest()[:8]
    name = f"{base}__pkg_{tag}"
    write_deck(name, d)
    return name


def short(cards):
    names = [c.split(",")[0] for c in cards]
    return ", ".join(names[:3]) + (f" +{len(names) - 3}" if len(names) > 3 else "")


def main():
    def setup_first(p):
        # deck setup (the quick AI check of a new list's cards) goes ahead of longer tests, then first in, first out
        try: m = json.load(open(p, encoding="utf-8")).get("mode")
        except Exception: m = None
        return (0 if m in ("usage", "cardcheck") else 1, p)
    q = sorted(glob.glob("queue/*.json"), key=setup_first)
    if not q:
        return
    src = q[0]
    r = json.load(open(src, encoding="utf-8"))
    arms, compare = [], []
    if r.get("mode") == "ladder":
        # backend only: power ladder calibration. Every listed deck plays full-length games against random pods of the
        # others (no early end), so every game's winner is known for the rating fit (scripts/ladder.py).
        for d in r["decks"]:
            arms.append({"deck": d, "card": "", "opponents": [o for o in r["decks"] if o != d]})
    elif r.get("mode") == "pilot":
        # backend only (no app button): the same list piloted by different Forge AI profiles, opponents on Default,
        # nothing forced. Measures how much a profile's extra thinking is worth with this deck.
        for p in r.get("pilots") or [{"profile": q} for q in r.get("profiles", ["Default", "Hard"])]:
            # a pilot: an AI profile, optionally with Forge's lookahead search ("mc": on = profile budgets, max = desktop)
            mc = p.get("mc", "off")
            arms.append({"deck": r["base"], "card": "", "profile": p["profile"], **({"mc": mc} if mc != "off" else {}),
                         **({"jvm": p["jvm"]} if p.get("jvm") else {}),
                         "label": f"{p['profile']} AI" + {"off": "", "on": " + lookahead", "max": " + lookahead (desktop)"}[mc]
                                  + (f" [{p['jvm']}]" if p.get("jvm") else "")})
        compare = [[0, i] for i in range(1, len(arms))]
    elif r.get("mode", "swap") == "swap":
        base = r["base"]
        for s in r["slots"]:
            b = len(arms)
            arms.append({"deck": base, "card": s["out"]})
            for c in s["ins"]:
                arms.append({"deck": swap_deck(base, s["out"], c), "card": c, "swap": {"out": [s["out"]], "in": [c]}})
                compare.append([b, len(arms) - 1])
            # several cards for one slot: also compare them directly with each other
            ins_idx = list(range(b + 1, len(arms)))
            for x in range(len(ins_idx)):
                for y in range(x + 1, len(ins_idx)):
                    compare.append([ins_idx[x], ins_idx[y]])
    elif r.get("mode") == "audit":
        # one unforced arm; the runner logs each game's kept hand + next 3 draws and every card is scored from those
        read_deck(r["base"])
        arms.append({"deck": r["base"], "card": "@audit", "label": f"Audit of {r['base']}"})
    elif r.get("mode") == "cardcheck":
        # quick check of newly added cards: each one forced into the opening hand, with the usage log on
        base = r["base"]; d = read_deck(base); have = {c for _, c in d["Main"] + d["Commander"]}
        for c in r["cards"]:
            if c not in have:
                sys.exit(f"{c!r} is not in {base}")
            arms.append({"deck": base, "card": c, "usage": True, "label": c})
    elif r.get("mode") == "tail":
        # tail check after a Rank (scripts/tail.py): the reference arm forces a typical card, each other arm forces one
        # card whose outlier call was uncertain; every gap is against the reference
        base = r["base"]; d = read_deck(base); have = {c for _, c in d["Main"]}
        for c in [r["ref"]] + r["cards"]:
            if c not in have:
                sys.exit(f"{c!r} is not in {base}")
        arms.append({"deck": base, "card": r["ref"], "label": f"Typical card ({r['ref']})"})
        for c in r["cards"]:
            arms.append({"deck": base, "card": c, "label": c})
        compare = [[0, i] for i in range(1, len(arms))]
    elif r.get("mode") == "usage":
        # short unforced run that logs how the AI handles every card it holds (cast rate, turns held while affordable)
        read_deck(r["base"])
        arms.append({"deck": r["base"], "card": "@usage", "label": f"Card usage in {r['base']}"})
    elif r.get("mode") == "package":
        # each game forces one package card into the opening hand, rotating through the package;
        # the baseline forces the matching card being cut, so both sides answer "when this slot shows up early"
        base = r["base"]
        for pk in r["packages"]:
            if len(pk["out"]) != len(pk["in"]) or not pk["out"]:
                sys.exit("a package must take out as many cards as it puts in")
            b = next((i for i, a in enumerate(arms) if a["deck"] == base and a["card"] == "|".join(pk["out"])), None)
            if b is None:
                b = len(arms)
                arms.append({"deck": base, "card": "|".join(pk["out"]), "label": short(pk["out"])})
            arms.append({"deck": package_deck(base, pk["out"], pk["in"]), "card": "|".join(pk["in"]),
                         "label": f"{short(pk['in'])} for {short(pk['out'])}", "swap": {"out": pk["out"], "in": pk["in"]}})
            compare.append([b, len(arms) - 1])
    else:
        for d in r["decks"]:
            read_deck(d)
            arms.append({"deck": d, "card": ""})
        compare = [[0, i] for i in range(1, len(arms))]
    name = re.sub(r"[^a-z0-9_]+", "_", r.get("name", "test").lower()).strip("_")[:80] or "test"
    n, k = name, 2
    while os.path.exists(f"results/{n}.md") and not r.get("result_name"):
        n, k = f"{name}_{k}", k + 1
    n = r.get("result_name") or n
    req = {"name": n, "title": r.get("name"), "arms": arms, "compare": compare, "band": 0,
           "minutes": int(r.get("minutes", 160)), "shards": int(r.get("shards", 38)),
           "mode": r.get("mode", "swap"), "queued_from": os.path.basename(src),
           "started": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    if r.get("opponents"):
        req["opponents"] = r["opponents"]
    # a background run (power ladder calibration, .github/workflows/background.yml) holds some runners: leave them free
    if os.environ.get("BG_RUNNERS"):
        req["shards"] = max(10, req["shards"] - int(os.environ["BG_RUNNERS"]))
    if r.get("mode") == "ladder":
        req["full"] = True; req["hidden"] = True   # full-length games (every winner known); result hidden from the app
    if r.get("mode") == "tail":
        req["tail"] = {k: r[k] for k in ("margin", "tau", "p_outlier", "rank") if k in r}
    req["game_timeout"] = int(r.get("game_timeout", DEFAULT_TIMEOUT))   # seconds before a game is cut off
    req["round_cap"] = int(r.get("round_cap", DEFAULT_ROUND_CAP))       # 0 = no round cap (the time limit decides)
    limits = str(req["game_timeout"]) + (f"r{req['round_cap']}" if req["round_cap"] else "")
    if r.get("profile_jfr"): req["profile_jfr"] = True   # CPU profile of a few game processes (scripts/shard.sh)
    if r.get("adaptive") and r.get("mode") == "audit":   # off by default (2026-11-25): more games beat targeted ones
        req["adaptive"] = True   # one-job Rank: targeted games for its uncertain cards in the second half (aggregate.py)
    if r.get("hidden"):
        req["hidden"] = True   # backend experiment: the app ignores its result (e.g. a Rank on another AI profile)
    mc = r.get("mc", DEFAULT_MC)
    if mc != "off" and r.get("mode") not in ("pilot", "ladder"):
        for a in arms: a["mc"] = mc   # Forge's lookahead search for the tested lists (on | max); opponents keep opp_mc
    if r.get("mode") not in ("pilot", "ladder"):
        # Forge AI settings: Default for every player, the tested lists with the lookahead (DEFAULT_MC); a request can ask otherwise
        prof = r.get("profile", DEFAULT_PROFILE)
        if prof != "Default": req["profile"] = prof
        op = r.get("opp_profile", prof)
        if op != "Default": req["opp_profile"] = op
    elif r.get("profile") and r["profile"] != "Default":
        req["profile"] = r["profile"]   # AI settings for the tested decks; opponents stay on Default
    # helper.json: a second account's runners (its own job limit) play shards main_shards..shards-1 of every run
    if os.path.exists("helper.json") and not r.get("no_helper"):
        h = json.load(open("helper.json"))
        req["main_shards"], req["helper"] = req["shards"], h["repo"]
        req["shards"] += int(h["shards"])
    # reuse cached games, then size the run: either to a precision target (points, 95% range on each gap)
    # or, for old-style requests, to a fixed number of minutes split evenly
    opps = req.get("opponents") or cache.DEFAULT_OPP
    eng, c = cache.engine_sig(), cache.load()
    for a in arms:
        a["key"] = cache.full_key(a, opps, req["band"], eng, a.get("profile") or req.get("profile"), req.get("opp_profile"),
                                  a.get("mc") or req.get("mc"), req.get("opp_mc"), limits)
        if a.get("jvm"): a["key"] = cache._h((a["key"] + "|jvm=" + a["jvm"]).encode())[:20]   # speed experiments stay apart
        e = c.get(a["key"], {})
        a["prior_games"], a["prior_wins"] = e.get("games", 0), e.get("wins", 0)
    procs_total = req["shards"] * 4
    if r.get("precision"):
        req["precision"] = float(r["precision"])
        need = audit_games(arms[0], req["precision"]) if req["mode"] == "audit" else plan_games(arms, compare, req["precision"])
        for a, n_new in zip(arms, need):
            a["target_new"] = n_new
            a["cached"] = n_new == 0
        todo = [i for i, n_new in enumerate(need) if n_new > 0]
        if todo:
            req["procs"] = allocate(need, todo, procs_total)
            if r.get("whole_runners"):   # speed experiments: each runner plays one arm only, so arms don't share a machine
                req["procs"] = [todo[(k // 4) % len(todo)] for k in range(procs_total)]
            per = [req["procs"].count(i) for i in range(len(arms))]
            gpm = [measured_gpm(a["deck"], opps, speed_profile(a, req)) for a in arms]
            req["gpm"] = [round(g, 3) for g in gpm]
            # each process stops once it has played its share of its arm's games, so a run ends when the games are done;
            # the minutes are only a safety cap (generous, in case this run is slower than the measured speed)
            req["quota"] = [math.ceil(need[i] / per[i]) if per[i] else 0 for i in range(len(arms))]
            # batches: ~60% of each arm's games are handed out up front (per process, no coordination needed); the rest is
            # split into small batches claimed while the run plays (scripts/claimbatch.sh), so fast runners take on more
            # and the run ends within a few minutes of its last game. At most ~2 claims per runner per arm keeps GitHub
            # API writes well inside its limits.
            sh = req["shards"]
            # slot tests can stop early once settled (scripts/aggregate.py): a smaller first round leaves more of the run
            # in batches, which runners stop claiming, and early reads come every 10 minutes instead of 20
            req["earlystop"] = req["mode"] in ("swap", "package", "pilot", "tail") and not r.get("full") and not r.get("no_earlystop")
            if req["earlystop"]:
                # about five looks per run: every 5 minutes for short runs, every 10 for the longest
                est = max(need[i] / (per[i] * measured_gpm(arms[i]["deck"], opps, speed_profile(arms[i], req))) for i in todo)
                req["checkpoint"] = int(min(10, max(5, math.ceil(est / 5))))
            frac = 0.3 if req["earlystop"] else 0.6
            first = [int(frac * need[i] / per[i]) if per[i] else 0 for i in range(len(arms))]
            rest = [max(0, need[i] - first[i] * per[i]) for i in range(len(arms))]
            size = [max(6, math.ceil(rest[i] / ((3 if req["earlystop"] else 2) * sh))) if rest[i] else 0 for i in range(len(arms))]
            req["first"] = first
            req["batch"] = size
            req["batches"] = [math.ceil(rest[i] / size[i]) if size[i] else 0 for i in range(len(arms))]
            mins = max(need[i] / (per[i] * gpm[i]) for i in todo) + STARTUP_MIN
            req["minutes"] = max(8, min(MAX_MIN, math.ceil(mins * 1.4)))
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
    if req.get("capped") and not req["allcached"] and r.get("chunk", 1) < 8:
        # more games needed than one run allows: keep it queued; the next run continues from the cache
        r["result_name"], r["chunk"] = n, r.get("chunk", 1) + 1
        req["chunk"] = r["chunk"] - 1
        with open(src, "w", encoding="utf-8") as f:
            json.dump(r, f, indent=2)
    else:
        os.remove(src)
    print(n)

main()
