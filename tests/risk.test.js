import test from 'node:test';
import assert from 'node:assert/strict';
import { assess } from '../src/lib/risk.js';
import { normalizeStations, trendOf } from '../src/lib/thaiwater.js';
import { summarizeRain, summarizeTide } from '../src/lib/forecast.js';

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

test('regional overbank canals add a system-wide point', () => {
  const rain = { next24: 0, peakHour: 0, past48: 0, max24: 0, min24: 0 };
  const a = assess({ rain, regional: { over: 3, total: 20 } });
  const b = assess({ rain, regional: { over: 12, total: 29 } });
  assert.equal(a.score, 0);
  assert.equal(b.score, 1);
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
