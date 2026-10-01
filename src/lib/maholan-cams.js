// Still-image cameras collected by cctv.maholan.net (a community aggregator of public CCTV: BMA, iTIC/Longdo, DOH, Pakkret, ...). The maker told
// us the data is cleared for public-interest use. We keep only its catalogue (name, place, coordinates, original owner) and show a camera's
// latest frame by pointing an <img> at THEIR snapshot endpoint, only while someone has that camera open — nothing is copied or stored here.
// Their snapshot URL carries a time bucket (?t=) exactly like their own page does, so we share their CDN cache instead of adding origin load.
// DOM-free.

export const MAHOLAN = 'https://cctv.maholan.net';
export const MAHOLAN_API = `${MAHOLAN}/api/cameras`;
export const SNAP_MS = 30000; // one URL per 30 s per camera, same as their HLS-derived frames (they refresh ~25 s)
export const METRO = { s: 13.45, n: 14.15, w: 100.2, e: 100.95 }; // Bangkok + the surrounding provinces we cover

const ID = /^[\w.-]{1,60}$/;
export const isCamId = (id) => typeof id === 'string' && ID.test(id);
export const snapUrl = (id, now = Date.now(), ms = SNAP_MS) => `${MAHOLAN}/api/snap/${encodeURIComponent(id)}?t=${Math.floor(now / ms)}`;

const clean = (t, n) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, n);
export const inMetro = (lat, lng) => lat >= METRO.s && lat <= METRO.n && lng >= METRO.w && lng <= METRO.e;

// their /api/cameras → compact catalogue for our map (only cameras with coordinates inside our area)
export function normalizeCatalog(list) {
  const seen = new Set();
  const out = [];
  for (const c of list || []) {
    const lat = Number(c?.lat);
    const lng = Number(c?.lng);
    if (!isCamId(c?.id) || seen.has(c.id) || !Number.isFinite(lat) || !Number.isFinite(lng) || !inMetro(lat, lng)) continue;
    seen.add(c.id);
    out.push({ id: c.id, n: clean(c.name, 90), lat: +lat.toFixed(5), lng: +lng.toFixed(5), s: clean(c.source, 60), d: clean(c.district, 40) });
  }
  return out;
}

// frames older than this at probe time mean the owner's feed is stuck (e.g. one BMA drainage cam showed an image 34 days old)
export const MAX_FRAME_AGE_MS = 6 * 3600e3;
export function frameIsUsable({ status, bytes, imageTime }, now = Date.now()) {
  if (status !== 200 || !(bytes > 2000)) return false;
  const t = Date.parse(imageTime || '');
  return Number.isNaN(t) || now - t <= MAX_FRAME_AGE_MS;
}

// several cameras share one pole/crossing (CAM1, CAM2, CAM3…): everything within ~30 m of `c`, in name order, `c` included
export function sameSpot(cams, c, meters = 30) {
  const dLat = meters / 111320;
  const dLng = meters / (111320 * Math.cos((c.lat * Math.PI) / 180));
  return (cams || []).filter((x) => Math.abs(x.lat - c.lat) <= dLat && Math.abs(x.lng - c.lng) <= dLng).sort((a, b) => a.n.localeCompare(b.n, 'th') || a.id.localeCompare(b.id));
}
