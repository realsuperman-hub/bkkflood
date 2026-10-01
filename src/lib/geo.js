export const distKm = (aLat, aLng, bLat, bLng) => {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

export function nearestStations(stations, lat, lng, { maxKm = 6, limit = 3 } = {}) {
  return stations
    .filter((s) => !s.upstream)
    .map((s) => ({ ...s, km: distKm(lat, lng, s.lat, s.lng) }))
    .filter((s) => s.km <= maxKm)
    .sort((a, b) => a.km - b.km)
    .slice(0, limit);
}

// Service area: กทม. + ปริมณฑล + ภาคตะวันออก (ฉะเชิงเทรา ชลบุรี ระยอง) (west, south, east, north)
export const BOUNDS = { west: 99.9, south: 12.5, east: 101.8, north: 14.4 };
// The area the risk rules were built and checked against (Bangkok + the five neighbouring provinces). Outside it the score is shown as "not yet checked".
export const CORE = { west: 99.9, south: 13.4, east: 100.95, north: 14.4 };
export const inCore = (lat, lng) => lat >= CORE.south && lat <= CORE.north && lng >= CORE.west && lng <= CORE.east;
export const inBounds = (lat, lng) =>
  lat >= BOUNDS.south && lat <= BOUNDS.north && lng >= BOUNDS.west && lng <= BOUNDS.east;
