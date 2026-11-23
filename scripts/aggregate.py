import glob, json, math, re, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cache

PEEK = bool(os.environ.get("PEEK"))
req = json.load(open('tests/request.json')); arms = req['arms']
new = [[0, 0] for _ in arms]   # wins, games played in this run
speed = [[0, 0] for _ in arms]   # games, total game milliseconds (per process, so games per process-minute)
usage_rows = None
usage = {}                     # usage runs: card -> how the AI handled it
seen = {}                      # audit: card -> [games where it was in the kept hand + next 3 draws, wins in those games]
tops = []                      # audit: (first 10 cards, won) per game, for the land curve
paced = []                     # audit: (won, round, stall) per game, for the speed curve (scripts/pace.py)
import pace
for f in glob.glob('out/**/arm*_*.log', recursive=True):
    i = int(re.match(r'arm(\d+)_', os.path.basename(f)).group(1)); me = arms[i]['deck']; top = None
    for l in open(f, errors='ignore'):
        if l.startswith('TOP '): topl = l[4:].rstrip('\n').split('|'); top = set(topl); continue
        if l.startswith('USE\t'):
            for ent in l.rstrip('\n').split('\t')[1:]:
                nm, first, held, cast, cturn, inhand = ent.rsplit('~', 5)
                u = usage.setdefault(nm, {"games": 0, "cast": 0, "held": [], "stuck": 0, "inhand": 0})
                u["games"] += 1; u["cast"] += int(cast); u["inhand"] += int(inhand)
                if int(cast): u["held"].append(int(held))
                elif int(held) >= 3: u["stuck"] += 1
            continue
        m = re.match(r'G\d+ winner=(\S+)', l)
        if m:
            t = re.search(r' (\d+)ms', l)
            if t: speed[i][0] += 1; speed[i][1] += int(t.group(1))
            won = m.group(1) == me
            if arms[i]['card'] == '@audit' and top is None: top = None; continue   # no draw log: skip the game for audits
            if arms[i]['card'] == '@audit':
                pg = pace.game(l, me)
                if pg: paced.append(pg)
            new[i][1] += 1; new[i][0] += won
            if top is not None:
                for c in top: e = seen.setdefault(c, [0, 0]); e[0] += 1; e[1] += won
                if arms[i]['card'] == '@audit': tops.append((topl, won))
            top = None
# totals include games reused from the cache (recorded in the request when the run was dispatched)
res = [[new[i][0] + a.get('prior_wins', 0), new[i][1] + a.get('prior_games', 0)] for i, a in enumerate(arms)]
if PEEK and sum(g for _, g in new) == 0:
    # early read requested before the runners saved any games: nothing to report yet
    print("no games saved yet; skipping early read"); sys.exit(0)

def p(i): w, n = res[i]; return w / max(1, n), n
intro = ("Same list piloted by different Forge AI profiles (opponents on Default), nothing forced into the opening hand." if req.get('mode') == 'pilot'
         else "Whole lists compared, nothing forced into the opening hand." if req.get('mode') == 'decks'
         else "Package swap: each game forces one card of the package (or of the cards it replaces) into the opening hand, rotating through them." if req.get('mode') == 'package'
         else f"Swapped card forced into opening hand (band {req.get('band', 0)}).")
reused = sum(a.get('prior_games', 0) for a in arms)
if req.get('profile'): intro += f" Tested lists piloted by Forge's {req['profile']} AI (opponents on Default)."
t = [f"# {req['name']}\n\n{intro} Same opponents for every list."
     + (f" {reused:,} games reused from earlier runs with identical settings." if reused else "") + "\n",
     "| List | Card | Games | Wins | Win rate | Reused |", "|---|---|---|---|---|---|"]
for i, a in enumerate(arms):
    pi, n = p(i)
    t.append(f"| {a['deck']} | {a.get('label') or a['card']} | {n} | {res[i][0]} | {100*pi:.1f}% | {a.get('prior_games', 0)} |")
pairs = req.get('compare') or [[0, i] for i in range(1, len(arms))]
t.append("\nGaps (95% interval):\n")
lab = lambda a: a.get('label') or a['card'] or a['deck']
settled = bool(pairs)   # early stop: every gap clear of zero at 99%
for b, i in pairs:
    p0, n0 = p(b); pi, n = p(i); se = math.sqrt(p0*(1-p0)/max(1, n0) + pi*(1-pi)/max(1, n))
    t.append(f"- **{lab(arms[i])} vs {lab(arms[b])}: {100*(pi-p0):+.1f} ± {196*se:.1f} points**")
    settled = settled and abs(pi - p0) > 2.576 * se
