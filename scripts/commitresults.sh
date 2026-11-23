#!/bin/bash
# Commit this run's results and cache to main. If main moved on and the cache files conflict (another run saved
# meanwhile), start over from the newest main and tally again: the cache then gets this run's games added to
# whatever is there now, instead of failing and losing the save.
git config user.name "swaptest-bot"; git config user.email "actions@users.noreply.github.com"
BR=${1:-main}; cp tests/request.json /tmp/request.json
for try in 1 2 3 4; do
  git add results/ cache/ 2>/dev/null || git add results/
  git commit -qm "Results: $(jq -r .name tests/request.json)" || true
  git checkout -q -- . 2>/dev/null   # leftovers outside results/cache (e.g. a recovered run's request) would block the pull
  git pull -q --rebase origin "$BR" && git push -q origin "HEAD:$BR" && exit 0
  echo "save attempt $try failed; tallying again on the newest main"
  git rebase --abort 2>/dev/null; git fetch -q origin "$BR"; git reset -q --hard "origin/$BR"
  cp /tmp/request.json tests/request.json
  python3 scripts/aggregate.py > /dev/null || exit 1
  sleep $((RANDOM % 10 + 5))
done
exit 1
