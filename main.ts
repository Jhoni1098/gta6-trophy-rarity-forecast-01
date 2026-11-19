// gta6-trophy-rarity-forecast-01: forecast each Grand Theft Auto VI PS5 trophy's
// earn rate on Exophase at the case's target, as five quantiles a trophy.
//
// The model (written for this entry, standard library only, deterministic):
//
//   1. Each trophy's rate saturates: it rises as players reach the content
//      and levels off at the share of players who will ever earn it. We fit
//      that saturation per trophy, as a logistic in log-time with the
//      trophy's day-7 prior as its ceiling:
//        rate(t) = A / (1 + exp(-(a + b * ln(1 + hours since first read))))
//      where A is the prior. The fit uses only distinct reads (Exophase
//      holds a page unchanged between refreshes), weighted toward recent
//      reads (12-hour half-life), the slope shrunk toward the median slope
//      across trophies. The ceiling stops the extrapolation running away:
//      a power-law fit of the earned counts overshoots badly here, because
//      the counts grow both as players progress and as the tracked
//      population itself grows. The prior is a belief about a week after
//      launch, grounded in Rockstar's earlier launches (GTA V's story
//      finishes near half of players over its lifetime, Red Dead's near a
//      quarter; a 50-hour campaign a week in sits between them) and in the
//      trophy list itself (200 h to platinum, no online trophies, one
//      missable). It is never tuned on any answer: the answers are not in
//      the case files.
//   2. When the history is flat (no refresh yet, as on launch night) no
//      trend is estimable. Then the forecast is a mixture: a refresh brings
//      in players who have already been playing for hours, so the new rate
//      is (old holders + newcomers' holders) / (old + newcomers), where the
//      newcomers' earn rate for a trophy follows its day-7 prior (the
//      opening mission near-universal, late-story and grind trophies rare).
//      The tracked count is expected to grow severalfold at such a refresh,
//      as the rules document the first one doing.
//   3. The spread is a logit-normal band around the median, widening with
//      the horizon (random-walk style) and with each trophy's fit residual,
//      so a trophy whose trajectory is noisy gets a wider band than one
//      whose trend is clean.
//
// The output for a case is {"trophies":[{"id":n,"q":[q05,q25,q50,q75,q95]}, ...]},
// one row per trophy, quantiles non-decreasing, each 0.01..99.99, rounded to
// 4 decimals, at most 65,536 bytes. Two runs on the same case write the same
// bytes: no randomness, no clock reads, files in name order.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The quantile levels the contest scores, in the order each row lists them. */
const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
/** The standard normal's quantile at each level. */
const Z = [-1.645, -0.674, 0, 0.674, 1.645];
/** Hours after release the day-7 prior is anchored at. */
const PRIOR_HOURS = 168;
/** Release of Grand Theft Auto VI (the case's game.release_date). */
const RELEASE_MS = Date.parse('2026-11-19T00:00:00Z');

interface Trophy {
  id: number;
  name: string;
  description: string;
  tier: string;
  points: number;
  secret: boolean;
}

interface Read {
  slot: string;
  at: string;
  players_tracked: number;
  trophies_earned: number | null;
  rates: Array<number | null>;
}

