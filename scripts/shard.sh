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
# a deck name resolves to decks/<name>.dck, or decks/ref/<name>.dck for reference decks (power ladder)
dk() { for n in "$@"; do [ -f "decks/$n.dck" ] && echo "decks/$n.dck" || echo "decks/ref/$n.dck"; done | tr '\n' ' '; }
OPP=$(dk $(jq -r '(.opponents // ["Atraxa","Prossh","UrDragon","Edgar","Meren"])[]' $REQ))
FULL=""; [ "$(jq -r '.full // false' $REQ)" = "true" ] && FULL="-Dfull=true"
mkdir -p out
if [ "$(jq -r '.earlystop // false' $REQ)" = "true" ] && [ -n "${GITHUB_RUN_ID:-}" ]; then
  # early stop: an early read marks the run settled with the ref refs/stop/<run>; poll it over plain git (public repo,
  # outside the API's hourly limit) and tell the game processes to start no new games
  ( sleep 120; while [ ! -f out/shard.done ]; do
      git ls-remote "https://github.com/${MAIN_REPO:-$GITHUB_REPOSITORY}" "refs/stop/${MAIN_RUN:-$GITHUB_RUN_ID}" 2>/dev/null | grep -q . && { touch out/STOP; echo "$(date -u +%T) stop seen" >> out/claims.log; break; }
      sleep 60
    done ) &
fi
if [ -n "${MAIN_RUN:-}" ]; then
  # helper runners (another account): a cancelled or finished main run doesn't reach them, so check it every 2 minutes
  # and quit when it's over (the main run's results no longer need these games)
  ( sleep 120; while [ ! -f out/shard.done ]; do
      st=$(curl -fsS -H "Authorization: Bearer ${GH_TOKEN:-}" "https://api.github.com/repos/${MAIN_REPO}/actions/runs/${MAIN_RUN}" 2>/dev/null | jq -r '.status // empty')
      [ "$st" = "completed" ] && { touch out/STOP; pkill -f "Run forge"; echo "$(date -u +%T) main run over: stopped" >> out/claims.log; break; }
      sleep 120
    done ) &
fi
GT=$(jq -r '.game_timeout // 120' $REQ)   # seconds of real time before Forge cuts a game off (a "stall")
RC=$(jq -r '.round_cap // 0' $REQ)        # rounds before an unfinished game ends as a draw (0 = none)
PLAN=""
if [ "$(jq -r '.adaptive // false' $REQ)" = "true" ] && [ -n "${GITHUB_RUN_ID:-}" ]; then
  # adaptive Rank: the run's early reads publish plans/<run>.json (which cards to force, how often); keep a local copy
  # the game processes read before each game. No plan yet = normal shuffled games.
  PLAN="-Dplan=$PWD/out/plan.txt"; R=${MAIN_RUN:-$GITHUB_RUN_ID}
  ( while true; do
      if git fetch -q --depth=1 "https://github.com/${MAIN_REPO:-$GITHUB_REPOSITORY}" main 2>/dev/null &&
         git show "FETCH_HEAD:plans/$R.json" 2>/dev/null | jq -r '.weights|to_entries[]|"\(.value)\t\(.key)"' > out/plan.tmp 2>/dev/null &&
         [ -s out/plan.tmp ]; then
        cmp -s out/plan.tmp out/plan.txt || { mv out/plan.tmp out/plan.txt; echo "$(date -u +%T) plan $(tr '\n' ' ' < out/plan.txt)" >> out/claims.log; }
      fi
      pgrep -f "Run forge" >/dev/null || [ ! -f out/started ] || break
      sleep 90
    done ) &
