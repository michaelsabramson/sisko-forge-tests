#!/bin/bash
# Engine A/B bench on one runner: four game processes play the SAME games (same seeds, same decks) side by side.
#   b0 = current engine            b1 = current engine again (control: shows how deterministic replays are)
#   b2 = candidate engine (bench/candidate.patch) with JVM options $CAND_FLAGS   b3 = candidate engine with $FLAG3
#   decks: $BENCH_DECKS (tested decks, one per runner in turn) against the current bracket 3 pool
# scripts in bench/compare.py line the games up by number and compare outcomes and time per game.
set -u
S=$1; MIN=$2; FLAG3=${3:-}
RES=forge/forge-gui/res; SEED=$((424242 + S*97))
dk() { for n in "$@"; do [ -f "decks/$n.dck" ] && echo "decks/$n.dck" || echo "decks/ref/$n.dck"; done | tr '\n' ' '; }
OPP=$(dk $(jq -r '.pools["3"].decks[]' decks/lab.json))
DECKS=(${BENCH_DECKS:-SiskoFinal Ironman NorinB3 Kess})
D=${DECKS[$((S % ${#DECKS[@]}))]}
JAVA=java; JX=""; [ -n "${JAVA_HOME_25_X64:-}" ] && { JAVA="$JAVA_HOME_25_X64/bin/java"; JX="-XX:+UseCompactObjectHeaders"; }
mkdir -p out
for b in 0 1 2 3; do
  CP="runner-classes:lib-base/*"; X=""
  [ $b -eq 1 ] && X="${FLAG1:-}"
  [ $b -eq 2 ] && { CP="runner-classes:lib-cand/*"; X="${CAND_FLAGS:-}"; }
  [ $b -eq 3 ] && { CP="runner-classes:lib-cand/*"; X="$FLAG3"; }
  timeout ${MIN}m $JAVA -Xmx3g -Xms3g -XX:+UseParallelGC -XX:-DontCompileHugeMethods -Dsisko.breakLoops=true $JX -Dsisko.mc=off -Dsisko.oppMc=off $X -Daudit=$D \
    -Dstart=0 -cp "$CP" Run $RES 1000 $SEED 900 nolog $(dk $D) $OPP > out/b${b}_$S.log 2> out/b${b}_$S.err &
done
wait
echo "$(grep -c '^G' out/b0_$S.log) $(grep -c '^G' out/b1_$S.log) $(grep -c '^G' out/b2_$S.log) $(grep -c '^G' out/b3_$S.log) games (b0 b1 b2 b3), deck $D"
