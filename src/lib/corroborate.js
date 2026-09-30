// How well is a reported flood spot backed up? Traffy complaints are single voices, so for every one we look for OTHER, independent
// evidence close by and say plainly what we found:
//   official — BMA published a flood traffic event within 400 m (last 12 h)
//   crowd    — a BKKFLOOD user report within 300 m that has not been voted down
//   env      — the surroundings agree: a gauge within 2 km is over its bank, or ≥ 10 mm of rain fell within 3 km in the last hour
//   witness  — other Traffy complainants within 300 m (same platform, so it strengthens the case but is not a separate source)
// tier: 3+ kinds of evidence (the complaint itself counts as one) = multi · 2 kinds, or ≥ 2 other witnesses = some · otherwise single.
// This is a transparency label, not a verdict: "single" does not mean "false", and "multi" does not measure the depth of the water.
import { distKm } from './geo.js';

export const TIER = {
  multi: { label: 'ยืนยันหลายแหล่ง', color: '#2e9e5b', opacity: 1 },
  some: { label: 'มีสัญญาณหนุน', color: '#b88700', opacity: 0.92 },
  single: { label: 'ยังไม่ยืนยัน (สัญญาณเดียว)', color: '#6b7683', opacity: 0.8 },
};

const H = 3600e3;

export function corroborate(f, { floods = [], events = [], reports = [], stations = [], rainObs = [], now = Date.now() } = {}) {
  const signals = [];
  const km = (o) => distKm(f.lat, f.lng, o.lat, o.lng);

  const witnesses = floods.filter((o) => o.id !== f.id && now - o.t < 24 * H && km(o) <= 0.3).length;
  if (witnesses) signals.push({ kind: 'witness', text: `มีผู้แจ้ง Traffy รายอื่นอีก ${witnesses} ราย ในรัศมี 300 ม.` });

  const ev = events
    .filter((e) => e.kind === 'flood' && now - e.t < 12 * H && km(e) <= 0.4)
    .sort((a, b) => km(a) - km(b))[0];
  if (ev) signals.push({ kind: 'official', text: `กทม. ประกาศเหตุการณ์น้ำท่วม: ${String(ev.title || '').slice(0, 60)} (ห่าง ${Math.round(km(ev) * 1000)} ม.)` });

  const rep = reports.filter((r) => km(r) <= 0.3 && !(r.wrongCount >= 2 && r.wrongCount > (r.stillCount || 0))).length;
  if (rep) signals.push({ kind: 'crowd', text: `ผู้ใช้ BKKFLOOD รายงานน้ำท่วมใกล้เคียง ${rep} รายการ` });

  const gauge = stations
    .filter((s) => !s.upstream && !s.stale && s.level === 5 && km(s) <= 2)
    .sort((a, b) => km(a) - km(b))[0];
  const rain = rainObs
    .filter((g) => !g.stale && (g.r1 ?? 0) >= 10 && km(g) <= 3)
    .sort((a, b) => (b.r1 ?? 0) - (a.r1 ?? 0))[0];
  if (gauge) signals.push({ kind: 'env', text: `สถานี${gauge.name} (${km(gauge).toFixed(1)} กม.) ระดับน้ำล้นตลิ่ง` });
  if (rain) signals.push({ kind: 'env', text: `ฝนตกจริง ${rain.r1} มม. ใน 1 ชม. ล่าสุด ที่สถานี${rain.name || 'วัดฝน'} (${km(rain).toFixed(1)} กม.)` });

  const kinds = 1 + new Set(signals.map((s) => s.kind).filter((k) => k !== 'witness')).size;
  const tier = kinds >= 3 ? 'multi' : kinds === 2 || witnesses >= 2 ? 'some' : 'single';
  return { tier, ...TIER[tier], kinds, witnesses, signals };
}

// Convenience for the app: everything comes from the shared state object
export const corroborateState = (f, state, now = Date.now()) =>
  corroborate(f, { floods: state.floods, events: state.traffic?.events, reports: state.reports, stations: state.stations, rainObs: state.rainObs, now });
