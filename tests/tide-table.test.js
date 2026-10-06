import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTideTable, summarizeTideTable } from '../src/lib/tide-table.js';

// 60 days, one high tide a day at 16:00; day 40 is the highest of the table, days 38–41 make the top 15 %
const csv = (() => {
  const rows = ['station,date,time,value'];
  for (let d = 0; d < 60; d++) {
    const date = new Date(Date.UTC(2026, 9, 1 + d)).toISOString().slice(0, 10);
    for (let h = 0; h < 24; h++) {
      const peak = d === 40 ? 1.5 : d >= 35 && d <= 43 ? 1.3 : 1.0;
      rows.push(`N04,${date},${String(h).padStart(2, '0')}:00:00,${h === 16 ? peak : -0.5}`);
    }
  }
  return rows.join('\n');
})();
const at = (bkk) => Date.parse(`${bkk}:00+07:00`);

test('parseTideTable: hourly cm from the first hour, gaps stay null, junk rows skipped', () => {
  const t = parseTideTable(csv.replace('N04,2026-10-02,05:00:00,-0.5', 'N04,2026-10-02,05:00:00,') + '\nbad,row');
  assert.equal(t.t0, '2026-10-01T00:00');
  assert.equal(t.cm.length, 60 * 24);
  assert.equal(t.cm[16], 100);
  assert.equal(t.cm[24 + 5], null);
  assert.throws(() => parseTideTable('station,date,time,value\nN04,2026-10-01,00:00:00,1'), /only 1/);
});

test('summarizeTideTable: 48 h peak, "high" against the top 15 % of the whole table, coming days', () => {
  const t = parseTideTable(csv);
  const calm = summarizeTideTable(t, at('2026-10-05T10:00'));
  assert.equal(calm.peak, 1);
  assert.equal(calm.peakTime, '2026-10-05T16:00');
  assert.equal(calm.high, false);
  assert.equal(calm.hours.length, 48);
  assert.equal(calm.days.length, 7);
  assert.equal(calm.dayThreshold, 1.3);
  const spring = summarizeTideTable(t, at('2026-11-09T20:00')); // next 48 h include day 40 (10 Nov)
  assert.equal(spring.peak, 1.5);
  assert.equal(spring.high, true);
  assert.equal(spring.topDay.date, '2026-11-10');
  assert.ok(spring.days.filter((d) => d.high).length >= 1);
});

test('summarizeTideTable returns null outside the table (an old file is reported missing, not guessed)', () => {
  const t = parseTideTable(csv);
  assert.equal(summarizeTideTable(t, at('2026-09-30T10:00')), null);
  assert.equal(summarizeTideTable(t, at('2026-11-29T10:00')), null); // fewer than 48 h left
  assert.equal(summarizeTideTable(null), null);
});
