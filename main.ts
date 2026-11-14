// polymarket-faa-attribution-02 entry: persistence with per-market recent volatility.
//
// Same shape as the NVIDIA CEO forecast (the practice cases ARE the NVIDIA
// event's prices, same 4-hour horizon, same five quantiles): over four hours
// these Yes prices usually sit still and occasionally jump. The house
// baseline spreads every market identically (sigma 0.0025 / sqrt-min, normal
// quantiles). This entry instead measures each market's own recent jitter —
// the standard deviation of its 1-minute price changes over the last 120
// minutes — and spreads around the checkpoint price with that, widening like
// sqrt(horizon). The median stays at the last price: on the practice cases
// neither trend extrapolation nor reversion toward a trailing mean beat plain
// persistence, and both lost badly on the cases where a trend kept running.
// Two small calibrations, both checked on all six practice cases:
//   - the inner quantiles (0.25 / 0.75) use a 0.3 multiplier, the outer
//     quantiles (0.05 / 0.95) a 0.5 multiplier: prices usually do not move at
//     all, so the middle of the band should be tighter than the tails
//     (0.4 -> 0.3 after a grid search on the practice cases: mean pinball
//     0.2759 -> 0.2736, better on four of six cases);
//   - sigma is floored at 0.001 (a market that was flat for two hours still
//     gets a minimal band) and capped at 0.03 (a market that just jumped
//     around should not get an absurdly wide band from one wild window).
//     The cap stays at 0.03 on purpose: lowering it to 0.02 looked better
//     on practice (0.2715) but the gain came from exactly 2 of 128 markets,
//     a single-observation artifact — a wild market that does jump on the
//     final cases would be punished hard by a tighter cap.
//     Also tested and REJECTED on this practice set: a "jump boost" that
//     widens the tails up to 2x after a >0.05 one-minute move in the window
//     (mean pinball 0.2802 vs 0.2736 without it) — the widened bands cost
//     more on the many quiet minutes than they save on the rare jumps.
//
//   q_tau(h) = clamp(x + z_tau * sigma * sqrt(h) * m_tau, 0, 1), rounded to 6 dp
//
// with x the market's last price, z_tau the standard normal quantile at tau,
// m_tau = 0.5 for tau in {0.05, 0.95}, 0.3 for tau in {0.25, 0.75}, 0 at the
// median. Deterministic, standard library only, no network: same input gives
// byte-identical output.
//
// Usage (outside the grader): mkdir -p out && MAKEFUN_INPUT_DIR=input
// MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** Quantile levels, in the order each output row lists them. */
const QUANTILES = [0.05, 0.25, 0.5, 0.75, 0.95];
/** Standard normal quantiles at those levels, to 6 decimals. */
const Z = [-1.644854, -0.67449, 0, 0.67449, 1.644854];
/** Spread multiplier per quantile: tighter in the middle, wider at the tails. */
const MULT = [0.5, 0.3, 0, 0.3, 0.5];
/** Minutes of recent history used to measure a market's own jitter. */
const VOL_WINDOW = 120;
/** Smallest / largest per-minute sigma allowed, in price units. */
const SIGMA_FLOOR = 0.001;
const SIGMA_CAP = 0.03;

interface CaseMarket {
  id: string;
  prices: number[];
}

interface Case {
  horizon_minutes: number;
  quantiles: number[];
  markets: CaseMarket[];
}

/** x clamped to [0, 1] and rounded to 6 decimals (0, never -0). */
function price6(x: number): number {
  return Math.round(Math.min(1, Math.max(0, x)) * 1e6) / 1e6 + 0;
}

/**
 * Per-minute jitter of a market: the sample standard deviation of its
 * 1-minute price changes over the last VOL_WINDOW minutes (fewer when the
 * market is younger), floored and capped.
 */
function recentSigma(prices: number[]): number {
  const start = Math.max(0, prices.length - VOL_WINDOW);
  const n = prices.length - start;
  if (n < 2) return SIGMA_FLOOR;
  let mean = 0;
  for (let i = start + 1; i < prices.length; i++) mean += prices[i] - prices[i - 1];
  mean /= n - 1;
  let sq = 0;
  for (let i = start + 1; i < prices.length; i++) {
    const d = prices[i] - prices[i - 1] - mean;
    sq += d * d;
  }
  const sigma = Math.sqrt(sq / (n - 2 > 0 ? n - 2 : 1));
  return Math.min(SIGMA_CAP, Math.max(SIGMA_FLOOR, sigma));
}

/** The forecast of one market: horizon rows of five quantiles around its last price. */
function forecast(market: CaseMarket, horizon: number): number[][] {
  if (market.prices.length === 0) throw new Error(`market ${market.id} has no prices`);
  const x = market.prices[market.prices.length - 1];
  const sigma = recentSigma(market.prices);
  const rows: number[][] = [];
  for (let h = 1; h <= horizon; h++) {
    const spread = sigma * Math.sqrt(h);
    const row = Z.map((z, k) => price6(x + z * spread * MULT[k]));
    for (let k = 1; k < row.length; k++) {
      if (row[k] < row[k - 1]) row[k] = row[k - 1];
    }
    rows.push(row);
  }
  return rows;
}

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  if (c.quantiles.length !== QUANTILES.length || c.quantiles.some((t, j) => t !== QUANTILES[j])) {
    throw new Error(`${file} asks for quantiles ${JSON.stringify(c.quantiles)}, not ${JSON.stringify(QUANTILES)}`);
  }
  const forecasts = c.markets.map((m) => ({ id: m.id, q: forecast(m, c.horizon_minutes) }));
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ forecasts })}\n`);
}
