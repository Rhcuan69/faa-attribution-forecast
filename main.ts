// Entry for polymarket-faa-attribution-02: a persistence forecast whose band
// width follows each market's own recent volatility.
//
// The practice cases are cut from the NVIDIA CEO event (same shape: 4-hour
// horizon, five quantiles), so the forecaster is tuned for Yes prices that
// mostly sit still and sometimes jump. The house baseline gives every market
// the same spread (sigma 0.0025 per sqrt-minute, normal quantiles). This
// entry instead measures how much each market actually jiggled lately — the
// standard deviation of its 1-minute changes over the trailing 120 minutes —
// and centres the band on the checkpoint price, growing it with
// sqrt(horizon). The median is the last price: on the six practice cases,
// extrapolating a trend and pulling back toward a trailing mean both lost to
// plain persistence, badly so on the cases where a trend kept running.
// Two calibrations, each verified on all six practice cases:
//   - the middle quantiles (0.25 / 0.75) take a 0.3 multiplier and the outer
//     ones (0.05 / 0.95) a 0.5 multiplier, because prices usually do not move
//     at all, so the centre of the band should be tighter than its tails
//     (the inner multiplier was grid-searched from 0.4 down to 0.3: mean
//     pinball 0.2759 -> 0.2736, better on four of the six cases);
//   - sigma is floored at 0.001, so a market that was flat for two hours
//     still gets a minimal band, and capped at 0.03, so one wild window
//     cannot blow the band up to something absurd. The cap is deliberately
//     left at 0.03: a 0.02 cap scored slightly better on practice (0.2715),
//     but the whole gain came from just 2 of 128 markets — a
//     single-observation artefact — and a wild market that really does jump
//     in the final cases would be punished hard by the tighter cap.
//     Also tried and REJECTED on this practice set: a "jump boost" that
//     widens the tails up to 2x after a one-minute move bigger than 0.05
//     inside the window (mean pinball 0.2802 against 0.2736 without it):
//     the wider bands cost more on the many quiet minutes than they save
//     on the rare jumps.
//
//   q_tau(h) = clamp(x + z_tau * sigma * sqrt(h) * m_tau, 0, 1), rounded to 6 dp
//
// where x is the market's last price, z_tau the standard normal quantile at
// tau, m_tau = 0.5 for tau in {0.05, 0.95} and 0.3 for tau in {0.25, 0.75},
// and 0 at the median. Deterministic, standard library only, no network:
// the same input always produces byte-identical output.
//
// To run it outside the grader: mkdir -p out && MAKEFUN_INPUT_DIR=input
// MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The quantile levels, in the order each output row lists them. */
const QUANTILES = [0.05, 0.25, 0.5, 0.75, 0.95];
/** Standard normal quantiles at those levels, to 6 decimals. */
const Z_SCORES = [-1.644854, -0.67449, 0, 0.67449, 1.644854];
/** Band multiplier per quantile: tight in the middle, wider at the tails. */
const SPREAD_MULT = [0.5, 0.3, 0, 0.3, 0.5];
/** How many trailing minutes of history feed the jitter measurement. */
const WINDOW_MINUTES = 120;
/** Smallest / largest per-minute sigma allowed, in price units. */
const SIGMA_MIN = 0.001;
const SIGMA_MAX = 0.03;

interface CaseMarket {
  id: string;
  prices: number[];
}

interface Case {
  horizon_minutes: number;
  quantiles: number[];
  markets: CaseMarket[];
}

/** Clamp x to [0, 1] and round to 6 decimals (0, never -0). */
function round6(x: number): number {
  return Math.round(Math.min(1, Math.max(0, x)) * 1e6) / 1e6 + 0;
}

/**
 * How jumpy a market has been lately: the sample standard deviation of its
 * 1-minute price changes over the trailing WINDOW_MINUTES minutes (fewer
 * when the market is younger), floored and capped.
 */
function windowSigma(prices: number[]): number {
  const start = Math.max(0, prices.length - WINDOW_MINUTES);
  const diffs: number[] = [];
  for (let i = start + 1; i < prices.length; i++) {
    diffs.push(prices[i] - prices[i - 1]);
  }
  if (diffs.length < 1) return SIGMA_MIN;
  let mean = 0;
  for (const d of diffs) mean += d;
  mean /= diffs.length;
  let sq = 0;
  for (const d of diffs) {
    const centred = d - mean;
    sq += centred * centred;
  }
  const denom = diffs.length - 1 > 0 ? diffs.length - 1 : 1;
  const sigma = Math.sqrt(sq / denom);
  return Math.min(SIGMA_MAX, Math.max(SIGMA_MIN, sigma));
}

/** One market's forecast: a row of five quantiles for each horizon minute. */
function forecastMarket(market: CaseMarket, horizon: number): number[][] {
  if (market.prices.length === 0) {
    throw new Error(`market ${market.id} has no prices`);
  }
  const x = market.prices[market.prices.length - 1];
  const sigma = windowSigma(market.prices);
  const rows: number[][] = [];
  for (let h = 1; h <= horizon; h++) {
    const spread = sigma * Math.sqrt(h);
    const row = Z_SCORES.map((z, k) => round6(x + z * spread * SPREAD_MULT[k]));
    // Rounding can (rarely) invert two neighbours; keep the row ordered.
    for (let k = 1; k < row.length; k++) {
      if (row[k] < row[k - 1]) row[k] = row[k - 1];
    }
    rows.push(row);
  }
  return rows;
}

mkdirSync(OUTPUT_DIR, { recursive: true });
// Case files in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  if (c.quantiles.length !== QUANTILES.length || c.quantiles.some((t, j) => t !== QUANTILES[j])) {
    throw new Error(`${file} asks for quantiles ${JSON.stringify(c.quantiles)}, not ${JSON.stringify(QUANTILES)}`);
  }
  const forecasts = c.markets.map((m) => ({ id: m.id, q: forecastMarket(m, c.horizon_minutes) }));
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ forecasts })}\n`);
}
