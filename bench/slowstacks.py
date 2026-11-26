"""Summarize the stacks of slow games (bench/profile.sh, out/**/slow_*.txt): which Forge methods the game thread was
in or under (inclusive), and the innermost Forge frame, across all samples."""
import glob, re, collections
incl, top, n = collections.Counter(), collections.Counter(), 0
for f in glob.glob('out/**/slow_*.txt', recursive=True):
    for block in open(f, errors='ignore').read().split('---- ')[1:]:
        frames = re.findall(r'at ((?:forge|Run)[\w.$]*)\(', block)
        if not frames: continue
        n += 1; top[frames[0]] += 1
        for fr in set(frames): incl[fr] += 1
print(f"SLOW GAMES: {n} stack samples from games running past 3 minutes")
print("-- innermost Forge frame --"); [print(f"  {100*c/n:5.1f}% {k}") for k, c in top.most_common(15)]
print("-- in or under (inclusive) --"); [print(f"  {100*c/n:5.1f}% {k}") for k, c in incl.most_common(40)]
