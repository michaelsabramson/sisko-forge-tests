# pilot_test_lookahead_with_a_6_minute_game_limit (early read, run still going)

Same list piloted by different Forge AI profiles (opponents on Default), nothing forced into the opening hand. Same opponents for every list.

| List | Card | Games | Wins | Win rate | Reused |
|---|---|---|---|---|---|
| SiskoFinal | Default AI | 2821 | 635 | 22.5% | 0 |
| SiskoFinal | Default AI + lookahead (desktop) | 2176 | 493 | 22.7% | 0 |

Gaps (95% interval):

- **Default AI + lookahead (desktop) vs Default AI: +0.1 ± 2.3 points**

<!-- data {"name": "pilot_test_lookahead_with_a_6_minute_game_limit", "title": "Pilot test: lookahead with a 6-minute game limit", "mode": "pilot", "run_id": "45662917896", "finished": "2026-11-25T17:16:21Z", "arms": [{"deck": "SiskoFinal", "card": "", "games": 2821, "wins": 635, "run_games": 2821, "run_stalls": 27, "run_clean_wins": 627, "reused": 0, "profile": "Default", "label": "Default AI"}, {"deck": "SiskoFinal", "card": "", "games": 2176, "wins": 493, "run_games": 2176, "run_stalls": 31, "run_clean_wins": 488, "reused": 0, "profile": "Default", "mc": "max", "label": "Default AI + lookahead (desktop)"}], "batching": {"runners": 66, "claimed": 359, "retries": 0, "unclaimed": 0}, "compare": [[0, 1]], "opponents": ["Atraxa", "Prossh", "UrDragon", "Edgar", "Meren"], "speed": 0.869} -->
