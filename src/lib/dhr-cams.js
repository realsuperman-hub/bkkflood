// Traffic cameras of the Don Hua Lo municipality (Chonburi, Amata Nakorn area): https://cctv.dhr.go.th/ lists 20 cameras (/cameras.php) and plays them as HLS.
// Their video server answers 403 to any request that carries another site's Referer — they do not want the streams embedded elsewhere — so we do NOT
// play or embed them: the camera joins the catalogue as a location with a link to the municipality's own page (`link`). DOM-free.

export const DHR_BASE = 'https://cctv.dhr.go.th';
export const DHR_LIST = `${DHR_BASE}/cameras.php`;
export const DHR_PROVINCE = 'ชลบุรี';
export const DHR_LABEL = 'เทศบาลตำบลดอนหัวฬ่อ';
export const DHR_PAGE = `${DHR_BASE}/`;

const PLAYLIST = /^stream_\d{1,4}$/;
// the playlist is only used by the PC-side check "is this camera streaming now?" (scripts/fetch-maholan.mjs); it never reaches the site
export const dhrPlaylist = (playlistId) => (PLAYLIST.test(playlistId) ? `${DHR_BASE}/hls/${playlistId}.m3u8` : null);
export const isDhrPage = (u) => u === DHR_PAGE;

const clean = (t, n) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, n);

// → [{ id, n, lat, lng, s, d, p, link, playlist }]  (`playlist` is dropped before the catalogue is written)
export function normalizeDhr(list) {
  const out = [];
  const seen = new Set();
  for (const c of Array.isArray(list) ? list : []) {
    const lat = Number(c?.lat);
    const lng = Number(c?.lng);
    const playlist = dhrPlaylist(c?.playlistId);
    const id = `dhr-${Number(c?.id)}`;
    if (!playlist || !Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isInteger(Number(c?.id)) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, n: clean(c.name, 90), lat: +lat.toFixed(5), lng: +lng.toFixed(5), s: DHR_LABEL, d: '', p: DHR_PROVINCE, link: DHR_PAGE, playlist });
  }
  return out;
}
