import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDams, mcmDayToCms, retainedShare, damStatus, outflowTrend } from '../src/lib/dams.js';

const dam = (id, name, extra = {}) => ({ id, name, owner: 'x', capacity: 1000, volume: 500, percent_storage: 50, inflow: 10, outflow: 2, ...extra });
const day = (date, dams) => ({ date, total: dams.length, data: [{ region: 'ภาคเหนือ', dam: dams }] });

test('normalizeDams keeps only the key dams and pairs each with the previous day', () => {
  const latest = day('2026-09-30', [dam('200101', 'เขื่อนภูมิพล', { inflow: 161.09, outflow: 2, percent_storage: 65.37 }), dam('999999', 'เขื่อนอื่น')]);
  const prev = day('2026-09-29', [dam('200101', 'เขื่อนภูมิพล', { inflow: 133.37, outflow: 3 })]);
  const s = normalizeDams(latest, prev);
  assert.equal(s.dams.length, 1);
  assert.equal(s.dams[0].name, 'ภูมิพล');
  assert.equal(s.dams[0].inflow, 161.09);
  assert.equal(s.dams[0].prevOutflow, 3);
  assert.equal(s.prevDate, '2026-09-29');
  assert.equal(normalizeDams(latest, null).dams[0].prevOutflow, null);
  assert.throws(() => normalizeDams(day('2026-09-30', []), null), /no data/);
  assert.throws(() => normalizeDams(day('2026-09-30', [dam('1', 'x')]), null), /none of the key dams/);
});

test('unit conversion, retained share, status and release trend', () => {
  assert.equal(mcmDayToCms(86.4), 1000); // 86.4 million m³/day = 1,000 m³/s
  assert.equal(mcmDayToCms(null), null);
  assert.ok(Math.abs(retainedShare({ inflow: 100, outflow: 2 }) - 0.98) < 1e-9);
  assert.equal(retainedShare({ inflow: 0, outflow: 0 }), null);
  assert.equal(damStatus({ percent: 106.8 }).level, 3);
  assert.equal(damStatus({ percent: 92 }).level, 2);
  assert.equal(damStatus({ percent: 80 }).level, 1);
  assert.equal(damStatus({ percent: 50 }).level, 0);
  assert.equal(damStatus({ percent: null }).level, 0);
  assert.equal(outflowTrend({ outflow: 9.94, prevOutflow: 2.16 }), 'rising');
  assert.equal(outflowTrend({ outflow: 2, prevOutflow: 3 }), 'falling');
  assert.equal(outflowTrend({ outflow: 2.1, prevOutflow: 2 }), 'steady');
  assert.equal(outflowTrend({ outflow: 2, prevOutflow: null }), 'unknown');
});