interface Case {
  id: string;
  at: string;
  horizon_minutes: number;
  target: string;
  levels: number[];
  game: { name: string; platform: string; release_date: string; source: string };
  trophies: Trophy[];
  history: Read[];
  notes: string;
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const clampPct = (x: number): number => clamp(x, 0.01, 99.99);
const logit = (pct: number): number => {
  const p = clampPct(pct) / 100;
  return Math.log(p / (1 - p));
};
const invLogit = (l: number): number => clampPct(100 / (1 + Math.exp(-l)));
/** x rounded to 4 decimals. */
const round4 = (x: number): number => Math.round(x * 10000) / 10000;

/**
 * Day-7 earn-rate prior (percent) by trophy name: the share of Exophase's
 * tracked players expected to hold each trophy a week after launch. Story
 * chapters fall as the campaign goes on (a ~50-hour campaign; the mass of
 * players is still working through it at day 7), the final mission lower
 * still, side strands and miscellany in the teens, grind and collectible
 * trophies in the low single digits, the platinum and 100% completion near
 * zero (about 200 hours to platinum). "Just Like Paradise" is the opening
 * mission, so nearly every player who plays holds it.
 */
const PRIOR_BY_NAME: Record<string, number> = {
  'Vice Got a Price!': 0.3,
  'Just Like Paradise': 96,
  'Paradise Lost': 68,
  'T**s Ass Drug Money': 58,
  'Vice City, Baby!': 50,
  'Top Of The World, Ma': 44,
  'You Gotta Know When to Get Off': 34,
  'Trust': 46,
  'Break the Bank': 42,
  'Family Matters': 40,
  'DWNFALL': 38,
  'Hi-Jacked': 36,
  'Snow Storm': 34,
  'A Long Road': 0.8,
  'Cunning Stunts': 2.0,
  'Master of None': 30,
  'The Shootist': 3.0,
  'Top Fun': 4.0,
  'Earn Cash, Not Kudos': 12,
  'Baited My Tackle': 20,
  'Stick Fiddler': 25,
  'Road to Rehabilitation': 14,
  'This Was No Boat Accident': 13,
  'The Lone Rider': 12,
  'Strangers & Freaks': 7,
  'Supply & Demand': 12,
  'Spin On This!': 11,
  'Positive Mental Attitude': 4,
  'Fair Game': 8,
  "Don't Touch My Deck": 3.0,
  'You WAiNKer!': 1.5,
  'One Last Thing': 5,
  'Hot Together': 18,
  'Retail Therapy': 15,
  'Whip It Good': 22,
  'Gunslinger': 22,
  'Catch Me If You Can': 6,
  'Challenging Tank': 5,
  'Sneakthief': 12,
  'Maximum Withdrawal': 6,
  'A Classic Blitz Play': 18,
  'The Goodtime State': 10,
  'Pest Control': 7,
  'In The Beginning…': 10,
  'Capital Offense': 8,
  "Let’s Go Bowling": 12,
  'Personal Best': 6,
  'Actions Speak Louder': 8,
  'Bad Luck, I Guess': 5,
  'The Truth Is Out There': 4,
  'Ten Pin': 7,
  'Dime on the Dollar': 9,
  'Treat Yo Self': 14,
  'Little Boxes': 6,
  'On the Spot': 12,
};

/** Fallback day-7 prior when a trophy's name is not in the table above. */
function priorFor(t: Trophy): number {
  const byName = PRIOR_BY_NAME[t.name];
  if (byName !== undefined) return byName;
  const d = t.description.toLowerCase();
  if (d.includes('congratulations!')) return 0.3; // the platinum
  if (d.includes('100% completion')) return 0.8;
  if (d.includes('complete chapter 1')) return 68;
  if (d.includes('complete chapter 2')) return 58;
  if (d.includes('complete chapter 3')) return 50;
  if (d.includes('complete chapter 4')) return 44;
  if (d.includes('complete the final mission')) return 34;
  if (d.includes('complete') && d.includes('chapter')) return 45;
  if (d.includes('stunts')) return 2;
  if (d.includes('gold medal')) return 3;
  if (d.includes('collectible')) return 3;
  if (d.includes('meditate')) return 4;
  if (t.tier === 'platinum') return 0.3;
  if (t.tier === 'gold') return 5;
  if (t.tier === 'silver') return 4;
  return 10;
}

/** Weighted least squares of y on x; returns intercept, slope, residual std. */
function wls(
  xs: number[],
  ys: number[],
  ws: number[],
): { a: number; b: number; resid: number } {
  let sw = 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < xs.length; i++) {
    sw += ws[i];
    sx += ws[i] * xs[i];
    sy += ws[i] * ys[i];
  }
  const mx = sx / sw;
  const my = sy / sw;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - mx;
    sxx += ws[i] * dx * dx;
    sxy += ws[i] * dx * (ys[i] - my);
  }
  const b = sxx > 1e-12 ? sxy / sxx : 0;
  const a = my - b * mx;
  let sr = 0;
  for (let i = 0; i < xs.length; i++) {
    const r = ys[i] - (a + b * xs[i]);
    sr += ws[i] * r * r;
  }
  const resid = Math.sqrt(sr / sw);
  return { a, b, resid };
}

