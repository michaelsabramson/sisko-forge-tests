#!/bin/bash
# runs 4 processes on one runner: 2 for list A, 2 for list B, paired by game index
set -u
S=$1; MIN=$2
REQ=tests/request.json
A=$(jq -r .deckA $REQ); B=$(jq -r .deckB $REQ); CA=$(jq -r .cardA $REQ); CB=$(jq -r .cardB $REQ); BAND=$(jq -r '.band // 0' $REQ)
RES=forge/forge-gui/res; CP="runner-classes:lib/*"
OPP="decks/Atraxa.dck decks/Prossh.dck decks/UrDragon.dck decks/Edgar.dck decks/Meren.dck"
mkdir -p out
for p in 0 1; do
  start=$(( (S*2+p)*1000 ))
  timeout ${MIN}m java -Xmx3g -Dstart=$start -DforceBand=$BAND "-Dstrat=$A=$CA;$B=$CB" -cp "$CP" Run $RES 1000 $((7000+S)) 120 nolog decks/$A.dck $OPP > out/A_${S}_${p}.log 2>/dev/null &
  timeout ${MIN}m java -Xmx3g -Dstart=$start -DforceBand=$BAND "-Dstrat=$A=$CA;$B=$CB" -cp "$CP" Run $RES 1000 $((7000+S)) 120 nolog decks/$B.dck $OPP > out/B_${S}_${p}.log 2>/dev/null &
done
wait
grep -c "^G" out/*.log || true
