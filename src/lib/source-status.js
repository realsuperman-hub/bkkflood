// "Are the data sources up to date?" — worked out in the browser from the timestamps of the snapshots and of the readings inside them, so a stalled
// refresh, a dead upstream or a PC that is switched off all show up as the same symptom: data older than it should be. Pure — unit-tested.
// level: 0 ok · 1 slow (older than usual) · 2 old (do not rely on it) · 3 missing · -1 still loading (never shown as a problem)
export const OK = 0;
export const SLOW = 1;
export const OLD = 2;
export const MISSING = 3;
export const LOADING = -1;

const MIN = 60e3;
const H = 3600e3;
const D = 24 * H;

// a timestamp in any shape we store (ms number, ISO string, "YYYY-MM-DD") → ms or null
export function toMs(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
  const t = Date.parse(String(v).replace(' ', 'T'));
  return Number.isNaN(t) ? null : t;
}

const newest = (arr, pick) => arr.reduce((m, x) => Math.max(m, toMs(pick(x)) ?? 0), 0) || null;

function judge(at, warn, old, now) {
  const t = toMs(at);
  if (t === null) return { level: MISSING, at: null };
  const age = now - t;
  return { level: age > old ? OLD : age > warn ? SLOW : OK, at: t };
}

// → [{ id, group:'core'|'extra', label, feeds, note?, level, at }]
export function sourceStatuses(s, now = Date.now(), { loading = false } = {}) {
  const out = [];
  const add = (id, group, label, feeds, res, note = '') => out.push({ id, group, label, feeds, note, ...res });
  const miss = (cond) => (cond ? { level: loading ? LOADING : MISSING, at: null } : null);

  // ── core: what the risk score and the headline numbers stand on
  {
    const st = (s.stations || []).filter((x) => !x.upstream);
    const r = miss(!st.length) || judge(newest(st, (x) => x.t) ?? s.stationsAt, 2 * H, 6 * H, now);
    add('stations', 'core', 'ระดับน้ำในแม่น้ำและคลอง', 'ThaiWater (สสน.) · คะแนนความเสี่ยง · สถานีล้นตลิ่ง', r, 'ต้นทางอัปเดตราวชั่วโมงละครั้ง');
  }
  {
    const r = miss(!(s.floods || []).length && !s.floodsAt) || judge(s.floodsAt, 45 * MIN, 3 * H, now);
    add('floods', 'core', 'จุดน้ำท่วมที่ประชาชนแจ้ง', 'Traffy Fondue (กทม.) · แผนที่จุดท่วม · เขตที่ท่วมหนัก', r, 'รวมใหม่ทุก ~15 นาที');
  }
  {
    const g = s.rainObs || [];
    const r = miss(!g.length) || judge(newest(g, (x) => x.t) ?? s.rainObsAt, 2 * H, 6 * H, now);
    add('rain', 'core', 'ฝนตรวจวัดจริง', 'ThaiWater · สถานีฝน · คะแนนความเสี่ยง', r);
  }
  {
    const f = s.roadFlood?.features;
    let r = miss(!s.roadFlood) || judge(s.roadFlood.generatedAt, 45 * MIN, 3 * H, now);
    let note = 'Floodboard (ข้อมูลเปิด) · รวมใหม่ทุก ~15 นาที';
    // our copy can be fresh while Floodboard itself has stopped updating: look at the newest reading inside it
    const inner = f?.length ? newest(f, (x) => x.properties.u) : null;
    if (r.level === OK && inner && now - inner > 6 * H) { r = { level: SLOW, at: inner }; note = 'ต้นทาง (Floodboard) ไม่มีการอัปเดตความลึกใหม่มาหลายชั่วโมง'; }
    add('roads', 'core', 'ระดับน้ำบนถนน', 'ตรวจเส้นทาง · แจ้งเตือนถนน · เลเยอร์ระดับน้ำบนถนน', r, note);
  }
  {
    const o = s.overview;
    const r = !o ? { level: loading ? LOADING : MISSING, at: null } : o.rain && o.tide ? { level: OK, at: o.at } : o.rain || o.tide ? { level: SLOW, at: o.at } : { level: OLD, at: o.at };
    add('forecast', 'core', 'พยากรณ์ฝนและน้ำทะเลหนุน', 'Open-Meteo · พยากรณ์ 48 ชม. · คะแนนความเสี่ยง', r, o && !(o.rain && o.tide) ? `ไม่ได้ข้อมูล${o.rain ? 'น้ำทะเลหนุน' : o.tide ? 'ฝน' : 'ฝนและน้ำทะเลหนุน'}` : '');
  }

  // ── extra: useful context
  const t = s.traffic || {};
  add('events', 'extra', 'เหตุการณ์จราจร กทม.', 'ป้ายเหตุน้ำท่วมบนถนน', miss(!t.eventsAt) || judge(t.eventsAt, 45 * MIN, 3 * H, now));
  add('speed', 'extra', 'ความเร็วรถบนถนน กทม.', 'เส้นถนนติดขัด', miss(!t.roadsAt) || judge(t.roadsAt, 45 * MIN, 3 * H, now));
  add('dds', 'extra', 'รายงานน้ำท่วมถนนสายหลัก สนน.', 'การ์ดรายงานรายวัน', miss(!s.traffic?.dds) || judge(s.traffic.dds.reportDate, 2 * D, 5 * D, now), 'รายงานรายวันของ กทม.');
  add('dams', 'extra', 'เขื่อน', 'กรมชลประทาน · การ์ดเขื่อน', miss(!s.dams) || judge(s.dams.date, 2 * D, 4 * D, now), 'รายงานรายวัน');
  add('sat', 'extra', 'น้ำท่วมจากดาวเทียม', 'GISTDA · เลเยอร์ดาวเทียม', miss(!s.satFlood) || judge(s.satFlood.lastPass ?? s.satFlood.generatedAt, 6 * D, 14 * D, now), 'ดาวเทียมผ่านทุก 3–6 วัน (วันที่ภาพล่าสุด)');
  add('news', 'extra', 'ข่าวน้ำท่วม', 'การ์ดข่าว (RSS)', miss(!s.news) || judge(s.news.generatedAt, 3 * H, 12 * H, now));
  add('cams', 'extra', 'รายการกล้อง CCTV', 'ห้องมอนิเตอร์ · ภาพกล้องบนแผนที่', miss(!s.mcams) || judge(s.mcams.generatedAt, 30 * H, 72 * H, now), 'ตรวจใหม่วันละ 2 ครั้งจากเครื่องของผู้จัดทำ');
  add('ai', 'extra', 'AI อ่านภาพกล้อง', 'จุดแดง “AI พบน้ำท่วม”', miss(!s.mcamAi) || judge(s.mcamAi.generatedAt, 3 * H, 4 * H, now), 'ถ้าเกิน 4 ชม. จะไม่แสดงธง AI');
  if (s.routeSvc) add('route', 'extra', 'บริการหาเส้นทาง (OSRM)', 'ตรวจเส้นทางน้ำท่วม', { level: s.routeSvc.ok ? OK : OLD, at: s.routeSvc.at }, s.routeSvc.ok ? 'ตอบล่าสุดเมื่อใช้งาน' : 'ครั้งล่าสุดไม่ตอบ');
  return out;
}

// the one-line verdict for the overview
export function overallStatus(list) {
  const bad = (g, min) => list.filter((x) => x.group === g && x.level >= min);
  const core = bad('core', SLOW);
  const worst = Math.max(OK, ...core.map((x) => x.level));
  const extraBad = bad('extra', SLOW).length;
  if (!core.length) return { tone: extraBad ? 'warn' : 'ok', text: extraBad ? 'แหล่งข้อมูลหลักอัปเดตปกติ · บางแหล่งเสริมล่าช้า' : 'แหล่งข้อมูลอัปเดตปกติ', labels: [] };
  const labels = core.map((x) => x.label);
  if (worst >= OLD) return { tone: 'bad', text: `แหล่งข้อมูลไม่อัปเดต: ${labels.join(' · ')} — ตัวเลขอาจไม่ตรงปัจจุบัน`, labels };
  return { tone: 'warn', text: `บางแหล่งข้อมูลล่าช้า: ${labels.join(' · ')}`, labels };
}
