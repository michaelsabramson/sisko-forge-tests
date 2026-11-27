"""Find combo payoffs among all cards Forge knows: cards that turn an infinite engine into a win.

    python3 scripts/payoffs.py <forge>/forge-gui/res/cardsfolder > decks/payoffs.txt

Reads each card's Oracle text and keeps the ones whose repeatable trigger or ability damages opponents, makes them
lose life or wins the game, by the kind of engine that feeds it:
    death     whenever a creature dies / is sacrificed                 (Blood Artist, Zulaport Cutthroat, Syr Konrad)
    etb       whenever a creature enters                               (Impact Tremors, Purphoros, Corpse Knight)
    artifact  whenever an artifact enters / goes to the graveyard      (Marionette Master/Apprentice, Reckless Fireweaver)
    token     whenever you create or sacrifice a token                  (Mirkwood Bats)
    life      whenever you gain life                                    (Sanguine Bond, Vito, Marauding Blight-Priest)
    draw      whenever you draw a card                                  (Psychosis Crawler, Niv-Mizzet, Parun)
    library   win with an empty library (needs infinite card draw)      (Thassa's Oracle, Laboratory Maniac)
    spell     whenever you cast a spell / magecraft                     (Guttersnipe, Kessig Flamebreather, Aetherflux)
    land      landfall                                                  (Retreat to Hagra-ish, Valakut Exploration...)
    mana      a mana sink that kills with unlimited mana               (Walking Ballista, Exsanguinate, Banefire)
Output, one card per line, tab-separated: name, classes (','), zone (B = must be on the battlefield, H = cast from hand).
"""
import glob, os, re, sys

HURT = re.compile(r"(each opponent loses|target (?:player|opponent) loses|loses \d+ life|deals? (?:\d+|x|that much|damage equal to [^.]*?) damage to "
                  r"(?:each opponent|any target|target (?:player|opponent)|each player|that player|any one target)|each opponent loses|"
                  r"deals? damage equal to [^.]*? to (?:any target|each opponent|target (?:player|opponent))|you win the game|"
                  r"deals? \d+ damage divided)")
TRIGGERS = {
    "death": re.compile(r"whenever (?:this creature or |\w+ or )?(?:another |a |one or more )?(?:other )?(?:nontoken )?creatures? (?:or planeswalkers? )?(?:you control |an opponent controls )?(?:dies|die|is put into a graveyard)|"
                        r"whenever you sacrifice (?:a|another) (?:creature|permanent)"),
    "etb": re.compile(r"whenever (?:another |a |one or more )?(?:other )?(?:nontoken )?creatures? (?:you control )?(?:enters|enter)|^alliance"),
    "artifact": re.compile(r"whenever (?:another |an |one or more )?(?:other )?(?:nontoken )?artifacts? (?:you control )?(?:enters|enter|is put into a graveyard|dies)|"
                           r"whenever another creature or artifact you control is put into a graveyard"),
    "token": re.compile(r"whenever you (?:create|sacrifice|create or sacrifice) (?:a|one or more) tokens?|whenever (?:a|one or more) tokens? you control (?:leaves|leave)"),
    "life": re.compile(r"whenever you gain life"),
    "draw": re.compile(r"whenever you draw (?:a|one or more|your second) cards?"),
    "spell": re.compile(r"whenever you cast (?:a|an|your first)? ?(?:noncreature |instant or sorcery |instant |sorcery )?spell|^magecraft"),
    "land": re.compile(r"^landfall|whenever a land (?:you control )?enters"),
}

def classes(name, oracle, cost=""):
    text = oracle.replace(name, "this").lower()
    found = set()
    for sentence in re.split(r"\\n|\n", text):
        s = sentence.strip()
        if not HURT.search(s):
            continue
        for cls, rx in TRIGGERS.items():
            if rx.search(s):
                found.add(cls)
    low = text
    if re.search(r"(?:your library has no cards|no cards in your library|number of cards in your library)[^.]*you win the game|you win the game[^.]*library", low):
        found.add("library")
    # mana sinks: X damage / life loss spells, and repeatable mana abilities that hurt (no {T} in the cost)
    # X spells and permanents whose X is in their own mana cost (not "X is the number of ...")
    if "X" in (cost or "") and re.search(r"deals? x damage|loses x life|repeat the following process x times|x damage divided", low):
        found.add("mana")
    for line in re.split(r"\\n|\n", low):
        cost = line.split(":")[0] if ":" in line else ""
        # a repeatable ability: a cost of mana only (no tapping, sacrificing, counters...), no once-per-turn limit
        if cost and re.fullmatch(r"(?:\{[0-9wubrgcx/]+\}\s*,?\s*)+", cost.strip()) and "only once" not in line and HURT.search(line):
            found.add("mana")
    # free sacrifice outlets that hurt: with unlimited creatures (an ETB / token engine) they kill
    for line in re.split(r"\\n|\n", low):
        if re.match(r"sacrifice (?:a|another) (?:creature|goblin|token|artifact)[^:]*:", line) and HURT.search(line):
            found.add("artifact" if "artifact" in line.split(":")[0] else "etb")
    if "walking ballista" in name.lower():
        found.add("mana")
    if name == "Aetherflux Reservoir":
        found |= {"spell", "life"}
    return found

def main(folder):
    out = []
    for path in glob.glob(os.path.join(folder, "**", "*.txt"), recursive=True):
        name = oracle = types = cost = None
        for line in open(path, encoding="utf-8", errors="ignore"):
            if line.startswith("Name:") and name is None:
                name = line[5:].strip()
            elif line.startswith("Oracle:") and oracle is None:
                oracle = line[7:].strip()
            elif line.startswith("ManaCost:") and cost is None:
                cost = line[9:].strip()
            elif line.startswith("Types:") and types is None:
                types = line[6:].strip()
        if not name or not oracle:
            continue
        cls = classes(name, oracle, cost)
        if not cls:
            continue
        zone = "H" if types and re.search(r"\b(?:Instant|Sorcery)\b", types) else "B"
        if "library" in cls and "Thassa" in name:
            zone = "H"
        out.append(f"{name}\t{','.join(sorted(cls))}\t{zone}")
    print("\n".join(sorted(set(out))))

main(sys.argv[1])
