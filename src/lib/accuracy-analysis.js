// Deeper look at the logged forecasts (see accuracy.js): threshold-free skill (AUC), event rate by score, by place, and "what if" variants of the
// low-ground rule re-scored from the logged scores. Pure — used by scripts/analyze-accuracy.mjs and unit-tested.
import { contingency } from './accuracy.js';

export const levelOfScore = (s) => (s >= 7 ? 3 : s >= 5 ? 2 : s >= 3 ? 1 : 0); // same cut-offs as risk.js

// Mann–Whitney AUC = chance that a random event sample scores higher than a random non-event sample (ties count half). 0.5 = no skill.
export function auc(samples, scoreOf) {
  const ev = [];
  const non = [];
  for (const s of samples) (s.event ? ev : non).push(scoreOf(s));
  if (!ev.length || !non.length) return null;
  const all = [...ev.map((v) => [v, 1]), ...non.map((v) => [v, 0])].sort((a, b) => a[0] - b[0]);
  let rankSumEv = 0;
  for (let i = 0; i < all.length; ) {
    let j = i;
    while (j < all.length && all[j][0] === all[i][0]) j++;
    const rank = (i + 1 + j) / 2; // average rank of the tie group
    for (let k = i; k < j; k++) if (all[k][1]) rankSumEv += rank;
    i = j;
  }
  return +((rankSumEv - (ev.length * (ev.length + 1)) / 2) / (ev.length * non.length)).toFixed(3);
}

// event rate for each value of a key (e.g. score 0,1,2…): [{ key, n, events, rate }]
export function bandRates(samples, keyOf) {
  const m = new Map();
  for (const s of samples) {
    const k = keyOf(s);
    const o = m.get(k) || { key: k, n: 0, events: 0 };
    o.n++;
    if (s.event) o.events++;
    m.set(k, o);
  }
  return [...m.values()].map((o) => ({ ...o, rate: +(o.events / o.n).toFixed(3) })).sort((a, b) => a.key - b.key);
}

export function spearman(xs, ys) {
  const rank = (a) => {
    const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
    const r = new Array(a.length);
    for (let i = 0; i < idx.length; ) {
      let j = i;
      while (j < idx.length && idx[j][0] === idx[i][0]) j++;
      for (let k = i; k < j; k++) r[idx[k][1]] = (i + 1 + j) / 2;
      i = j;
    }
    return r;
  };
  const n = xs.length;
  if (n < 3) return null;
  const rx = rank(xs), ry = rank(ys);
  const mx = rx.reduce((a, b) => a + b, 0) / n, my = ry.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (rx[i] - mx) * (ry[i] - my); sxx += (rx[i] - mx) ** 2; syy += (ry[i] - my) ** 2; }
  return sxx && syy ? +(sxy / Math.sqrt(sxx * syy)).toFixed(3) : null;
}

// per grid point: how high the system scored there on average vs how often a complaint followed
export function cellStats(samples, grid) {
  const m = new Map();
  for (const s of samples) {
    const o = m.get(s.i) || { i: s.i, n: 0, sum: 0, events: 0 };
    o.n++;
    o.sum += s.score;
    if (s.event) o.events++;
    m.set(s.i, o);
  }
  return [...m.values()].map((o) => ({ i: o.i, lat: grid[o.i]?.[0], lng: grid[o.i]?.[1], n: o.n, meanScore: +(o.sum / o.n).toFixed(2), eventRate: +(o.events / o.n).toFixed(3) }));
}

// "what if" scores. A sample needs: score, fcScore, event, plus elev (1 if the low-ground +1 applied), tideHigh (bool), wet (bool: some rain signal in the forecast part)
export const VARIANTS = {
  current: (s) => s.score,
  noElevation: (s) => s.score - s.elev,
  elevOnlyWithHighTide: (s) => s.score - s.elev + (s.elev && s.tideHigh ? 1 : 0),
  elevOnlyWhenWet: (s) => s.score - s.elev + (s.elev && s.wet ? 1 : 0),
  elevOnlyWetAndHighTide: (s) => s.score - s.elev + (s.elev && s.wet && s.tideHigh ? 1 : 0),
};

export function variantReport(samples, scoreOf) {
  const lvl = (s) => levelOfScore(scoreOf(s));
  return {
    auc: auc(samples, scoreOf),
    byLevel: [1, 2, 3].map((th) => ({ th, ...contingency(samples, (s) => lvl(s) >= th) })),
    eventRateByLevel: bandRates(samples, lvl),
  };
}
