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
if [ "$(jq -r '.earlystop // false' $REQ)" = "true" ] && [ -n "${GITHUB_RUN_ID:-}" ]; then
  # early stop: an early read marks the run settled with the ref refs/stop/<run>; poll it over plain git (public repo,
  # outside the API's hourly limit) and tell the game processes to start no new games
  ( sleep 120; while pgrep -f "Run forge" >/dev/null; do
      git ls-remote "https://github.com/${MAIN_REPO:-$GITHUB_REPOSITORY}" "refs/stop/${MAIN_RUN:-$GITHUB_RUN_ID}" 2>/dev/null | grep -q . && { touch out/STOP; echo "$(date -u +%T) stop seen" >> out/claims.log; break; }
      sleep 60
    done ) &
fi
for p in 0 1 2 3; do
  k=$((S*4+p))
  if [ "$(jq '.procs|length' $REQ)" -gt "$k" ] 2>/dev/null; then i=$(jq -r ".procs[$k]" $REQ); else i=${RUN[$((k % N))]}; fi
  D=$(jq -r ".arms[$i].deck" $REQ); C=$(jq -r ".arms[$i].card" $REQ)
  AUD=""; [ "$C" = "@audit" ] && AUD="-Daudit=$D"; [ "$C" = "@usage" ] && AUD="-Daudit=$D -Dusage=1"; [ "$(jq -r ".arms[$i].usage // false" $REQ)" = "true" ] && AUD="-Daudit=$D -Dusage=1"
  # precision-sized runs: this runner's processes on the same arm share one pool of games (quota x processes),
  # so the runner finishes together instead of waiting on whichever process drew the slowest games
  Q=$(jq -r ".quota[$i] // 0" $REQ); POOL=""; B=$(jq -r ".batch[$i] // 0" $REQ 2>/dev/null || echo 0)
  M=0; for q in 0 1 2 3; do kk=$((S*4+q)); [ "$(jq -r ".procs[$kk] // -1" $REQ)" = "$i" ] && M=$((M+1)); done
  if [ "$B" -gt 0 ] 2>/dev/null && [ -n "${GITHUB_RUN_ID:-}" ]; then
    # batches: the runner's processes on this arm share a pool that starts with their first-round games and
    # claims small batches from the whole run as it runs dry
    FIRST=$(jq -r ".first[$i] // 0" $REQ)
    POOL="-Dpool=out/pool_$i -DpoolMax=$((FIRST*M)) -Dbatch=$B -DbatchArm=$i -DbatchRunner=$S"
  elif [ "$Q" -gt 0 ] 2>/dev/null; then
    POOL="-Dpool=out/pool_$i -DpoolMax=$((Q*M))"
  fi
  timeout ${MIN}m java -Xmx3g -XX:+UseParallelGC $AUD $POOL -Dstart=$((k*1000)) -DforceBand=$BAND "-Dstrat=$D=$C" -cp "$CP" Run $RES 1000 $((SB+k)) 120 nolog decks/$D.dck $OPP > out/arm${i}_${k}.log 2>/dev/null &
done
wait
