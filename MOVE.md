# Moving to the magic-the-science organization (Team plan, 60 jobs)

Waiting on: GitHub currently runs only 5 jobs at once for the new organization. Move once that cap is gone.
Check: queue one small test from the org's repo (or ask Claude to probe) and count jobs in progress.

The move is a repo transfer (keeps history, results, cache, Actions settings). The app finds its repo from the
page address, so no code edit is needed for that.

1. In `magic-the-science`, delete the placeholder repo `sisko-forge-helper` (frees nothing, just avoids confusion).
2. In this repo: Settings → General → Danger Zone → Transfer → `magic-the-science`. Keep the name.
3. In the moved repo: Settings → Pages → Deploy from branch `main`, folder `/docs` (re-check it survived).
   New app address: https://magic-the-science.github.io/sisko-forge-tests/ (the old address won't redirect).
4. Runner count 38 → 58 (Team allows 60; two stay free for early reads and cleanup):
   - `docs/app.js`: `const SHARDS = 38` → `58`, then bump the `?v=` in `docs/index.html`.
   - `scripts/dispatch.py`: default `r.get("shards", 38)` → `58`.
5. Tokens: your app token and your friend's token were made for your personal account. Make new fine-grained tokens
   with Resource owner = magic-the-science, repo sisko-forge-tests, Contents + Actions read/write; paste into the
   app's settings. Old tokens can be deleted.
6. Secrets: `HELPER_TOKEN` (and the helper's `MAIN_TOKEN`) are no longer needed; delete them and their tokens.
7. Personal Pro: optional to keep; the org's Team plan now covers the runners.
