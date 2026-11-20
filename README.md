# sisko-forge-tests

Head-to-head card-swap tests for a Captain Benjamin Sisko Commander deck, run on the open-source
[Forge](https://github.com/Card-Forge/forge) rules engine (GPL-3.0) via GitHub Actions.

- `forge.patch` — local changes applied on top of Forge commit in `FORGE_COMMIT` (AI hints for this deck, a
  dilemma-counting fix for AI free casts, test hooks). Some card-script edits are test-only and not upstream-quality.
- `runner/Run.java` — headless 4-player Commander runner.
- `decks/` — test lists and the opponent pool (EDHREC "upgraded/expensive" average decks).
- `tests/request.json` — edit and push to start a test; results land in `results/`.

Method: the swapped card is forced into the opening hand of each list; each list plays separate pods against
the same opponents and seats for a given game index; scored on wins.

## Deck Lab (web app)

`docs/` is a static web app served by GitHub Pages: edit decks, queue swap tests or whole-deck comparisons,
watch runs, and browse results. Writes go through the GitHub API with a fine-grained token stored in the browser.
Queued tests land in `queue/`; the `dispatcher` workflow starts the oldest one whenever no `swap-test` run is active
(`scripts/dispatch.py` builds the swapped decks and `tests/request.json`). `docs/forge-cards.txt` lists the cards Forge
implements at `FORGE_COMMIT`, with Forge's own "AI can't play this well" flags.
