"""Build a pool's par line (cache/par.json) from the par tallies of finished runs on that pool.

    python3 scripts/makepar.py <pool key, e.g. 3> results/a.md results/b.md ...

Par = the average seat's share of games won by the end of each round (pace.ROUNDS) at a table of pool decks only:
a power-ladder run (every pool deck against the others, all games played to the end, no lookahead for anyone), so no
tested deck shapes it. One par line per pool, shared by every deck's speed curve; rebuilt only when the pool or the
engine / AI setup changes. Each run's tally comes from aggregate.py."""
import json, re, sys
sys.path.insert(0, 'scripts')
import pace
key, files = sys.argv[1], sys.argv[2:]
pool = sorted(json.load(open('decks/lab.json'))['pools'][key]['decks'])
tot = {"games": 0, "seats": 0, "won": [0] * len(pace.ROUNDS)}; used = []; fin = [0, 0]   # clean wins, games: the share won by the end of every game
for f in files:
    d = json.loads(re.search(r'<!-- data (.*) -->', open(f).read(), re.S).group(1)); t = d.get('par_tally')
    if not t or t.get('decks') != pool or t.get('round_cap'):
        print(f"skip {f}: {'no tally' if not t else 'not a pool-only (ladder) run on this pool, or a round cap'}"); continue
    for k in ('games', 'seats'): tot[k] += t[k]
    tot['won'] = [a + b for a, b in zip(tot['won'], t['won'])]; used.append(d['name'])
    for a in d['arms']: fin[0] += a.get('run_clean_wins', 0); fin[1] += a.get('run_games', 0)
par = json.load(open('cache/par.json'))
par[key] = {"rounds": pace.ROUNDS, "par": [round(100 * w / tot['seats'], 2) for w in tot['won']], "games": tot['games'], **({"final": round(100 * fin[0] / fin[1], 2)} if fin[1] else {}),
            "from": "pool-only full games: " + ", ".join(used),
            "note": "average seat's share of games won by the end of each round at a table of pool decks; games cut off unfinished count as no winner; final = share won once every game has ended"}
json.dump(par, open('cache/par.json', 'w'), indent=1)
print(json.dumps(par[key]))
