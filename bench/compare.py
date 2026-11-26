"""Line up the bench games (bench/run.sh) by runner and game number; compare outcomes and time per game."""
import glob, re, sys, collections
pat = re.compile(r'^G(\d+) winner=(\S+) turn=(\d+) \(round [\d.]+\) (\d+)ms\s+(.*)$')
def load(f):
    out = {}
    for l in open(f, errors='ignore'):
        m = pat.match(l.rstrip('\n'))
        if m: out[int(m.group(1))] = (m.group(2), m.group(3), m.group(5).strip(), int(m.group(4)))
    return out
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
names = {1: 'current engine again (control)', 2: 'candidate engine patch', 3: 'JVM flag'}
print(f"{n_common} games played by all four processes")
for b in (1, 2, 3):
    print(f"- {names[b]}: same outcome as current engine in {same[b]}/{tot[b]} games ({100*same[b]/max(1,tot[b]):.1f}%); "
          f"time {100*(ms[b]/max(1,ms[0])-1):+.1f}% vs current")
