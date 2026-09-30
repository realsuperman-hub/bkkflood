import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRss, collectNews, tagAreas, isPolitics } from '../src/lib/news.js';

const NOW = Date.parse('2026-09-30T14:00:00Z');
const rss = (items) => `<?xml version="1.0"?><rss><channel>${items.map((i) => `<item><title>${i.title}</title><link>${i.link}</link>${i.desc ? `<description><![CDATA[${i.desc}]]></description>` : ''}<pubDate>${i.date}</pubDate></item>`).join('')}</channel></rss>`;

test('parseRss reads titles, links, dates and strips CDATA/HTML from the summary', () => {
  const xml = rss([
    { title: 'น้ำท่วม &amp; ระบายน้ำ', link: 'https://a.example/1', desc: '<p>เขตมีนบุรี น้ำสูง</p>', date: 'Wed, 30 Sep 2026 13:00:00 +0000' },
    { title: 'ไม่มีลิงก์', link: 'not-a-url', date: 'Wed, 30 Sep 2026 13:00:00 +0000' },
  ]);
  const r = parseRss(xml);
  assert.equal(r.length, 1);
  assert.equal(r[0].title, 'น้ำท่วม & ระบายน้ำ');
  assert.equal(r[0].summary, 'เขตมีนบุรี น้ำสูง');
  assert.equal(r[0].t, Date.parse('2026-09-30T13:00:00Z'));
});

test('tagAreas finds Bangkok districts and metro provinces, without confusing Ayutthaya with เขตพระนคร', () => {
  assert.deepEqual(tagAreas('น้ำท่วมเขตมีนบุรี และหนองจอก').areas.sort(), ['เขตมีนบุรี', 'เขตหนองจอก'].sort());
  assert.equal(tagAreas('น้ำท่วมพระนครศรีอยุธยา').metro, false);
  assert.equal(tagAreas('น้ำท่วมพระนครศรีอยุธยา').river, true);
  assert.ok(tagAreas('น้ำท่วมเขตพระนคร').areas.includes('เขตพระนคร'));
  assert.ok(tagAreas('ปทุมธานี น้ำเอ่อ').areas.includes('ปทุมธานี'));
  assert.equal(tagAreas('กทม. ประกาศ').areas[0], 'กทม.');
  assert.equal(tagAreas('ข่าวกีฬา').metro, false);
});

test('collectNews keeps recent flood headlines only, dedupes, sorts newest first and flags politics', () => {
  const e = (title, iso, link) => ({ title, link, t: Date.parse(iso), summary: '' });
  const feeds = [
    { source: 'ก', sourceId: 'a', entries: [e('น้ำท่วมถนนสุขุมวิท กทม.', '2026-09-30T13:00:00Z', 'https://a/1'), e('ข่าวกีฬาไม่เกี่ยว', '2026-09-30T13:30:00Z', 'https://a/2'), e('น้ำท่วมเก่ามาก', '2026-09-25T13:00:00Z', 'https://a/3')] },
    { source: 'ข', sourceId: 'b', entries: [e('น้ำท่วมถนนสุขุมวิท กทม.', '2026-09-30T13:10:00Z', 'https://b/1'), e('สส.อัดรัฐบาล แก้น้ำท่วมล้มเหลว', '2026-09-30T13:20:00Z', 'https://b/2')] },
  ];
  const items = collectNews(feeds, NOW);
  assert.equal(items.length, 2); // sport, 5-day-old and duplicate dropped
  assert.equal(items[0].politics, true); // newest first
  assert.equal(items[1].metro, true);
  assert.equal(isPolitics('ระดับน้ำเจ้าพระยาสูงขึ้น 20 ซม.'), false);
  assert.equal(isPolitics('ปชป.ฉะรัฐบาล'), true);
});
