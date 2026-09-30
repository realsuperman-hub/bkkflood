import test from 'node:test';
import assert from 'node:assert/strict';
import { norm, validQuery, matchFloods, matchStations, matchReports } from '../src/lib/search.js';

const F = (text, district, lvl = 2, t = 1) => ({ id: text, text, district, lvl, t });
const floods = [
  F('น้ำท่วมซอยรามคำแหง 174 สูงระดับเข่า', 'มีนบุรี', 2, 5),
  F('ถนนสุวินทวงศ์ ก่อนขึ้นสะพาน น้ำท่วมสูง', 'หนองจอก', 3, 9),
  F('ริมคลองพระยาสุเรนทร์ 21', 'คลองสามวา', 1, 3),
  F('ซอยนวมินทร์ 42 น้ำสูงขึ้น', 'บึงกุ่ม', 2, 7),
];

test('norm strips spaces and road/district prefixes', () => {
  assert.equal(norm('ซอย รามคำแหง 174'), 'รามคำแหง174');
  assert.equal(norm('ถนนสุวินทวงศ์'), 'สุวินทวงศ์');
  assert.equal(norm('เขตหนองจอก'), 'หนองจอก');
  assert.equal(validQuery('ก'), false);
  assert.equal(validQuery('ซอย'), false); // only a prefix
});

test('road, soi (with/without spaces) and district queries hit the right complaints', () => {
  assert.deepEqual(matchFloods(floods, 'รามคำแหง 174').map((f) => f.district), ['มีนบุรี']);
  assert.deepEqual(matchFloods(floods, 'ซอยรามคำแหง174').map((f) => f.district), ['มีนบุรี']);
  assert.deepEqual(matchFloods(floods, 'สุวินทวงศ์').map((f) => f.district), ['หนองจอก']);
  assert.deepEqual(matchFloods(floods, 'เขตหนองจอก').map((f) => f.district), ['หนองจอก']);
  assert.deepEqual(matchFloods(floods, 'นวมินทร์ 42').map((f) => f.district), ['บึงกุ่ม']);
  assert.deepEqual(matchFloods(floods, 'ไม่มีที่นี่'), []);
  assert.deepEqual(matchFloods(floods, 'ก'), []);
});

test('results are ordered heaviest, then newest', () => {
  const r = matchFloods(floods, 'น้ำ');
  assert.deepEqual(r.map((f) => f.lvl), [3, 2, 2]);
  assert.ok(r[1].t > r[2].t);
});

test('stations and citizen notes', () => {
  assert.equal(matchStations([{ name: 'คลองลาดพร้าว วัดบางบัว', prov: 'กรุงเทพมหานคร' }], 'ลาดพร้าว').length, 1);
  assert.equal(matchReports([{ note: 'ซอยสุขุมวิท 71 น้ำขึ้น' }, { note: '' }], 'สุขุมวิท71').length, 1);
});

import { matchTraffic } from '../src/lib/search.js';
test('traffic matches: events, official flood rows and cameras by road/district/name', () => {
  const traffic = {
    events: [{ title: 'น้ำท่วม ถนนรามอินทรา', detail: 'ช่วงเซ็นทรัล' }, { title: 'อุบัติเหตุ ถนนบรมราชชนนี', detail: '' }],
    dds: { rows: [{ road: 'วิภาวดีรังสิต', place: 'หน้าเขตจตุจักร', district: 'จตุจักร' }, { road: 'สุขุมวิท', place: 'ซอย 26', district: 'คลองเตย' }] },
    cameras: [{ name: 'TF1-LK-04 แยกร่มเกล้า', desc: 'ถ.ร่มเกล้า' }, { name: 'BR-05-01 แยกสีลม', desc: '-' }],
  };
  assert.equal(matchTraffic(traffic, 'รามอินทรา').events.length, 1);
  assert.equal(matchTraffic(traffic, 'เขตจตุจักร').dds.length, 1);
  assert.equal(matchTraffic(traffic, 'สุขุมวิท 26').dds.length, 1);
  assert.equal(matchTraffic(traffic, 'ร่มเกล้า').cameras.length, 1);
  assert.deepEqual(matchTraffic(traffic, 'ก'), { events: [], dds: [], cameras: [] });
});
