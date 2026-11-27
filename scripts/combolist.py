"""Turn decks/combos.json (Commander Spellbook) into decks/combos.txt: the game-winning combos the engine can shortcut.

Kept: combos whose result ends the game (infinite damage, life loss, combat phases, turns, ...), whose pieces are all
named cards in zones we can check (battlefield, hand, graveyard, command zone) with no conditions beyond "untapped" /
"without summoning sickness", and with no generic requirements ("any sacrifice outlet"), which can't be checked by
name. Combos that only make infinite mana or tokens aren't wins on their own; Spellbook lists the versions with a
payoff (Zulaport Cutthroat, Blood Artist, ...) as combos of their own, and those are kept.

Format, one combo per line, tab-separated: id, result, mana cost ({W}{U}... symbols only), pieces (name@zones[!flags]
joined by ';', zones from B H G C, flags: u = untapped, s = no summoning sickness), hate cards (';'), description of
the result, prerequisites (';'-joined checks from Spellbook's prerequisite text: sick:names, life:N, opp:N, extra:N,
combat, power:N, attach:A>B, colors:XY, islands:N, islandsany:N, count10:kinds)."""
import json, re

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

c = json.load(open("decks/combos.json"))
seen = {}
for deck, combos in c.items():
    for v in combos:
        if v["id"] in seen: continue
        win = [f for f in v["produces"] if f in WINS]
        if not win or v["requires"]: continue
        pieces = []; ok = True
        for u in v["uses"]:
            zones = [z for z in (u["zones"] or []) if z in "BHGC"]
            st = (u["battlefieldState"] or "").strip()
            if not zones or st not in ("", "untapped", "without summoning sickness"): ok = False; break
            flags = ("s" if st == "without summoning sickness" else "")
            pieces.append(u["card"].split(" // ")[0] + "@" + "".join(zones) + ("!" + flags if flags else ""))
        if not ok: continue
        feats = " ".join(v["produces"]).lower()
        hate = HATE["life"] + (HATE["etb"] if "etb" in feats else []) + (HATE["grave"] if "death" in feats or "graveyard" in feats else [])
        mana = "".join(re.findall(r"\{[^}]+\}", (v["manaNeeded"] or "").split(" plus")[0].split(",")[0]))
        req = prereqs(v, pieces)
        if req is None: continue
        if req.get("mana"): mana = mana or req.pop("mana")
        req.pop("mana", None)
        seen[v["id"]] = "\t".join([v["id"], win[0], mana, ";".join(pieces), ";".join(hate), ", ".join(v["produces"][:6]),
                                    ";".join(f"{k}:{x}" if x is not True else k for k, x in req.items())])
open("decks/combos.txt", "w").write("\n".join(sorted(seen.values())) + "\n")
print(len(seen), "combos kept")
for l in sorted(seen.values()): print(" ", l.split("\t")[1], "|", l.split("\t")[3], "|", l.split("\t")[2])
