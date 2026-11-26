import glob, json, math, re, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cache

PEEK = bool(os.environ.get("PEEK"))
req = json.load(open('tests/request.json')); arms = req['arms']
new = [[0, 0] for _ in arms]   # wins, games played in this run
stl = [[0, 0] for _ in arms]   # this run: games cut off at the time limit (stalls), clean wins (won with nobody else alive)
speed = [[0, 0] for _ in arms]   # games, total game milliseconds (per process, so games per process-minute)
usage_rows = None
usage = {}                     # usage runs: card -> how the AI handled it
seen = {}                      # audit: card -> [games where it was in the kept hand + next 3 draws, wins in those games]
side = [[{}, 0, 0] for _ in arms]   # other modes, per arm: same card tallies, games and wins with a logged opening (feeds the Rank)
tops = []                      # audit: (first 10 cards, won) per game, for the land curve
forced_g = {}                  # adaptive Rank: card -> [games where the plan forced it into the opening hand, wins]
partally = {"games": 0, "seats": 0, "won": [0] * 10}   # opponents' wins by round (for the pool's par line)
cutoffs = {"opp": {}, "alive": {}, "me_alive": 0, "n": 0, "life": [], "why": {}, "opp_why": {}, "ms": []}   # round-cap draws: who/what was left
paced = []                     # audit: (won, round, stall) per game, for the speed curve (scripts/pace.py)
import pace
for f in glob.glob('out/**/arm*_*.log', recursive=True):
    i = int(re.match(r'arm(\d+)_', os.path.basename(f)).group(1)); me = arms[i]['deck']; top = None; fc = None
    pod = []
    for l in open(f, errors='ignore'):
        if l.startswith('POD '): pod = [x.strip() for x in l[4:].strip().strip('[]').split(',')]
        if l.startswith('FORCE '): fc = l[6:].rstrip('\n'); continue
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
            if t: speed[i][0] += 1; speed[i][1] += int(t.group(1)); cutoffs["ms"].append(int(t.group(1)))
            won = m.group(1) == me
            for o in pod[1:]: cutoffs["opp"].setdefault(o, [0, 0])[0] += 1
            # par: how fast the opponents win (the average opponent's share of games won by each round), from this run's games
            if pod:
                partally["games"] += 1; partally["seats"] += len(pod) - 1
                if m.group(1) in pod[1:]:
                    pw = pace.game(l, m.group(1))
                    if pw and pw[0]:
                        for k_, b_ in enumerate(pace.ROUNDS):
                            if pw[1] < b_ + 1: partally["won"][k_] += 1
            if m.group(1) == 'Draw' and (req.get('round_cap') or req.get('game_timeout')):
                # a game cut off unfinished (time limit, or a round cap if one is set) is a draw shared by the players still in it
                alive = [p.split('=')[0] for p in l.split('ms', 1)[-1].split() if '=' in p and not p.endswith('x')
                         and p.split('=')[1].lstrip('-').isdigit() and int(p.split('=')[1]) > 0]
                won = 1 / len(alive) if me in alive else 0
                if not alive and pod:
                    # everyone lost at once: Forge's infinite-loop rule (CR 104.4b) drew the game for all players, so
                    # it's an even split of the table, not a loss
                    won = 1 / len(pod)
                # cut-off diagnostics: which opponents were at the table, how many players were left, their life
                for o in pod[1:]: cutoffs["opp"].setdefault(o, [0, 0])[1] += 1
                cutoffs["alive"][len(alive)] = cutoffs["alive"].get(len(alive), 0) + 1
                ms_ = int(t.group(1)) if t else 0; rd_ = re.search(r'\(round ([\d.]+)\)', l)
                why = "loop" if not alive else "time" if ms_ >= 0.98 * 1000 * float(req.get('game_timeout') or 120) else \
                      "cap" if rd_ and req.get('round_cap') and float(rd_.group(1)) >= float(req['round_cap']) else "other"
                cutoffs["why"][why] = cutoffs["why"].get(why, 0) + 1
                for o in pod[1:]: cutoffs["opp_why"].setdefault(o, {}).setdefault(why, 0); cutoffs["opp_why"][o][why] += 1
                cutoffs["me_alive"] += me in alive; cutoffs["n"] += 1
                for p_ in l.split('ms', 1)[-1].split():
                    if '=' in p_ and not p_.endswith('x') and p_.split('=')[1].lstrip('-').isdigit():
                        cutoffs["life"].append(int(p_.split('=')[1]))
            if arms[i]['card'] == '@audit' and top is None: top = None; fc = None; continue   # no draw log: skip the game for audits
            if arms[i]['card'] == '@audit' and fc:
                # adaptive Rank, targeted game: the forced card's result goes to its verdict and the game is left out of
                # that card's own comparison; every other card in the opening counts normally
                e = forced_g.setdefault(fc, [0, 0]); e[0] += 1; e[1] += won
                new[i][1] += 1; new[i][0] += won
                for c in top - {fc}: e = seen.setdefault(c, [0, 0]); e[0] += 1; e[1] += won
                top = None; fc = None; continue
            if arms[i]['card'] == '@audit':
                pg = pace.game(l, me)
                if pg: paced.append(pg)
            new[i][1] += 1; new[i][0] += won
            pg2 = pace.game(l, me)
            if pg2: stl[i][0] += pg2[2]; stl[i][1] += pg2[0]
            if top is not None and arms[i]['card'] != '@audit':
                sd = side[i]; sd[1] += 1; sd[2] += won
                for c in top: e = sd[0].setdefault(c, [0, 0]); e[0] += 1; e[1] += won
            if top is not None:
                for c in top: e = seen.setdefault(c, [0, 0]); e[0] += 1; e[1] += won
                if arms[i]['card'] == '@audit': tops.append((topl, won))
            top = None; fc = None
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
if req.get('profile'): intro += (f" Every player on Forge's {req['profile']} AI." if req.get('opp_profile') == req['profile'] else f" Tested lists piloted by Forge's {req['profile']} AI (opponents on {req.get('opp_profile', 'Default')})." )
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
tail_rows = None
if req.get('mode') == 'tail':
    # tail check: each card vs the typical reference card; done when every card's verdict is settled (scripts/tail.py)
    import tail as tailmod
    m = req.get('tail', {}).get('margin', 2.0); po = req.get('tail', {}).get('p_outlier', {}); tail_rows = []
    for b, i in pairs:
        p0, n0 = p(b); pi, n = p(i); se = math.sqrt(p0*(1-p0)/max(1, n0) + pi*(1-pi)/max(1, n))
        v = tailmod.verdict(100*(pi-p0), 100*se, m)
        tail_rows.append({"card": arms[i]['card'], "gap": round(100*(pi-p0), 2), "ci": round(196*se, 2), "verdict": v,
                          **({"p_outlier": po[arms[i]['card']]} if arms[i]['card'] in po else {})})
    settled = all(r['verdict'] in tailmod.SETTLED for r in tail_rows)
    t.append(f"\nTail check: each card forced into the opening hand vs a typical card ({arms[0]['card']}). The Rank's outlier line sits {m:.1f} points below a typical card.\n")
    t.append("| Card | Rank's chance it's an outlier | Gap vs typical card | ± (95%) | Verdict |"); t.append("|---|---|---|---|---|")
    for r in tail_rows:
        t.append(f"| {r['card']} | {round(100*r['p_outlier']) if 'p_outlier' in r else '-'}% | {r['gap']:+.1f} | {r['ci']:.1f} | {tailmod.LABEL[r['verdict']]} |")
