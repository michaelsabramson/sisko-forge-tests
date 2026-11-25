# pilot_test_lookahead_with_a_6_minute_game_limit

Same list piloted by different Forge AI profiles (opponents on Default), nothing forced into the opening hand. Same opponents for every list.

| List | Card | Games | Wins | Win rate | Reused |
|---|---|---|---|---|---|
| SiskoFinal | Default AI | 2960 | 661 | 22.3% | 0 |
| SiskoFinal | Default AI + lookahead (desktop) | 2960 | 682 | 23.0% | 0 |

Gaps (95% interval):

- **Default AI + lookahead (desktop) vs Default AI: +0.7 ± 2.1 points**

<!-- data {"name": "pilot_test_lookahead_with_a_6_minute_game_limit", "title": "Pilot test: lookahead with a 6-minute game limit", "mode": "pilot", "run_id": "45658180382", "finished": "2026-11-25T17:26:10Z", "arms": [{"deck": "SiskoFinal", "card": "", "games": 2960, "wins": 661, "run_games": 2960, "run_stalls": 32, "run_clean_wins": 651, "reused": 0, "profile": "Default", "label": "Default AI"}, {"deck": "SiskoFinal", "card": "", "games": 2960, "wins": 682, "run_games": 2960, "run_stalls": 36, "run_clean_wins": 675, "reused": 0, "profile": "Default", "mc": "max", "label": "Default AI + lookahead (desktop)"}], "batching": {"runners": 67, "claimed": 392, "retries": 0, "unclaimed": 0}, "compare": [[0, 1]], "opponents": ["Atraxa", "Prossh", "UrDragon", "Edgar", "Meren"], "speed": 0.88} -->
