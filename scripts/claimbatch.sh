#!/bin/bash
# Claim one more batch of games for arm $1 on runner $2. Prints 1 if this runner may play another batch, 0 when none are left.
#
# Each runner starts with a first round of games handed out by the dispatcher (no claim needed). The rest of the
# games are split into small numbered batches, claimed here by creating the ref refs/batches/<run>/<arm>-<n> through
# the GitHub API. Creating a ref is all-or-nothing, so if two runners try for the same batch exactly one succeeds.
# A runner first takes its own batches (n = runner, runner + shards, ...), then unclaimed ones from the end of the
# list, which belong to slower runners, so owners and helpers rarely collide.
# GitHub limits bursts of writes, so claims are spread out with a small random delay, and a "slow down" answer
# (secondary rate limit) is waited out and retried. If the API keeps failing, a runner plays its own batches anyway:
# never worse than a fixed share.
A=$1; S=$2; REQ=tests/request.json
NB=$(jq -r ".batches[$A] // 0" $REQ); SH=$(jq -r '.shards // 38' $REQ)
R=${GITHUB_REPOSITORY:?}; RUN=${GITHUB_RUN_ID:?}; SHA=${GITHUB_SHA:?}
CUR=out/.home_$A; ERR=out/.claimerr_$A; LOG=out/claims.log

create() { gh api -X POST "repos/$R/git/refs" -f ref="refs/batches/$RUN/$A-$1" -f sha="$SHA" --silent 2>"$ERR"; }
# 0 = claimed, 1 = someone else has it, 2 = API trouble that didn't clear after waiting
try() {
  local wait=30
  for attempt in 1 2 3; do
    create "$1" && { echo "$(date -u +%T) arm $A batch $1 claimed" >> $LOG; return 0; }
    grep -q "Reference already exists\|HTTP 422" "$ERR" && return 1
    echo "$(date -u +%T) arm $A batch $1 attempt $attempt: $(head -c 200 "$ERR" | tr '\n' ' ')" >> $LOG
    sleep $wait; wait=$((wait * 2))
  done
  return 2
}

sleep $((RANDOM % 8))   # spread runners that finish at the same moment
j=$(cat "$CUR" 2>/dev/null || echo "$S")
while [ "$j" -lt "$NB" ]; do
  try "$j"; rc=$?
  echo $((j + SH)) > "$CUR"
  [ $rc -eq 0 ] && { echo 1; exit 0; }
  [ $rc -eq 2 ] && { echo "$(date -u +%T) arm $A batch $j played without a claim (API trouble)" >> $LOG; echo 1; exit 0; }
  j=$((j + SH))
done

taken=$(gh api "repos/$R/git/matching-refs/batches/$RUN/$A-" --paginate -q '.[].ref' 2>/dev/null | sed 's#.*-##') || { echo 0; exit 0; }
for k in $(seq $((NB - 1)) -1 0); do
  grep -qx "$k" <<< "$taken" && continue
  try "$k"; rc=$?
  [ $rc -eq 0 ] && { echo 1; exit 0; }
  [ $rc -eq 2 ] && { echo 0; exit 0; }   # can't reach the API: stop helping, our own work is done
done
echo 0
