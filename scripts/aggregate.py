import glob, json, math, re, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cache

PEEK = bool(os.environ.get("PEEK"))
req = json.load(open('tests/request.json')); arms = req['arms']
new = [[0, 0] for _ in arms]   # wins, games played in this run
for f in glob.glob('out/**/arm*_*.log', recursive=True):
    i = int(re.match(r'arm(\d+)_', os.path.basename(f)).group(1)); me = arms[i]['deck']
    for l in open(f, errors='ignore'):
        m = re.match(r'G\d+ winner=(\S+)', l)
        if m: new[i][1] += 1; new[i][0] += m.group(1) == me
# totals include games reused from the cache (recorded in the request when the run was dispatched)
res = [[new[i][0] + a.get('prior_wins', 0), new[i][1] + a.get('prior_games', 0)] for i, a in enumerate(arms)]

def p(i): w, n = res[i]; return w / max(1, n), n
intro = ("Whole lists compared, nothing forced into the opening hand." if req.get('mode') == 'decks'
         else f"Swapped card forced into opening hand (band {req.get('band', 0)}).")
reused = sum(a.get('prior_games', 0) for a in arms)
t = [f"# {req['name']}\n\n{intro} Same opponents for every list."
     + (f" {reused:,} games reused from earlier runs with identical settings." if reused else "") + "\n",
     "| List | Card | Games | Wins | Win rate | Reused |", "|---|---|---|---|---|---|"]
for i, a in enumerate(arms):
    pi, n = p(i)
    t.append(f"| {a['deck']} | {a['card']} | {n} | {res[i][0]} | {100*pi:.1f}% | {a.get('prior_games', 0)} |")
pairs = req.get('compare') or [[0, i] for i in range(1, len(arms))]
t.append("\nGaps (95% interval):\n")
lab = lambda a: a['card'] or a['deck']
for b, i in pairs:
    p0, n0 = p(b); pi, n = p(i); se = math.sqrt(p0*(1-p0)/max(1, n0) + pi*(1-pi)/max(1, n))
    t.append(f"- **{lab(arms[i])} vs {lab(arms[b])}: {100*(pi-p0):+.1f} ± {196*se:.1f} points**")
data = {"name": req['name'], "mode": req.get('mode', 'swap'), "run_id": os.environ.get('GITHUB_RUN_ID'),
        "finished": time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        "arms": [{"deck": a['deck'], "card": a['card'], "games": res[i][1], "wins": res[i][0],
                  "reused": a.get('prior_games', 0)} for i, a in enumerate(arms)],
        "compare": pairs, "opponents": req.get('opponents')}
t.append("\n<!-- data " + json.dumps(data) + " -->")
txt = "\n".join(t) + "\n"
os.makedirs('results', exist_ok=True); open(f"results/{req['name']}.md", 'w').write(txt); print(txt)

# add this run's new games to the cache (final aggregation only, never for early reads)
if not PEEK:
    c = cache.load(); changed = False
    for i, a in enumerate(arms):
        if not a.get('key') or new[i][1] == 0: continue
        e = c.setdefault(a['key'], {"deck": a['deck'], "card": a['card'], "games": 0, "wins": 0, "runs": []})
        e["games"] += new[i][1]; e["wins"] += new[i][0]
        e["runs"].append(f"{req['name']}:{os.environ.get('GITHUB_RUN_ID', 'local')}"); changed = True
    if changed: cache.save(c)
