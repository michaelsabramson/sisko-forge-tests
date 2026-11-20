#!/bin/bash
# 4 game processes per runner (4 cores). Arms are spread round-robin across all processes in the run,
# so each arm gets an equal share. Each process has its own game range and seed.
set -u
S=$1; MIN=$2
REQ=tests/request.json
BAND=$(jq -r '.band // 0' $REQ)
RUN=($(jq -r '.arms|to_entries[]|select(.value.cached!=true)|.key' $REQ)); N=${#RUN[@]}
SB=$(jq -r '.seedbase // 7000' $REQ)
[ $N -eq 0 ] && exit 0
RES=forge/forge-gui/res; CP="runner-classes:lib/*"
OPP=$(jq -r '(.opponents // ["Atraxa","Prossh","UrDragon","Edgar","Meren"]) | map("decks/"+.+".dck") | join(" ")' $REQ)
mkdir -p out
for p in 0 1 2 3; do
  k=$((S*4+p))
  if [ "$(jq '.procs|length' $REQ)" -gt "$k" ] 2>/dev/null; then i=$(jq -r ".procs[$k]" $REQ); else i=${RUN[$((k % N))]}; fi
  D=$(jq -r ".arms[$i].deck" $REQ); C=$(jq -r ".arms[$i].card" $REQ)
  timeout ${MIN}m java -Xmx3g -XX:+UseParallelGC -Dstart=$((k*1000)) -DforceBand=$BAND "-Dstrat=$D=$C" -cp "$CP" Run $RES 1000 $((SB+k)) 120 nolog decks/$D.dck $OPP > out/arm${i}_${k}.log 2>/dev/null &
done
wait
