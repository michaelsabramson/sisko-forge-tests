"""Summarize Java Flight Recorder CPU samples (jfr print --events jdk.ExecutionSample output on stdin):
where the game processes spend their time, by method (self and inclusive) and by Forge area."""
import re, sys
from collections import Counter

self_c, incl_c, area_c = Counter(), Counter(), Counter()
n = 0; frames = None
for line in sys.stdin:
    if 'stackTrace = [' in line: frames = []; continue
    if frames is None: continue
    s = line.strip()
    if s.startswith(']') or s == '...':
        if frames:
            n += 1; self_c[frames[0]] += 1
            for f in set(frames): incl_c[f] += 1
            for a in {re.sub(r'\.[A-Z].*$', '', f) for f in frames if f.startswith('forge.')}: area_c[a] += 1
        frames = None; continue
    m = re.match(r'([\w.$<>]+)\(', s)
    if m: frames.append(m.group(1))
if not n: print("profile: no CPU samples"); sys.exit()
pct = lambda c: f"{100 * c / n:5.1f}%"
print(f"PROFILE: {n} CPU samples")
print("-- time spent inside (self) --"); [print(" ", pct(c), f) for f, c in self_c.most_common(20)]
print("-- time spent in or under (inclusive) --"); [print(" ", pct(c), f) for f, c in incl_c.most_common(30) if not f.startswith(('java.', 'jdk.', 'sun.'))]
print("-- by Forge package (inclusive) --"); [print(" ", pct(c), a) for a, c in area_c.most_common(15)]