# slot tests stop early once the answer is settled: every gap clear at 99% (stricter than the 95% shown, because the run
# is checked several times) and every arm at least a quarter of its planned games in. The early read leaves stop.flag;
# peek.yml turns it into the ref refs/stop/<run>, which the runners watch for.
STOPPED = bool(os.environ.get("STOPPED"))
if PEEK and req.get('earlystop') and settled and all(new[i][1] >= 0.25 * a.get('target_new', 0) for i, a in enumerate(arms)):
    open('stop.flag', 'w').write('1'); print("settled: asking the runners to stop")
if STOPPED:
    t[0] += (f"\nStopped early: every gap was clear at 99% confidence after {sum(r[1] for r in res):,} games"
             f" ({100*sum(new[i][1] for i in range(len(arms)))/max(1, sum(a.get('target_new', 0) for a in arms)):.0f}% of the planned run)."
             " The winner is settled; the size of the gap is less precise than a full run.\n")
audit = None
if req.get('mode') == 'audit':
    # every card: win rate when it was in the kept hand or the next 3 draws, vs games where it wasn't
    a0 = arms[0]; prior = cache.load().get(a0.get('key'), {}).get('cards', {})
    cards = {k: [v[0], v[1]] for k, v in prior.items()}
    for k, v in seen.items(): e = cards.setdefault(k, [0, 0]); e[0] += v[0]; e[1] += v[1]
    W, N = res[0]; rows = []
    for k, (n1, w1) in cards.items():
        n0, w0 = N - n1, W - w1
        if n1 < 30 or n0 < 30: continue
        p1, p0 = w1 / n1, w0 / n0
        se = math.sqrt(p1 * (1 - p1) / n1 + p0 * (1 - p0) / n0)
        rows.append({"card": k, "seen": n1, "wins": w1, "diff": round(100 * (p1 - p0), 2), "ci": round(196 * se, 2)})
    rows.sort(key=lambda r: r["diff"])
    audit = {"cards": rows, "tallies": cards}
    # land curve: win rate by lands in the first 10 cards, basics counted by copies (scripts/landcurve.py)
    import landcurve
    prior_l = cache.load().get(a0.get('key'), {}).get('lands', {})
    L = landcurve.land_names({n for tl, _ in tops for n in tl} | set(cards))
    if L is not None:
        lt = landcurve.tally(tops, L, {k: list(v) for k, v in prior_l.items()})
        audit["land_tallies"] = lt; audit["lands"] = landcurve.summarize(lt)
    prior_p = cache.load().get(a0.get('key'), {}).get('pace')
    pt = pace.tally(paced, {"games": prior_p["games"], "stalls": prior_p["stalls"], "won": list(prior_p["won"])} if prior_p else None)
    audit["pace_tallies"] = pt; audit["pace"] = pace.summarize(pt)
    t.append(f"\nDeck audit: {N:,} games, {100*W/max(1,N):.1f}% wins. Each card's change in win rate when it was in the kept opening hand or the next 3 draws, vs games where it wasn't (weakest first):\n")
    t.append("| Card | Games seen | Win rate seen | Change | ± |"); t.append("|---|---|---|---|---|")
    for r in rows: t.append(f"| {r['card']} | {r['seen']} | {100*r['wins']/r['seen']:.1f}% | {r['diff']:+.1f} | {r['ci']:.1f} |")
