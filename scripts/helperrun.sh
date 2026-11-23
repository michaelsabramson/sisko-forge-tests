#!/bin/bash
# Find the helper organization's run for main run $1 and print repo=/id= for $GITHUB_OUTPUT.
# With "wait", first wait for it to finish (up to 40 minutes; 5 if it never started).
H=$(jq -r '.helper // empty' tests/request.json); [ -n "$H" ] && [ -n "${GH_TOKEN:-}" ] || exit 0
look() { gh api "repos/$H/actions/runs?event=workflow_dispatch&per_page=30" \
           -q ".workflow_runs[] | select(.display_title == \"helper for $1\") | \"\(.id) \(.status)\"" 2>/dev/null | head -1; }
while :; do
  read -r id st <<< "$(look "$1")"
  [ "$2" != wait ] && break
  [ "$st" = completed ] && break
  [ -z "$id" ] && [ $SECONDS -gt 300 ] && { echo "helper run never started" >&2; break; }
  [ $SECONDS -gt 2400 ] && { echo "gave up waiting for the helper run" >&2; break; }
  echo "helper run: ${id:-not found yet} ${st}" >&2; sleep 30
done
[ -n "$id" ] && { echo "repo=$H"; echo "id=$id"; }
true
