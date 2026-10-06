// Official tide predictions for the Chao Phraya mouth: HII's copy of the Royal Thai Navy Hydrographic Department tide table (astronomical tide,
// metres above mean sea level, hourly, about one year ahead). It replaced Open-Meteo Marine for the "high tide" signal on 2026-10-06: the two agree
// hour by hour (r ≈ 0.95, ~1 h apart) but put the month's highest days on different dates, and Open-Meteo sits ~0.85 m higher on another datum.
// DOM-free: the Thai-network sync job turns the text file into data-static/tide-table.json; the app and the server scripts read that.
export const TIDE_TABLE_URL = 'https://fews2.hii.or.th/model-output/data_portal/tide_table/N04.txt';
export const TIDE_STATION = { code: 'N04', name: 'สันดอนเจ้าพระยา', lat: 13.4503, lng: 100.5953 };
export const HIGH_PCT = 0.85; // a day is "high" when its peak is in the top 15 % of the daily peaks across the whole table (about a year)

const HOUR = 3600e3;
const r2 = (x) => Math.round(x * 100) / 100;
// "YYYY-MM-DDTHH:00" Bangkok wall time ↔ an hour index from the table's first hour
const keyMs = (key) => Date.parse(`${key}:00Z`);
const keyOf = (ms) => new Date(ms).toISOString().slice(0, 13) + ':00';
const bangkokKey = (now) => keyOf(now + 7 * HOUR);

// "station,date,time,value" CSV → { t0, cm } where cm[i] is the level in cm at hour t0 + i (null where the file has a gap)
export function parseTideTable(text) {
  const rows = String(text).trim().split(/\r?\n/).slice(1).map((l) => l.split(','));
  const pts = [];
  for (const [, date, time, value] of rows) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^\d{2}:\d{2}/.test(time || '') || value === undefined || value.trim() === '' || !Number.isFinite(+value)) continue;
    pts.push([keyMs(`${date}T${time.slice(0, 2)}:00`), Math.round(+value * 100)]);
  }
  if (pts.length < 24 * 30) throw new Error(`tide table: only ${pts.length} hourly values`);
  const start = Math.min(...pts.map((p) => p[0]));
  const end = Math.max(...pts.map((p) => p[0]));
  const cm = Array.from({ length: (end - start) / HOUR + 1 }, () => null);
  for (const [ms, v] of pts) cm[(ms - start) / HOUR] = v;
  return { t0: keyOf(start), cm };
}

// highest level of each day with at least 18 hours of data → [{ date, peak (m), peakTime }]
function dailyPeaks(tbl) {
  const start = keyMs(tbl.t0);
  const byDay = new Map();
  tbl.cm.forEach((v, i) => {
    if (v === null || v === undefined) return;
    const key = keyOf(start + i * HOUR);
    const day = key.slice(0, 10);
    const e = byDay.get(day) || { n: 0, peak: -Infinity, peakTime: null };
    e.n += 1;
    if (v > e.peak) Object.assign(e, { peak: v, peakTime: key });
    byDay.set(day, e);
  });
  return [...byDay].filter(([, e]) => e.n >= 18).map(([date, e]) => ({ date, peak: e.peak / 100, peakTime: e.peakTime }));
}

// What the risk card and the score need, in the shape the Open-Meteo summary had: { peak, peakTime, high, hours, days, dayThreshold, topDay }.
// null when "now" is outside the table (an old file) — the caller then reports the tide as missing rather than guessing.
export function summarizeTideTable(tbl, now = Date.now(), { days: nDays = 7 } = {}) {
  if (!tbl?.cm?.length) return null;
  const start = keyMs(tbl.t0);
  const i0 = (keyMs(bangkokKey(now)) - start) / HOUR;
  if (i0 < 0 || i0 + 48 > tbl.cm.length) return null;
  const peaks = dailyPeaks(tbl);
  const sorted = peaks.map((d) => d.peak).sort((a, b) => a - b);
  const thr = sorted[Math.floor(sorted.length * HIGH_PCT)] ?? Infinity;
  const next = tbl.cm.slice(i0, i0 + 48);
  let pk = -1;
  next.forEach((v, i) => {
    if (v !== null && (pk < 0 || v > next[pk])) pk = i;
  });
  if (pk < 0) return null;
  const today = bangkokKey(now).slice(0, 10);
  const days = peaks.filter((d) => d.date >= today).slice(0, nDays).map((d) => ({ ...d, high: d.peak >= thr }));
  return {
    peak: r2(next[pk] / 100),
    peakTime: keyOf(start + (i0 + pk) * HOUR),
    high: next[pk] / 100 >= thr,
    hours: next.map((v, k) => ({ t: keyOf(start + (i0 + k) * HOUR), v: v === null ? null : v / 100 })),
    days,
    dayThreshold: r2(thr),
    topDay: days.reduce((m, d) => (!m || d.peak > m.peak ? d : m), null),
    station: tbl.station?.name || TIDE_STATION.name,
  };
}
