// Live traffic cameras of the Don Hua Lo municipality (Chonburi, Amata Nakorn area): https://cctv.dhr.go.th/ — its public page lists 20 cameras
// (/cameras.php, CORS open) and plays them as plain HLS (/hls/stream_N.m3u8, CORS open). They join the camera catalogue as `hls` cameras:
// shown as a ▶ live video on request (never auto-played), straight from their server. DOM-free.

export const DHR_BASE = 'https://cctv.dhr.go.th';
export const DHR_LIST = `${DHR_BASE}/cameras.php`;
export const DHR_PROVINCE = 'ชลบุรี';
export const DHR_LABEL = 'เทศบาลตำบลดอนหัวฬ่อ';

const PLAYLIST = /^stream_\d{1,4}$/;
export const dhrHls = (playlistId) => (PLAYLIST.test(playlistId) ? `${DHR_BASE}/hls/${playlistId}.m3u8` : null);
// the only host/path shape the live player is allowed to open
export const isDhrHls = (u) => typeof u === 'string' && /^https:\/\/cctv\.dhr\.go\.th\/hls\/stream_\d{1,4}\.m3u8$/.test(u);

const clean = (t, n) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, n);

export function normalizeDhr(list) {
  const out = [];
  const seen = new Set();
  for (const c of Array.isArray(list) ? list : []) {
    const lat = Number(c?.lat);
    const lng = Number(c?.lng);
    const hls = dhrHls(c?.playlistId);
    const id = `dhr-${Number(c?.id)}`;
    if (!hls || !Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isInteger(Number(c?.id)) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, n: clean(c.name, 90), lat: +lat.toFixed(5), lng: +lng.toFixed(5), s: DHR_LABEL, d: '', p: DHR_PROVINCE, hls });
  }
  return out;
}
