# pilot_test_lookahead_normal_vs_desktop_maximum_round_cap (early read, run still going)

Same list piloted by different Forge AI profiles (opponents on Default), nothing forced into the opening hand. Same opponents for every list.

| List | Card | Games | Wins | Win rate | Reused |
|---|---|---|---|---|---|
| SiskoFinal | Default AI | 868 | 171.58333333333334 | 19.8% | 0 |
| SiskoFinal | Default AI + lookahead | 672 | 157.08333333333334 | 23.4% | 0 |
| SiskoFinal | Default AI + lookahead (desktop) | 528 | 99.16666666666667 | 18.8% | 0 |

Gaps (95% interval):

- **Default AI + lookahead vs Default AI: +3.6 ± 4.2 points**
- **Default AI + lookahead (desktop) vs Default AI: -1.0 ± 4.3 points**

<!-- data {"name": "pilot_test_lookahead_normal_vs_desktop_maximum_round_cap", "title": "Pilot test: lookahead normal vs desktop maximum (round cap)", "mode": "pilot", "run_id": "45733831532", "finished": "2026-11-26T01:09:55Z", "arms": [{"deck": "SiskoFinal", "card": "", "games": 868, "wins": 171.58333333333334, "run_games": 868, "run_stalls": 4, "run_clean_wins": 170, "reused": 0, "profile": "Default", "label": "Default AI"}, {"deck": "SiskoFinal", "card": "", "games": 672, "wins": 157.08333333333334, "run_games": 672, "run_stalls": 7, "run_clean_wins": 155, "reused": 0, "profile": "Default", "mc": "on", "label": "Default AI + lookahead"}, {"deck": "SiskoFinal", "card": "", "games": 528, "wins": 99.16666666666667, "run_games": 528, "run_stalls": 5, "run_clean_wins": 98, "reused": 0, "profile": "Default", "mc": "max", "label": "Default AI + lookahead (desktop)"}], "batching": {"runners": 44, "claimed": 71, "retries": 0, "unclaimed": 0}, "compare": [[0, 1], [0, 2]], "opponents": null, "speed": 0.89} -->
