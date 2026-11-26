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
  ( sleep 120; while pgrep -f "Run forge" >/dev/null; do
      git ls-remote "https://github.com/${MAIN_REPO:-$GITHUB_REPOSITORY}" "refs/stop/${MAIN_RUN:-$GITHUB_RUN_ID}" 2>/dev/null | grep -q . && { touch out/STOP; echo "$(date -u +%T) stop seen" >> out/claims.log; break; }
      sleep 60
    done ) &
fi
if [ -n "${MAIN_RUN:-}" ]; then
  # helper runners (another account): a cancelled or finished main run doesn't reach them, so check it every 2 minutes
  # and quit when it's over (the main run's results no longer need these games)
  ( sleep 120; while pgrep -f "Run forge" >/dev/null; do
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
for p in 0 1 2 3; do
  k=$((S*4+p))
  if [ "$(jq '.procs|length' $REQ)" -gt "$k" ] 2>/dev/null; then i=$(jq -r ".procs[$k]" $REQ); else i=${RUN[$((k % N))]}; fi
  D=$(jq -r ".arms[$i].deck" $REQ); C=$(jq -r ".arms[$i].card" $REQ)
  PROF=$(jq -r ".arms[$i].profile // .profile // \"Default\"" $REQ); OPROF=$(jq -r ".opp_profile // \"Default\"" $REQ); MC=$(jq -r ".arms[$i].mc // .mc // \"off\"" $REQ); OMC=$(jq -r ".opp_mc // \"off\"" $REQ)
  AO=$OPP; [ -n "$(jq -r ".arms[$i].opponents // empty | length" $REQ)" ] && AO=$(dk $(jq -r ".arms[$i].opponents[]" $REQ))   # per-deck opponents (ladder)   # tested deck's AI settings (forge-gui/res/ai/<profile>.ai)
  AUD="-Daudit=$D"; [ "$(jq -r '.mode // "swap"' $REQ)" = "package" ] && AUD="";   # opening cards logged for the Rank (package games force a rotating card)
  JX=""; [ "$(jq -r ".arms[$i].jvm // .jvm // empty" $REQ)" = "gc1" ] && JX="-XX:ParallelGCThreads=1"   # one GC thread per game process
  # CPU profile (request "profile_jfr"): the first runner's first two processes record 10 minutes, after a 3-minute warm-up
  [ "$(jq -r '.profile_jfr // false' $REQ)" = "true" ] && [ "$S" = "0" ] && [ $p -lt 2 ] && JX="$JX -XX:StartFlightRecording=delay=3m,duration=10m,filename=out/rec_$k.jfr,settings=profile"
  [ "$C" = "@audit" ] && AUD="-Daudit=$D"; [ "$C" = "@usage" ] && AUD="-Daudit=$D -Dusage=1"; [ "$(jq -r ".arms[$i].usage // false" $REQ)" = "true" ] && AUD="-Daudit=$D -Dusage=1"
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
  timeout ${MIN}m java -Xmx3g -XX:+UseParallelGC $JX -Dsisko.profile=$PROF -Dsisko.oppProfile=$OPROF -Dsisko.mc=$MC -Dsisko.oppMc=$OMC -DroundCap=$RC $PLAN $FULL $AUD $POOL -Dstart=$((k*1000)) -DforceBand=$BAND "-Dstrat=$D=$C" -cp "$CP" Run $RES 1000 $((SB+k)) $GT nolog $(dk $D) $AO > out/arm${i}_${k}.log 2>out/arm${i}_${k}.err &
done
touch out/started
wait
if ls out/rec_*.jfr >/dev/null 2>&1; then
  for r in out/rec_*.jfr; do "${JAVA_HOME:+$JAVA_HOME/bin/}jfr" print --events jdk.ExecutionSample "$r"; done | python3 scripts/jfrsummary.py > out/profile.txt 2>&1
fi
touch out/profile.done
