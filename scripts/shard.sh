#!/bin/bash
# Runs one process per arm on this runner (4 arms -> 4 processes on a 4-core runner).
# All arms in a shard share the same start index and seed, so game i faces the same opponents/seats in every arm.
set -u
S=$1; MIN=$2
REQ=tests/request.json
BAND=$(jq -r '.band // 0' $REQ); N=$(jq '.arms|length' $REQ)
RES=forge/forge-gui/res; CP="runner-classes:lib/*"
OPP="decks/Atraxa.dck decks/Prossh.dck decks/UrDragon.dck decks/Edgar.dck decks/Meren.dck"
mkdir -p out
for i in $(seq 0 $((N-1))); do
  D=$(jq -r ".arms[$i].deck" $REQ); C=$(jq -r ".arms[$i].card" $REQ)
  timeout ${MIN}m java -Xmx3g -XX:+UseParallelGC -Dstart=$((S*1000)) -DforceBand=$BAND "-Dstrat=$D=$C" -cp "$CP" Run $RES 1000 $((7000+S)) 120 nolog decks/$D.dck $OPP > out/arm${i}_${S}.log 2>/dev/null &
done
wait
grep -c "^G" out/*.log || true
