#!/bin/bash
# Profile slow games on one runner: four processes play the friend's token decks on the real settings
# (lookahead on for the tested deck, loop fix, current pool). Two views:
#   - JFR CPU samples over the whole run (out/rec_*.jfr -> out/profile_$S.txt)
#   - stacks of games that have run past 3 minutes: every 20 s, the game thread's stack (out/slow_*.txt)
set -u
S=$1; MIN=$2
RES=forge/forge-gui/res; SEED=$((777000 + S*131))
dk() { for n in "$@"; do [ -f "decks/$n.dck" ] && echo "decks/$n.dck" || echo "decks/ref/$n.dck"; done | tr '\n' ' '; }
OPP=$(dk $(jq -r '.pools["3"].decks[]' decks/lab.json))
DECKS=(Necrobloom Chatterfang); D=${DECKS[$((S % 2))]}
JAVA=java; JX=""; [ -n "${JAVA_HOME_25_X64:-}" ] && { JAVA="$JAVA_HOME_25_X64/bin/java"; JX="-XX:+UseCompactObjectHeaders"; }
JBIN=$(dirname "$(readlink -f "$(command -v $JAVA)")")
mkdir -p out
declare -a PID
for b in 0 1 2 3; do
  timeout ${MIN}m $JAVA -Xmx3g -Xms3g -XX:+UseParallelGC -XX:-DontCompileHugeMethods $JX -XX:FlightRecorderOptions:stackdepth=256 \
    -XX:StartFlightRecording=filename=out/rec_$b.jfr,settings=profile,dumponexit=true \
    -Dsisko.mc=on -Dsisko.oppMc=off -Dsisko.breakLoops=true -Daudit=$D -Dstart=0 -cp "runner-classes:lib-base/*" \
    Run $RES 1000 $((SEED + b*7)) 900 nolog $(dk $D) $OPP > out/g${b}_$S.log 2> out/g${b}_$S.err &
  PID[$b]=$!
done
# watchdog: a game counts as slow once 180 s pass without a finished game (G line) from its process
declare -a LASTN LASTT; for b in 0 1 2 3; do LASTN[$b]=0; LASTT[$b]=$(date +%s); done
while pgrep -f "Run forge" >/dev/null; do
  sleep 20
  for b in 0 1 2 3; do
    n=$(grep -c '^G' out/g${b}_$S.log 2>/dev/null || echo 0)
    if [ "$n" != "${LASTN[$b]}" ]; then LASTN[$b]=$n; LASTT[$b]=$(date +%s); continue; fi
    el=$(( $(date +%s) - ${LASTT[$b]} )); [ $el -lt 180 ] && continue
    jp=$(pgrep -f "Run forge.*$((SEED + b*7)) " | while read p; do [ "$(ps -o comm= -p $p)" = java ] && echo $p; done | head -1)
    [ -z "$jp" ] && continue
    { echo "---- process $b game $((n+1)) at ${el}s"; $JBIN/jcmd $jp Thread.print 2>/dev/null | awk '/^"/{t=$0; keep=0} /forge\.game/{keep=1} {buf[t]=buf[t] $0 "\n"} END{for(k in buf) if (buf[k] ~ /forge\.game/ && buf[k] ~ /RUNNABLE/) {print buf[k]; exit}}'; } >> out/slow_${b}_$S.txt
  done
done
wait
for b in 0 1 2 3; do [ -f out/rec_$b.jfr ] && $JBIN/jfr print --events jdk.ExecutionSample out/rec_$b.jfr; done | python3 scripts/jfrsummary.py > out/profile_$S.txt 2>&1
rm -f out/rec_*.jfr
echo "deck $D: $(cat out/g*_$S.log | grep -c '^G') games; $(cat out/slow_*_$S.txt 2>/dev/null | grep -c '^----') slow-game stacks"
