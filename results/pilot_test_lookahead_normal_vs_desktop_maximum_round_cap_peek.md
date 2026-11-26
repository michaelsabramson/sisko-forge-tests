# pilot_test_lookahead_normal_vs_desktop_maximum_round_cap (early read, run still going)

Same list piloted by different Forge AI profiles (opponents on Default), nothing forced into the opening hand. Same opponents for every list.

| List | Card | Games | Wins | Win rate | Reused |
|---|---|---|---|---|---|
| SiskoFinal | Default AI | 2910 | 604.1666666666666 | 20.8% | 0 |
| SiskoFinal | Default AI + lookahead | 2834 | 684.4166666666667 | 24.2% | 0 |
| SiskoFinal | Default AI + lookahead (desktop) | 2642 | 614.6666666666666 | 23.3% | 0 |

Gaps (95% interval):

- **Default AI + lookahead vs Default AI: +3.4 ± 2.2 points**
- **Default AI + lookahead (desktop) vs Default AI: +2.5 ± 2.2 points**

<!-- data {"name": "pilot_test_lookahead_normal_vs_desktop_maximum_round_cap", "title": "Pilot test: lookahead normal vs desktop maximum (round cap)", "mode": "pilot", "run_id": "45739042241", "finished": "2026-11-26T01:56:16Z", "arms": [{"deck": "SiskoFinal", "card": "", "games": 2910, "wins": 604.1666666666666, "run_games": 2910, "run_stalls": 31, "run_clean_wins": 594, "reused": 0, "profile": "Default", "label": "Default AI"}, {"deck": "SiskoFinal", "card": "", "games": 2834, "wins": 684.4166666666667, "run_games": 2834, "run_stalls": 47, "run_clean_wins": 671, "reused": 0, "profile": "Default", "mc": "on", "label": "Default AI + lookahead"}, {"deck": "SiskoFinal", "card": "", "games": 2642, "wins": 614.6666666666666, "run_games": 2642, "run_stalls": 25, "run_clean_wins": 607, "reused": 0, "profile": "Default", "mc": "max", "label": "Default AI + lookahead (desktop)"}], "batching": {"runners": 67, "claimed": 122, "retries": 1967, "unclaimed": 439}, "compare": [[0, 1], [0, 2]], "opponents": null, "speed": 0.974} -->