fi
start_proc() {   # slot, arm, generation (0 = the run's first assignment; 1+ = a refill after the slot's own arm ran out)
  local p=$1 i=$2 gen=$3; k=$((S*4+p))
  D=$(jq -r ".arms[$i].deck" $REQ); C=$(jq -r ".arms[$i].card" $REQ)
  PROF=$(jq -r ".arms[$i].profile // .profile // \"Default\"" $REQ); OPROF=$(jq -r ".opp_profile // \"Default\"" $REQ); MC=$(jq -r ".arms[$i].mc // .mc // \"off\"" $REQ); OMC=$(jq -r ".opp_mc // \"off\"" $REQ)
  AO=$OPP; [ -n "$(jq -r ".arms[$i].opponents // empty | length" $REQ)" ] && AO=$(dk $(jq -r ".arms[$i].opponents[]" $REQ))   # per-deck opponents (ladder)   # tested deck's AI settings (forge-gui/res/ai/<profile>.ai)
  AUD="-Daudit=$D"; [ "$(jq -r '.mode // "swap"' $REQ)" = "package" ] && AUD="";   # opening cards logged for the Rank (package games force a rotating card)
  # speed variants ("jvm", comma-separated): gc1 = one GC thread per process, xms = start at full heap, j25 = Java 25 with
  # compact object headers, nolog = skip game-log formatting (forge.patch), p3 = 3 game processes on this runner
  # default j25,xms (speed test 2026-11-26: about +6% each vs plain Java 21); "base" runs plain Java 21
  # -XX:-DontCompileHugeMethods (always): lets Java compile Forge's huge rules methods (CardProperty.cardHasProperty is
  # far past the size Java otherwise leaves interpreted); engine bench 2026-11-26: 14% more games, outcomes unchanged
  JV=",$(jq -r ".arms[$i].jvm // .jvm // \"j25,xms\"" $REQ),"; JX=""; JAVA=java
  case $JV in *,gc1,*) JX="$JX -XX:ParallelGCThreads=1";; esac
  case $JV in *,xms,*) JX="$JX -Xms3g";; esac
  case $JV in *,nolog,*) JX="$JX -Dsisko.nolog=true";; esac
  case $JV in *,j25,*) [ -n "${JAVA_HOME_25_X64:-}" ] && { JAVA="$JAVA_HOME_25_X64/bin/java"; JX="$JX -XX:+UseCompactObjectHeaders"; };; esac
  case $JV in *,p3,*) [ $p -eq 3 ] && [ $gen -eq 0 ] && return 1;; esac
  # CPU profile (request "profile_jfr"): the first runner's first two processes record 10 minutes, after a 3-minute warm-up
  [ "$(jq -r '.profile_jfr // false' $REQ)" = "true" ] && [ "$S" = "0" ] && [ $p -lt 2 ] && [ $gen -eq 0 ] && JX="$JX -XX:StartFlightRecording=delay=3m,duration=10m,filename=out/rec_$k.jfr,settings=profile"
  [ "$C" = "@audit" ] && AUD="-Daudit=$D"; [ "$C" = "@usage" ] && AUD="-Daudit=$D -Dusage=1"; [ "$(jq -r ".arms[$i].usage // false" $REQ)" = "true" ] && AUD="-Daudit=$D -Dusage=1"
  # precision-sized runs: this runner's processes on the same arm share one pool of games (quota x processes),
  # so the runner finishes together instead of waiting on whichever process drew the slowest games
  Q=$(jq -r ".quota[$i] // 0" $REQ); POOL=""; B=$(jq -r ".batch[$i] // 0" $REQ 2>/dev/null || echo 0)
  M=0; for q in 0 1 2 3; do kk=$((S*4+q)); [ "$(jq -r ".procs[$kk] // -1" $REQ)" = "$i" ] && M=$((M+1)); done
  LOGN=arm${i}_${k}; SEED=$((SB+k)); TO=${MIN}m
  if [ $gen -gt 0 ]; then
    # refill: a fresh pool holding the batch just claimed for arm i, claiming more of arm i's batches as it runs dry;
    # its own seeds and log, and only the minutes the run has left
    LOGN=arm${i}_${k}r$gen; SEED=$((SB+k+100000*gen)); TO=$(( END - $(date +%s) ))s
    POOL="-Dpool=out/pool_${i}_r${p}_$gen -DpoolMax=$B -Dbatch=$B -DbatchArm=$i -DbatchRunner=$S"
  elif [ "$B" -gt 0 ] 2>/dev/null && [ -n "${GITHUB_RUN_ID:-}" ]; then
    # batches: the runner's processes on this arm share a pool that starts with their first-round games and
    # claims small batches from the whole run as it runs dry
    FIRST=$(jq -r ".first[$i] // 0" $REQ)
    POOL="-Dpool=out/pool_$i -DpoolMax=$((FIRST*M)) -Dbatch=$B -DbatchArm=$i -DbatchRunner=$S"
  elif [ "$Q" -gt 0 ] 2>/dev/null; then
    POOL="-Dpool=out/pool_$i -DpoolMax=$((Q*M))"
  fi
  timeout $TO $JAVA -Xmx3g -XX:+UseParallelGC -XX:-DontCompileHugeMethods $JX -Dsisko.profile=$PROF -Dsisko.oppProfile=$OPROF -Dsisko.mc=$MC -Dsisko.oppMc=$OMC -DroundCap=$RC $PLAN $FULL $AUD $POOL -Dstart=$((k*1000)) -DforceBand=$BAND "-Dstrat=$D=$C" -cp "$CP" Run $RES 1000 $SEED $GT nolog $(dk $D) $AO > out/$LOGN.log 2>out/$LOGN.err &
  PID[$p]=$!
}
declare -a PID; END=$(( $(date +%s) + MIN*60 ))
for p in 0 1 2 3; do
  k=$((S*4+p))
  if [ "$(jq '.procs|length' $REQ)" -gt "$k" ] 2>/dev/null; then i=$(jq -r ".procs[$k]" $REQ); else i=${RUN[$((k % N))]}; fi
  start_proc $p $i 0
done
touch out/started
# refill (batched runs): a process that has run out of its own arm's games takes a batch from another arm that still has
# unclaimed batches, so runners on a fast arm don't sit idle while a slow arm finishes. Speed experiments
# ("refill": false) keep each runner on its own arm.
NA=$(jq '.arms|length' $REQ)
if [ "$(jq -r '.refill // true' $REQ)" = "true" ] && [ -n "${GITHUB_RUN_ID:-}" ] && [ "$(jq '[.batches // [] | .[] | select(. > 0)] | length' $REQ)" -gt 0 ]; then
  gen=0
  while :; do
    busy=0
    for p in 0 1 2 3; do
      [ -z "${PID[$p]:-}" ] && continue
      kill -0 "${PID[$p]}" 2>/dev/null && { busy=1; continue; }
      PID[$p]=""
      [ -f out/STOP ] && continue
      [ $(( END - $(date +%s) )) -lt 240 ] && continue
      for d in $(seq 0 $((NA-1))); do
        j=$(( (S + p + d) % NA ))
        [ "$(jq -r ".batches[$j] // 0" $REQ)" -gt 0 ] 2>/dev/null || continue
        [ "$(jq -r ".arms[$j].cached // false" $REQ)" = "true" ] && continue
        [ -f out/.done_$j ] && continue
        if [ "$(scripts/claimbatch.sh $j $S | tail -1)" = "1" ]; then
          gen=$((gen+1)); echo "$(date -u +%T) slot $p refilled with arm $j" >> out/claims.log
          start_proc $p $j $gen && busy=1; break
        else touch out/.done_$j; fi
      done
    done
    [ $busy -eq 0 ] && break
    sleep 15
  done
fi
wait
if ls out/rec_*.jfr >/dev/null 2>&1; then
  for r in out/rec_*.jfr; do "${JAVA_HOME:+$JAVA_HOME/bin/}jfr" print --events jdk.ExecutionSample "$r"; done | python3 scripts/jfrsummary.py > out/profile.txt 2>&1
fi
touch out/profile.done
touch out/shard.done
