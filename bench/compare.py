"""Line up the bench games (bench/run.sh) by runner and game number; compare outcomes and time per game."""
import glob, re, sys, collections
pat = re.compile(r'^G(\d+) winner=(\S+) turn=(\d+) \(round [\d.]+\) (\d+)ms\s+(.*)$')
def load(f):
    out = {}
    for l in open(f, errors='ignore'):
        m = pat.match(l.rstrip('\n'))
        if m: out[int(m.group(1))] = (m.group(2), m.group(3), m.group(5).strip(), int(m.group(4)))
    return out
conc = collections.Counter(); cut = collections.Counter(); won = collections.Counter()
def deckname(f):
    for l in open(f, errors='ignore'):
        if l.startswith('POD '): return l[4:].strip().strip('[]').split(',')[0].strip()
    return ''
loops = collections.Counter(); draws0 = collections.Counter(); loopcards = collections.Counter(); games = collections.Counter()
same = collections.Counter(); tot = collections.Counter(); ms = collections.Counter(); n_common = 0
for f0 in sorted(glob.glob('out/**/b0_*.log', recursive=True)):
    s = re.search(r'b0_(\d+)\.log', f0).group(1)
    runs = [load(f0.replace('b0_', f'b{b}_')) for b in range(4)]
    common = set(runs[0])
    for r in runs[1:]: common &= set(r)
    # drop the last game of each process (it may have been cut off by the time limit)
    for g in sorted(common):
        n_common += 1
        for b in range(4):
            ms[b] += runs[b][g][3]
            if b: tot[b] += 1; same[b] += runs[b][g][:3] == runs[0][g][:3]
names = {1: 'current engine again (control)', 2: 'candidate engine', 3: 'candidate engine again'}
print(f"{n_common} games played by all four processes")
for b in (1, 2, 3):
    print(f"- {names[b]}: same outcome as current engine in {same[b]}/{tot[b]} games ({100*same[b]/max(1,tot[b]):.1f}%); "
          f"time {100*(ms[b]/max(1,ms[0])-1):+.1f}% vs current")

# loop draws (everyone lost at once) and the abilities the candidate dropped (LOOP lines), over all games played
for f in glob.glob('out/**/b*_*.log', recursive=True):
    b = int(re.search(r'b(\d)_', f).group(1)); dn = deckname(f)
    for l in open(f, errors='ignore'):
        m = pat.match(l.rstrip('\n'))
        if m:
            games[b] += 1; cut[b] += int(m.group(4)) >= 899000
            won[b] += m.group(2) == dn
            lives = [x for x in m.group(5).split() if '=' in x]
            if m.group(2) == 'Draw' and lives and all(x.endswith('x') for x in lives): draws0[b] += 1
        elif l.startswith('CONCEDE '):
            conc[b] += 1
        elif l.startswith('LOOP '):
            loops[b] += 1; loopcards[l[5:].split(' | ')[0]] += 1
for b in range(4):
    print(f"- process {b}: {games[b]} games, {cut[b]} hit the time limit, {conc[b]} won by concession, tested deck won {won[b]}, {draws0[b]} loop draws ({100*draws0[b]/max(1,games[b]):.1f}%), {loops[b]} loops broken")
print("abilities dropped:", loopcards.most_common(12))
