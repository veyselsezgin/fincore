import { growth } from '../core/math.js';
import { Trace, type Result } from '../core/result.js';
import { percentileSorted, Rng } from '../core/stats.js';

export type Distribution =
  | { type: 'fixed'; value: number }
  | { type: 'normal'; mean: number; sd: number }
  | { type: 'triangular'; min: number; mode: number; max: number }
  | { type: 'uniform'; min: number; max: number };

export interface MonteCarloNpvInput {
  /** Discount rate per period: a fixed number or a distribution. */
  rate: number | Distribution;
  /** One distribution per period; index i is discounted i periods (t = 0 first). */
  cashFlows: Distribution[];
  iterations?: number;
  seed?: number;
  histogramBins?: number;
}

export interface HistogramBin {
  x0: number;
  x1: number;
  count: number;
}

export interface MonteCarloNpvOutput {
  iterations: number;
  seed: number;
  mean: number;
  sd: number;
  min: number;
  max: number;
  probabilityPositive: number;
  /** Standard error of `probabilityPositive`: sqrt(p(1−p)/n). */
  probabilityStdError: number;
  percentiles: { p: number; value: number }[];
  histogram: HistogramBin[];
  /** NPV with every input at its expected value. */
  npvAtMeans: number;
  /** Rate draws at or below -100% that were re-drawn. */
  rejectedRateDraws: number;
}

export const MC_MAX_ITERATIONS = 200_000;

export function distributionMean(d: Distribution): number {
  switch (d.type) {
    case 'fixed':
      return d.value;
    case 'normal':
      return d.mean;
    case 'triangular':
      return (d.min + d.mode + d.max) / 3;
    case 'uniform':
      return (d.min + d.max) / 2;
  }
}

export function sample(d: Distribution, rng: Rng): number {
  switch (d.type) {
    case 'fixed':
      return d.value;
    case 'normal':
      return d.mean + d.sd * rng.normal();
    case 'uniform':
      return d.min + (d.max - d.min) * rng.uniform();
    case 'triangular': {
      const { min: a, mode: c, max: b } = d;
      if (b === a) return a;
      const u = rng.uniform();
      const fc = (c - a) / (b - a);
      return u < fc
        ? a + Math.sqrt(u * (b - a) * (c - a))
        : b - Math.sqrt((1 - u) * (b - a) * (b - c));
    }
  }
}

/** Returns an error message, or null when the distribution is valid. */
export function validateDistribution(d: unknown): string | null {
  if (typeof d !== 'object' || d === null) return 'Missing distribution.';
  const x = d as Record<string, unknown>;
  const fin = (k: string) => typeof x[k] === 'number' && Number.isFinite(x[k]);
  switch (x.type) {
    case 'fixed':
      return fin('value') ? null : 'Value must be a number.';
    case 'normal':
      if (!fin('mean') || !fin('sd')) return 'Mean and standard deviation must be numbers.';
      return (x.sd as number) < 0 ? 'Standard deviation cannot be negative.' : null;
    case 'uniform':
      if (!fin('min') || !fin('max')) return 'Min and max must be numbers.';
      return (x.min as number) > (x.max as number) ? 'Min must not exceed max.' : null;
    case 'triangular': {
      if (!fin('min') || !fin('mode') || !fin('max'))
        return 'Min, most likely and max must be numbers.';
      const { min, mode, max } = x as { min: number; mode: number; max: number };
      return min <= mode && mode <= max ? null : 'Need min ≤ most likely ≤ max.';
    }
    default:
      return 'Unknown distribution type.';
  }
}

