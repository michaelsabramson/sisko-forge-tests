"""Land counts for Rank runs: win rate by how many lands were in the first 10 cards (kept hand + next 3 draws),
and the value of one more land there. Basics are counted by copies, so a stack of 30 Mountains is scored too.
Used by aggregate.py for every Rank, and by backfill_lands.py for Ranks run before this existed."""
import json, math, re, time, urllib.request

BASIC = re.compile(r'^(Snow-Covered )?(Plains|Island|Swamp|Mountain|Forest|Wastes)$')


def land_names(names):
    """The subset of card names that are lands (front face), from Scryfall. None if Scryfall can't be reached."""
    names = sorted(set(names)); lands = {n for n in names if BASIC.match(n)}; rest = [n for n in names if n not in lands]
    try:
        for i in range(0, len(rest), 75):
            body = json.dumps({"identifiers": [{"name": n} for n in rest[i:i + 75]]}).encode()
            rq = urllib.request.Request("https://api.scryfall.com/cards/collection", body,
                                        {"Content-Type": "application/json", "Accept": "application/json",
                                         "User-Agent": "sisko-forge-tests/1.0"})
            for attempt in range(4):   # Scryfall occasionally times out: retry with a pause
                try: data = json.load(urllib.request.urlopen(rq, timeout=30)).get("data", []); break
                except Exception:
                    if attempt == 3: raise
                    time.sleep(5 * (attempt + 1))
            for c in data:
                front = c.get("type_line", "").split(" // ")[0]
                if "Land" in front.split():
                    lands.add(c["name"]); lands.add(c["name"].split(" // ")[0])
    except Exception as e:
        print("land lookup failed:", e); return None
    return lands


def tally(games, lands, into=None):
    """games: [(names in the first 10 cards, won)] -> {lands in first 10: [games, wins]}"""
    cur = into if into is not None else {}
    for names, won in games:
        e = cur.setdefault(str(sum(n in lands for n in names)), [0, 0]); e[0] += 1; e[1] += int(won)
    return cur


def summarize(cur, min_bucket=300):
    """Merge thin buckets at both ends, then the value of one more land = average over games of the win-rate step to
    the next bucket (the top bucket counts as flat). Returned in points with a 95% range."""
    ks = sorted((int(k), g, w) for k, (g, w) in cur.items()); N = sum(g for _, g, _ in ks)
    if N < 1000: return None
    b = [[k, k, g, w] for k, g, w in ks]                       # [low, high, games, wins]
    while len(b) > 2 and b[0][2] < min_bucket: x = b.pop(0); b[0] = [x[0], b[0][1], b[0][2] + x[2], b[0][3] + x[3]]
    while len(b) > 2 and b[-1][2] < min_bucket: x = b.pop(); b[-1] = [b[-1][0], x[1], b[-1][2] + x[2], b[-1][3] + x[3]]
    P = [g / N for _, _, g, _ in b]; p = [w / g for _, _, g, w in b]; v = [q * (1 - q) / g for q, (_, _, g, _) in zip(p, b)]
    # value = sum_j P(j) (p(j+1) - p(j)) for j below the top bucket = sum_j c_j p(j)
    c = [0.0] * len(b)
    for j in range(len(b) - 1): c[j + 1] += P[j]; c[j] -= P[j]
    val = sum(cj * pj for cj, pj in zip(c, p)); se = math.sqrt(sum(cj * cj * vj for cj, vj in zip(c, v)))
    mean = sum(k * g for k, g, _ in ks) / N
    return {"curve": [[lo if lo == hi else f"{lo}-{hi}", g, w] for lo, hi, g, w in b],
            "value": round(100 * val, 2), "ci": round(196 * se, 2), "mean": round(mean, 2), "games": N}
