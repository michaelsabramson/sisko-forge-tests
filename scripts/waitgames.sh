#!/bin/bash
# Wait up to $1 minutes, returning early once all game processes have finished.
end=$(( $(date +%s) + ${1:-20}*60 ))
while pgrep -f "Run forge" >/dev/null && [ $(date +%s) -lt $end ]; do sleep 15; done
grep -h -c "^G" out/*.log 2>/dev/null | awk "{s+=\$1} END {print s+0, \"games so far\"}" || true
