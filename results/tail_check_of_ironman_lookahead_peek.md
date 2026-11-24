# tail_check_of_ironman_lookahead (early read, run still going)

Swapped card forced into opening hand (band 0). Same opponents for every list.

| List | Card | Games | Wins | Win rate | Reused |
|---|---|---|---|---|---|
| Ironman | Typical card (Mjölnir, Hammer of Thor) | 1811 | 189 | 10.4% | 0 |
| Ironman | Talisman of Creativity | 1755 | 180 | 10.3% | 0 |
| Ironman | S.H.I.E.L.D. Helicarrier | 1757 | 146 | 8.3% | 0 |
| Ironman | Roaming Throne | 1715 | 185 | 10.8% | 0 |
| Ironman | Futurist Forge | 1752 | 170 | 9.7% | 0 |
| Ironman | Pact of Negation | 1831 | 186 | 10.2% | 0 |
| Ironman | Pinnacle Emissary | 1674 | 172 | 10.3% | 0 |

Gaps (95% interval):

- **Talisman of Creativity vs Typical card (Mjölnir, Hammer of Thor): -0.2 ± 2.0 points**
- **S.H.I.E.L.D. Helicarrier vs Typical card (Mjölnir, Hammer of Thor): -2.1 ± 1.9 points**
- **Roaming Throne vs Typical card (Mjölnir, Hammer of Thor): +0.4 ± 2.0 points**
- **Futurist Forge vs Typical card (Mjölnir, Hammer of Thor): -0.7 ± 2.0 points**
- **Pact of Negation vs Typical card (Mjölnir, Hammer of Thor): -0.3 ± 2.0 points**
- **Pinnacle Emissary vs Typical card (Mjölnir, Hammer of Thor): -0.2 ± 2.0 points**

Tail check: each card forced into the opening hand vs a typical card (Mjölnir, Hammer of Thor). The Rank's outlier line sits 1.5 points below a typical card.

| Card | Rank's chance it's an outlier | Gap vs typical card | ± (95%) | Verdict |
|---|---|---|---|---|
| Talisman of Creativity | 46% | -0.2 | 2.0 | still unclear |
| S.H.I.E.L.D. Helicarrier | 36% | -2.1 | 1.9 | still unclear |
| Roaming Throne | 34% | +0.3 | 2.0 | still unclear |
| Futurist Forge | 27% | -0.7 | 2.0 | still unclear |
| Pact of Negation | 24% | -0.3 | 2.0 | still unclear |
| Pinnacle Emissary | 23% | -0.2 | 2.0 | still unclear |

<!-- data {"name": "tail_check_of_ironman_lookahead", "title": "Tail check of Ironman (lookahead)", "mode": "tail", "run_id": "45500585945", "finished": "2026-11-24T22:24:18Z", "arms": [{"deck": "Ironman", "card": "Mj\u00f6lnir, Hammer of Thor", "games": 1811, "wins": 189, "reused": 0, "mc": "max", "label": "Typical card (Mj\u00f6lnir, Hammer of Thor)"}, {"deck": "Ironman", "card": "Talisman of Creativity", "games": 1755, "wins": 180, "reused": 0, "mc": "max", "label": "Talisman of Creativity"}, {"deck": "Ironman", "card": "S.H.I.E.L.D. Helicarrier", "games": 1757, "wins": 146, "reused": 0, "mc": "max", "label": "S.H.I.E.L.D. Helicarrier"}, {"deck": "Ironman", "card": "Roaming Throne", "games": 1715, "wins": 185, "reused": 0, "mc": "max", "label": "Roaming Throne"}, {"deck": "Ironman", "card": "Futurist Forge", "games": 1752, "wins": 170, "reused": 0, "mc": "max", "label": "Futurist Forge"}, {"deck": "Ironman", "card": "Pact of Negation", "games": 1831, "wins": 186, "reused": 0, "mc": "max", "label": "Pact of Negation"}, {"deck": "Ironman", "card": "Pinnacle Emissary", "games": 1674, "wins": 172, "reused": 0, "mc": "max", "label": "Pinnacle Emissary"}], "batching": {"runners": 50, "claimed": 164, "retries": 0, "unclaimed": 0}, "hidden": true, "compare": [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6]], "opponents": ["Atraxa", "Prossh", "UrDragon", "Edgar", "Meren"], "speed": 0.868, "tail": {"deck": "Ironman", "ref": "Mj\u00f6lnir, Hammer of Thor", "rows": [{"card": "Talisman of Creativity", "gap": -0.18, "ci": 2.0, "verdict": "unclear", "p_outlier": 0.46}, {"card": "S.H.I.E.L.D. Helicarrier", "gap": -2.13, "ci": 1.91, "verdict": "unclear", "p_outlier": 0.36}, {"card": "Roaming Throne", "gap": 0.35, "ci": 2.03, "verdict": "unclear", "p_outlier": 0.34}, {"card": "Futurist Forge", "gap": -0.73, "ci": 1.98, "verdict": "unclear", "p_outlier": 0.27}, {"card": "Pact of Negation", "gap": -0.28, "ci": 1.97, "verdict": "unclear", "p_outlier": 0.24}, {"card": "Pinnacle Emissary", "gap": -0.16, "ci": 2.02, "verdict": "unclear", "p_outlier": 0.23}], "margin": 1.5, "tau": 0.98, "p_outlier": {"Talisman of Creativity": 0.46, "S.H.I.E.L.D. Helicarrier": 0.36, "Roaming Throne": 0.34, "Futurist Forge": 0.27, "Pact of Negation": 0.24, "Pinnacle Emissary": 0.23}, "rank": "rank_of_ironman_with_lookahead"}} -->
