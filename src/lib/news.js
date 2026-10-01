// Flood headlines from Thai news outlets' public RSS feeds. We keep ONLY the headline, link, outlet and time (+ which areas it
// mentions, worked out from the headline/summary) — never the article text — and every item links back to the outlet.
// DOM-free (used by scripts/fetch-news.mjs and the browser).

// Feeds checked on 2026-09-30: all returned fresh items (minutes old) and many flood stories.
export const FEEDS = [
  { id: 'thairath', name: 'ไทยรัฐ', url: 'https://www.thairath.co.th/rss/news' },
  { id: 'matichon', name: 'มติชน', url: 'https://www.matichon.co.th/feed' },
  { id: 'khaosod', name: 'ข่าวสด', url: 'https://www.khaosod.co.th/feed' },
  { id: 'prachachat', name: 'ประชาชาติธุรกิจ', url: 'https://www.prachachat.net/feed' },
  { id: 'thaipost', name: 'ไทยโพสต์', url: 'https://www.thaipost.net/feed/' },
];

export const NEWS_MAX_AGE_MS = 48 * 3600e3;

const FLOOD = /ท่วม|น้ำหลาก|น้ำป่า|น้ำหนุน|มวลน้ำ|ระบายน้ำ|พร่องน้ำ|เตือนภัยน้ำ|น้ำล้นตลิ่ง|ปล่อยน้ำ|ระดับน้ำ/;

export const BKK_DISTRICTS = [
  'พระนคร', 'ดุสิต', 'หนองจอก', 'บางรัก', 'บางเขน', 'บางกะปิ', 'ปทุมวัน', 'ป้อมปราบศัตรูพ่าย', 'พระโขนง', 'มีนบุรี',
  'ลาดกระบัง', 'ยานนาวา', 'สัมพันธวงศ์', 'พญาไท', 'ธนบุรี', 'บางกอกใหญ่', 'ห้วยขวาง', 'คลองสาน', 'ตลิ่งชัน', 'บางกอกน้อย',
  'บางขุนเทียน', 'ภาษีเจริญ', 'หนองแขม', 'ราษฎร์บูรณะ', 'บางพลัด', 'ดินแดง', 'บึงกุ่ม', 'สาทร', 'บางซื่อ', 'จตุจักร',
  'บางคอแหลม', 'ประเวศ', 'คลองเตย', 'สวนหลวง', 'จอมทอง', 'ดอนเมือง', 'ราชเทวี', 'ลาดพร้าว', 'วัฒนา', 'บางแค',
  'หลักสี่', 'สายไหม', 'คันนายาว', 'สะพานสูง', 'วังทองหลาง', 'คลองสามวา', 'บางนา', 'ทวีวัฒนา', 'ทุ่งครุ', 'บางบอน',
];
// names that are also ordinary words / other places: only count them when written as "เขต…"
const NEED_KHET = new Set(['พระนคร', 'วัฒนา', 'สวนหลวง', 'ธนบุรี']);
const PROVINCES = ['นนทบุรี', 'ปทุมธานี', 'สมุทรปราการ', 'สมุทรสาคร', 'นครปฐม', 'ฉะเชิงเทรา', 'ชลบุรี', 'ระยอง', 'พัทยา'];
// upstream places whose water reaches Bangkok
const RIVER = /เจ้าพระยา|บางปะกง|ปราจีนบุรี|นครนายก|ขุนด่านปราการชล|อยุธยา|อ่างทอง|ชัยนาท|สิงห์บุรี|นครสวรรค์|ป่าสัก|เขื่อน(?:เจ้าพระยา|ภูมิพล|สิริกิติ์|ป่าสัก)|ท่าจีน/;

// Many flood headlines are politicians attacking the government, not what is happening on the ground. This rough filter marks them so
// the app can hide them by default. It is a heuristic (keyword-based) and will sometimes be wrong either way.
const POLITICS = /สส\.?|ส\.ส\.|ส\.ว\.|พรรค|ฝ่ายค้าน|ไฮปาร์ค|ปชป|ปชน|ล้มเหลว|ไร้ประสิทธิภาพ|(?:อัด|เหน็บ|แซะ|จวก|ฉะ|โวย|ประณาม)\s?(?:รัฐบาล|รบ\.|ผู้ว่า)/;
export const isPolitics = (title) => POLITICS.test(String(title || ''));

export function tagAreas(text) {
  const t = String(text || '');
  const areas = [];
  if (/กทม|กรุงเทพ/.test(t)) areas.push('กทม.');
  for (const d of BKK_DISTRICTS) {
    const hit = NEED_KHET.has(d) ? t.includes(`เขต${d}`) : t.includes(d) && !(d === 'ธนบุรี' && /จังหวัดธนบุรี/.test(t));
    if (hit) areas.push(`เขต${d}`);
  }
  for (const p of PROVINCES) if (t.includes(p)) areas.push(p);
  if (/ปริมณฑล/.test(t)) areas.push('ปริมณฑล');
  return { areas: [...new Set(areas)], metro: areas.length > 0, river: RIVER.test(t) };
}

const decode = (s) =>
  String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/\s+/g, ' ')
    .trim();

const tag = (block, name) => {
  const m = block.match(new RegExp(String.raw`<${name}(?:\s[^>]*)?>([\s\S]*?)</${name}>`, 'i'));
  return m ? m[1] : '';
};

// Minimal RSS 2.0 reader: [{ title, link, t, summary }]
export function parseRss(xml) {
  const out = [];
  for (const m of String(xml).matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const b = m[1];
    const title = decode(tag(b, 'title'));
    const link = decode(tag(b, 'link')) || decode(tag(b, 'guid'));
    const t = Date.parse(decode(tag(b, 'pubDate')));
    const summary = decode(tag(b, 'description')).slice(0, 400);
    if (title && /^https?:\/\//.test(link) && Number.isFinite(t)) out.push({ title, link, t, summary });
  }
  return out;
}

// Flood-related, recent, de-duplicated headlines from several feeds, newest first.
export function collectNews(feeds, now = Date.now(), { max = 60 } = {}) {
  const seen = new Set();
  const items = [];
  for (const { source, sourceId, entries } of feeds) {
    for (const e of entries) {
      if (now - e.t > NEWS_MAX_AGE_MS || e.t > now + 3600e3) continue;
      if (!FLOOD.test(e.title)) continue;
      const key = e.title.replace(/[\s"“”‘’'’!?.…\-–—:：,]/g, '').slice(0, 40);
      if (seen.has(key)) continue;
      seen.add(key);
      const { areas, metro, river } = tagAreas(`${e.title} ${e.summary}`);
      items.push({ t: e.t, title: e.title, url: e.link, source, sourceId, areas, metro, river, politics: isPolitics(e.title) });
    }
  }
  return items.sort((a, b) => b.t - a.t).slice(0, max);
}