/** The share of a newly arriving cohort of players expected to hold a trophy.
 * A refresh brings in players who have already been playing for hours, so
 * they are not empty-handed: the opening mission is near-universal among
 * them, early chapters common, late-story and grind trophies rare. The
 * day-7 prior stands in for how early a trophy is earned: near-universal
 * trophies are earned in the first minutes, the rest in proportion to the
 * square of their day-7 rate. */
function earlyRate(t: Trophy): number {
  const p7 = priorFor(t);
  if (p7 >= 90) return 0.95;
  return Math.min(0.5, Math.pow(p7 / 100, 2) * 0.3);
}

/** Forecast one case into five quantiles per trophy. */
function forecast(c: Case): Array<{ id: number; q: number[] }> {
  const horizonDays = c.horizon_minutes / 1440;
  const targetMs = Date.parse(c.target);
  const releaseMs = c.game && c.game.release_date ? Date.parse(`${c.game.release_date}T00:00:00Z`) : RELEASE_MS;
  const hoursTargetSinceRelease = Math.max(0.1, (targetMs - releaseMs) / 3600000);

  // Distinct reads: consecutive reads that print the same page are one
  // observation (Exophase holds a page unchanged between refreshes).
  const reads = c.history.filter((r) => r && r.players_tracked > 0 && Array.isArray(r.rates));
  const distinct: Read[] = [];
  for (const r of reads) {
    const prev = distinct[distinct.length - 1];
    if (
      prev &&
      prev.players_tracked === r.players_tracked &&
      prev.rates.length === r.rates.length &&
      prev.rates.every((v, i) => v === r.rates[i])
    ) {
      continue;
    }
    distinct.push(r);
  }
  if (distinct.length === 0) {
    // No history at all: fall back to the priors at the target time.
    return c.trophies.map((t) => {
      const m = priorFor(t);
      const s = 1.0;
      const q = Z.map((z) => round4(invLogit(logit(m) + z * s)));
      return { id: t.id, q: monotonic(q) };
    });
  }

  const t0 = Date.parse(distinct[0].at);
  const last = distinct[distinct.length - 1];
  const lastMs = Date.parse(last.at);
  const xOf = (ms: number): number => Math.log(1 + Math.max(0, (ms - t0) / 3600000));
  const xT = xOf(targetMs);
  const xs = distinct.map((r) => xOf(Date.parse(r.at)));
  // Recent reads weigh more: a 12-hour half-life.
  const ws = distinct.map((r) => Math.pow(0.5, Math.max(0, (lastMs - Date.parse(r.at)) / 3600000) / 12));

  const n = c.trophies.length;
  const lastRate: number[] = c.trophies.map((_, i) => {
    for (let k = distinct.length - 1; k >= 0; k--) {
      const v = distinct[k].rates[i];
      if (v !== null && v !== undefined && Number.isFinite(v)) return v;
    }
    return priorFor(c.trophies[i]);
  });

  const hasTrend = distinct.length >= 2;

  // First pass: per-trophy logistic fits of the rate toward its day-7
  // prior, rate(t) = A / (1 + exp(-(a + b * x))). The fitted quantity is
  // the log-odds of rate/A, so the curve saturates at the prior instead of
  // running away. Rates above the prior (the hardcore launch-night
  // population) are clamped into the fit; recent reads weigh most.
  interface Fit {
    a: number;
    b: number;
    resid: number;
    npts: number;
  }
  const fits: Array<Fit | null> = [];
  const slopes: number[] = [];
  for (let i = 0; i < n; i++) {
    const a0 = priorFor(c.trophies[i]);
    const px: number[] = [];
    const py: number[] = [];
    const pw: number[] = [];
    if (hasTrend) {
      for (let k = 0; k < distinct.length; k++) {
        const v = distinct[k].rates[i];
        if (v === null || v === undefined || !Number.isFinite(v) || v <= 0.001) continue;
        const q = clamp(v / a0, 0.001, 0.999);
        px.push(xs[k]);
        py.push(Math.log(q / (1 - q)));
        pw.push(ws[k]);
      }
    }
    if (px.length >= 3) {
      const f = wls(px, py, pw);
      const b = clamp(f.b, -1, 3);
      fits.push({ a: f.a, b, resid: f.resid, npts: px.length });
      slopes.push(b);
    } else {
      fits.push(null);
    }
  }
  // The common slope all trophies share, for shrinking thin fits toward.
  slopes.sort((x, y) => x - y);
  const bCommon = slopes.length > 0 ? slopes[Math.floor(slopes.length / 2)] : 0;

  const out: Array<{ id: number; q: number[] }> = [];
  for (let i = 0; i < n; i++) {
    const t = c.trophies[i];
    const p7 = priorFor(t);
    let median: number;
    let spread: number;

    const fit = fits[i];
    if (hasTrend && fit !== null) {
      // Shrink this trophy's slope toward the common slope: more points,
      // more trust in its own.
      const wData = Math.min(1, fit.npts / 8) * 0.8 + 0.2;
      const b = wData * fit.b + (1 - wData) * bCommon;
      const qT = 1 / (1 + Math.exp(-(fit.a + b * xT)));
      median = clampPct(p7 * qT);
      const resid = clamp(fit.resid, 0, 0.8);
      spread = Math.sqrt(0.3 * 0.3 + Math.pow(0.45 * Math.sqrt(horizonDays), 2) + resid * resid);
    } else if (hasTrend) {
      // A trend exists for the population but this trophy has too few
      // readable rates to fit: let its rate drift from where it stands
      // toward the prior over the horizon.
      const u = clamp(Math.log(1 + hoursTargetSinceRelease) / Math.log(1 + PRIOR_HOURS), 0, 1);
      median = invLogit((1 - u) * logit(lastRate[i]) + u * logit(p7));
      spread = Math.sqrt(0.55 * 0.55 + Math.pow(0.5 * Math.sqrt(horizonDays), 2));
    } else {
      // Flat history: no refresh yet, so no trend. A refresh is coming, and
      // it brings players who have already been playing for hours. The new
      // rate is the mixture of the old holders and the newcomers:
      //   r_new = (r + (G - 1) * q) / G
      // where G is how much the tracked count grows at the refresh (the
      // rules document the first one growing it about sixfold) and q is the
      // newcomers' earn rate for the trophy. The opening mission stays near
      // 100% because every newcomer has already done it; late-story and
      // grind trophies fall because the newcomers have not reached them.
      const g = 1 + 5 * (1 - Math.exp(-horizonDays / 0.1));
      const q = earlyRate(t);
      median = clampPct(100 * ((lastRate[i] / 100 + (g - 1) * q) / g));
      spread = Math.sqrt(0.8 * 0.8 + Math.pow(0.5 * Math.sqrt(horizonDays), 2));
    }

    const base = logit(median);
    const q = Z.map((z) => round4(invLogit(base + z * spread)));
    out.push({ id: t.id, q: monotonic(q) });
  }
  return out;
}

/** Enforce non-decreasing quantiles (a running max, after rounding). */
function monotonic(q: number[]): number[] {
  const r: number[] = [];
  let prev = -Infinity;
  for (const v of q) {
    const x = Math.max(v, prev);
    r.push(x);
    prev = x;
  }
  return r;
}

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  if (c.levels.length !== LEVELS.length || c.levels.some((t, j) => t !== LEVELS[j])) {
    throw new Error(`${file} asks for levels ${JSON.stringify(c.levels)}, not ${JSON.stringify(LEVELS)}`);
  }
  if (!Array.isArray(c.trophies) || c.trophies.length === 0) {
    throw new Error(`${file} has no trophies`);
  }
  if (!Array.isArray(c.history)) {
    throw new Error(`${file} has no history`);
  }
  const trophies = forecast(c);
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ trophies })}\n`);
}
