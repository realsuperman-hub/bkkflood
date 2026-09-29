// Share helpers: native share sheet on phones, LINE deep link, or copy.
export const SITE_URL = 'https://bkkflood.web.app/';

export const pointUrl = (lat, lng) => `${SITE_URL}?p=${(+lat).toFixed(5)},${(+lng).toFixed(5)}`;

export const lineLink = (text, url) => `https://line.me/R/msg/text/?${encodeURIComponent(`${text}\n${url}`)}`;

export const canNativeShare = () => typeof navigator !== 'undefined' && typeof navigator.share === 'function';

// Returns 'shared' | 'copied' | 'cancelled'. Throws only when nothing worked.
export async function shareNative({ title, text, url }) {
  if (canNativeShare()) {
    try {
      await navigator.share({ title, text, url });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
    }
  }
  await navigator.clipboard.writeText(`${text}\n${url}`);
  return 'copied';
}

export const siteShare = () => ({
  title: 'BKKFLOOD — จุดน้ำท่วม กทม.',
  text: 'BKKFLOOD ดูจุดน้ำท่วม กทม. และปริมณฑล ตอนนี้ พร้อมพยากรณ์และแจ้งเตือนอัตโนมัติ — เช็กก่อนเดินทาง',
  url: SITE_URL,
});

// ev = result of evaluate() for the point
export function pointShare(lat, lng, ev) {
  const r = ev?.risk;
  const why = r?.reasons?.[0]?.text ? ` (${r.reasons[0].text})` : '';
  return {
    title: 'BKKFLOOD — ความเสี่ยงน้ำท่วมจุดนี้',
    text: r ? `BKKFLOOD ประเมินจุดนี้: ${r.label}${why}` : 'BKKFLOOD — ดูความเสี่ยงน้ำท่วมจุดนี้',
    url: pointUrl(lat, lng),
  };
}
