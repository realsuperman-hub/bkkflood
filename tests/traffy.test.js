import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, normalizeFloods } from '../src/lib/traffy.js';

const lv = (t) => classify(t).lvl;

test('explicit depth beats vague wording', () => {
  assert.equal(lv('น้ำท่วมสูงมาก ประมาณเข่า'), 2);
  assert.equal(lv('น้ำท่วมสูง ถนนสุวินทวงศ์'), 3);
  assert.equal(lv('ระดับน้ำสูงประมาณ 40 เซนติเมตร'), 2);
  assert.equal(classify('สูง 50-70 ซม.').depth, 70);
  assert.equal(lv('ท่วมถึงระดับอก'), 3);
  assert.equal(lv('ท่วมขังหน้าแข้ง'), 1);
});
test('impassable / into the house is heavy; relief requests floor at medium and set help', () => {
  assert.equal(lv('รถเล็กผ่านไม่ได้'), 3);
  assert.equal(lv('น้ำไหลเข้าบ้านแล้ว'), 3);
  const r = classify('ต้องการนำคนสูงอายุออกจากบ้าน');
  assert.equal(r.lvl, 2);
  assert.equal(r.help, true);
});
test('receding water lowers the level unless it is "ไม่ลด"', () => {
  assert.equal(lv('น้ำท่วมระดับเข่า ตอนนี้น้ำลดแล้ว'), 1);
  assert.equal(lv('น้ำท่วมระดับเข่า น้ำลดแล้วบางจุด แต่ตรงนี้ยังไม่ลด'), 2);
});
test('normalizeFloods filters type/state/age/area and bumps clusters', () => {
  const now = Date.parse('2026-09-29T23:00:00+07:00');
  const f = (o = {}) => ({
    geometry: { coordinates: [100.7, 13.8] },
    properties: { problem_type_fondue: ['น้ำท่วม'], state_type_latest: 'start', timestamp: '2026-09-29 22:00:00', last_activity: '2026-09-29 22:00:00', description: 'ท่วมขัง', district: ['มีนบุรี'], photo_url: 'https://x/y.jpg', ...o.p },
    ...o.g,
  });
  const raw = { features: [
    f(), f(), f(), f(), // 4 neighbours → each gets near≥3 → bump 1→2
    f({ p: { problem_type_fondue: ['ถนน'] } }),
    f({ p: { state_type_latest: 'finish' } }),
    f({ p: { timestamp: '2026-09-27 10:00:00', last_activity: '2026-09-27 10:00:00' } }),
    f({ g: { geometry: { coordinates: [100.7, 20] } } }),
  ] };
  const out = normalizeFloods(raw, now);
  assert.equal(out.length, 4);
  assert.ok(out.every((r) => r.lvl === 2 && r.near === 3));
  assert.equal(out[0].district, 'มีนบุรี');
  assert.throws(() => normalizeFloods({}), /unexpected/);
});
