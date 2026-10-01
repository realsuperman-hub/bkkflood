// Which cameras the Monitoring Room shows, and in what order. DOM-free.
//   district: ''  nothing chosen yet → only AI-flagged and favourite cameras
//             '*' every camera        '@' nearest to `here` (within 12 km)        otherwise a district name (เขต)
// Order: AI-flagged first, then favourites, then by distance ('@') or by name.

const R = 6371000;
export function metersBetween(aLat, aLng, bLat, bLng) {
  const t = (x) => (x * Math.PI) / 180;
  const h = Math.sin(t(bLat - aLat) / 2) ** 2 + Math.cos(t(aLat)) * Math.cos(t(bLat)) * Math.sin(t(bLng - aLng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const NEAR_M = 12000;

export function pickCams(cams, { district = '', here = null, aiOnly = false, favOnly = false, ai = new Map(), favs = new Set() } = {}) {
  let list = (cams || []).map((c) => ({ c, m: here ? metersBetween(here.lat, here.lng, c.lat, c.lng) : null }));
  if (aiOnly) list = list.filter((x) => ai.has(x.c.id));
  else if (favOnly) list = list.filter((x) => favs.has(x.c.id));
  else if (district === '@') list = here ? list.filter((x) => x.m <= NEAR_M) : [];
  else if (district === '') list = list.filter((x) => ai.has(x.c.id) || favs.has(x.c.id));
  else if (district !== '*') list = list.filter((x) => x.c.d === district);
  const rank = (x) => (ai.has(x.c.id) ? 0 : favs.has(x.c.id) ? 1 : 2);
  list.sort((a, b) => rank(a) - rank(b) || (district === '@' ? a.m - b.m : 0) || a.c.n.localeCompare(b.c.n, 'th') || a.c.id.localeCompare(b.c.id));
  return list.map((x) => x.c);
}

// districts with at least one camera, biggest first → [{ name, n }]
export function districtList(cams) {
  const m = new Map();
  for (const c of cams || []) if (c.d) m.set(c.d, (m.get(c.d) || 0) + 1);
  return [...m].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'th'));
}
