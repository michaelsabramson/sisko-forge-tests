# pilot_test_lookahead_with_a_6_minute_game_limit (early read, run still going)

Same list piloted by different Forge AI profiles (opponents on Default), nothing forced into the opening hand. Same opponents for every list.

| List | Card | Games | Wins | Win rate | Reused |
|---|---|---|---|---|---|
| SiskoFinal | Default AI | 1472 | 323 | 21.9% | 0 |
| SiskoFinal | Default AI + lookahead (desktop) | 989 | 229 | 23.2% | 0 |

Gaps (95% interval):

- **Default AI + lookahead (desktop) vs Default AI: +1.2 ± 3.4 points**

<!-- data {"name": "pilot_test_lookahead_with_a_6_minute_game_limit", "title": "Pilot test: lookahead with a 6-minute game limit", "mode": "pilot", "run_id": "45661538936", "finished": "2026-11-25T17:08:40Z", "arms": [{"deck": "SiskoFinal", "card": "", "games": 1472, "wins": 323, "run_games": 1472, "run_stalls": 10, "run_clean_wins": 319, "reused": 0, "profile": "Default", "label": "Default AI"}, {"deck": "SiskoFinal", "card": "", "games": 989, "wins": 229, "run_games": 989, "run_stalls": 15, "run_clean_wins": 227, "reused": 0, "profile": "Default", "mc": "max", "label": "Default AI + lookahead (desktop)"}], "batching": {"runners": 67, "claimed": 164, "retries": 0, "unclaimed": 0}, "compare": [[0, 1]], "opponents": ["Atraxa", "Prossh", "UrDragon", "Edgar", "Meren"], "speed": 0.838} -->
