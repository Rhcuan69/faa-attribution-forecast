# polymarket-faa-attribution-02 — entry

Forecasts the Yes price of every market of Polymarket's FAA outage
attribution family (Iran / foreign actor / hack / AI sandbox escape),
minute by minute, 4 hours ahead (240 minutes x 5 quantiles
[0.05, 0.25, 0.5, 0.75, 0.95]).

## Model (`main.ts`, Node 22, standard library only, no network, deterministic)

Persistence with per-market recent volatility:

```
q_tau(h) = clamp(x + z_tau * sigma * sqrt(h) * m_tau, 0, 1), rounded to 6 dp
```

- `x` — the market's last price at the checkpoint (the median stays put).
- `sigma` — the sample standard deviation of the market's 1-minute price
  changes over the last 120 minutes (fewer if the market is younger),
  floored at 0.001 and capped at 0.03 price units per sqrt-minute.
- `z_tau` — the standard normal quantile at level tau.
- `m_tau` — 0.5 for tau in {0.05, 0.95}, 0.3 for tau in {0.25, 0.75}, 0 at
  the median: prices usually do not move at all, so the middle of the band
  is tighter than the tails.

The practice cases are cut from Polymarket's "Next CEO of NVIDIA?" event
(the FAA markets are too new to cut a practice from), so this is the same
forecaster that scored 0.2736 mean pinball on that event's practice set —
re-verified on this competition's identical practice cases (see below).

## Why this, and what was tried and rejected

Checked on the six practice cases (p00–p05) with a local pinball-loss
scorer (mean pinball x100, percentage points):

| model | mean | p00 | p01 | p02 | p03 | p04 | p05 |
|---|---|---|---|---|---|---|---|
| house baseline (fixed sigma 0.0025) | 0.3636 | 0.536 | 0.380 | 0.408 | 0.369 | 0.299 | 0.238 |
| **this entry (inner 0.3, floor 0.001)** | **0.2736** | 0.486 | 0.310 | 0.364 | 0.235 | 0.204 | 0.113 |

Better than baseline on every practice case, not just on average.

Rejected on the same practice data:

- **Mean reversion** toward a trailing mean and **trend extrapolation**:
  both lost badly on cases where a trend kept running.
- **Logit-space spreads**, **long-window volatility** (720/1440 min),
  **Student-t quantiles**, **MAD / winsorized sigma**, **EWMA volatility**:
  all worse than the plain 120-minute std.
- **Lower sigma cap (0.02 instead of 0.03)**: looked better on practice
  (0.2715) but the gain came from exactly 2 of 128 markets — a
  single-observation artifact, so the cap stays at 0.03.
- **Jump boost** (widen the tails up to 2x after a >0.05 one-minute move
  in the window): 0.2802 vs 0.2736 — the widened bands cost more on the
  many quiet minutes than they save on the rare jumps.

The remaining loss is dominated by a few unpredictable jumps. Nothing in
the price history predicts those, so the model stays simple and robust
rather than fitted to them. Note the practice score is no guide to the
final: the final runs on the FAA markets, whose news-driven jumps may be
larger than the NVIDIA event's.

## Local testing

- `node main.ts` with `MAKEFUN_INPUT_DIR` / `MAKEFUN_OUTPUT_DIR` set
  (defaults `/input` and `/output`). Two runs on the same case are
  byte-identical.
- The practice scores above come from a local scorer that takes realized
  prices from the next case file (p00–p04) and from Polymarket's public
  CLOB `prices-history` endpoint for p05's window (2026-11-13 02:00–06:00
  UTC), gridded the way the kit's NOTICE.txt describes.
