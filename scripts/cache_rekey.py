"""Re-file cached games under the current cache keys (after a key-scheme change that doesn't change gameplay).
Assumes each entry used the default bracket 3 opponents unless it records others."""
import sys
sys.path.insert(0, 'scripts'); import cache
c = cache.load(); eng = cache.engine_sig(); out = {}
for k, e in c.items():
    opps = e.get("opponents") or cache.DEFAULT_OPP
    nk = cache.arm_key({"deck": e["deck"], "card": e["card"]}, opps, 0, eng)
    if nk in out:   # same configuration filed twice: merge
        m = out[nk]; m["games"] += e["games"]; m["wins"] += e["wins"]; m["runs"] += e["runs"]
    else:
        out[nk] = e
    print(f"{e['deck']:52} {e['card']:28} {e['games']:6}  {k} -> {nk}")
cache.save(out)
