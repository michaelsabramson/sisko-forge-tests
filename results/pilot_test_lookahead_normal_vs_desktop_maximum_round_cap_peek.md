# pilot_test_lookahead_normal_vs_desktop_maximum_round_cap (early read, run still going)

Same list piloted by different Forge AI profiles (opponents on Default), nothing forced into the opening hand. Same opponents for every list.

| List | Card | Games | Wins | Win rate | Reused |
|---|---|---|---|---|---|
| SiskoFinal | Default AI | 1634 | 328.25 | 20.1% | 0 |
| SiskoFinal | Default AI + lookahead | 1359 | 319.4166666666667 | 23.5% | 0 |
| SiskoFinal | Default AI + lookahead (desktop) | 1070 | 230.33333333333337 | 21.5% | 0 |

Gaps (95% interval):

- **Default AI + lookahead vs Default AI: +3.4 ± 3.0 points**
- **Default AI + lookahead (desktop) vs Default AI: +1.4 ± 3.1 points**

<!-- data {"name": "pilot_test_lookahead_normal_vs_desktop_maximum_round_cap", "title": "Pilot test: lookahead normal vs desktop maximum (round cap)", "mode": "pilot", "run_id": "45735194480", "finished": "2026-11-26T01:21:32Z", "arms": [{"deck": "SiskoFinal", "card": "", "games": 1634, "wins": 328.25, "run_games": 1634, "run_stalls": 15, "run_clean_wins": 323, "reused": 0, "profile": "Default", "label": "Default AI"}, {"deck": "SiskoFinal", "card": "", "games": 1359, "wins": 319.4166666666667, "run_games": 1359, "run_stalls": 10, "run_clean_wins": 317, "reused": 0, "profile": "Default", "mc": "on", "label": "Default AI + lookahead"}, {"deck": "SiskoFinal", "card": "", "games": 1070, "wins": 230.33333333333337, "run_games": 1070, "run_stalls": 13, "run_clean_wins": 227, "reused": 0, "profile": "Default", "mc": "max", "label": "Default AI + lookahead (desktop)"}], "batching": {"runners": 67, "claimed": 122, "retries": 497, "unclaimed": 118}, "compare": [[0, 1], [0, 2]], "opponents": null, "speed": 0.926} -->
