"""Turn decks/combos.json (Commander Spellbook) into decks/combos.txt: the game-winning combos the engine can shortcut.

Kept: combos whose result ends the game (infinite damage, life loss, combat phases, turns, ...), whose pieces are all
named cards in zones we can check (battlefield, hand, graveyard, command zone) with no conditions beyond "untapped" /
"without summoning sickness", and with no generic requirements ("any sacrifice outlet"), which can't be checked by
name. Combos that only make infinite mana or tokens aren't wins on their own; Spellbook lists the versions with a
payoff (Zulaport Cutthroat, Blood Artist, ...) as combos of their own, and those are kept.

Format, one combo per line, tab-separated: id, result, mana cost ({W}{U}... symbols only), pieces (name@zones[!flags]
joined by ';', zones from B H G C, flags: u = untapped, s = no summoning sickness), hate cards (';'), description of
the result."""
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
        seen[v["id"]] = "\t".join([v["id"], win[0], mana, ";".join(pieces), ";".join(hate), ", ".join(v["produces"][:6])])
open("decks/combos.txt", "w").write("\n".join(sorted(seen.values())) + "\n")
print(len(seen), "combos kept")
for l in sorted(seen.values()): print(" ", l.split("\t")[1], "|", l.split("\t")[3], "|", l.split("\t")[2])
