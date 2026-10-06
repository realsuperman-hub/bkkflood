import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWarningList, parseWarningBody, latestSeries, thaiDateIso, decodeEntities } from '../src/lib/tmd.js';

// the page writes Thai as hex entities; this mirrors its markup (trimmed)
const enc = (s) => [...s].map((c) => (c.charCodeAt(0) > 127 ? `&#x${c.codePointAt(0).toString(16).toUpperCase()};` : c)).join('');
const item = (title, date, slug) => `<div class="link-list">
  <div class="link-list-content">
    <div class="link-list-title"><a href="/warning-and-events/warning-storm/${enc(slug)}">${enc(title)} </a></div>
    <div class="link-list-description"><a href="/warning-and-events/warning-storm/${enc(slug)}"> ${enc('มีฝนตกหนักบางแห่ง')} </a></div>
    <div class="link-list-caption caption d-flex mt-2"><div class="caption-item d-flex"><div class="me-1">${enc('วันที่ข้อมูล:')}</div><div>${enc(date)}</div><div class="text-light1 mx-2">|</div></div>
    <div class="caption-item d-flex"><div class="me-1">${enc('หมวดหมู่:')}</div><div>${enc('พยากรณ์')}</div><div class="text-light1 mx-2">|</div></div></div>
  </div></div>`;
const list = `<section>${item('อากาศแปรปรวน (มีผลกระทบจนถึงวันที่ 7 ตุลาคม 2569) ฉบับที่ 10 (244/2569)', '06 ตุลาคม 2569', 'อากาศ-10')}
${item('อากาศแปรปรวน (มีผลกระทบจนถึงวันที่ 7 ตุลาคม 2569) ฉบับที่ 9 (243/2569)', '05 ตุลาคม 2569', 'อากาศ-9')}
${item('พายุโซนร้อน ฉบับที่ 3 (200/2569)', '20 กันยายน 2569', 'พายุ-3')}</section>`;
const NOW = Date.parse('2026-10-06T10:00:00+07:00');

test('thai dates and entities', () => {
  assert.equal(thaiDateIso('06 ตุลาคม 2569'), '2026-10-06');
  assert.equal(thaiDateIso('nonsense'), null);
  assert.equal(decodeEntities('&#xE01;&amp;&nbsp;x'), 'ก& x');
});

test('parseWarningList reads title, summary, date, category and an absolute, encoded link', () => {
  const l = parseWarningList(list);
  assert.equal(l.length, 3);
  assert.equal(l[0].title, 'อากาศแปรปรวน (มีผลกระทบจนถึงวันที่ 7 ตุลาคม 2569) ฉบับที่ 10 (244/2569)');
  assert.equal(l[0].summary, 'มีฝนตกหนักบางแห่ง');
  assert.equal(l[0].date, '2026-10-06');
  assert.equal(l[0].category, 'พยากรณ์');
  assert.match(l[0].url, /^https:\/\/www\.tmd\.go\.th\/warning-and-events\/warning-storm\/%E0%B8%AD/);
});

test('latestSeries keeps the newest issue of each warning and drops old ones', () => {
  const s = latestSeries(parseWarningList(list), NOW);
  assert.equal(s.length, 1); // issue 10 supersedes 9; the September storm is too old
  assert.match(s[0].title, /ฉบับที่ 10/);
});

test('parseWarningBody searches only the announcement for Bangkok, not the TMD address in the footer', () => {
  const page = (txt) => `<html><script>var x='กรุงเทพ'</script><div>${enc('ประกาศกรมอุตุนิยมวิทยา')} ${enc(txt)} ${enc('ประกาศ ณ วันที่ 6 ตุลาคม พ.ศ. 2569 เวลา 05.00 น.')} (${enc(' ลงชื่อ)')}</div><footer>${enc('4353 ถนนสุขุมวิท เขตบางนา กรุงเทพมหานคร')}</footer></html>`;
  const bkk = parseWarningBody(page('ภาคกลาง รวมทั้งกรุงเทพมหานครและปริมณฑล'));
  assert.equal(bkk.bangkok, true);
  assert.equal(bkk.issuedAt, '6 ตุลาคม พ.ศ. 2569 05.00');
  assert.equal(parseWarningBody(page('ภาคเหนือ และภาคใต้')).bangkok, false);
  assert.equal(parseWarningBody('<html>nothing</html>'), null);
});