# slot tests stop early once the answer is settled: every gap clear at 99% (stricter than the 95% shown, because the run
# is checked several times) and every arm at least a quarter of its planned games in. The early read leaves stop.flag;
# peek.yml turns it into the ref refs/stop/<run>, which the runners watch for.
STOPPED = bool(os.environ.get("STOPPED"))
if PEEK and req.get('earlystop') and settled and all(new[i][1] >= 0.25 * a.get('target_new', 0) for i, a in enumerate(arms)):
    open('stop.flag', 'w').write('1'); print("settled: asking the runners to stop")
if STOPPED:
    t[0] += (f"\nStopped early: every gap was clear at 99% confidence after {sum(r[1] for r in res):,} games"
             f" ({100*sum(new[i][1] for i in range(len(arms)))/max(1, sum(a.get('target_new', 0) for a in arms)):.0f}% of the planned run)."
             + (" Every card's verdict is settled." if tail_rows is not None else " The winner is settled; the size of the gap is less precise than a full run.") + "\n")
audit = None
if req.get('mode') == 'audit':
    # every card: win rate when it was in the kept hand or the next 3 draws, vs games where it wasn't
    a0 = arms[0]; prior = cache.load().get(a0.get('key'), {}).get('cards', {})
    cards = {k: [v[0], v[1]] for k, v in prior.items()}
    for k, v in seen.items(): e = cards.setdefault(k, [0, 0]); e[0] += v[0]; e[1] += v[1]
    W, N = res[0]; rows = []; excl = {k: list(v) for k, v in cache.load().get(a0.get('key'), {}).get('excl', {}).items()}
    for k, (g_, w_) in forced_g.items(): e = excl.setdefault(k, [0, 0]); e[0] += g_; e[1] += w_
    for k, (n1, w1) in cards.items():
        xn, xw = excl.get(k, [0, 0])   # slot-test games where this card was forced into the hand
        n0, w0 = N - xn - n1, W - xw - w1
        if n1 < 30 or n0 < 30: continue
        p1, p0 = w1 / n1, w0 / n0
        se = math.sqrt(p1 * (1 - p1) / n1 + p0 * (1 - p0) / n0)
        rows.append({"card": k, "seen": n1, "wins": w1, "diff": round(100 * (p1 - p0), 2), "ci": round(196 * se, 2)})
    rows.sort(key=lambda r: r["diff"])
    audit = {"cards": rows, "tallies": cards, "excl": excl}
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
if req.get('mode') == 'audit' and req.get('adaptive') and audit:
    # adaptive Rank (one job, two phases): normal shuffled games until SPLIT of the run's games are in, then the early
    # reads publish a plan that also forces the Rank's uncertain cards into the opening hand (each against a typical
    # card, as in a tail check: scripts/tail.py). Settled cards drop out and their games go to the close calls.
    import tail as tailmod, subprocess
    SPLIT, NATURAL = 0.5, 0.25
    run_id = os.environ.get('RANK_RUN') or os.environ.get('GITHUB_RUN_ID', 'local'); pf = f"plans/{run_id}.json"
    plan = {}
    try: plan = json.load(open(pf))
    except Exception:
        if PEEK: plan = {}   # early reads run on main: no file there means no plan yet
        else:
          try:   # the final tally runs on the commit the run started from: the early reads' plan is on main
            subprocess.run(['git', 'fetch', '-q', 'origin', 'main'], check=True, timeout=120)
            plan = json.loads(subprocess.run(['git', 'show', f'FETCH_HEAD:{pf}'], capture_output=True, text=True, check=True).stdout)
          except Exception: plan = {}
    # switch once half of the run's total (games reused from earlier runs included) are normal games: a Rank that
    # already has many games targets its uncertain cards from the first early read
    nat_all = res[0][1] - sum(g_ for g_, _ in forced_g.values())
    if not plan.get('targets') and nat_all >= SPLIT * ((arms[0].get('target_new') or 0) + arms[0].get('prior_games', 0)) > 0:
        pick = tailmod.select(arms[0]['deck'], audit["cards"], res[0][1])
        if pick:   # chosen once, then fixed so the forced games add up; no candidates yet = ask again at the next read
            plan = {"targets": pick["cards"], "ref": pick["ref"], "margin": pick["margin"], "tau": pick["tau"], "p_outlier": pick["p_outlier"]}
    if plan.get('targets'):
        def fp(k): g_, w_ = forced_g.get(k, [0, 0]); return (w_ + 1) / (g_ + 2), g_   # lightly smoothed
        pr, nr = fp(plan['ref']); vrows = []
        # both kinds of evidence count: the forced games say how the card compares with the typical (reference) card;
        # adding the reference card's own Rank score puts that on the Rank's scale, and it is then pooled with the card's
        # normal Rank score by precision. The verdict and the card's place on the ladder use the pooled score.
        byc = {c['card']: c for c in audit["cards"]}; tt = tailmod.tiers(audit["cards"]); med = tt["median"] if tt else 0.0
        refc = byc.get(plan['ref'])
        for k in plan['targets']:
            pk, nk = fp(k); se = math.sqrt(pk*(1-pk)/max(1, nk) + pr*(1-pr)/max(1, nr))
            c = byc.get(k); row = {"card": k, "games": nk, "gap": round(100*(pk-pr), 2), "ci": round(196*se, 2),
                                   "p_outlier": plan.get('p_outlier', {}).get(k)}
            if c and refc and min(nk, nr) >= 200:
                s1 = c['ci'] / 1.96; s2 = math.hypot(100*se, refc['ci'] / 1.96); f_ = refc['diff'] + 100*(pk-pr)
                w1, w2 = 1/s1**2, 1/s2**2; comb = (c['diff']*w1 + f_*w2) / (w1 + w2); sc = (1/(w1 + w2)) ** .5
                row.update(rank_diff=c['diff'], rank_ci=c['ci'], diff=round(comb, 2), diff_ci=round(1.96*sc, 2),
                           verdict=tailmod.verdict(comb - med, sc, plan['margin']))
            else:
                row["verdict"] = "unclear"
            vrows.append(row)
        open_ = [r['card'] for r in vrows if r['verdict'] not in tailmod.SETTLED]
        if open_:
            share = (1 - NATURAL) / (len(open_) + math.sqrt(len(open_)))
            plan['weights'] = {"@natural": NATURAL, plan['ref']: round(share * math.sqrt(len(open_)), 4), **{k: round(share, 4) for k in open_}}
        else:
            plan['weights'] = {"@natural": 1.0}
        plan['verdicts'] = vrows; audit['targeted'] = {"ref": plan['ref'], "ref_games": nr, "margin": plan['margin'], "median": round(med, 2), "rows": vrows}
        if not PEEK:   # the ladder shows the pooled score for the double-checked cards (their normal score kept as rank_diff)
            for r in vrows:
                if 'diff' in r and r['card'] in byc:
                    byc[r['card']].update(rank_diff=byc[r['card']]['diff'], rank_ci=byc[r['card']]['ci'], diff=r['diff'], ci=r['diff_ci'])
        t.append(f"\nTargeted games: the Rank's uncertain cards forced into the opening hand, each against a typical card ({plan['ref']}, {nr:,} games). The outlier line sits {plan['margin']:.1f} points below a typical card.\n")
        t.append("| Card | Rank score | Forced games | Gap vs typical card | Pooled score | Verdict |"); t.append("|---|---|---|---|---|---|")
        for r in vrows:
            t.append(f"| {r['card']} | {byc[r['card']].get('rank_diff', byc[r['card']]['diff']):+.1f} | {r['games']:,} | {r['gap']:+.1f} ± {r['ci']:.1f} | "
                     + (f"{r['diff']:+.1f} ± {r['diff_ci']:.1f}" if 'diff' in r else "-") + f" | {tailmod.LABEL[r['verdict']]} |")
    if PEEK and plan:
        os.makedirs('plans', exist_ok=True); json.dump(plan, open(pf, 'w'), indent=1)
