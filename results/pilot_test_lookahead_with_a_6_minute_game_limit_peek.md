# pilot_test_lookahead_with_a_6_minute_game_limit (early read, run still going)

Same list piloted by different Forge AI profiles (opponents on Default), nothing forced into the opening hand. Same opponents for every list.

| List | Card | Games | Wins | Win rate | Reused |
|---|---|---|---|---|---|
| SiskoFinal | Default AI | 592 | 123 | 20.8% | 0 |
| SiskoFinal | Default AI + lookahead (desktop) | 403 | 83 | 20.6% | 0 |

Gaps (95% interval):

- **Default AI + lookahead (desktop) vs Default AI: -0.2 ± 5.1 points**

<!-- data {"name": "pilot_test_lookahead_with_a_6_minute_game_limit", "title": "Pilot test: lookahead with a 6-minute game limit", "mode": "pilot", "run_id": "45660131008", "finished": "2026-11-25T17:01:06Z", "arms": [{"deck": "SiskoFinal", "card": "", "games": 592, "wins": 123, "run_games": 592, "run_stalls": 0, "run_clean_wins": 123, "reused": 0, "profile": "Default", "label": "Default AI"}, {"deck": "SiskoFinal", "card": "", "games": 403, "wins": 83, "run_games": 403, "run_stalls": 1, "run_clean_wins": 83, "reused": 0, "profile": "Default", "mc": "max", "label": "Default AI + lookahead (desktop)"}], "batching": {"runners": 19, "claimed": 20, "retries": 0, "unclaimed": 0}, "compare": [[0, 1]], "opponents": ["Atraxa", "Prossh", "UrDragon", "Edgar", "Meren"], "speed": 0.779} -->
