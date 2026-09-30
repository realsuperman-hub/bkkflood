import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDdsReport, thaiDateToIso } from '../src/lib/dds.js';
import { parseCameras, normalizeEvents, normalizeSegments, eventTimeFromText, bangkokNow } from '../src/lib/bma-traffic.js';

const ddsHtml = `<html><body>${'x'.repeat(600)}
<div>รายงานน้ำท่วมขังบนถนนสายหลัก ในความรับผิดชอบของสำนักการระบายน้ำ วันที่ 25 กันยายน 2569 ถึง 30 กันยายน 2569</div>
<div>วันที่ 25 กันยายน 2569</div>
<table><thead><tr><th>รายการที่</th><th>พื้นที่เขต</th><th>จำนวนรายการน้ำท่วมขัง (แห่ง)</th></tr></thead><tbody><tr><td>1</td><td>คลองเตย</td><td>1</td></tr></tbody></table>
<table><thead><tr><th>ลำดับที่</th><th>พื้นที่เขต</th><th>ถนน</th><th>บริเวณ</th><th>ความสูง (ซม.)</th><th>ความยาว (ม.)</th><th>กระทบผิวจราจร (เลน)</th><th>เวลาท่วม (น.)</th><th>เวลาแห้ง (น.)</th><th>ระยะเวลาท่วม (ชม:นาที)</th><th>ปริมาณฝนรวม (มม.)</th></tr></thead>
<tbody>
<tr><td colspan="11">รายงานผลโดย กองสารสนเทศระบายน้ำ</td></tr>
<tr><td>1</td><td>ห้วยขวาง</td><td>ประชาอุทิศ</td><td>ตรงข้ามสำนักงานเขตห้วยขวาง</td><td>15</td><td>300</td><td>1-2 เลน</td><td>15:00</td><td>19:10</td><td>04:10</td><td>280.5</td></tr>
<tr><td>2</td><td>ห้วยขวาง</td><td>เพชรบุรี</td><td>ช่วง&nbsp;สิงห์คอมเพล็กซ์</td><td>10</td><td>1,150</td><td>เต็มผิว</td><td>08:15</td><td>09:45</td><td>01:30</td><td>280.5</td></tr>
</tbody></table><div>วันที่ 30 กันยายน 2569 เวลา 11:34 สถิติผู้เข้าชม</div></body></html>`;

test('DDS report: dates, columns by header name, notes row skipped, entities and thousands separators handled', () => {
  const r = parseDdsReport(ddsHtml);
  assert.equal(r.reportDate, '2026-09-25');
  assert.equal(r.rangeFrom, '2026-09-25');
  assert.equal(r.rangeTo, '2026-09-30');
  assert.equal(r.rows.length, 2);
  assert.deepEqual(r.rows[0], { district: 'ห้วยขวาง', road: 'ประชาอุทิศ', place: 'ตรงข้ามสำนักงานเขตห้วยขวาง', depthCm: 15, lengthM: 300, lanes: '1-2 เลน', from: '15:00', dry: '19:10', duration: '04:10', rainMm: 280.5 });
  assert.equal(r.rows[1].place, 'ช่วง สิงห์คอมเพล็กซ์');
  assert.equal(r.rows[1].lengthM, 1150);
  assert.equal(thaiDateToIso(3, 'มกราคม', 2570), '2027-01-03');
  assert.throws(() => parseDdsReport('<html>' + 'y'.repeat(600) + '</html>'), /no flood rows/);
  assert.throws(() => parseDdsReport(''), /empty/);
});

const camHtml = `var locations = [
['603','BR-05-01 แยกสีลม-นราธิวาส','Silom','แยกสีลม-นราธิวาส','From Surasak',13.7262,100.52797,'10.104.101.29','pin-right.png'],
['1258','TF1-BB-03 แยกบางพฤกษ์','-','ถ.กัลปพฤกษ์','-',13.66318,100.40585,'10.156.101.4','pin_camera_flood.png'],
['9','bad coords','-','x','-',40.1,100.5,'10.0.0.1','pin-right.png']
];`;

test('cameras: parsed from the page array, IP column dropped, flood pin flagged, bad coordinates rejected', () => {
  const c = parseCameras(camHtml);
  assert.equal(c.length, 2);
  assert.deepEqual(c[1], { id: '1258', name: 'TF1-BB-03 แยกบางพฤกษ์', desc: 'ถ.กัลปพฤกษ์', lat: 13.66318, lng: 100.40585, flood: true });
  assert.equal(c[0].flood, false);
  assert.ok(!JSON.stringify(c).includes('10.104'), 'no internal IP in the output');
});

const now = Date.parse('2026-09-30T05:00:00Z'); // 12:00 Bangkok
const wall = (iso) => Date.parse(iso + 'Z'); // Bangkok wall-clock stored as UTC

test('events: only today\'s, kind from type id or text, time from the Thai text, flood first', () => {
  const ev = (o) => ({ attributes: { event_id: 1, event_type_id: 7, headline: 'อุบัติเหตุ', detail: '', latitude: 13.8, longitude: 100.6, date_start: wall('2026-09-30T00:00:00'), date_stop: wall('2026-09-30T23:59:00'), ...o } });
  const out = normalizeEvents([
    ev({ event_id: 1 }),
    ev({ event_id: 2, event_type_id: 10, headline: 'น้ำท่วม ถนนรามอินทรา', detail: '30/09/2569 07.27 น. ถนนรามอินทรา ยังท่วมขัง' }),
    ev({ event_id: 3, date_start: wall('2026-09-20T00:00:00'), date_stop: wall('2026-09-20T23:59:00') }), // yesterday's
    ev({ event_id: 4, event_type_id: 1, headline: 'ประกาศ น้ำท่วมขัง' }),
    ev({ event_id: 5, latitude: null }),
    ev({ event_id: 6, event_type_id: 7, headline: 'คืบหน้าเพลิงไหม้รถยนต์ ซอยวิภาวดี 72' }), // filed under the accident id
  ], now);
  assert.equal(out.find((e) => e.id === 6).kind, 'fire');
  assert.deepEqual(out.map((e) => e.id).slice(0, 2), [2, 4]); // flood first (newest first)
  assert.equal(out.length, 4);
  assert.equal(out[0].kind, 'flood');
  assert.equal(out[0].t, Date.parse('2026-09-30T00:27:00Z'), '07:27 Bangkok = 00:27 UTC');
  assert.ok(out.find((e) => e.id === 4).kind === 'flood', 'text fallback');
  assert.equal(eventTimeFromText('ไม่มีเวลา'), null);
  assert.equal(bangkokNow(0), 7 * 3600e3);
});

test('segments: keep fresh + slow only; drop free-flow, stale, and geometry-less', () => {
  const K = 'TRAFFIC.dbo.tbl_data_line_color_lastupdate.';
  const seg = (lv, ageMin, paths = [[[100.5123456, 13.7123456], [100.52, 13.72]]]) => ({
    attributes: { [K + 'speed_level']: lv, [K + 'Speed']: 12.6, [K + 'Last_Update']: bangkokNow(now) - ageMin * 60e3 },
    geometry: paths ? { paths } : undefined,
  });
  const out = normalizeSegments([seg(1, 10), seg(5, 10), seg(2, 300), seg(3, 30), seg(4, 10, null)], now);
  assert.deepEqual(out.map((s) => s.lv), [1, 3]);
  assert.equal(out[0].sp, 13);
  assert.deepEqual(out[0].paths[0][0], [100.51235, 13.71235]);
  assert.equal(out[0].t, now - 10 * 60e3);
});
