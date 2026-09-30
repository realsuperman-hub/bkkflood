// "Repeat flood spots": where citizens reported flooding (Traffy Fondue "น้ำท่วม" complaints) on MANY different days.
// A spot that floods again and again points to a low pocket, an underpass or a weak drain — things the coarse elevation model cannot see.
// These are complaints, not measurements: the count says "people reported it on N separate days", never "the water was X deep".
// DOM-free (used by scripts/build-flood-history.mjs and the browser).

export const CELL = 0.0025; // degrees ≈ 275 m
const DAY_MS = 86400e3;
export const dayNo = (t) => Math.floor((t + 7 * 3600e3) / DAY_MS); // Bangkok calendar day
export const dayIso = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);
export const cellOf = (lat, lng) => [Math.floor(lat / CELL), Math.floor(lng / CELL)];

// floods: [{ id, lat, lng, t, lvl }] → cells reported on ≥ minDays different days.
// cell = [latIdx, lngIdx, days, complaints, maxSeverity, firstDay, lastDay]
export function aggregateHistory(floods, { minDays = 2 } = {}) {
  const seen = new Set();
  const byCell = new Map();
  for (const f of floods) {
    if (f.id !== undefined && f.id !== null) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
    }
    const [i, j] = cellOf(f.lat, f.lng);
    const k = `${i},${j}`;
    let c = byCell.get(k);
    if (!c) byCell.set(k, (c = { i, j, days: new Set(), n: 0, max: 0 }));
    c.days.add(dayNo(f.t));
    c.n += 1;
    c.max = Math.max(c.max, f.lvl || 1);
  }
  const cells = [];
  for (const c of byCell.values()) {
    if (c.days.size < minDays) continue;
    const d = [...c.days];
    cells.push([c.i, c.j, c.days.size, c.n, c.max, Math.min(...d), Math.max(...d)]);
  }
  return cells.sort((a, b) => b[2] - a[2] || b[3] - a[3]);
}

// The 3×3 block of cells around a point (≈ 400 m): the worst repeat count nearby and the total complaints.
export function nearbyHistory(cells, lat, lng) {
  if (!Array.isArray(cells)) return null;
  const [ci, cj] = cellOf(lat, lng);
  let days = 0;
  let n = 0;
  let max = 0;
  let last = 0;
  let count = 0;
  for (const c of cells) {
    if (Math.abs(c[0] - ci) > 1 || Math.abs(c[1] - cj) > 1) continue;
    count += 1;
    days = Math.max(days, c[2]);
    n += c[3];
    max = Math.max(max, c[4]);
    last = Math.max(last, c[6]);
  }
  return count ? { days, n, max, last, cells: count } : { days: 0, n: 0, max: 0, last: 0, cells: 0 };
}

// GeoJSON for the map layer
export function historyGeoJson(cells) {
  return {
    type: 'FeatureCollection',
    features: cells.map((c) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [(c[1] + 0.5) * CELL, (c[0] + 0.5) * CELL] },
      properties: { days: c[2], n: c[3], max: c[4], first: dayIso(c[5]), last: dayIso(c[6]) },
    })),
  };
}
