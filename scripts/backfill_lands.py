"""Add the land curve (scripts/landcurve.py) to a finished Rank result from its run's stored game logs in out/.
Usage: python3 scripts/backfill_lands.py results/<rank>.md   (only that run's games; nothing else is changed)"""
import glob, json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import landcurve, pace
f = sys.argv[1]; t = open(f).read(); m = re.search(r'<!-- data (\{.*\}) -->', t)
d = json.loads(m.group(1)); games = []; paced = []
for lf in glob.glob('out/**/arm*_*.log', recursive=True):
    top = None
    for l in open(lf, errors='ignore'):
        if l.startswith('TOP '): top = l[4:].rstrip('\n').split('|'); continue
        pg = pace.game(l, d['audit']['deck'])
        if pg: paced.append(pg)
        g = re.match(r'G\d+ winner=(\S+)', l)
        if g and top is not None: games.append((top, g.group(1) == d['audit']['deck'])); top = None
L = landcurve.land_names({n for tl, _ in games for n in tl})
if L is None: sys.exit("could not look up card types")
s = landcurve.summarize(landcurve.tally(games, L))
print(len(games), "games", s)
ps = pace.summarize(pace.tally(paced)); print("pace", ps)
if ps: d['audit']['pace'] = ps
if s or ps:
    if s: d['audit']['lands'] = s
    open(f, 'w').write(t[:m.start(1)] + json.dumps(d) + t[m.end(1):])
