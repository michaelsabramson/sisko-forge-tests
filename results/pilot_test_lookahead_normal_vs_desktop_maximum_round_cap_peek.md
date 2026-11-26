# pilot_test_lookahead_normal_vs_desktop_maximum_round_cap (early read, run still going)

Same list piloted by different Forge AI profiles (opponents on Default), nothing forced into the opening hand. Same opponents for every list.

| List | Card | Games | Wins | Win rate | Reused |
|---|---|---|---|---|---|
| SiskoFinal | Default AI | 2721 | 561.3333333333333 | 20.6% | 0 |
| SiskoFinal | Default AI + lookahead | 2564 | 615.25 | 24.0% | 0 |
| SiskoFinal | Default AI + lookahead (desktop) | 2204 | 491.4166666666666 | 22.3% | 0 |

Gaps (95% interval):

- **Default AI + lookahead vs Default AI: +3.4 ± 2.2 points**
- **Default AI + lookahead (desktop) vs Default AI: +1.7 ± 2.3 points**

<!-- data {"name": "pilot_test_lookahead_normal_vs_desktop_maximum_round_cap", "title": "Pilot test: lookahead normal vs desktop maximum (round cap)", "mode": "pilot", "run_id": "45737782076", "finished": "2026-11-26T01:44:42Z", "arms": [{"deck": "SiskoFinal", "card": "", "games": 2721, "wins": 561.3333333333333, "run_games": 2721, "run_stalls": 28, "run_clean_wins": 552, "reused": 0, "profile": "Default", "label": "Default AI"}, {"deck": "SiskoFinal", "card": "", "games": 2564, "wins": 615.25, "run_games": 2564, "run_stalls": 25, "run_clean_wins": 608, "reused": 0, "profile": "Default", "mc": "on", "label": "Default AI + lookahead"}, {"deck": "SiskoFinal", "card": "", "games": 2204, "wins": 491.4166666666666, "run_games": 2204, "run_stalls": 22, "run_clean_wins": 485, "reused": 0, "profile": "Default", "mc": "max", "label": "Default AI + lookahead (desktop)"}], "batching": {"runners": 67, "claimed": 122, "retries": 1598, "unclaimed": 385}, "compare": [[0, 1], [0, 2]], "opponents": null, "speed": 0.981} -->