data = {"name": req['name'], "title": req.get('title'), "mode": req.get('mode', 'swap'), "run_id": os.environ.get('GITHUB_RUN_ID'),
        "finished": time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        "arms": [{"deck": a['deck'], "card": a['card'], "games": res[i][1], "wins": res[i][0],
                  **({"run_games": new[i][1], "run_stalls": stl[i][0], "run_clean_wins": stl[i][1]} if new[i][1] else {}),
                  "reused": a.get('prior_games', 0), **({"profile": a['profile']} if a.get('profile') else {}), **({"mc": a['mc']} if a.get('mc') else {}), **({"label": a['label']} if a.get('label') else {}),
                  **({"swap": a['swap']} if a.get('swap') else {})} for i, a in enumerate(arms)],
        "batching": batching, **({"profile": req['profile']} if req.get('profile') else {}), **({"opp_profile": req['opp_profile']} if req.get('opp_profile') else {}), **({"hidden": True} if req.get('hidden') else {}), **({"stopped": True} if STOPPED else {}),
        "compare": pairs, "opponents": req.get('opponents'),
        **({"cutoffs": {"n": cutoffs["n"], "alive": cutoffs["alive"], "me_alive": cutoffs["me_alive"],
                        "median_life": sorted(cutoffs["life"])[len(cutoffs["life"]) // 2] if cutoffs["life"] else None,
                        "opp": cutoffs["opp"], "why": cutoffs["why"], "opp_why": cutoffs["opp_why"],
                        "game_seconds": {q: round(sorted(cutoffs["ms"])[min(len(cutoffs["ms"]) - 1, int(q / 100 * len(cutoffs["ms"])))] / 1000)
                                         for q in (50, 75, 90, 95, 98, 99)} if cutoffs["ms"] else None}} if cutoffs["n"] else {}),
        **({"par_tally": {**partally, "opponents": sorted(req.get('opponents') or []), "round_cap": req.get('round_cap', 0),
                          "game_timeout": req.get('game_timeout')}} if partally["games"] else {}),
        "speed": round(sum(x[0] for x in speed) / max(1e-9, sum(x[1] for x in speed) / 60000), 3) if sum(x[0] for x in speed) else None,
        **({"tail": {"deck": arms[0]['deck'], "ref": arms[0]['card'], "rows": tail_rows, **req.get('tail', {})}} if tail_rows is not None else {}),
        **({"usage": {"deck": arms[0]['deck'], "cards": usage_rows, "forced": [x['card'] for x in arms if x.get('usage')]}} if usage_rows else {}),
        **({"audit": {"deck": arms[0]['deck'], "cards": audit["cards"], "chunk": req.get('chunk'), "partial": bool(req.get('capped')),
                      **({"lands": audit["lands"]} if audit.get("lands") else {}),
                      **({"pace": audit["pace"]} if audit.get("pace") else {}),
                      **({"targeted": audit["targeted"]} if audit.get("targeted") else {})}} if audit else {})}
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
            if audit.get("excl"): e["excl"] = audit["excl"]
            if audit.get("land_tallies"): e["lands"] = audit["land_tallies"]
            if audit.get("pace_tallies"): e["pace"] = audit["pace_tallies"]
    # slot tests, head-to-heads and pilots also play each list naturally apart from one forced card: add their opening-card
    # tallies to that list's Rank (same list, opponents, engine and AI settings). The forced card itself is left out
    # (it was in every hand) and its games noted in "excl", so its own comparison only uses games where it was dealt.
    if req.get('mode', 'swap') in ('swap', 'decks', 'pilot', 'tail'):
        opps_l = req.get('opponents') or cache.DEFAULT_OPP; eng = cache.engine_sig()
        for i, a in enumerate(arms):
            tal, g, w = side[i]
            if not g or a['card'] == '@audit': continue
            rk = cache.full_key({"deck": a['deck'], "card": "@audit"}, opps_l, req.get('band', 0), eng,
                                a.get('profile') or req.get('profile'), req.get('opp_profile'), a.get('mc') or req.get('mc'), req.get('opp_mc'), (str(req['game_timeout']) + (f"r{req['round_cap']}" if req.get('round_cap') else "")) if req.get('game_timeout') else None)
            e = c.setdefault(rk, {"deck": a['deck'], "card": "@audit", "games": 0, "wins": 0, "runs": []})
            e["games"] += g; e["wins"] += w; e["runs"].append(f"{req['name']}:{os.environ.get('GITHUB_RUN_ID', 'local')}:side")
            ct = e.setdefault("cards", {}); forced = a['card'] if req.get('mode', 'swap') in ('swap', 'tail') else ''
            for k, (n1, w1) in tal.items():
                if k == forced: continue
                x = ct.setdefault(k, [0, 0]); x[0] += n1; x[1] += w1
            if forced:
                x = e.setdefault("excl", {}).setdefault(forced, [0, 0]); x[0] += g; x[1] += w
            changed = True
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
        if a.get('mc') or req.get('opp_mc'):   # lookahead games run at their own speed: keep them out of the plain-AI figures
            prof = (prof or "Default") + "+mc"
        for k in ((a['deck'] + "|" + opps + "|" + prof, "*|" + prof) if prof else (a['deck'] + "|" + opps, "*")):
            sp[k] = (sp.get(k, []) + [speed[i]])[-6:]   # recent measurements only: the engine and decks change
    json.dump(sp, open('cache/speed.json', 'w'), indent=1)

# After a finished Rank, queue its tail check (scripts/tail.py): the cards whose outlier call is uncertain, plus the
# clearest outliers to confirm them, each forced into the opening hand against a typical card. Same list, opponents
# and AI settings as the Rank. Hidden (experimental) Ranks don't queue one unless they ask ("tail": true).
AUTO_TAIL = False   # off since 2026-11-25: more Rank games instead of targeted follow-ups (a request can still ask: "tail_auto")
if not PEEK and req.get('mode') == 'audit' and audit and (AUTO_TAIL and not req.get('hidden') or req.get('tail_auto')) and not req.get('no_tail') and not req.get('adaptive'):
    try:
        import tail as tailmod
        pick = tailmod.select(arms[0]['deck'], audit["cards"], res[0][1])
        if pick:
            q = {"mode": "tail", "base": arms[0]['deck'], **pick, "rank": req['name'],
                 "name": f"Tail check of {arms[0]['deck']}", "precision": 1.5, "shards": req.get('shards', 38),
                 **({"opponents": req['opponents']} if req.get('opponents') else {}),
                 **({"profile": req['profile']} if req.get('profile') else {"profile": "Default"}),
                 **({"opp_profile": req['opp_profile']} if req.get('opp_profile') else {}),
                 **({"mc": arms[0]['mc']} if arms[0].get('mc') else {}), **({"opp_mc": req['opp_mc']} if req.get('opp_mc') else {}),
                 "hidden": True,   # shown in chat until the Rank tab gets its tail-check badges
                 "reason": "after Rank",
                 "submitted": time.strftime('%Y-%m-%dT%H:%M:%S+00:00', time.gmtime())}
            os.makedirs('queue', exist_ok=True)
            fn = f"queue/{time.strftime('%Y%m%d-%H%M%S', time.gmtime())}-tail-{re.sub(r'[^a-z0-9]+', '-', arms[0]['deck'].lower())}.json"
            json.dump(q, open(fn, 'w'), indent=2); print("queued tail check:", fn, pick['cards'])
    except Exception as ex:
        print("tail check not queued:", ex)
