import test from 'node:test';
import assert from 'node:assert/strict';
import { inBounds, inCore } from '../src/lib/geo.js';
import { normalizeStations } from '../src/lib/thaiwater.js';
import { normalizeCatalog, placeLabel } from '../src/lib/maholan-cams.js';
import { pickCams, provinceList } from '../src/lib/room-pick.js';
import { normalizeDams } from '../src/lib/dams.js';
import { tagAreas } from '../src/lib/news.js';

test('service area now reaches Chachoengsao, Chonburi (Pattaya) and Rayong; the risk-checked core stays Bangkok + neighbours', () => {
  assert.equal(inBounds(12.68, 101.28), true); // Rayong
  assert.equal(inBounds(12.93, 100.88), true); // Pattaya
  assert.equal(inBounds(13.69, 101.07), true); // Chachoengsao
  assert.equal(inBounds(12.0, 101.28), false); // south of Rayong
  assert.equal(inCore(13.7563, 100.5018), true); // central Bangkok
  assert.equal(inCore(13.69, 101.07), false); // Chachoengsao is outside the core
  assert.equal(inCore(12.68, 101.28), false);
});

const row = (prov, code, lat, lng) => ({
  id: 1, waterlevel_datetime: '2026-09-29 21:20', waterlevel_msl: '2.44', waterlevel_msl_previous: '2.40', discharge: null, situation_level: 3,
  station: { id: Math.random(), tele_station_name: { th: 'x' }, tele_station_lat: lat, tele_station_long: lng, tele_station_oldcode: code, min_bank: 2.2 },
  geocode: { province_name: { th: prov } }, agency: { agency_shortname: { th: 'ชป.' } },
});

test('eastern gauges: Chachoengsao/Chonburi/Rayong are ordinary gauges, Prachin Buri/Nakhon Nayok are Bang Pakong upstream, others dropped', () => {
  const raw = { waterlevel_data: { data: [
    row('ฉะเชิงเทรา', 'A', 13.6, 101.0), row('ระยอง', 'B', 12.7, 101.3), row('ชลบุรี', 'C', 13.3, 101.0),
    row('ปราจีนบุรี', 'D', 14.0, 101.4), row('นครนายก', 'E', 14.2, 101.2), row('จันทบุรี', 'F', 12.6, 102.1), row('เชียงใหม่', 'G', 18.7, 99.0),
  ] } };
  const s = normalizeStations(raw, Date.parse('2026-09-29T21:30:00+07:00'));
  assert.deepEqual(s.map((x) => x.code), ['A', 'B', 'C', 'D', 'E']);
  assert.deepEqual(s.map((x) => !!x.upstream), [false, false, false, true, true]);
  assert.deepEqual(s.map((x) => x.basin), [undefined, undefined, undefined, 'bpk', 'bpk']);
  assert.equal(s.some((x) => x.chain), false);
});

test('camera catalogue keeps eastern cameras with their province; the label shows district in Bangkok and province elsewhere', () => {
  const out = normalizeCatalog([
    { id: 'a', name: 'ถ.สุขุมวิท', lat: 12.68, lng: 101.28, region: 'ระยอง', source: 'x' },
    { id: 'b', name: 'แยกบางนา', lat: 13.67, lng: 100.6, region: 'กรุงเทพมหานคร', district: 'บางนา', source: 'x' },
    { id: 'c', name: 'ไม่รู้', lat: 13.0, lng: 101.0, region: 'ไม่ทราบจังหวัด', source: 'x' },
    { id: 'd', name: 'ภาคใต้', lat: 13.0, lng: 101.1, region: 'ภาคใต้', source: 'x' },
  ]);
  assert.deepEqual(out.map((c) => c.p), ['ระยอง', 'กรุงเทพมหานคร', '', '']);
  assert.deepEqual(out.map(placeLabel), ['จ.ระยอง', 'เขตบางนา', '', '']);
  assert.deepEqual(provinceList(out), [{ name: 'ระยอง', n: 1 }]);
  assert.deepEqual(pickCams(out, { district: 'จ:ระยอง' }).map((c) => c.id), ['a']);
});

test('eastern dams are grouped as area "east", the Chao Phraya ones keep the default', () => {
  const dam = (id, name) => ({ id, name, capacity: 100, volume: 50, percent_storage: 50, inflow: 1, outflow: 1 });
  const day = (date) => ({ date, total: 2, data: [{ region: 'x', dam: [dam('200101', 'ภูมิพล'), dam('100505', 'ประแสร์')] }] });
  const s = normalizeDams(day('2026-10-01'), day('2026-09-30'));
  assert.deepEqual(Object.fromEntries(s.dams.map((d) => [d.name, d.area])), { ภูมิพล: 'cpy', ประแสร์: 'east' });
});

test('news about the eastern provinces and the Bang Pakong basin is tagged', () => {
  assert.ok(tagAreas('น้ำท่วมหนักที่ฉะเชิงเทรา').areas.includes('ฉะเชิงเทรา'));
  assert.equal(tagAreas('น้ำป่าไหลหลาก ปราจีนบุรี').river, true);
});
