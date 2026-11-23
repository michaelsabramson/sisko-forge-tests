# Future improvements

## Early stopping (decided: not yet, 2026-11-21)
Stop a test once the answer is clear instead of always running the planned length.
- Check at each progress save (~every 20 min), reusing the early-read aggregation.
- Stop when every comparison is settled: the 99% interval for each challenger excludes zero, or the
  target precision is already reached. With 6-8 looks, 99% per look keeps the overall false-alarm
  rate near the usual 95%.
- Require ~1,500 games per side before any stop.
- Multi-challenger tests stop only when all comparisons are settled (reassigning freed runners mid-run is a later step).
- Signal: the check commits a stop marker; runners poll it, save their games and exit; final aggregation runs as usual.
- Label results "stopped early: clear at 99%" and note that early-stopped gaps run slightly high (winner's curse).
- Expected gain: clear-cut swaps finish in ~30-40 min instead of ~70; close calls run full length.

## Engine speed: what was learned (2026-11-21/22)
Shipped 2026-11-22 (exact, same decisions, cache carried over):
- Ending a game once the tracked deck is eliminated (~8%).
- Combat-planning speedups in forge.patch: lure-check shortcut, token grouping for block checks, static-zone card list
  frozen while the AI plans, "this creature" can't-block-by rules (flying etc.) checked only for their own attacker.
  Verified on 33 same-seed replays with the AI's 5-second thinking budget switched off (games are only reproducible
  that way). Clean benchmark: ~10% faster on ordinary games, ~20% on slow games; the 32-dragon game that always timed
  out now finishes.

Tried and dropped:
- Forking games at the swapped card: paired games are uncorrelated (63% same outcome = chance), no variance saved.
- Caching mana-payment checks during combat (~3%) and caching per-card replacement flags (~7%, unproven): not worth it.
- Shortening the AI thinking deadline: no decision ever hit it in normal games.

Still open:
- Stall cutoff (held): end a game when one turn runs past ~20 s; toss stalled/timed-out games out of results and show
  the stall rate per test. Also fixes timeouts handing a "win" to the first surviving player (Forge marks all survivors
  as winners on a forced end).
- Rules upkeep on monster boards (~13% there): StaticAbilityContinuous.getAffectedCards re-matching every lord effect
  against every card after each action. Core rules code: higher risk.
- Note: with the 5-second budget, Forge's AI plays slightly differently depending on machine speed on big boards.

## Synergy views (held, 2026-11-23)
From Rank opening hands (kept hand + 3 draws; `extract-hands` workflow pulls them into analysis/):
- **Best partners** on each card: given card X early, which other cards raise win rate most (card's own score plus
  its X-synergy, shrunk by noise). Doubles as a tutor/keep guide. Sisko + Norin the Wary: Purphoros +16, Impact
  Tremors +7, Warleader's Call +6, Corpse Knight +5; reactive cards worst (Trophy, Boros Charm, Pact).
- **Engines** summary on the Rank tab: only combinations that clearly stand out (Norin x damage-on-enter cards:
  37% together vs ~23% apart, synergy +10.5 ± 3.5). Pairs are ~±6 pts each at ~34k games, so no full pair grid.
- Needs each Rank to store its opening hands (~0.4 MB per Rank).
