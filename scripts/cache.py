"""Result cache: games already played for an exact configuration are reused instead of replayed.

An arm's key covers everything that can change its games: the deck's card list (not its name), the card forced
into the opening hand, the opponent decks' card lists, the Forge commit + patch, the runner, and the game settings.
Change any of them and the key changes, so stale games are never mixed in.
Every run draws fresh seeds (request.seedbase), so cached and new games are independent.
"""
import hashlib, json, os, re

CACHE = "cache/arms.json"
SETTINGS = "timeout=120;hand=7;pod=4;fixed=1"   # bump if shard.sh game settings change


def _h(b):
    return hashlib.sha256(b).hexdigest()


def deck_sig(name):
    sec, cards = None, []
    for line in open(f"decks/{name}.dck", encoding="utf-8"):
        m = re.match(r"\[(\w+)\]", line)
        if m:
            sec = m.group(1); continue
        m = re.match(r"(\d+)\s+(.+)", line.strip())
        if m and sec in ("Commander", "Main"):
            cards.append(f"{sec}:{m.group(2).split('|')[0].strip()}x{m.group(1)}")
    return _h("\n".join(sorted(cards)).encode())[:16]


# Bump when a runner change alters how games are played (logging-only changes don't need a bump),
# then run scripts/cache_rekey.py only if old games are still valid under the new version.
RUNNER_VERSION = "runner-2"   # runner-2: package rotation; audit logging added without a bump (no gameplay change)


def engine_sig():
    parts = [open(p, "rb").read() for p in ("FORGE_COMMIT", "forge.patch")]
    return _h(b"\0".join(parts) + RUNNER_VERSION.encode() + SETTINGS.encode())[:16]


def arm_key(arm, opponents, band, engine=None):
    blob = json.dumps({"deck": deck_sig(arm["deck"]), "card": arm.get("card", ""), "band": band,
                       "opp": sorted(deck_sig(o) for o in opponents), "engine": engine or engine_sig()},
                      sort_keys=True)
    return _h(blob.encode())[:20]


def load():
    return json.load(open(CACHE)) if os.path.exists(CACHE) else {}


def save(c):
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    with open(CACHE, "w") as f:
        json.dump(c, f, indent=1, sort_keys=True)
        f.write("\n")


DEFAULT_OPP = ["Atraxa", "Prossh", "UrDragon", "Edgar", "Meren"]
