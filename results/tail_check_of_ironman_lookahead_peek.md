# tail_check_of_ironman_lookahead (early read, run still going)

Swapped card forced into opening hand (band 0). Same opponents for every list.

| List | Card | Games | Wins | Win rate | Reused |
|---|---|---|---|---|---|
| Ironman | Typical card (Mjölnir, Hammer of Thor) | 478 | 58 | 12.1% | 0 |
| Ironman | Talisman of Creativity | 458 | 52 | 11.4% | 0 |
| Ironman | S.H.I.E.L.D. Helicarrier | 467 | 45 | 9.6% | 0 |
| Ironman | Roaming Throne | 459 | 60 | 13.1% | 0 |
| Ironman | Futurist Forge | 462 | 58 | 12.6% | 0 |
| Ironman | Pact of Negation | 478 | 56 | 11.7% | 0 |
| Ironman | Pinnacle Emissary | 444 | 42 | 9.5% | 0 |

Gaps (95% interval):

- **Talisman of Creativity vs Typical card (Mjölnir, Hammer of Thor): -0.8 ± 4.1 points**
- **S.H.I.E.L.D. Helicarrier vs Typical card (Mjölnir, Hammer of Thor): -2.5 ± 4.0 points**
- **Roaming Throne vs Typical card (Mjölnir, Hammer of Thor): +0.9 ± 4.3 points**
- **Futurist Forge vs Typical card (Mjölnir, Hammer of Thor): +0.4 ± 4.2 points**
- **Pact of Negation vs Typical card (Mjölnir, Hammer of Thor): -0.4 ± 4.1 points**
- **Pinnacle Emissary vs Typical card (Mjölnir, Hammer of Thor): -2.7 ± 4.0 points**

Tail check: each card forced into the opening hand vs a typical card (Mjölnir, Hammer of Thor). The Rank's outlier line sits 1.5 points below a typical card.

| Card | Rank's chance it's an outlier | Gap vs typical card | ± (95%) | Verdict |
|---|---|---|---|---|
| Talisman of Creativity | 46% | -0.8 | 4.1 | still unclear |
| S.H.I.E.L.D. Helicarrier | 36% | -2.5 | 4.0 | still unclear |
| Roaming Throne | 34% | +0.9 | 4.2 | still unclear |
| Futurist Forge | 27% | +0.4 | 4.2 | still unclear |
| Pact of Negation | 24% | -0.4 | 4.1 | still unclear |
| Pinnacle Emissary | 23% | -2.7 | 4.0 | still unclear |

<!-- data {"name": "tail_check_of_ironman_lookahead", "title": "Tail check of Ironman (lookahead)", "mode": "tail", "run_id": "45493011053", "finished": "2026-11-24T21:37:55Z", "arms": [{"deck": "Ironman", "card": "Mj\u00f6lnir, Hammer of Thor", "games": 478, "wins": 58, "reused": 0, "mc": "max", "label": "Typical card (Mj\u00f6lnir, Hammer of Thor)"}, {"deck": "Ironman", "card": "Talisman of Creativity", "games": 458, "wins": 52, "reused": 0, "mc": "max", "label": "Talisman of Creativity"}, {"deck": "Ironman", "card": "S.H.I.E.L.D. Helicarrier", "games": 467, "wins": 45, "reused": 0, "mc": "max", "label": "S.H.I.E.L.D. Helicarrier"}, {"deck": "Ironman", "card": "Roaming Throne", "games": 459, "wins": 60, "reused": 0, "mc": "max", "label": "Roaming Throne"}, {"deck": "Ironman", "card": "Futurist Forge", "games": 462, "wins": 58, "reused": 0, "mc": "max", "label": "Futurist Forge"}, {"deck": "Ironman", "card": "Pact of Negation", "games": 478, "wins": 56, "reused": 0, "mc": "max", "label": "Pact of Negation"}, {"deck": "Ironman", "card": "Pinnacle Emissary", "games": 444, "wins": 42, "reused": 0, "mc": "max", "label": "Pinnacle Emissary"}], "batching": null, "hidden": true, "compare": [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6]], "opponents": ["Atraxa", "Prossh", "UrDragon", "Edgar", "Meren"], "speed": 0.823, "tail": {"deck": "Ironman", "ref": "Mj\u00f6lnir, Hammer of Thor", "rows": [{"card": "Talisman of Creativity", "gap": -0.78, "ci": 4.12, "verdict": "unclear", "p_outlier": 0.46}, {"card": "S.H.I.E.L.D. Helicarrier", "gap": -2.5, "ci": 3.97, "verdict": "unclear", "p_outlier": 0.36}, {"card": "Roaming Throne", "gap": 0.94, "ci": 4.25, "verdict": "unclear", "p_outlier": 0.34}, {"card": "Futurist Forge", "gap": 0.42, "ci": 4.21, "verdict": "unclear", "p_outlier": 0.27}, {"card": "Pact of Negation", "gap": -0.42, "ci": 4.11, "verdict": "unclear", "p_outlier": 0.24}, {"card": "Pinnacle Emissary", "gap": -2.67, "ci": 4.0, "verdict": "unclear", "p_outlier": 0.23}], "margin": 1.5, "tau": 0.98, "p_outlier": {"Talisman of Creativity": 0.46, "S.H.I.E.L.D. Helicarrier": 0.36, "Roaming Throne": 0.34, "Futurist Forge": 0.27, "Pact of Negation": 0.24, "Pinnacle Emissary": 0.23}, "rank": "rank_of_ironman_with_lookahead"}} -->