/** Monte Carlo simulation of NPV with independent, seeded draws. */
export function monteCarloNpv(input: MonteCarloNpvInput): Result<MonteCarloNpvOutput> {
  const t = new Trace('analysis.monteCarloNpv');
  const iterations = input.iterations ?? 10_000;
  const seed = input.seed ?? 1;
  const bins = input.histogramBins ?? 40;

  if (!Number.isInteger(iterations) || iterations < 100 || iterations > MC_MAX_ITERATIONS) {
    t.error({
      code: 'INVALID_ITERATIONS',
      message: `Iterations must be a whole number from 100 to ${MC_MAX_ITERATIONS.toLocaleString('en-US')}.`,
      field: 'iterations',
    });
  }
  if (!Number.isInteger(seed))
    t.error({ code: 'INVALID_SEED', message: 'Seed must be a whole number.', field: 'seed' });
  if (!Array.isArray(input.cashFlows) || input.cashFlows.length < 2) {
    t.error({
      code: 'TOO_FEW_VALUES',
      message: 'At least 2 cash flows are required.',
      field: 'cashFlows',
    });
  } else {
    input.cashFlows.forEach((d, i) => {
      const msg = validateDistribution(d);
      if (msg)
        t.error({
          code: 'INVALID_DISTRIBUTION',
          message: `Cash flow ${i}: ${msg}`,
          params: { index: i },
          field: 'cashFlows',
        });
    });
  }
  const rateDist: Distribution =
    typeof input.rate === 'number' ? { type: 'fixed', value: input.rate } : input.rate;
  const rateMsg = validateDistribution(rateDist);
  if (rateMsg)
    t.error({ code: 'INVALID_DISTRIBUTION', message: `Discount rate: ${rateMsg}`, field: 'rate' });
  else if (distributionMean(rateDist) <= -1) {
    t.error({
      code: 'RATE_OUT_OF_DOMAIN',
      message: 'The expected discount rate must be above -100%.',
      field: 'rate',
    });
  }
  if (t.hasErrors) return t.fail();

  t.assume(
    'independence',
    'Each cash flow is drawn independently: no correlation between periods is modelled.',
  );
  t.assume(
    'timing',
    'The first cash flow occurs today (t = 0); each following flow is one period later.',
  );
  t.assume(
    'seed',
    `Pseudo-random generator xoshiro128** with seed ${seed}: the same inputs and seed always give the same result.`,
  );
  t.assume('percentiles', 'Percentiles use linear interpolation (Excel PERCENTILE.INC).');

  const rng = new Rng(seed);
  const n = input.cashFlows.length;
  const results = new Float64Array(iterations);
  let rejected = 0;
  let positive = 0;
  let sum = 0;
  for (let k = 0; k < iterations; k++) {
    let r = sample(rateDist, rng);
    let guard = 0;
    while (r <= -1 && guard++ < 1000) {
      rejected++;
      r = sample(rateDist, rng);
    }
    let v = 0;
    let disc = 1;
    const f = 1 / (1 + r);
    for (let i = 0; i < n; i++) {
      v += sample(input.cashFlows[i]!, rng) * disc;
      disc *= f;
    }
    results[k] = v;
    sum += v;
    if (v > 0) positive++;
  }
  const mean = sum / iterations;
  let ss = 0;
  for (let k = 0; k < iterations; k++) ss += (results[k]! - mean) ** 2;
  const sd = Math.sqrt(ss / (iterations - 1));
  results.sort();
  const min = results[0]!;
  const max = results[iterations - 1]!;
  const p = positive / iterations;
  const se = Math.sqrt((p * (1 - p)) / iterations);

  const percentiles = [0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95].map((q) => ({
    p: q,
    value: percentileSorted(results, q),
  }));
  const histogram = buildHistogram(results, bins);
  const meanRate = distributionMean(rateDist);
  const npvAtMeans = input.cashFlows.reduce(
    (s, d, i) => s + distributionMean(d) / growth(meanRate, i),
    0,
  );

  if (rejected > 0) {
    t.warn({
      code: 'RATE_DRAWS_REJECTED',
      message: `${rejected} discount-rate draws at or below -100% were re-drawn; the rate distribution is effectively truncated.`,
      params: { rejected },
    });
  }
  t.step('iterations', 'Iterations', iterations);
  t.step('npvAtMeans', 'NPV with every input at its expected value', npvAtMeans);
  t.step('mean', 'Mean simulated NPV', mean, '\\bar{X} = \\frac{1}{N}\\sum NPV_k');
  t.step('sd', 'Standard deviation of NPV', sd);
  t.step(
    'probabilityPositive',
    'Probability that NPV > 0',
    p,
    'P(NPV>0) = \\frac{\\#\\{NPV_k>0\\}}{N}',
  );
  t.step('probabilityStdError', 'Standard error of that probability', se, '\\sqrt{p(1-p)/N}');
  return t.ok({
    iterations,
    seed,
    mean,
    sd,
    min,
    max,
    probabilityPositive: p,
    probabilityStdError: se,
    percentiles,
    histogram,
    npvAtMeans,
    rejectedRateDraws: rejected,
  });
}

function buildHistogram(sorted: Float64Array, bins: number): HistogramBin[] {
  const min = sorted[0]!;
  const max = sorted[sorted.length - 1]!;
  if (min === max) return [{ x0: min, x1: max, count: sorted.length }];
  const width = (max - min) / bins;
  const out: HistogramBin[] = Array.from({ length: bins }, (_, i) => ({
    x0: min + i * width,
    x1: min + (i + 1) * width,
    count: 0,
  }));
  for (const v of sorted) out[Math.min(bins - 1, Math.floor((v - min) / width))]!.count++;
  return out;
}
