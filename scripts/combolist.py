"""Turn Commander Spellbook's database (decks/combos_all.json.gz, scripts/combodb.py) into decks/combos.txt.gz: the game-winning combos the engine can shortcut.

Kept: combos whose result ends the game (infinite damage, life loss, combat phases, turns, ...), whose pieces are all
named cards in zones we can check (battlefield, hand, graveyard, command zone) with no conditions beyond "untapped" /
"without summoning sickness", and with no generic requirements ("any sacrifice outlet"), which can't be checked by
name. Combos that only make infinite mana or tokens aren't wins on their own; Spellbook lists the versions with a
payoff (Zulaport Cutthroat, Blood Artist, ...) as combos of their own, and those are kept.

Format, one combo per line, tab-separated: id, result, mana cost ({W}{U}... symbols only), pieces (name@zones[!flags]
joined by ';', zones from B H G C, flags: u = untapped, s = no summoning sickness), hate cards (';'), description of
the result, prerequisites (';'-joined checks from Spellbook's prerequisite text: sick:names, life:N, opp:N, extra:N,
combat, power:N, attach:A>B, colors:XY, islands:N, islandsany:N, count10:kinds)."""
import collections, json, re

WINS = ["Infinite damage", "Near-infinite damage", "Infinite lifeloss", "Near-infinite lifeloss", "Infinite combat phases",
        "Near-infinite combat phases", "Near-infinite combat damage", "Infinite turns", "Win the game at the beginning of your next upkeep"]
# cards that stop a kind of loop (checked on the opponents' side): creatures entering, dying/graveyard, activated abilities
HATE = {
    "etb": ["Torpor Orb", "Hushbringer", "Hushwing Gryff", "Tocatli Honor Guard", "Elesh Norn, Mother of Machines"],
    "grave": ["Rest in Peace", "Leyline of the Void", "Grafdigger's Cage", "Kaya's Ghostform"],
    "activated": ["Null Rod", "Collector Ouphe", "Cursed Totem", "Linvala, Keeper of Silence", "Karn, the Great Creator", "Pithing Needle"],
    "life": ["Platinum Angel", "Angel's Grace", "Teferi's Protection", "Tainted Remedy", "Rain of Gore", "Erebos, God of the Dead"],
}
def prereqs(v, pieces):
    """The combo's stated prerequisites (Commander Spellbook text) as checks the engine understands; None = drop it."""
    text = (v.get("easyPrerequisites") or "") + "\n" + (v.get("notablePrerequisites") or "")
    req = {}
    names = [p.split("@")[0] for p in pieces]
    for sent in re.split(r"\n|(?<=\.)\s", text):
        t = sent.strip()
        if not t: continue
        low = t.lower()
        sym = re.findall(r"\{[WUBRGC0-9]\}", t)
        if sym and ("produce" in low or "tapping for" in low or "tap for" in low): req["mana"] = "".join(sym)
        if "summoning sickness" in low:
            if low.startswith("all creatures"): req["sick"] = ",".join(names)
            else:
                hit = [n for n in names if n.split(",")[0].split(" ")[0].lower() in low]
                req["sick"] = ",".join(sorted(set(req.get("sick", "").split(",") + hit) - {""}))
        m = re.search(r"life total is (?:at least )?(\d+)", low)
        if m: req["life"] = int(m.group(1))
        if "three or more opponents" in low: req["opp"] = 3
        m = re.search(r"(one|two|three|four|five) additional (?:nontoken )?(?:non-human )?creature", low)
        if m: req["extra"] = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5}[m.group(1)]
        if "additional goblin" in low: req["extra"] = max(req.get("extra", 0), 1)
        if re.search(r"can ?not block|cannot block|unable to block|cannot be blocked|unblocked combat damage", low): req["combat"] = True
        m = re.search(r"total power (\w+) or greater", low)
        if m: req["power"] = {"ten": 10}.get(m.group(1), 10); req["combat"] = True
        m = re.match(r"(.+?) attached to (.+?)\.?$", t)
        if m and "you control" not in low:
            a = m.group(1).strip(); b = m.group(2).strip()
            bb = [n for n in names if n.split(",")[0] == b or n == b]
            req["attach"] = a + ">" + (bb[0] if bb else b)
        m = re.search(r"you control an? (white|blue|black|red|green) and an? (white|blue|black|red|green) permanent", low)
        if m: req["colors"] = "".join({"white": "W", "blue": "U", "black": "B", "red": "R", "green": "G"}[c] for c in m.groups())
        m = re.search(r"at least (\w+) islands between", low)
        if m: req["islandsany"] = {"three": 3, "four": 4}.get(m.group(1), 3)
        elif (m := re.search(r"you control at least (\w+) islands", low)): req["islands"] = {"three": 3, "four": 4}.get(m.group(1), 4)
        if "ten in any combination of lands and/or treasure" in low: req["count10"] = "land+treasure"
        if "ten in any combination of treasures and/or creatures" in low: req["count10"] = "treasure+creature"
    return req

import gzip, sys
src = sys.argv[1] if len(sys.argv) > 1 else "decks/combos_all.json.gz"
c = json.load(gzip.open(src, "rt")) if src.endswith(".gz") else [v for d in json.load(open(src)).values() for v in d]

