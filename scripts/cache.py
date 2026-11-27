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
    path = f"decks/{name}.dck" if os.path.exists(f"decks/{name}.dck") else f"decks/ref/{name}.dck"   # reference decks (power ladder)
    for line in open(path, encoding="utf-8"):
        m = re.match(r"\[(\w+)\]", line)
        if m:
            sec = m.group(1); continue
        m = re.match(r"(\d+)\s+(.+)", line.strip())
        if m and sec in ("Commander", "Main"):
            cards.append(f"{sec}:{m.group(2).split('|')[0].strip()}x{m.group(1)}")
    return _h("\n".join(sorted(cards)).encode())[:16]


# Bump when a runner change alters how games are played (logging-only changes don't need a bump),
# then run scripts/cache_rekey.py only if old games are still valid under the new version.
RUNNER_VERSION = "runner-4"   # runner-4: the concession check also runs as spells resolve and tokens are made; runner-3: a runaway board wins by concession (sisko.concede); runner-2: package rotation; audit logging and ending games once the tracked deck is out added without a bump (results unchanged)


def engine_sig():
    parts = [open(p, "rb").read() for p in ("FORGE_COMMIT", "forge.patch")]
    for extra in ("decks/combos.txt",):   # the combos the engine plays out (ComboShortcut; full set in testing: combos.txt.gz)
        try:
            parts.append(open(extra, "rb").read())
        except FileNotFoundError:
            pass
    return _h(b"\0".join(parts) + RUNNER_VERSION.encode() + SETTINGS.encode())[:16]


def arm_key(arm, opponents, band, engine=None, profile=None, opp_profile=None):
    k = {"deck": deck_sig(arm["deck"]), "card": arm.get("card", ""), "band": band,
         "opp": sorted(deck_sig(o) for o in opponents), "engine": engine or engine_sig()}
    if profile and profile != "Default":
        k["profile"] = profile   # the tested deck's AI settings (forge-gui/res/ai/<profile>.ai); Default keeps old keys
    if opp_profile and opp_profile != "Default":
        k["opp_profile"] = opp_profile   # opponents' AI settings; never mixed with games against Default opponents
    blob = json.dumps(k, sort_keys=True)
    return _h(blob.encode())[:20]


def full_key(arm, opponents, band, engine=None, profile=None, opp_profile=None, mc=None, opp_mc=None, game_timeout=None):
    """arm_key plus Forge's lookahead switches and the game time limit (kept out of arm_key so older keys stay valid)."""
    k = arm_key(arm, opponents, band, engine, profile, opp_profile)
    if (mc and mc != "off") or (opp_mc and opp_mc != "off"):
        k = _h((k + "|mc=" + (mc or "off") + "|opp_mc=" + (opp_mc or "off")).encode())[:20]
    if game_timeout and str(game_timeout) != "120":   # "360", or "900r15" with a round cap
        k = _h((k + "|t=" + str(game_timeout)).encode())[:20]
    return k


def load():
    return json.load(open(CACHE)) if os.path.exists(CACHE) else {}


def save(c):
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    with open(CACHE, "w") as f:
        json.dump(c, f, indent=1, sort_keys=True)
        f.write("\n")


DEFAULT_OPP = ["Edgar", "UrDragon", "Prossh", "Meren", "Talrand_B3", "Krenko_B3", "RafiqoftheMany_B3", "TuvasatheSunlit_B3", "Tatyova_B3", "Kykar_B3"]   # bracket 3 pool since 2026-11-25
