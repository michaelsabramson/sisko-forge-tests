# tail_check_of_ironman_lookahead

Swapped card forced into opening hand (band 0). Same opponents for every list. 30,473 games reused from earlier runs with identical settings.

| List | Card | Games | Wins | Win rate | Reused |
|---|---|---|---|---|---|
| Ironman | Typical card (Mjölnir, Hammer of Thor) | 4539 | 450 | 9.9% | 4539 |
| Ironman | Talisman of Creativity | 4308 | 428 | 9.9% | 4308 |
| Ironman | S.H.I.E.L.D. Helicarrier | 4385 | 326 | 7.4% | 4385 |
| Ironman | Roaming Throne | 4240 | 438 | 10.3% | 4240 |
| Ironman | Futurist Forge | 4302 | 445 | 10.3% | 4302 |
| Ironman | Pact of Negation | 4549 | 447 | 9.8% | 4549 |
| Ironman | Pinnacle Emissary | 4150 | 420 | 10.1% | 4150 |

Gaps (95% interval):

- **Talisman of Creativity vs Typical card (Mjölnir, Hammer of Thor): +0.0 ± 1.2 points**
- **S.H.I.E.L.D. Helicarrier vs Typical card (Mjölnir, Hammer of Thor): -2.5 ± 1.2 points**
- **Roaming Throne vs Typical card (Mjölnir, Hammer of Thor): +0.4 ± 1.3 points**
- **Futurist Forge vs Typical card (Mjölnir, Hammer of Thor): +0.4 ± 1.3 points**
- **Pact of Negation vs Typical card (Mjölnir, Hammer of Thor): -0.1 ± 1.2 points**
- **Pinnacle Emissary vs Typical card (Mjölnir, Hammer of Thor): +0.2 ± 1.3 points**

Tail check: each card forced into the opening hand vs a typical card (Mjölnir, Hammer of Thor). The Rank's outlier line sits 1.5 points below a typical card.

| Card | Rank's chance it's an outlier | Gap vs typical card | ± (95%) | Verdict |
|---|---|---|---|---|
| Talisman of Creativity | 46% | +0.0 | 1.2 | still unclear |
| S.H.I.E.L.D. Helicarrier | 36% | -2.5 | 1.2 | worse than a typical card |
| Roaming Throne | 34% | +0.4 | 1.3 | cleared: not an outlier |
| Futurist Forge | 27% | +0.4 | 1.3 | cleared: not an outlier |
| Pact of Negation | 24% | -0.1 | 1.2 | still unclear |
| Pinnacle Emissary | 23% | +0.2 | 1.3 | cleared: not an outlier |

<!-- data {"name": "tail_check_of_ironman_lookahead", "title": "Tail check of Ironman (lookahead)", "mode": "tail", "run_id": "45515131397", "finished": "2026-11-25T00:04:23Z", "arms": [{"deck": "Ironman", "card": "Mj\u00f6lnir, Hammer of Thor", "games": 4539, "wins": 450, "reused": 4539, "mc": "max", "label": "Typical card (Mj\u00f6lnir, Hammer of Thor)"}, {"deck": "Ironman", "card": "Talisman of Creativity", "games": 4308, "wins": 428, "reused": 4308, "mc": "max", "label": "Talisman of Creativity"}, {"deck": "Ironman", "card": "S.H.I.E.L.D. Helicarrier", "games": 4385, "wins": 326, "reused": 4385, "mc": "max", "label": "S.H.I.E.L.D. Helicarrier"}, {"deck": "Ironman", "card": "Roaming Throne", "games": 4240, "wins": 438, "reused": 4240, "mc": "max", "label": "Roaming Throne"}, {"deck": "Ironman", "card": "Futurist Forge", "games": 4302, "wins": 445, "reused": 4302, "mc": "max", "label": "Futurist Forge"}, {"deck": "Ironman", "card": "Pact of Negation", "games": 4549, "wins": 447, "reused": 4549, "mc": "max", "label": "Pact of Negation"}, {"deck": "Ironman", "card": "Pinnacle Emissary", "games": 4150, "wins": 420, "reused": 4150, "mc": "max", "label": "Pinnacle Emissary"}], "batching": null, "hidden": true, "compare": [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6]], "opponents": ["Atraxa", "Prossh", "UrDragon", "Edgar", "Meren"], "speed": null, "tail": {"deck": "Ironman", "ref": "Mj\u00f6lnir, Hammer of Thor", "rows": [{"card": "Talisman of Creativity", "gap": 0.02, "ci": 1.25, "verdict": "unclear", "p_outlier": 0.46}, {"card": "S.H.I.E.L.D. Helicarrier", "gap": -2.48, "ci": 1.17, "verdict": "weak", "p_outlier": 0.36}, {"card": "Roaming Throne", "gap": 0.42, "ci": 1.26, "verdict": "cleared", "p_outlier": 0.34}, {"card": "Futurist Forge", "gap": 0.43, "ci": 1.26, "verdict": "cleared", "p_outlier": 0.27}, {"card": "Pact of Negation", "gap": -0.09, "ci": 1.23, "verdict": "unclear", "p_outlier": 0.24}, {"card": "Pinnacle Emissary", "gap": 0.21, "ci": 1.26, "verdict": "cleared", "p_outlier": 0.23}], "margin": 1.5, "tau": 0.98, "p_outlier": {"Talisman of Creativity": 0.46, "S.H.I.E.L.D. Helicarrier": 0.36, "Roaming Throne": 0.34, "Futurist Forge": 0.27, "Pact of Negation": 0.24, "Pinnacle Emissary": 0.23}, "rank": "rank_of_ironman_with_lookahead"}} -->
