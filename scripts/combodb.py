"""Reduce Commander Spellbook's full export (variants.json) to what the engine needs: decks/combos_all.json.gz.

Keeps every variant that is legal in Commander and whose pieces are named cards (generic "requires" templates are kept
as text, so combolist.py can decide), with: id, pieces (name, zones, battlefield state, must be commander), mana needed,
prerequisites text, results. Prints how many there are and the shape of the first variant."""
import gzip, json, sys
raw = json.load(open(sys.argv[1]))
variants = raw.get("variants", raw) if isinstance(raw, dict) else raw
print("export keys:", list(raw.keys())[:10] if isinstance(raw, dict) else type(raw), "variants:", len(variants))
print("first variant keys:", list(variants[0].keys()))
out = []
for v in variants:
    legal = v.get("legalities", {})
    if legal and legal.get("commander") is False:
        continue
    if v.get("status") not in (None, "OK", "E", "X"):   # spoilers/drafts/not working
        pass
    out.append({
        "id": v.get("id"),
        "uses": [{"card": u["card"]["name"], "zones": u.get("zoneLocations"), "state": u.get("battlefieldCardState") or "",
                  "commander": u.get("mustBeCommander", False)} for u in v.get("uses", [])],
        "requires": [q.get("template", {}).get("name") for q in v.get("requires", [])],
        "produces": [p.get("feature", {}).get("name") for p in v.get("produces", [])],
        "mana": v.get("manaNeeded") or "", "easy": v.get("easyPrerequisites") or "", "notable": v.get("notablePrerequisites") or "",
        "status": v.get("status"),
    })
json.dump(out, gzip.open("decks/combos_all.json.gz", "wt"), separators=(",", ":"))
import collections
print("kept", len(out), "status", collections.Counter(x["status"] for x in out).most_common(6))
print("top results", collections.Counter(f for x in out for f in x["produces"]).most_common(25))
