"""Look up every deck's combos on Commander Spellbook (find-my-combos) and save them to decks/combos.json.

Runs in GitHub Actions (the workspace can't reach the site). For each deck: the combos fully contained in it
("included"), with their pieces (and where each must be), what they need (mana, other requirements) and what they
produce. Combo logic in the engine reads this file."""
import glob, json, re, sys, urllib.request

def cards(path):
    out = {"commanders": [], "main": []}; sec = None
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if line.startswith("["): sec = line.strip("[]").lower(); continue
        m = re.match(r"^(\d+)\s+(.+)$", line)
        if m and sec in ("main", "commander"):
            name = m.group(2).split("|")[0].strip()
            (out["commanders"] if sec == "commander" else out["main"]).append({"card": name, "quantity": int(m.group(1))})
    return out

def post(body):
    req = urllib.request.Request("https://backend.commanderspellbook.com/find-my-combos?limit=200",
                                 data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "Accept": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=60))

result = {}
paths = sorted(glob.glob("decks/*.dck") + glob.glob("decks/ref/*.dck"))
for path in paths:
    deck = path.split("/")[-1][:-4]
    try:
        r = post(cards(path))
    except Exception as e:
        print(f"{deck}: lookup failed: {e}"); continue
    res = r.get("results", r)
    if deck == "SiskoFinal":
        print("RESPONSE KEYS", list(r.keys()), list(res.keys()) if isinstance(res, dict) else type(res))
    inc = res.get("included", []) if isinstance(res, dict) else []
    combos = []
    for v in inc:
        combos.append({
            "id": v.get("id"),
            "uses": [{"card": u["card"]["name"], "zones": u.get("zoneLocations"), "battlefieldState": u.get("battlefieldCardState"),
                      "mustBeCommander": u.get("mustBeCommander")} for u in v.get("uses", [])],
            "requires": [q.get("template", {}).get("name") for q in v.get("requires", [])],
            "produces": [p.get("feature", {}).get("name") for p in v.get("produces", [])],
            "manaNeeded": v.get("manaNeeded"), "easyPrerequisites": v.get("easyPrerequisites"),
            "notablePrerequisites": v.get("notablePrerequisites"), "description": v.get("description"),
            "bracketTag": v.get("bracketTag"),
        })
    result[deck] = combos
    print(f"{deck}: {len(combos)} combos" + "".join(f"\n   - {' + '.join(u['card'] for u in c['uses'])} -> {', '.join(c['produces'][:4])}" for c in combos[:12]))
json.dump(result, open("decks/combos.json", "w"), indent=1)
