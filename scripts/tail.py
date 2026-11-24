"""Tail check: after a Rank, give the cards whose "outlier" call is uncertain their own forced-hand games.

A Rank only sees a card when the shuffle deals it (about 1 game in 10), so the cards near the outlier line can't be
settled cheaply there. The tail check forces each of them into the opening hand, against one shared reference arm
that forces a typical (median) card, and stops once every verdict is clear.

Selection mirrors the app's rankTiers (docs/app.js): empirical-Bayes shrinkage of each card's gap toward the deck
mean, true spread tau, outlier line = median - 1.5 tau. P(outlier) is the shrunk estimate's chance of being below the
line. Up to MAX cards with P of at least 10%, likeliest outliers first: the clear ones get confirmed (about one card
per deck flips between runs by chance) and the uncertain ones get settled.

Verdicts use 99% intervals (early reads check several times) on gap = forced card minus forced reference card,
against margin = 1.5 tau (how far below the median the outlier line sits): see verdict().
"""
import math, re

MAX = 6
P_LO = 0.10
MIN_MARGIN = 1.5   # points: in a deck whose cards are all close, gaps smaller than this aren't worth acting on


def _phi(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def deck_counts(deck):
    n = {}
    for path in (f"decks/{deck}.dck", f"decks/ref/{deck}.dck"):
        try:
            sec = None
            for line in open(path, encoding="utf-8"):
                line = line.strip()
                if line.startswith("["): sec = line.strip("[]").lower(); continue
                m = re.match(r"^(\d+)\s+(.+)$", line)
                if m and sec == "main": n[m.group(2).split("|")[0].strip()] = n.get(m.group(2).split("|")[0].strip(), 0) + int(m.group(1))
            return n
        except FileNotFoundError:
            continue
    return n


def tiers(cards):
    """cards: Rank rows {card, diff, ci}. Returns (mu, tau, line, {card: (shrunk, post_sd, p_outlier)})."""
    n = len(cards)
    if n < 10: return None
    se2 = [(c["ci"] / 1.96) ** 2 for c in cards]
    mu = sum(c["diff"] for c in cards) / n
    var_obs = sum((c["diff"] - mu) ** 2 for c in cards) / (n - 1)
    tau2 = max(0.0, var_obs - sum(se2) / n)
    if tau2 <= 0: return None
    tau = math.sqrt(tau2)
    shr = [mu + tau2 / (tau2 + s) * (c["diff"] - mu) for c, s in zip(cards, se2)]
    med = sorted(shr)[n // 2]; line = med - 1.5 * tau
    out = {}
    for c, s, x in zip(cards, se2, shr):
        sd = math.sqrt(tau2 * s / (tau2 + s))
        out[c["card"]] = (x, sd, _phi((line - x) / sd))
    return {"mu": mu, "tau": tau, "median": med, "line": line, "cards": out}


def select(deck, cards, games):
    """Pick the tail cards and the reference card for a finished Rank. Returns None when there is nothing to check."""
    t = tiers(cards)
    if not t: return None
    counts = deck_counts(deck)
    ok = [c for c in cards if counts.get(c["card"], 1) == 1 and c.get("seen", 0) < 0.9 * max(1, games)]
    P = {c["card"]: t["cards"][c["card"]][2] for c in ok}
    pick = sorted([k for k, p in P.items() if p >= P_LO], key=lambda k: -P[k])[:MAX]
    if not pick: return None
    # reference: a single-copy nonland card closest to the median (a typical card); lands are skipped because a
    # forced land changes the hand's mana more than a typical spell does
    from landcurve import land_names
    lands = land_names({c["card"] for c in ok}) or set()
    ref_pool = [c["card"] for c in ok if c["card"] not in lands and c["card"] not in pick]
    if not ref_pool: return None
    ref = min(ref_pool, key=lambda k: abs(t["cards"][k][0] - t["median"]))
    return {"cards": pick, "ref": ref, "margin": round(max(MIN_MARGIN, 1.5 * t["tau"]), 2), "tau": round(t["tau"], 2),
            "p_outlier": {k: round(P[k], 2) for k in pick}}


def verdict(gap, se, margin):
    """gap and se in points (forced card minus forced typical card). 99% intervals."""
    lo, hi = gap - 2.576 * se, gap + 2.576 * se
    if hi < -margin: return "outlier"   # worse than a typical card by more than the outlier margin
    if hi < 0: return "weak"            # clearly worse than a typical card (a cut candidate)
    if lo > -margin: return "cleared"   # can't be an outlier
    return "unclear"


SETTLED = {"outlier", "weak", "cleared"}
LABEL = {"outlier": "confirmed outlier", "weak": "worse than a typical card", "cleared": "cleared: not an outlier",
         "unclear": "still unclear"}
