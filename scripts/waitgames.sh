#!/bin/bash
# Wait up to $1 minutes, returning early once all game processes have finished.
# Runs that stop early (request "checkpoint") save progress more often, so the early read can check sooner.
M=${1:-20}; C=$(jq -r '.checkpoint // empty' tests/request.json 2>/dev/null); [ "$M" -lt 1000 ] && [ -n "$C" ] && M=$C
end=$(( $(date +%s) + M*60 ))
while pgrep -f "Run forge" >/dev/null && [ $(date +%s) -lt $end ]; do sleep 15; done
n=$(grep -h -c "^G" out/*.log 2>/dev/null | awk '{s+=$1} END {print s+0}'); echo "$n games so far"
# no games at all: show why (the game processes' error output)
[ "${n:-0}" = "0" ] && ! pgrep -f "Run forge" >/dev/null && for f in out/*.err; do [ -s "$f" ] && { echo "== $f"; grep -v "^\s*at " "$f" | head -8; }; done 2>/dev/null | head -40
true
