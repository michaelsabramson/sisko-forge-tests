# pilot_test_lookahead_normal_vs_desktop_maximum_round_cap (early read, run still going)

Same list piloted by different Forge AI profiles (opponents on Default), nothing forced into the opening hand. Same opponents for every list.

| List | Card | Games | Wins | Win rate | Reused |
|---|---|---|---|---|---|
| SiskoFinal | Default AI | 2264 | 462.66666666666663 | 20.4% | 0 |
| SiskoFinal | Default AI + lookahead | 2031 | 491.0833333333332 | 24.2% | 0 |
| SiskoFinal | Default AI + lookahead (desktop) | 1636 | 384.1666666666666 | 23.5% | 0 |

Gaps (95% interval):

- **Default AI + lookahead vs Default AI: +3.7 ± 2.5 points**
- **Default AI + lookahead (desktop) vs Default AI: +3.0 ± 2.6 points**

<!-- data {"name": "pilot_test_lookahead_normal_vs_desktop_maximum_round_cap", "title": "Pilot test: lookahead normal vs desktop maximum (round cap)", "mode": "pilot", "run_id": "45736494744", "finished": "2026-11-26T01:33:04Z", "arms": [{"deck": "SiskoFinal", "card": "", "games": 2264, "wins": 462.66666666666663, "run_games": 2264, "run_stalls": 25, "run_clean_wins": 454, "reused": 0, "profile": "Default", "label": "Default AI"}, {"deck": "SiskoFinal", "card": "", "games": 2031, "wins": 491.0833333333332, "run_games": 2031, "run_stalls": 17, "run_clean_wins": 486, "reused": 0, "profile": "Default", "mc": "on", "label": "Default AI + lookahead"}, {"deck": "SiskoFinal", "card": "", "games": 1636, "wins": 384.1666666666666, "run_games": 1636, "run_stalls": 19, "run_clean_wins": 379, "reused": 0, "profile": "Default", "mc": "max", "label": "Default AI + lookahead (desktop)"}], "batching": {"runners": 67, "claimed": 122, "retries": 1038, "unclaimed": 270}, "compare": [[0, 1], [0, 2]], "opponents": null, "speed": 0.958} -->
