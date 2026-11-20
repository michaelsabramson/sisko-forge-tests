"""Seed the cache from a finished run that predates caching: python3 scripts/cache_backfill.py results/<name>.md <run_id>
Only valid when decks, opponents, forge.patch, FORGE_COMMIT and Run.java are unchanged since that run, and the
run used the old fixed seeds (7000+k), which never overlap the per-run seeds used now (10000+)."""
import json, re, sys
sys.path.insert(0, 'scripts'); import cache
md, run = sys.argv[1], sys.argv[2]
req = json.load(open('tests/request.json')); name = re.search(r'results/(.+)\.md', md).group(1)
assert req['name'] == name, f"tests/request.json is for {req['name']}, not {name}"
rows = re.findall(r'^\| (\S+) \| ([^|]+?) \| (\d+) \| (\d+) \|', open(md).read(), re.M)
opps = req.get('opponents') or cache.DEFAULT_OPP; eng = cache.engine_sig(); c = cache.load()
for deck, card, games, wins in rows:
    k = cache.arm_key({"deck": deck, "card": card}, opps, req.get('band', 0), eng)
    if any(r.endswith(':' + run) for r in c.get(k, {}).get('runs', [])): continue
    e = c.setdefault(k, {"deck": deck, "card": card, "games": 0, "wins": 0, "runs": []})
    e["games"] += int(games); e["wins"] += int(wins); e["runs"].append(f"{name}:{run}")
    print(deck, card, games, wins, k)
cache.save(c)
