import test from 'node:test';
import assert from 'node:assert/strict';
import { assess, COMP } from '../src/lib/risk.js';
import { normalizeStations, trendOf } from '../src/lib/thaiwater.js';
import { summarizeRain, summarizeTide, dailyPeaks, antecedentIndex } from '../src/lib/forecast.js';

const gauge = (o) => ({ name: 'คลองทดสอบ', km: 1.2, level: 3, over: -0.5, trend: 0, stale: false, ...o });

test('dry day, normal gauges, high ground → ok', () => {
  const r = assess({ rain: { next24: 2, peakHour: 1, past48: 3, max24: 4, min24: 1 }, gauges: [gauge({})], elevation: 5 });
  assert.equal(r.level, 0);
  assert.equal(r.reasons.length, 0);
});

test('heavy rain + overbank canal + low ground → danger, with reasons', () => {
  const r = assess({
    rain: { next24: 80, peakHour: 45, past48: 70, max24: 90, min24: 60 },
    tide: { high: true, peak: 1.8 },
    gauges: [gauge({ level: 5, over: 0.24, trend: 0.05 })],
    upstream: { q: 2600 },
    elevation: 1,
  });
  assert.equal(r.level, 3);
  assert.ok(r.reasons.length >= 4);
  assert.ok(r.reasons[0].pts >= r.reasons.at(-1).pts, 'reasons sorted by weight');
});

test('stale gauge is ignored', () => {
  const r = assess({ rain: { next24: 0, peakHour: 0, past48: 0, max24: 0, min24: 0 }, gauges: [gauge({ level: 5, over: 1, stale: true })] });
  assert.equal(r.level, 0);
});

test('model disagreement is flagged', () => {
  const r = assess({ rain: { next24: 5, peakHour: 2, past48: 0, max24: 45, min24: 3 } });
  assert.equal(r.notes.length, 1);
});

test('normalizeStations keeps metro + upstream, parses strings and Bangkok time', () => {
  const row = (prov, code, extra = {}) => ({
    id: 1, waterlevel_datetime: '2026-09-29 21:20', waterlevel_msl: '2.44', waterlevel_msl_previous: '2.40',
    discharge: null, situation_level: 5,
    station: { id: 9, tele_station_name: { th: ' ทดสอบ ' }, tele_station_lat: 13.8, tele_station_long: 100.5, tele_station_oldcode: code, min_bank: 2.2 },
    geocode: { province_name: { th: prov } }, agency: { agency_shortname: { th: 'ชป.' } }, ...extra,
  });
  const raw = { waterlevel_data: { data: [row('กรุงเทพมหานคร', 'X'), row('เชียงใหม่', 'Y'), row('ชัยนาท', 'C.13')] } };
  const now = Date.parse('2026-09-29T21:30:00+07:00');
  const s = normalizeStations(raw, now);
  assert.equal(s.length, 2);
  assert.equal(s[0].name, 'ทดสอบ');
  assert.equal(s[0].over, 0.24);
  assert.equal(s[0].stale, false);
  assert.equal(trendOf(s[0]), 'rising');
  assert.equal(s[1].upstream, true);
  assert.equal(normalizeStations(raw, now + 4 * 3600e3)[0].stale, true);
  assert.throws(() => normalizeStations({}), /unexpected/);
});

test('summarizeRain uses median of models and windows from "now"', () => {
  const times = Array.from({ length: 24 * 6 }, (_, i) => new Date(Date.UTC(2026, 8, 27, 0) + i * 3600e3).toISOString().slice(0, 13) + ':00');
  const flat = (v) => times.map(() => v);
  const d = { elevation: 9, hourly: { time: times, precipitation_ecmwf_ifs025: flat(1), precipitation_gfs_seamless: flat(2), precipitation_icon_seamless: flat(9) } };
  const now = Date.parse('2026-09-29T10:00:00+07:00') - 7 * 3600e3 + 7 * 3600e3; // key uses +7h shift
  const r = summarizeRain(d, Date.parse('2026-09-29T03:00:00Z'));
  assert.equal(r.next24, 48); // median per hour = 2 → 48
  assert.equal(r.max24, 216);
  assert.equal(r.min24, 24);
  assert.equal(r.hours.length, 48);
  void now;
});

