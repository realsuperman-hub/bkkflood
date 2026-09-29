// Search across everything BKKFLOOD knows about, so people can check a road/soi/district before travelling.
// Primary = local match (complaint text, district, gauge names, citizen notes) — works for Thai road names.
// Secondary = best-effort geocoders (Nominatim, Photon): free services with weak Thai support, so they only add "places".
import { inBounds } from './geo.js';

const PREFIX = /^(ถนน|ถ\.|ซอย|ซ\.|เขต|แขวง|ตำบล|อำเภอ|จังหวัด|จ\.)/;

// "ซอย รามคำแหง 174" → "รามคำแหง174"  (Thai has no word breaks; complaints often drop spaces)
export function norm(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[\s\-_.,/()"'“”]+/g, '')
    .replace(PREFIX, '');
}

export const validQuery = (q) => norm(q).length >= 2;

export function matchFloods(floods, q) {
  const nq = norm(q);
  if (nq.length < 2) return [];
  return floods
    .filter((f) => {
      const d = norm(f.district);
      return d === nq || (d.length >= 2 && (nq.includes(d) || d.includes(nq))) || norm(`${f.text}`).includes(nq) || String(f.text).replace(/\s+/g, '').includes(nq);
    })
    .sort((a, b) => b.lvl - a.lvl || b.t - a.t);
}

export const matchStations = (stations, q) => {
  const nq = norm(q);
  return nq.length < 2 ? [] : stations.filter((s) => norm(s.name).includes(nq) || norm(s.prov) === nq);
};

export const matchReports = (reports, q) => {
  const nq = norm(q);
  return nq.length < 2 ? [] : reports.filter((r) => norm(r.note).includes(nq));
};

const withTimeout = (url, ms = 8000) => fetch(url, { signal: AbortSignal.timeout(ms) }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const nominatim = async (q) => {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=th&countrycodes=th&viewbox=99.9,14.4,101.1,13.3&q=${encodeURIComponent(q)}`;
  return (await withTimeout(url)).map((x) => ({ name: x.display_name.split(',').slice(0, 3).join(','), full: x.display_name, lat: +x.lat, lng: +x.lon }));
};
const photon = async (q) => {
  const url = `https://photon.komoot.io/api/?limit=5&bbox=99.9,13.3,101.1,14.4&q=${encodeURIComponent(q)}`;
  return (await withTimeout(url)).features.map((f) => ({
    name: [f.properties.name, f.properties.district || f.properties.city].filter(Boolean).join(', '),
    full: Object.values(f.properties).filter((v) => typeof v === 'string').join(' '),
    lat: f.geometry.coordinates[1],
    lng: f.geometry.coordinates[0],
  }));
};

// Returns places inside the service area; never throws (a geocoder outage must not break search).
export async function geocode(q) {
  const nq = norm(q);
  const tries = [() => nominatim(q), async () => { await sleep(1100); return nominatim(`${q} กรุงเทพมหานคร`); }, () => photon(q)];
  for (const t of tries) {
    try {
      // fuzzy geocoders return unrelated places for Thai text; keep only results that actually contain the query
      const r = (await t()).filter((p) => inBounds(p.lat, p.lng) && norm(p.full).includes(nq));
      if (r.length) return r.slice(0, 5);
    } catch {
      /* try the next service */
    }
  }
  return [];
}
