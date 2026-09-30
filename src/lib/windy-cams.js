// Webcams from the Windy Webcams API v3 (free tier). What the free tier allows, per Windy's pricing/terms pages (read 2026-10-01): show their
// images linked back to windy.com, or embed THEIR timelapse player; credit "Webcams provided by Windy.com — add a webcam"; image URLs expire
// in 15 minutes (so we never store or show image URLs). We keep only metadata and the permanent page/player links, and play the last-24 h
// timelapse through Windy's own embed — which is also a useful flood view (you can watch the water rise or fall). DOM-free.

export const WINDY = 'https://www.windy.com';
export const WINDY_CREDIT_URL = 'https://www.windy.com/webcams/add';
export const isWindyPlayer = (u) => typeof u === 'string' && /^https:\/\/webcams\.windy\.com\/[\w\-./?=&%]+$/.test(u);

// "Khlong Khwang Subdistrict: Rama IX Exit, Bangkok" → keep as-is but trim; Windy titles are already human readable
const clean = (t) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 100);

export function normalizeWebcams(apiWebcams) {
  const out = [];
  for (const w of apiWebcams || []) {
    const lat = w.location?.latitude;
    const lng = w.location?.longitude;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || w.status !== 'active') continue;
    const day = w.player?.day;
    if (!isWindyPlayer(day)) continue; // only cameras whose timelapse we can embed
    out.push({
      id: String(w.webcamId),
      title: clean(w.title),
      lat: +lat.toFixed(5),
      lng: +lng.toFixed(5),
      city: clean(w.location?.city),
      region: clean(w.location?.region),
      day,
      detail: typeof w.urls?.detail === 'string' && w.urls.detail.startsWith(WINDY) ? w.urls.detail : null,
      updated: Date.parse(w.lastUpdatedOn) || null,
    });
  }
  return out;
}
