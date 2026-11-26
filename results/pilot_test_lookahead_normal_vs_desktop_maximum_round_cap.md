# pilot_test_lookahead_normal_vs_desktop_maximum_round_cap

Same list piloted by different Forge AI profiles (opponents on Default), nothing forced into the opening hand. Same opponents for every list.

| List | Card | Games | Wins | Win rate | Reused |
|---|---|---|---|---|---|
| SiskoFinal | Default AI | 2966 | 613.3333333333334 | 20.7% | 0 |
| SiskoFinal | Default AI + lookahead | 2957 | 712.6666666666667 | 24.1% | 0 |
| SiskoFinal | Default AI + lookahead (desktop) | 2957 | 702.5 | 23.8% | 0 |

Gaps (95% interval):

- **Default AI + lookahead vs Default AI: +3.4 ± 2.1 points**
- **Default AI + lookahead (desktop) vs Default AI: +3.1 ± 2.1 points**

<!-- data {"name": "pilot_test_lookahead_normal_vs_desktop_maximum_round_cap", "title": "Pilot test: lookahead normal vs desktop maximum (round cap)", "mode": "pilot", "run_id": "45732117568", "finished": "2026-11-26T02:23:49Z", "arms": [{"deck": "SiskoFinal", "card": "", "games": 2966, "wins": 613.3333333333334, "run_games": 2966, "run_stalls": 39, "run_clean_wins": 601, "reused": 0, "profile": "Default", "label": "Default AI"}, {"deck": "SiskoFinal", "card": "", "games": 2957, "wins": 712.6666666666667, "run_games": 2957, "run_stalls": 55, "run_clean_wins": 697, "reused": 0, "profile": "Default", "mc": "on", "label": "Default AI + lookahead"}, {"deck": "SiskoFinal", "card": "", "games": 2957, "wins": 702.5, "run_games": 2957, "run_stalls": 30, "run_clean_wins": 693, "reused": 0, "profile": "Default", "mc": "max", "label": "Default AI + lookahead (desktop)"}], "batching": {"runners": 67, "claimed": 122, "retries": 2202, "unclaimed": 466}, "compare": [[0, 1], [0, 2]], "opponents": null, "speed": 0.965} -->
