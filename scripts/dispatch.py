"""Turn the oldest file in queue/ into tests/request.json (building swap decks as needed).

Queue file formats (written by the web app):
  {"mode":"swap","name":..,"base":"SiskoFinal","slots":[{"out":"Cultivate","ins":["Riku of Many Paths"]}],
   "minutes":160,"opponents":[..]}
  {"mode":"decks","name":..,"decks":["SiskoFinal","SiskoV2"],"minutes":160,"opponents":[..]}
Prints the request name, or nothing if the queue is empty.
"""
import glob, json, os, re, sys, time
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
    # reuse cached games: an arm with enough cached games for its config is not replayed
    opps = req.get("opponents") or cache.DEFAULT_OPP
    eng, c = cache.engine_sig(), cache.load()
    est = req["shards"] * 4 / len(arms) * req["minutes"] * 1.1
    for a in arms:
        a["key"] = cache.arm_key(a, opps, req["band"], eng)
        e = c.get(a["key"], {})
        a["prior_games"], a["prior_wins"] = e.get("games", 0), e.get("wins", 0)
        a["cached"] = a["prior_games"] >= 0.9 * est
    req["allcached"] = all(a["cached"] for a in arms)
    req["seedbase"] = 10000 + (int(time.time()) // 60 % 1_000_000) * 200   # fresh seeds every run
    with open("tests/request.json", "w", encoding="utf-8") as f:
        json.dump(req, f, indent=2)
    os.remove(src)
    print(n)

main()
