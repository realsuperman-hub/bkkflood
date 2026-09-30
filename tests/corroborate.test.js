import test from 'node:test';
import assert from 'node:assert/strict';
import { corroborate } from '../src/lib/corroborate.js';

const NOW = Date.parse('2026-09-30T10:00:00Z');
const f = (id, lat = 13.75, lng = 100.5, ageH = 1) => ({ id, lat, lng, t: NOW - ageH * 3600e3, lvl: 2 });
const near = (dLat) => 13.75 + dLat; // 0.001° ≈ 111 m

test('a lone complaint is "single" and says so', () => {
  const me = f('a');
  const r = corroborate(me, { floods: [me], now: NOW });
  assert.equal(r.tier, 'single');
  assert.equal(r.kinds, 1);
  assert.equal(r.signals.length, 0);
});

test('two or more other complainants nearby lift it to "some", but never to "multi" on their own', () => {
  const me = f('a');
  const floods = [me, f('b', near(0.001)), f('c', near(0.0015)), f('far', near(0.02))];
  const r = corroborate(me, { floods, now: NOW });
  assert.equal(r.witnesses, 2);
  assert.equal(r.tier, 'some');
  const one = corroborate(me, { floods: [me, f('b', near(0.001))], now: NOW });
  assert.equal(one.tier, 'single'); // one other voice is not enough
});

test('an official BMA flood event or a user report adds a separate kind of evidence', () => {
  const me = f('a');
  const ev = { kind: 'flood', lat: near(0.002), lng: 100.5, t: NOW - 3600e3, title: 'น้ำท่วมขังถนน' };
  assert.equal(corroborate(me, { floods: [me], events: [ev], now: NOW }).tier, 'some');
  const rep = { lat: near(0.001), lng: 100.5, wrongCount: 0, stillCount: 1 };
  const r = corroborate(me, { floods: [me], events: [ev], reports: [rep], now: NOW });
  assert.equal(r.tier, 'multi'); // complaint + official + crowd
  assert.equal(r.kinds, 3);
  // an old traffic event, a non-flood event, and a voted-down report do not count
  const stale = { ...ev, t: NOW - 20 * 3600e3 };
  const other = { ...ev, kind: 'accident' };
  const bad = { ...rep, wrongCount: 3, stillCount: 0 };
  assert.equal(corroborate(me, { floods: [me], events: [stale, other], reports: [bad], now: NOW }).tier, 'single');
});

test('surroundings agree (over-bank gauge or heavy observed rain) count once as "env"', () => {
  const me = f('a');
  const gauge = { name: 'คลองทดสอบ', lat: near(0.005), lng: 100.5, level: 5, stale: false };
  const rain = { name: 'สถานีฝน', lat: near(0.01), lng: 100.5, r1: 25, stale: false };
  const both = corroborate(me, { floods: [me], stations: [gauge], rainObs: [rain], now: NOW });
  assert.equal(both.kinds, 2); // env is one kind even with two signals
  assert.equal(both.tier, 'some');
  assert.equal(both.signals.length, 2);
  // stale / upstream gauges and light rain are ignored
  const ignored = corroborate(me, { floods: [me], stations: [{ ...gauge, stale: true }, { ...gauge, upstream: true }], rainObs: [{ ...rain, r1: 3 }], now: NOW });
  assert.equal(ignored.tier, 'single');
});
