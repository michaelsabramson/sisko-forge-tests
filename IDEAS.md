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
