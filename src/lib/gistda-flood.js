// Flood extent seen by radar satellites (Sentinel-1, RADARSAT-2), from GISTDA's open disaster API (Features API, collection flood/7days).
// Each API feature is one ~0.1 km² hexagon that was still flooded in the newest satellite pass; we checked on 2026-09-30 that summing them
// per province reproduces GISTDA's own dashboard exactly (Ayutthaya: 216,824 rai, 69,159 people). DOM-free (used by scripts/sync-gistda.mjs).
// Radar sees open water and flooded fields well and dense city streets badly, and a pass happens only every few days — so this is a
// picture of the outskirts and the upstream provinces, NOT a substitute for the street-level reports.

export const RAI_M2 = 1600;
export const CELL = 0.005; // degrees ≈ 550 m
// Bangkok, its five neighbouring provinces and Ayutthaya (the upstream province whose water reaches Bangkok)
export const PROVINCES = {
  10: 'กรุงเทพมหานคร',
  11: 'สมุทรปราการ',
  12: 'นนทบุรี',
  13: 'ปทุมธานี',
  73: 'นครปฐม',
  74: 'สมุทรสาคร',
  14: 'พระนครศรีอยุธยา',
};

export const centroid = (g) => {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const poly of g?.coordinates || []) {
    const ring = poly[0] || [];
    const closed = ring.length > 1 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1];
    for (const [x, y] of closed ? ring.slice(0, -1) : ring) { // a closed ring repeats its first vertex — count it once
      sx += x;
      sy += y;
      n += 1;
    }
  }
  return n ? [sx / n, sy / n] : null;
};

// "rd2_20260926_0613, S1C_20260928_0550" → ["2026-09-26", "2026-09-28"]
export const passDates = (fileName) =>
  [...new Set([...String(fileName || '').matchAll(/_(20\d{2})(\d{2})(\d{2})_/g)].map((m) => `${m[1]}-${m[2]}-${m[3]}`))].sort();

// featuresByProvince: { [pv_idn]: GeoJSON features[] } → compact snapshot
//   cells: [lat, lng, rai, people, pvId] per ~550 m cell (location = flooded-area-weighted centre)
export function aggregateFlood(featuresByProvince, now = Date.now()) {
  const provinces = [];
  const cells = new Map();
  let first = null;
  let last = null;
  for (const [pv, feats] of Object.entries(featuresByProvince)) {
    const tot = { id: +pv, name: PROVINCES[pv] || String(pv), polygons: 0, rai: 0, people: 0, buildings: 0, rice: 0 };
    for (const f of feats) {
      const p = f.properties || {};
      const c = centroid(f.geometry);
      if (!c) continue;
      const m2 = p.f_area || 0;
      const rai = m2 / RAI_M2;
      const people = p.population || 0;
      tot.polygons += 1;
      tot.rai += rai;
      tot.people += people;
      tot.buildings += p.building || 0;
      tot.rice += (p.rice_area || 0) / RAI_M2;
      const d = passDates(p.file_name);
      if (d.length) {
        if (!first || d[0] < first) first = d[0];
        if (!last || d.at(-1) > last) last = d.at(-1);
      }
      const key = `${pv}:${Math.floor(c[1] / CELL)}:${Math.floor(c[0] / CELL)}`;
      const e = cells.get(key) || { pv: +pv, w: 0, x: 0, y: 0, rai: 0, people: 0 };
      e.w += m2;
      e.x += c[0] * m2;
      e.y += c[1] * m2;
      e.rai += rai;
      e.people += people;
      cells.set(key, e);
    }
    provinces.push({ ...tot, rai: Math.round(tot.rai), people: Math.round(tot.people), rice: Math.round(tot.rice) });
  }
  return {
    generatedAt: now,
    source: 'GISTDA (สทอภ.) Disaster Platform — พื้นที่น้ำท่วมจากภาพดาวเทียมเรดาร์',
    lastPass: last, // newest satellite pass date seen in the polygons
    firstPass: first,
    provinces,
    cells: [...cells.values()]
      .filter((e) => e.w > 0)
      .map((e) => [+(e.y / e.w).toFixed(4), +(e.x / e.w).toFixed(4), +e.rai.toFixed(1), Math.round(e.people), e.pv])
      .sort((a, b) => b[2] - a[2]),
  };
}
