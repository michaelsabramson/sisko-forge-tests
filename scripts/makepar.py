"""Build a pool's par line (cache/par.json) from the par tallies of finished runs on that pool.

    python3 scripts/makepar.py <pool key, e.g. 3> results/a.md results/b.md ...

Par = the average opponent's share of games won by the end of each round (pace.ROUNDS), from full-length games: the
runs must use the pool's opponents, no round cap and the same time limit. Each run's tally comes from aggregate.py."""
import json, re, sys
sys.path.insert(0, 'scripts')
import pace
key, files = sys.argv[1], sys.argv[2:]
pool = sorted(json.load(open('decks/lab.json'))['pools'][key]['decks'])
tot = {"games": 0, "seats": 0, "won": [0] * len(pace.ROUNDS)}; used = []
for f in files:
    d = json.loads(re.search(r'<!-- data (.*) -->', open(f).read(), re.S).group(1)); t = d.get('par_tally')
    if not t or t['opponents'] != pool or t.get('round_cap'):
        print(f"skip {f}: {'no tally' if not t else 'other pool or a round cap'}"); continue
    for k in ('games', 'seats'): tot[k] += t[k]
    tot['won'] = [a + b for a, b in zip(tot['won'], t['won'])]; used.append(d['name'])
par = json.load(open('cache/par.json'))
par[key] = {"rounds": pace.ROUNDS, "par": [round(100 * w / tot['seats'], 2) for w in tot['won']], "games": tot['games'],
            "from": "full games of " + ", ".join(used),
            "note": "average opponent's share of games won by the end of each round; games cut off unfinished count as no winner"}
json.dump(par, open('cache/par.json', 'w'), indent=1)
print(json.dumps(par[key]))
