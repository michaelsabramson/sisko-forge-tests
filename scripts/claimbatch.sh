#!/bin/bash
# Claim one batch of games for arm $1 on runner $2. Prints 1 if this runner may play another batch, 0 when none are left.
#
# A batch is claimed by creating the ref refs/batches/<run>/<arm>-<n> through the GitHub API. Creating a ref is
# all-or-nothing, so if two runners try for the same batch exactly one succeeds. Each runner first works through its
# own batches (n = runner, runner + shards, ...); once those are gone it takes unclaimed batches from the end of the
# list, which belong to slower runners, so owners and helpers rarely collide.
# If the API misbehaves (rate limit, network), a runner keeps playing its own batches: never worse than a fixed share.
A=$1; S=$2; REQ=tests/request.json
NB=$(jq -r ".batches[$A] // 0" $REQ); SH=$(jq -r '.shards // 38' $REQ)
R=${GITHUB_REPOSITORY:?}; RUN=${GITHUB_RUN_ID:?}; SHA=${GITHUB_SHA:?}
CUR=out/.home_$A; ERR=out/.claimerr_$A

try() { gh api -X POST "repos/$R/git/refs" -f ref="refs/batches/$RUN/$A-$1" -f sha="$SHA" --silent 2>"$ERR"; }
taken_by_other() { grep -q "Reference already exists\|HTTP 422" "$ERR"; }

j=$(cat "$CUR" 2>/dev/null || echo "$S")
while [ "$j" -lt "$NB" ]; do
  if try "$j"; then echo $((j + SH)) > "$CUR"; echo 1; exit 0; fi
  if ! taken_by_other; then echo $((j + SH)) > "$CUR"; echo 1; exit 0; fi   # API trouble: play our own batch anyway
  j=$((j + SH))
done
echo "$j" > "$CUR"

taken=$(gh api "repos/$R/git/matching-refs/batches/$RUN/$A-" --paginate -q '.[].ref' 2>/dev/null | sed 's#.*-##') || { echo 0; exit 0; }
for k in $(seq $((NB - 1)) -1 0); do
  grep -qx "$k" <<< "$taken" && continue
  if try "$k"; then echo 1; exit 0; fi
done
echo 0