test('summarizeTide flags high peaks', () => {
  const times = Array.from({ length: 168 }, (_, i) => new Date(Date.UTC(2026, 8, 29, 0) + i * 3600e3).toISOString().slice(0, 13) + ':00');
  const vals = times.map((_, i) => (i === 6 ? 1.93 : Math.sin(i) * 0.8));
  const t = summarizeTide({ hourly: { time: times, sea_level_height_msl: vals } }, Date.parse('2026-09-28T17:00:00Z'));
  assert.equal(t.peak, 1.9);
  assert.equal(t.high, true);
});

test('region-wide overbank canals and high upstream flow are information only: no points, a note, a logged bit', () => {
  const rain = { next24: 0, peakHour: 0, past48: 0, max24: 0, min24: 0 };
  const a = assess({ rain, regional: { over: 3, total: 20 } });
  const b = assess({ rain, regional: { over: 12, total: 29 }, upstream: { q: 2600 } });
  assert.equal(a.score, 0);
  assert.equal(a.info.length, 0);
  assert.equal(b.score, 0);
  assert.equal(b.level, 0);
  assert.equal(b.info.length, 2);
  assert.ok(b.info.every((t) => /ไม่นับเป็นคะแนน/.test(t)));
  assert.equal((b.comp >> COMP.regional) & 1, 1);
  assert.equal((b.comp >> COMP.upstream) & 1, 1);
});

test('nearby complaints raise the score (observed flooding beats a dry forecast)', () => {
  const rain = { next24: 0, peakHour: 0, past48: 0, max24: 0, min24: 0 };
  assert.equal(assess({ rain, nearby: { heavy: 0, medium: 0, light: 0 } }).score, 0);
  assert.equal(assess({ rain, nearby: { heavy: 0, medium: 0, light: 1 } }).score, 1);
  assert.equal(assess({ rain, nearby: { heavy: 0, medium: 2, light: 0 } }).score, 2);
  const h = assess({ rain, nearby: { heavy: 2, medium: 1, light: 0 } });
  assert.equal(h.score, 3);
  assert.equal(h.level, 1);
});

test('observed rain at nearby gauges raises the score and is explained', () => {
  const rain = { next24: 0, peakHour: 0, past48: 0, max24: 0, min24: 0 };
  const obs = (r1, r24 = 0) => ({ r1, r1Name: 'สถานีทดสอบ', r1Km: 2.3, r24, r24Name: 'สถานีทดสอบ', r24Km: 2.3, n: 3 });
  assert.equal(assess({ rain, obs: obs(0) }).score, 0);
  assert.equal(assess({ rain, obs: obs(3) }).score, 1);
  assert.equal(assess({ rain, obs: obs(15) }).score, 2);
  const heavy = assess({ rain, obs: obs(45, 120) });
  assert.equal(heavy.score, 4);
  assert.match(heavy.reasons[0].text, /ฝนตรวจวัดจริง.*45/);
});

test('an official BMA flood announcement nearby raises the score and names the road', () => {
  const rain = { next24: 0, peakHour: 0, past48: 0, max24: 0, min24: 0 };
  const r = assess({ rain, official: [{ title: 'น้ำท่วม ถนนรามอินทรา' }, { title: 'น้ำท่วม ถนนลาดกระบัง' }] });
  assert.equal(r.score, 2);
  assert.match(r.reasons[0].text, /รามอินทรา.*อีก 1/);
  assert.equal(assess({ rain, official: [] }).score, 0);
});

test('normalizeStations keeps the whole Chao Phraya chain; only non-metro chain stations are flagged upstream', () => {
  const row = (prov, code) => ({
    id: code, waterlevel_datetime: '2026-09-29 21:20', waterlevel_msl: '5', waterlevel_msl_previous: '5', discharge: null, situation_level: 4,
    station: { id: code, tele_station_name: { th: code }, tele_station_lat: 14.5, tele_station_long: 100.4, tele_station_oldcode: code, min_bank: 6 },
    geocode: { province_name: { th: prov } }, agency: { agency_shortname: { th: 'x' } },
  });
  const raw = { waterlevel_data: { data: [row('ชัยนาท', 'CPY004'), row('อ่างทอง', 'CPY008'), row('กรุงเทพมหานคร', 'CPY015'), row('เชียงใหม่', 'P.1')] } };
  const s = Object.fromEntries(normalizeStations(raw, Date.parse('2026-09-29T21:30:00+07:00')).map((x) => [x.code, x]));
  assert.deepEqual(Object.keys(s).sort(), ['CPY004', 'CPY008', 'CPY015']);
  assert.equal(s.CPY004.upstream, true);
  assert.equal(s.CPY008.upstream, true);
  assert.equal(s.CPY015.upstream, false); // Bangkok gauge stays a metro gauge …
  assert.equal(s.CPY015.chain, true); // … but is still shown on the river route
});