if usage:
    rows = []
    for nm, u in usage.items():
        if u["games"] < 20: continue
        h = sorted(u["held"]); med = h[len(h) // 2] if h else None
        rows.append((u["stuck"] / u["games"], nm, u["games"], u["cast"] / u["games"], med, u["stuck"] / u["games"]))
    rows.sort(reverse=True)
    t.append(f"\nCard usage: how the AI handled each spell it held. 'Stuck' = held 3+ turns with enough lands to cast it and never cast (colors not checked).\n")
    t.append("| Card | Games held | Cast rate | Median affordable turns before casting | Stuck |"); t.append("|---|---|---|---|---|")
    for _, nm, g, cr, med, st in rows: t.append(f"| {nm} | {g} | {100*cr:.0f}% | {med if med is not None else '-'} | {100*st:.0f}% |")
    usage_rows = [{"card": nm, "games": g, "cast": round(cr, 3), "median_wait": med, "stuck": round(st, 3)} for _, nm, g, cr, med, st in rows]
# how batch claiming went (claims.log per runner): claims made, retries after "slow down", batches played unclaimed
batching = None
logs = glob.glob('out/**/claims.log', recursive=True)
if logs:
    lines = [l for f in logs for l in open(f, errors='ignore')]
    batching = {"runners": len(logs), "claimed": sum('claimed' in l for l in lines),
                "retries": sum('attempt' in l for l in lines), "unclaimed": sum('without a claim' in l for l in lines)}
data = {"name": req['name'], "title": req.get('title'), "mode": req.get('mode', 'swap'), "run_id": os.environ.get('GITHUB_RUN_ID'),
        "finished": time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        "arms": [{"deck": a['deck'], "card": a['card'], "games": res[i][1], "wins": res[i][0],
                  "reused": a.get('prior_games', 0), **({"profile": a['profile']} if a.get('profile') else {}), **({"label": a['label']} if a.get('label') else {}),
                  **({"swap": a['swap']} if a.get('swap') else {})} for i, a in enumerate(arms)],
        "batching": batching, **({"profile": req['profile']} if req.get('profile') else {}), **({"hidden": True} if req.get('hidden') else {}), **({"stopped": True} if STOPPED else {}),
        "compare": pairs, "opponents": req.get('opponents'),
        "speed": round(sum(x[0] for x in speed) / max(1e-9, sum(x[1] for x in speed) / 60000), 3) if sum(x[0] for x in speed) else None,
        **({"usage": {"deck": arms[0]['deck'], "cards": usage_rows, "forced": [x['card'] for x in arms if x.get('usage')]}} if usage_rows else {}),
        **({"audit": {"deck": arms[0]['deck'], "cards": audit["cards"], "chunk": req.get('chunk'), "partial": bool(req.get('capped')),
                      **({"lands": audit["lands"]} if audit.get("lands") else {}),
                      **({"pace": audit["pace"]} if audit.get("pace") else {})}} if audit else {})}
t.append("\n<!-- data " + json.dumps(data) + " -->")
txt = "\n".join(t) + "\n"
if all(res[i][1] for pr in pairs for i in pr):
    os.makedirs('results', exist_ok=True); open(f"results/{req['name']}.md", 'w').write(txt); print(txt)
else:
    print("a compared list has no games (run cancelled early?): no result written")

# add this run's new games to the cache (final aggregation only, never for early reads)
if not PEEK:
    c = cache.load(); changed = False
    for i, a in enumerate(arms):
        if not a.get('key') or new[i][1] == 0: continue
        e = c.setdefault(a['key'], {"deck": a['deck'], "card": a['card'], "games": 0, "wins": 0, "runs": []})
        e["games"] += new[i][1]; e["wins"] += new[i][0]
        e["runs"].append(f"{req['name']}:{os.environ.get('GITHUB_RUN_ID', 'local')}"); changed = True
        if audit and i == 0:
            e["cards"] = audit["tallies"]
            if audit.get("land_tallies"): e["lands"] = audit["land_tallies"]
            if audit.get("pace_tallies"): e["pace"] = audit["pace_tallies"]
    if changed: cache.save(c)
    # remember how fast games actually ran (games per process-minute), so the dispatcher sizes future runs from it
    try:
        sp = json.load(open('cache/speed.json'))
    except Exception:
        sp = {}
    opps = ",".join(req.get('opponents') or cache.DEFAULT_OPP)
    for i, a in enumerate(arms):
        if speed[i][0] < 20: continue
        prof = a.get('profile') or req.get('profile')
        prof = None if prof == "Default" else prof
        for k in ((a['deck'] + "|" + opps + "|" + prof, "*|" + prof) if prof else (a['deck'] + "|" + opps, "*")):
            sp[k] = (sp.get(k, []) + [speed[i]])[-6:]   # recent measurements only: the engine and decks change
    json.dump(sp, open('cache/speed.json', 'w'), indent=1)
