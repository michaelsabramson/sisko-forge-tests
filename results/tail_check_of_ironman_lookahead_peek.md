# tail_check_of_ironman_lookahead (early read, run still going)

Swapped card forced into opening hand (band 0). Same opponents for every list.

| List | Card | Games | Wins | Win rate | Reused |
|---|---|---|---|---|---|
| Ironman | Typical card (Mjölnir, Hammer of Thor) | 1299 | 136 | 10.5% | 0 |
| Ironman | Talisman of Creativity | 1247 | 135 | 10.8% | 0 |
| Ironman | S.H.I.E.L.D. Helicarrier | 1246 | 108 | 8.7% | 0 |
| Ironman | Roaming Throne | 1204 | 128 | 10.6% | 0 |
| Ironman | Futurist Forge | 1235 | 129 | 10.4% | 0 |
| Ironman | Pact of Negation | 1292 | 128 | 9.9% | 0 |
| Ironman | Pinnacle Emissary | 1184 | 126 | 10.6% | 0 |

Gaps (95% interval):

- **Talisman of Creativity vs Typical card (Mjölnir, Hammer of Thor): +0.4 ± 2.4 points**
- **S.H.I.E.L.D. Helicarrier vs Typical card (Mjölnir, Hammer of Thor): -1.8 ± 2.3 points**
- **Roaming Throne vs Typical card (Mjölnir, Hammer of Thor): +0.2 ± 2.4 points**
- **Futurist Forge vs Typical card (Mjölnir, Hammer of Thor): -0.0 ± 2.4 points**
- **Pact of Negation vs Typical card (Mjölnir, Hammer of Thor): -0.6 ± 2.3 points**
- **Pinnacle Emissary vs Typical card (Mjölnir, Hammer of Thor): +0.2 ± 2.4 points**

Tail check: each card forced into the opening hand vs a typical card (Mjölnir, Hammer of Thor). The Rank's outlier line sits 1.5 points below a typical card.

| Card | Rank's chance it's an outlier | Gap vs typical card | ± (95%) | Verdict |
|---|---|---|---|---|
| Talisman of Creativity | 46% | +0.4 | 2.4 | still unclear |
| S.H.I.E.L.D. Helicarrier | 36% | -1.8 | 2.3 | still unclear |
| Roaming Throne | 34% | +0.2 | 2.4 | still unclear |
| Futurist Forge | 27% | -0.0 | 2.4 | still unclear |
| Pact of Negation | 24% | -0.6 | 2.3 | still unclear |
| Pinnacle Emissary | 23% | +0.2 | 2.4 | still unclear |

<!-- data {"name": "tail_check_of_ironman_lookahead", "title": "Tail check of Ironman (lookahead)", "mode": "tail", "run_id": "45498722110", "finished": "2026-11-24T22:12:42Z", "arms": [{"deck": "Ironman", "card": "Mj\u00f6lnir, Hammer of Thor", "games": 1299, "wins": 136, "reused": 0, "mc": "max", "label": "Typical card (Mj\u00f6lnir, Hammer of Thor)"}, {"deck": "Ironman", "card": "Talisman of Creativity", "games": 1247, "wins": 135, "reused": 0, "mc": "max", "label": "Talisman of Creativity"}, {"deck": "Ironman", "card": "S.H.I.E.L.D. Helicarrier", "games": 1246, "wins": 108, "reused": 0, "mc": "max", "label": "S.H.I.E.L.D. Helicarrier"}, {"deck": "Ironman", "card": "Roaming Throne", "games": 1204, "wins": 128, "reused": 0, "mc": "max", "label": "Roaming Throne"}, {"deck": "Ironman", "card": "Futurist Forge", "games": 1235, "wins": 129, "reused": 0, "mc": "max", "label": "Futurist Forge"}, {"deck": "Ironman", "card": "Pact of Negation", "games": 1292, "wins": 128, "reused": 0, "mc": "max", "label": "Pact of Negation"}, {"deck": "Ironman", "card": "Pinnacle Emissary", "games": 1184, "wins": 126, "reused": 0, "mc": "max", "label": "Pinnacle Emissary"}], "batching": {"runners": 10, "claimed": 12, "retries": 0, "unclaimed": 0}, "hidden": true, "compare": [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6]], "opponents": ["Atraxa", "Prossh", "UrDragon", "Edgar", "Meren"], "speed": 0.862, "tail": {"deck": "Ironman", "ref": "Mj\u00f6lnir, Hammer of Thor", "rows": [{"card": "Talisman of Creativity", "gap": 0.36, "ci": 2.4, "verdict": "unclear", "p_outlier": 0.46}, {"card": "S.H.I.E.L.D. Helicarrier", "gap": -1.8, "ci": 2.28, "verdict": "unclear", "p_outlier": 0.36}, {"card": "Roaming Throne", "gap": 0.16, "ci": 2.41, "verdict": "unclear", "p_outlier": 0.34}, {"card": "Futurist Forge", "gap": -0.02, "ci": 2.38, "verdict": "unclear", "p_outlier": 0.27}, {"card": "Pact of Negation", "gap": -0.56, "ci": 2.33, "verdict": "unclear", "p_outlier": 0.24}, {"card": "Pinnacle Emissary", "gap": 0.17, "ci": 2.42, "verdict": "unclear", "p_outlier": 0.23}], "margin": 1.5, "tau": 0.98, "p_outlier": {"Talisman of Creativity": 0.46, "S.H.I.E.L.D. Helicarrier": 0.36, "Roaming Throne": 0.34, "Futurist Forge": 0.27, "Pact of Negation": 0.24, "Pinnacle Emissary": 0.23}, "rank": "rank_of_ironman_with_lookahead"}} -->