# results that end the game for every opponent, or for one of them
WINS_ALL = set(WINS) | {"Infinite combat damage", "Each opponent loses the game", "Win the game", "Near-infinite turns",
                        "Infinite mill", "Near-infinite mill", "Infinite creature tokens with haste", "Near-infinite creature tokens with haste"}
WINS_ONE = {"Target opponent loses the game", "Infinite damage to one opponent", "Near-infinite damage to one opponent",
            "Infinite lifeloss for target opponent", "Near-infinite lifeloss for target opponent", "Infinite mill for target opponent"}
# what an engine (a combo that doesn't win by itself) feeds: matched with payoffs (decks/payoffs.txt) in the same deck
ENGINE = [("death", r"(?:infinite|near-infinite) (?:death triggers|creature sacrifice triggers)"),
          ("etb", r"(?:infinite|near-infinite) (?:creature etb|(?:tapped )?creature tokens)"),
          ("artifact", r"(?:infinite|near-infinite) (?:artifact etb|artifact ltb|artifact sacrifice triggers|(?:tapped )?(?:artifact|treasure|food|clue|blood) tokens)"),
          ("token", r"(?:infinite|near-infinite) (?:tapped )?\w* ?tokens"),
          ("life", r"(?:infinite|near-infinite) lifegain"),
          ("draw", r"(?:infinite|near-infinite) (?:card draw|draw triggers)$"),
          ("library", r"(?:infinite|near-infinite) card draw$"),
          ("spell", r"(?:infinite|near-infinite) (?:storm count|magecraft triggers|commander casts)"),
          ("land", r"(?:infinite|near-infinite) landfall triggers"),
          ("mana", r"(?:infinite|near-infinite) (?:\w+ )?mana(?: .*can produce)?$")]
# generic pieces ("requires" templates) the engine can check: template -> predicate key
TEMPLATES = {"Persist Creature": "kw:Persist", "Creature with Undying": "kw:Undying", "Undying Creature": "kw:Undying",
             "Creature with Persist or Undying": "kw:Persist|Undying", "Zombie Creature": "type:Zombie", "Changeling Creature": "kw:Changeling",
             "Dinosaur": "type:Dinosaur", "Hero Creature": "type:Hero", "Knight Creature with MV<=3": "type:Knight,mv<=3",
             "Artifact Castable for {0} that survives": "artifact,mv=0", "Artifact Castable for Exactly {1}": "artifact,mv=1",
             "Noncreature Artifact with MV<=1": "noncreatureartifact,mv<=1", "Creature Castable for One Colored Mana": "creature,mv=1,colored",
             "Creature castable for {0} that survives": "creature,mv=0", "Zombie Creature castable for one colored mana": "type:Zombie,mv=1,colored",
             "Goblin, Orc or Army Creature Castable for One Colored Mana": "type:Goblin|Orc|Army,mv=1,colored"}

def kind(v):
    p = v["produces"]
    if any(f in WINS_ALL for f in p): return "win", [f for f in p if f in WINS_ALL][0]
    if any(f in WINS_ONE for f in p): return "one", [f for f in p if f in WINS_ONE][0]
    cls = sorted({k for k, rx in ENGINE for f in p if re.search(rx, f.lower())})
    if cls: return "engine:" + ",".join(cls), "Engine (" + ", ".join(p[:3]) + ")"
    return None, None

seen = {}; counts = collections.Counter()
for v in c:
    if v["id"] in seen: continue
    k, label = kind(v)
    if not k: continue
    pieces = []; ok = True
    for u in v["uses"]:
        zones = [z for z in (u.get("zones") or []) if z in "BHGC"]
        st = (u.get("state") if "state" in u else u.get("battlefieldState") or "").strip()
        if not zones or st not in ("", "untapped", "without summoning sickness"): ok = False; break
        flags = ("s" if st == "without summoning sickness" else "")
        pieces.append(u["card"].split(" // ")[0] + "@" + "".join(zones) + ("!" + flags if flags else ""))
    for t in v["requires"]:
        if t not in TEMPLATES: ok = False; break
        pieces.append("#" + TEMPLATES[t] + "@B")
    if not ok or not pieces: counts["skipped"] += 1; continue
    feats = " ".join(v["produces"]).lower()
    hate = HATE["life"] + (HATE["etb"] if "etb" in feats else []) + (HATE["grave"] if "death" in feats or "graveyard" in feats else [])
    v2 = {"easyPrerequisites": v.get("easy", v.get("easyPrerequisites", "")), "notablePrerequisites": v.get("notable", v.get("notablePrerequisites", ""))}
    req = prereqs(v2, pieces)
    if req is None: counts["skipped"] += 1; continue
    mana = "".join(re.findall(r"\{[^}]+\}", (v.get("mana", v.get("manaNeeded")) or "").split(" plus")[0].split(",")[0]))
    if req.get("mana"): mana = mana or req["mana"]
    req.pop("mana", None)
    seen[v["id"]] = "\t".join([v["id"], label, mana, ";".join(pieces), ";".join(hate), ", ".join(v["produces"][:5]),
                                ";".join(f"{a}:{b}" if b is not True else a for a, b in req.items()), k])
    counts[k.split(":")[0]] += 1
gzip.open("decks/combos.txt.gz", "wt").write("\n".join(sorted(seen.values())) + "\n")
print(len(seen), "combos kept", dict(counts))