test('dailyPeaks picks each day\'s highest hour, drops thin days, and flags the top 20% (≥ 1.3 m)', () => {
  const times = [];
  const vals = [];
  for (let d = 0; d < 12; d++) {
    for (let h = 0; h < 24; h++) {
      const day = new Date(Date.UTC(2026, 8, 20 + d)).toISOString().slice(0, 10);
      times.push(`${day}T${String(h).padStart(2, '0')}:00`);
      // day 10 is the highest (2.1 m); the last day only has 6 valid hours (forecast tail)
      vals.push(d === 11 && h >= 6 ? null : h === 12 ? (d === 10 ? 2.1 : 1.5 + d * 0.01) : 0);
    }
  }
  const r = dailyPeaks(times, vals, '2026-09-22');
  assert.equal(r.days.at(-1).date, '2026-09-30'); // 2026-10-01 has < 18 valid hours → dropped
  assert.equal(r.topDay.date, '2026-09-30');
  assert.equal(r.topDay.peak, 2.1);
  assert.equal(r.days.find((x) => x.date === '2026-09-30').high, true);
  assert.equal(r.days.find((x) => x.date === '2026-09-22').high, false);
});

test('antecedentIndex weights recent days more and settles near R/(1-K) in steady rain', () => {
  const hours = 24 * 8;
  const steady = Array.from({ length: hours }, () => 10 / 24); // 10 mm/day
  const a = antecedentIndex(steady, hours);
  // 7-day truncation of the geometric series: 10 × (1 − 0.8^7)/(1 − 0.8) ≈ 39.5
  assert.ok(Math.abs(a.api - 39.5) < 0.3, String(a.api));
  assert.equal(a.past7, 70);
  // the same total rain counts for more when it fell yesterday than when it fell a week ago
  const recent = Array.from({ length: hours }, (_, i) => (i >= hours - 24 ? 24 / 24 * 10 : 0));
  const old = Array.from({ length: hours }, (_, i) => (i >= hours - 24 * 7 && i < hours - 24 * 6 ? 10 : 0));
  assert.ok(antecedentIndex(recent, hours).api > antecedentIndex(old, hours).api * 2);
  assert.equal(antecedentIndex([1, 2, 3], 3), null); // not enough history → no index
});

test('low ground is information only: no points, a note for the user, and a logged component bit', () => {
  const dry = { next24: 0, peakHour: 0, past48: 0, max24: 0, min24: 0 };
  const low = assess({ rain: dry, elevation: 1 });
  const high = assess({ rain: dry, elevation: 5 });
  assert.equal(low.score, high.score);
  assert.equal(low.level, 0);
  assert.equal(low.reasons.length, 0);
  assert.equal(low.info.length, 1);
  assert.match(low.info[0], /ไม่นับเป็นคะแนน/);
  assert.equal((low.comp >> COMP.lowGround) & 1, 1);
  assert.equal(high.info.length, 0);
});

test('component bits record which parts of the score fired', () => {
  const r = assess({ rain: { next24: 80, peakHour: 45, past48: 70, max24: 90, min24: 60 }, tide: { high: true, peak: 1.8 }, gauges: [gauge({ level: 5, over: 0.24, trend: 0.05 })], upstream: { q: 2600 } });
  const on = (k) => (r.comp >> COMP[k]) & 1;
  assert.deepEqual(['fcNext24', 'fcPeakHour', 'fcPast48', 'tideHigh', 'gaugeOver', 'gaugeRising', 'upstream'].map(on), [1, 1, 1, 1, 1, 1, 1]);
  assert.deepEqual(['nearHeavy', 'official', 'obsRain1h', 'lowGround', 'regional'].map(on), [0, 0, 0, 0, 0]);
});
