// Renders the four tabs of the side panel as HTML strings. Events are delegated in main.js via data-act.
import { state } from '../state.js';
import { LEVELS, TREND_TH, trendOf } from '../lib/thaiwater.js';
import { DEPTHS, PASSABLE } from '../lib/store.js';
import { esc, ago, fmtTime, fmtHourKey, fmtDayHour } from '../lib/util.js';
import { RISK } from '../lib/risk.js';
import { SEVERITY } from '../lib/traffy.js';
import { BMA_LINKS, EVENT_LABEL, SPEED_LEVEL } from '../lib/bma-traffic.js';
import { distKm } from '../lib/geo.js';
import { validQuery } from '../lib/search.js';
import { intensity1h, intensity24h } from '../lib/rain-obs.js';

export const BKK_CENTER = { lat: 13.7563, lng: 100.5018 };

const DISCLAIMER =
  'เป็นการประเมินเพื่อช่วยตัดสินใจ ไม่ใช่ประกาศทางการ — โปรดตรวจคำเตือนอย่างเป็นทางการจาก ปภ. (1784) และกรมอุตุนิยมวิทยาประกอบเสมอ';

const skeleton = (t) => `<section class="card"><div class="skel"></div><p class="muted small">${t}</p></section>`;

/* ───────── shared components ───────── */
function riskCard(ev, title) {
  if (!ev) return skeleton('กำลังประเมินความเสี่ยง…');
  const r = ev.risk;
  const reasons = r.reasons.length
    ? `<ul class="reasons">${r.reasons.map((x) => `<li>${esc(x.text)}</li>`).join('')}</ul>`
    : '<p class="muted small">ไม่พบปัจจัยเสี่ยงเด่นจากข้อมูลที่มี</p>';
  const notes = r.notes.map((n) => `<p class="note">⚠ ${esc(n)}</p>`).join('');
  const errs = ev.errors.length
    ? `<p class="note">ดึงข้อมูลไม่สำเร็จ: ${esc(ev.errors.join(', '))} — การประเมินอาจต่ำกว่าความเป็นจริง</p>`
    : '';
  return `<section class="card risk" style="--c:${r.color}">
    <div class="risk-head"><span class="risk-badge">${esc(r.label)}</span><span class="risk-title">${esc(title)}</span></div>
    <p class="advice">${esc(r.advice)}</p>
    <div class="why">เพราะอะไร</div>${reasons}${notes}${errs}
    <p class="muted tiny">${DISCLAIMER}</p>
  </section>`;
}

export function rainChart(rain) {
  if (!rain) return '';
  const H = rain.hours;
  const W = 480;
  const T = 118;
  const top = Math.max(10, Math.ceil(Math.max(...H.map((h) => h.hi)) / 5) * 5);
  const bw = W / H.length;
  const y = (v) => T - (v / top) * (T - 14);
  const bars = H.map((h, i) => {
    const x = i * bw;
    return `<rect x="${x + 0.6}" y="${y(h.hi)}" width="${bw - 1.2}" height="${T - y(h.hi)}" fill="#bcd9ee"/>
            <rect x="${x + 0.6}" y="${y(h.med)}" width="${bw - 1.2}" height="${T - y(h.med)}" fill="#0b6fa8"/>`;
  });
  const ticks = H.map((h, i) => (i % 6 === 0 ? `<text x="${i * bw}" y="${T + 13}" class="ax">${fmtHourKey(h.t)}</text>` : '')).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${T + 18}" role="img" aria-label="กราฟฝนพยากรณ์ 48 ชั่วโมง">
    <line x1="0" y1="${T}" x2="${W}" y2="${T}" stroke="#8a94a3" stroke-width="1"/>
    <text x="2" y="10" class="ax">${top} มม./ชม.</text>${bars.join('')}${ticks}</svg>
    <div class="legend-row"><span><i style="background:#0b6fa8"></i>ค่ากลางของโมเดล</span><span><i style="background:#bcd9ee"></i>โมเดลที่ฝนมากสุด</span></div>`;
}

function tideChart(tide) {
  const v = tide.hours.map((h) => h.v ?? 0);
  const W = 480;
  const T = 70;
  const lo = Math.min(-0.5, ...v);
  const hi = Math.max(1.5, ...v);
  const x = (i) => (i / (v.length - 1)) * W;
  const y = (val) => 8 + (1 - (val - lo) / (hi - lo)) * (T - 16);
  const path = v.map((val, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(val).toFixed(1)}`).join(' ');
  const pk = v.indexOf(Math.max(...v));
  return `<svg class="chart" viewBox="0 0 ${W} ${T + 6}" role="img" aria-label="กราฟระดับน้ำทะเล 48 ชั่วโมง">
    <line x1="0" y1="${y(0)}" x2="${W}" y2="${y(0)}" stroke="#8a94a3" stroke-dasharray="3 3"/>
    <path d="${path}" fill="none" stroke="#0b6fa8" stroke-width="2"/>
    <circle cx="${x(pk)}" cy="${y(v[pk])}" r="4" fill="#d7263d"/></svg>`;
}

/* ───────── observed rain + next-3-hours ───────── */
const mm = (v) => (v === null || v === undefined ? '—' : `${v % 1 ? v.toFixed(1) : v}`);

const rainRow = (g, extra = '') => {
  const i1 = intensity1h(g.r1);
  const i24 = intensity24h(g.r24);
  return `<button class="row-item" data-act="fly-rain" data-id="${esc(g.id)}">
    <span class="dot" style="background:${g.stale ? '#8a94a3' : i1.color}"></span>
    <span class="grow"><b>${esc(g.name || 'สถานีวัดฝน')}</b>
      <small>${esc(g.prov)}${extra} · ${g.t ? `ข้อมูล ${fmtTime(g.t)} น.` : ''}${g.stale ? ' · <b>ข้อมูลเก่า</b>' : ''}</small></span>
    <span class="val"><span style="color:${i1.color}">${mm(g.r1)}</span><small> มม./ชม.</small><br><span class="rain24" style="color:${i24.color}">${mm(g.r24)}<small> มม./24ชม.</small></span></span></button>`;
};

/* ───────── BMA traffic + official flood report ───────── */
const EVC = { flood: '#0b6fa8', accident: '#f28c28', fire: '#d7263d', closed: '#12222e', other: '#5b6876' };
const TH_MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const thDate = (iso) => (iso ? `${+iso.slice(8, 10)} ${TH_MON[+iso.slice(5, 7) - 1]} ${(+iso.slice(0, 4) + 543) % 100}` : '—');
const linkBtns = () => `<div class="row wrap"><a class="btn btn-sm" href="${BMA_LINKS.bma}" target="_blank" rel="noopener">กล้อง/จราจร กทม. ↗</a><a class="btn btn-sm" href="${BMA_LINKS.itic}" target="_blank" rel="noopener">iTIC live ↗</a><a class="btn btn-sm" href="${BMA_LINKS.longdo}" target="_blank" rel="noopener">Longdo Traffic ↗</a></div>`;
const evRow = (e, extra = '') => `<button class="row-item" data-act="fly-event" data-id="${esc(e.id)}"><span class="dot" style="background:${EVC[e.kind]}"></span>
  <span class="grow"><b>${esc(EVENT_LABEL[e.kind] || 'เหตุการณ์')} · ${esc(e.title)}</b><small>${e.t ? ago(e.t) : ''}${extra}</small></span></button>`;

function trafficOverviewCard() {
  const t = state.traffic;
  if (!t.events.length && !t.roadsTotal && !t.longdo) return '';
  const flood = t.events.filter((e) => e.kind === 'flood');
  const others = t.events.filter((e) => e.kind !== 'flood');
  const slow = t.roads.length;
  const roads = t.roadsTotal
    ? slow
      ? `<p class="small">🚦 ช่วงถนนที่ติดขัดตอนนี้ <b>${slow}</b> ช่วง (จาก ${t.roadsFresh ?? '?'} ช่วงที่มีข้อมูลสด) — เส้นสีบนแผนที่</p>`
      : `<p class="small">🚦 ยังไม่พบช่วงถนนติดขัดในข้อมูลของ กทม. (มี ${t.roadsFresh ?? '?'} ช่วงที่รายงานล่าสุด จากที่ติดตามทั้งหมด ${t.roadsTotal} ช่วง) — <b>ถนนที่ไม่มีเซ็นเซอร์ไม่อยู่ในข้อมูลนี้</b></p>`
    : '';
  return `<section class="card"><h3>จราจรและถนนตอนนี้ (กทม.)</h3>
    ${t.longdo ? `<p class="small">ดัชนีจราจร Longdo: <b>${t.longdo.index}</b> <span class="muted">(ตัวเลขของ Longdo — ความหมายดูที่เว็บต้นทาง)</span></p>` : ''}
    ${roads}
    ${flood.length ? `<div class="why">ประกาศเหตุน้ำท่วมถนน (ศูนย์ข้อมูลจราจร กทม.)</div><div class="list">${flood.slice(0, 5).map((e) => evRow(e)).join('')}</div>` : '<p class="small">ไม่มีประกาศเหตุน้ำท่วมถนนจากศูนย์ข้อมูลจราจร กทม. ในขณะนี้</p>'}
    ${others.length ? `<p class="small">เหตุอื่น ${others.length} รายการ (อุบัติเหตุ/ไฟไหม้/ปิดถนน) — ดูบนแผนที่ (จุดสีตามชนิด)</p>` : ''}
    ${linkBtns()}
    <p class="muted tiny">ภาพกล้องสดต้องดูที่เว็บของเจ้าของกล้อง เว็บนี้ไม่นำภาพมาแสดงเอง · ที่มา: สำนักจัดการจราจรและขนส่ง กทม. · Longdo Traffic${t.eventsAt ? ` · ข้อมูล ณ ${fmtTime(t.eventsAt)} น.` : ''}</p></section>`;
}

const ddsAge = (iso) => {
  if (!iso) return null;
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  return Math.round((Date.parse(today) - Date.parse(iso)) / 86400e3);
};
const ddsRow = (r) => `<div class="row-item static"><span class="sev-ic" style="--c:${r.depthCm >= 30 ? '#d7263d' : r.depthCm >= 15 ? '#f28c28' : '#f2c200'}" aria-hidden="true"></span>
  <span class="grow"><b>${esc(r.road)} · ${esc(r.place)}</b><small>เขต${esc(r.district)} · ${r.lanes ? esc(r.lanes) : ''}${r.lengthM ? ` · ยาว ${r.lengthM} ม.` : ''} · ท่วม ${esc(r.from)} น.${r.dry ? `–${esc(r.dry)} น.` : ''}</small></span>
  <span class="val">${r.depthCm ?? '—'}<small> ซม.</small></span></div>`;

function ddsBanner(d) {
  const age = ddsAge(d.reportDate);
  return age >= 1
    ? `<p class="note">⚠ นี่คือ <b>รายงานย้อนหลังของวันที่ ${thDate(d.reportDate)}</b> (${age} วันที่แล้ว) — ไม่ใช่สถานการณ์ตอนนี้ แต่บอกได้ว่าถนนสายหลักช่วงไหนเคยท่วมและลึกเท่าไร</p>`
    : `<p class="small muted">รายงานของวันที่ ${thDate(d.reportDate)}</p>`;
}

function ddsOverviewCard() {
  const d = state.traffic.dds;
  if (!d?.rows?.length) return '';
  const top = [...d.rows].sort((a, b) => (b.depthCm ?? 0) - (a.depthCm ?? 0)).slice(0, 5);
  return `<section class="card"><h3>รายงานน้ำท่วมถนนสายหลัก (สำนักการระบายน้ำ กทม.)</h3>${ddsBanner(d)}
    <p class="small">${d.rows.length} จุด ใน ${new Set(d.rows.map((r) => r.district)).size} เขต · ลึกสุด ${top[0]?.depthCm ?? '—'} ซม.</p>
    <div class="list">${top.map(ddsRow).join('')}</div>
    <div class="row"><button class="btn btn-sm" data-act="goto-district" data-d="">ดูทั้งหมด/ค้นหาตามเขต</button></div>
    <p class="muted tiny">ที่มา: สำนักการระบายน้ำ กรุงเทพมหานคร (dds.bangkok.go.th) · ตารางนี้ไม่มีพิกัด จึงแสดงเป็นรายการ ค้นหาด้วยชื่อถนนได้</p></section>`;
}

function ddsListCard() {
  const d = state.traffic.dds;
  if (!d?.rows?.length) return '';
  const rows = d.rows.filter((r) => !state.district || r.district === state.district);
  return `<section class="card"><h3>รายงานน้ำท่วมถนนสายหลัก (สนน.) ${state.district ? `· เขต${esc(state.district)}` : ''}</h3>${ddsBanner(d)}
    ${rows.length ? `<div class="list">${rows.slice(0, 40).map(ddsRow).join('')}</div>${rows.length > 40 ? `<p class="muted small">แสดง 40 จาก ${rows.length} จุด — เลือกเขตเพื่อกรอง</p>` : ''}` : '<p class="muted small">ไม่มีรายการในเขตนี้</p>'}
    <p class="muted tiny">ที่มา: สำนักการระบายน้ำ กรุงเทพมหานคร</p></section>`;
}

function camerasNearCard(f) {
  const t = state.traffic;
  if (!t.cameras.length && !t.events.length) return '';
  const near = t.cameras.map((c) => ({ ...c, km: distKm(f.lat, f.lng, c.lat, c.lng) })).filter((c) => c.km <= 3).sort((a, b) => a.km - b.km).slice(0, 4);
  const evs = t.events.map((e) => ({ ...e, km: distKm(f.lat, f.lng, e.lat, e.lng) })).filter((e) => e.km <= 3).sort((a, b) => (b.kind === 'flood') - (a.kind === 'flood') || a.km - b.km);
  return `<section class="card"><h3>สภาพถนนรอบจุดนี้ (ภายใน 3 กม.)</h3>
    ${evs.length ? `<div class="why">เหตุการณ์จราจรวันนี้ (กทม.)</div><div class="list">${evs.slice(0, 4).map((e) => evRow(e, ` · ${e.km.toFixed(1)} กม.`)).join('')}</div>` : '<p class="small">ไม่มีเหตุการณ์จราจรที่ กทม. ประกาศรอบจุดนี้วันนี้</p>'}
    ${near.length ? `<div class="why">กล้องจราจรใกล้เคียง — ดูภาพสดที่เว็บทางการ</div><div class="list">${near.map((c) => `<button class="row-item" data-act="fly-camera" data-id="${esc(c.id)}"><span class="dot" style="background:${c.flood ? '#00a6c8' : '#4a5b6c'}"></span>
      <span class="grow"><b>${esc(c.name)}</b><small>${c.km.toFixed(1)} กม.${c.flood ? ' · จุดเฝ้าระวังน้ำท่วม' : ''}${c.desc && c.desc !== '-' ? ` · ${esc(c.desc)}` : ''}</small></span></button>`).join('')}</div>` : '<p class="muted small">ไม่มีกล้อง กทม. ภายใน 3 กม. (ครอบคลุมเฉพาะกรุงเทพฯ)</p>'}
    ${linkBtns()}
    <p class="muted tiny">เว็บนี้ไม่แสดงภาพกล้อง — กดปุ่มด้านบนเพื่อดูภาพสดที่เว็บของเจ้าของกล้อง แล้วค้นหาชื่อกล้อง</p></section>`;
}

function rainObsOverviewCard() {
  const g = state.rainObs;
  if (!g.length) return state.rainObsError ? `<section class="card"><h3>ฝนตรวจวัดจริง</h3><p class="note">โหลดข้อมูลสถานีวัดฝนไม่สำเร็จ (${esc(state.rainObsError)})</p></section>` : '';
  const fresh = g.filter((x) => !x.stale);
  const wet = fresh.filter((x) => (x.r1 ?? 0) > 0);
  const top = [...fresh].filter((x) => (x.r1 ?? 0) > 0 || (x.r24 ?? 0) >= 35).sort((a, b) => (b.r1 ?? 0) - (a.r1 ?? 0) || (b.r24 ?? 0) - (a.r24 ?? 0)).slice(0, 5);
  const heaviest1 = fresh.reduce((m, x) => ((x.r1 ?? 0) > (m?.r1 ?? -1) ? x : m), null);
  return `<section class="card"><h3>ฝนตรวจวัดจริงตอนนี้</h3>
    <p class="small">${wet.length ? `<b>${wet.length}</b> จาก ${fresh.length} สถานีวัดฝนรอบ กทม. รายงานว่ามีฝนตกใน 1 ชม. ล่าสุด${heaviest1 && heaviest1.r1 > 0 ? ` · หนักสุด <b>${mm(heaviest1.r1)} มม.</b> ที่${esc(heaviest1.name)}` : ''}` : `ไม่มีสถานีวัดฝนรอบ กทม. รายงานฝนตกใน 1 ชม. ล่าสุด (${fresh.length} สถานีที่มีข้อมูลสด)`}</p>
    ${top.length ? `<div class="list">${top.map((x) => rainRow(x)).join('')}</div>` : ''}
    <p class="muted tiny">ที่มา: ThaiWater (สสน.) และหน่วยงานเครือข่าย · ${state.rainObsAt ? `ข้อมูล ณ ${fmtTime(state.rainObsAt)} น.` : ''} สถานีส่วนใหญ่อัปเดตทุก 1 ชม. จึงอาจช้ากว่าฝนจริงได้ · ปริมาณฝนคือน้ำฝนที่วัดได้ที่จุดสถานี ไม่ใช่ทั้งพื้นที่</p></section>`;
}

// Next ~3 hours from the model hours we already fetched (models refresh hourly; not radar)
function next3hCard(f) {
  const rain = f.rain;
  if (!rain) return '';
  const H = rain.hours.slice(0, 3);
  const med = H.reduce((s, h) => s + h.med, 0);
  const hi = H.reduce((s, h) => s + h.hi, 0);
  const peak = H.reduce((m, h) => (h.med > m.med ? h : m), H[0]);
  const top = Math.max(5, Math.ceil(Math.max(...H.map((h) => h.hi)) / 5) * 5);
  const W = 300;
  const T = 70;
  const bw = W / H.length;
  const y = (v) => T - (v / top) * (T - 12);
  const bars = H.map((h, i) => `<rect x="${i * bw + 10}" y="${y(h.hi)}" width="${bw - 20}" height="${T - y(h.hi)}" rx="3" fill="#bcd9ee"/>
    <rect x="${i * bw + 10}" y="${y(h.med)}" width="${bw - 20}" height="${T - y(h.med)}" rx="3" fill="#0b6fa8"/>
    <text x="${i * bw + bw / 2}" y="${T + 13}" text-anchor="middle" class="ax">${fmtHourKey(h.t)}</text>
    <text x="${i * bw + bw / 2}" y="${Math.min(y(h.hi) - 3, T - 2)}" text-anchor="middle" class="ax">${h.med}</text>`).join('');
  const verdict = med >= 30 ? 'ฝนหนักใน 3 ชม. ข้างหน้า' : med >= 10 ? 'มีฝนพอสมควรใน 3 ชม. ข้างหน้า' : med >= 2 ? 'ฝนเล็กน้อยใน 3 ชม. ข้างหน้า' : 'ยังไม่มีสัญญาณฝนใน 3 ชม. ข้างหน้า';
  return `<section class="card"><h3>ฝนพยากรณ์ 3 ชั่วโมงข้างหน้า</h3>
    <p class="small"><b>${verdict}</b> — รวม ≈ ${Math.round(med * 10) / 10} มม. (โมเดลที่ฝนมากสุด ≈ ${Math.round(hi * 10) / 10} มม.)${peak.med >= 1 ? ` · ช่วงหนักสุดประมาณ ${fmtHourKey(peak.t)} น. ≈ ${peak.med} มม./ชม.` : ''}</p>
    <svg class="chart" viewBox="0 0 ${W} ${T + 18}" role="img" aria-label="ฝนพยากรณ์รายชั่วโมง 3 ชั่วโมงข้างหน้า">${bars}</svg>
    <div class="legend-row"><span><i style="background:#0b6fa8"></i>ค่ากลางของโมเดล (มม./ชม.)</span><span><i style="background:#bcd9ee"></i>โมเดลที่ฝนมากสุด</span></div>
    <p class="muted tiny">คำนวณจากโมเดลสภาพอากาศ (อัปเดตรายชั่วโมง) ไม่ใช่เรดาร์ — ฝนตกเป็นกลุ่มเล็กๆ ระยะสั้นอาจคลาดเคลื่อนได้มาก ดูเรดาร์ที่ปุ่ม "เลเยอร์" ประกอบ</p></section>`;
}

function rainNearCard(f) {
  const near = f.rainNear || [];
  if (!state.rainObs.length) return '';
  const o = f.obs;
  return `<section class="card"><h3>ฝนตรวจวัดจริงใกล้จุดนี้</h3>${
    near.length
      ? `${o && o.r1 > 0 ? `<p class="small">ฝนตกเมื่อ 1 ชม. ที่ผ่านมา สูงสุด <b>${mm(o.r1)} มม.</b> ที่${esc(o.r1Name)} (${o.r1Km.toFixed(1)} กม.)</p>` : '<p class="small">สถานีใกล้เคียงไม่รายงานฝนตกใน 1 ชม. ล่าสุด</p>'}
         <div class="list">${near.map((g) => rainRow(g, ` · ${g.km.toFixed(1)} กม.`)).join('')}</div>`
      : '<p class="muted small">ไม่มีสถานีวัดฝนภายใน 12 กม. จากจุดนี้</p>'
  }<p class="muted tiny">ที่มา: ThaiWater · ข้อมูลบางสถานีเก่ากว่า 1 ชม. ดูเวลากำกับแต่ละแถว</p></section>`;
}

/* ───────── flood complaints (Traffy / BMA) ───────── */
const sevCounts = (list) => [3, 2, 1].map((l) => ({ l, n: list.filter((f) => f.lvl === l).length }));

const sevChips = (list) =>
  `<div class="chips">${sevCounts(list)
    .map((c) => `<span class="chip static" style="--c:${SEVERITY[c.l].color}"><span class="chip-dot tri"></span>${SEVERITY[c.l].short} ${c.n}</span>`)
    .join('')}</div>`;

function districtStats() {
  const m = new Map();
  for (const f of state.floods) {
    const d = f.district || 'ไม่ระบุเขต';
    const e = m.get(d) || { d, h: 0, m: 0, l: 0, n: 0 };
    e[f.lvl === 3 ? 'h' : f.lvl === 2 ? 'm' : 'l']++;
    e.n++;
    m.set(d, e);
  }
  return [...m.values()].sort((a, b) => b.h - a.h || b.m - a.m || b.n - a.n);
}

const floodRow = (f, extra = '') => `<button class="row-item report" data-act="fly-flood" data-id="${esc(f.id)}">
  <span class="sev-ic" style="--c:${SEVERITY[f.lvl].color}" aria-hidden="true"></span>
  <span class="grow"><b style="color:${SEVERITY[f.lvl].color}">${SEVERITY[f.lvl].label}</b>${f.help ? ' <span class="tag warn">ขอความช่วยเหลือ</span>' : ''}
  <small>${esc(f.district ? `เขต${f.district}` : 'กทม.')} · ${ago(f.t)}${f.depth ? ` · ≈ ${f.depth} ซม.` : ''}${extra}</small>
  <small class="clip">${esc(f.text)}</small></span></button>`;

function floodsSourceNote() {
  if (state.floodsError && !state.floods.length) return `<p class="note">โหลดข้อมูลแจ้งน้ำท่วมจาก กทม. ไม่สำเร็จ (${esc(state.floodsError)})</p>`;
  return `<p class="muted tiny">ที่มา: Traffy Fondue / กทม. — เรื่องร้องเรียน 24 ชม. ล่าสุดที่ยังไม่ปิดเรื่อง${state.floodsAt ? ` · ข้อมูล ณ ${fmtTime(state.floodsAt)} น.` : ''}${state.floodsSrc === 'snapshot-old' ? ' · <b>ข้อมูลเก่า</b>' : ''}<br>
  ความหนัก (หนัก/ปานกลาง/เล็กน้อย) <b>ประเมินจากข้อความที่ผู้แจ้งเขียน</b> และจำนวนเรื่องใกล้เคียง ไม่ใช่ค่าที่วัดจริง — บางจุดอาจลดแล้ว ตรวจสภาพจริงก่อนเดินทาง</p>`;
}

function floodsOverviewCard() {
  if (!state.floods.length) return state.floodsError ? `<section class="card">${floodsSourceNote()}</section>` : skeleton('กำลังโหลดจุดน้ำท่วมจาก กทม.…');
  const top = districtStats().slice(0, 6);
  const heavy = state.floods.filter((f) => f.lvl === 3).length;
  const nDist = new Set(state.floods.filter((f) => f.lvl === 3).map((f) => f.district)).size;
  return `<section class="card${heavy >= 10 ? ' alert' : ''}"><h3>จุดน้ำท่วมตอนนี้ (แจ้ง กทม.)</h3>${heavy ? `<p class="alert-line">⚠ ท่วมหนัก ${heavy} จุด ใน ${nDist} เขต — ตรวจเส้นทางก่อนเดินทาง</p>` : ''}
    ${sevChips(state.floods)}
    <div class="why">เขตที่มีจุดท่วมหนักมากที่สุด</div>
    <div class="list">${top.map((s) => `<button class="row-item" data-act="goto-district" data-d="${esc(s.d === 'ไม่ระบุเขต' ? '' : s.d)}">
      <span class="grow"><b>${esc(s.d === 'ไม่ระบุเขต' ? s.d : `เขต${s.d}`)}</b><small>หนัก ${s.h} · ปานกลาง ${s.m} · เล็กน้อย ${s.l}</small></span>
      <span class="val" style="color:${s.h ? SEVERITY[3].color : SEVERITY[2].color}">${s.n}</span></button>`).join('')}</div>
    <div class="row"><button class="btn btn-sm" data-act="goto-district" data-d="">ดูจุดท่วมทั้งหมด</button></div>
    ${floodsSourceNote()}</section>`;
}

/* ───────── tabs ───────── */
function savedChips() {
  if (!state.saved.length) return '';
  return `<div class="chips">${state.saved
    .map((p) => {
      const ev = state.savedEval[p.id];
      const r = ev ? ev.risk : null;
      return `<button class="chip" data-act="pick-saved" data-id="${esc(p.id)}" style="--c:${r ? r.color : '#8a94a3'}">
        <span class="chip-dot"></span>${esc(p.label)} · ${r ? esc(r.label) : 'กำลังประเมิน…'}</button>`;
    })
    .join('')}</div>`;
}

function pushCard() {
  const p = state.push;
  if (!p || p.reason === 'no-backend') return '';
  const n = state.saved.length;
  const consent = '<p class="muted tiny">เปิดแล้วระบบจะเก็บ <b>พิกัดของจุดที่บันทึก</b> และรหัสอุปกรณ์บนเซิร์ฟเวอร์ เพื่อส่งแจ้งเตือนเท่านั้น ปิดเมื่อไรก็ได้ (ข้อมูลถูกลบ) · การแจ้งเตือนเป็นการประเมินอัตโนมัติ อาจคลาดเคลื่อนหรือล่าช้า ไม่ใช่ประกาศทางการ</p>';
  let body;
  if (p.reason === 'ios-install') {
    body = `<p class="small">บน iPhone/iPad ต้อง <b>เพิ่มเว็บนี้ลงหน้าจอโฮมก่อน</b> จึงจะรับแจ้งเตือนได้:</p>
      <ol class="small steps"><li>กดปุ่มแชร์ <b>⬆︎</b> ที่แถบล่างของ Safari</li><li>เลือก <b>"เพิ่มลงในหน้าจอโฮม"</b></li><li>เปิดแอป BKKFLOOD จากหน้าจอโฮม แล้วกลับมาที่การ์ดนี้เพื่อเปิดแจ้งเตือน</li></ol>`;
  } else if (p.reason === 'unsupported') {
    body = '<p class="small">เบราว์เซอร์นี้ยังไม่รองรับการแจ้งเตือนจากเว็บ ลองใช้ Chrome (Android/คอมพิวเตอร์) หรือ Safari 16.4+ ที่ติดตั้งลงหน้าจอโฮม</p>';
  } else if (p.permission === 'denied') {
    body = '<p class="note">คุณปิดสิทธิ์การแจ้งเตือนของเว็บนี้ไว้ — เปิดได้ที่การตั้งค่าเว็บไซต์ของเบราว์เซอร์ (ไอคอนแม่กุญแจข้างชื่อเว็บ) แล้วรีเฟรช</p>';
  } else if (p.enabled) {
    const ver = p.verified === true ? '<p class="small">✅ ลงทะเบียนกับเซิร์ฟเวอร์เรียบร้อยแล้ว</p>' : p.verified === false ? '<p class="note">⚠ เครื่องนี้บอกว่าเปิดอยู่ แต่<b>ไม่พบการลงทะเบียนบนเซิร์ฟเวอร์</b> จึงจะยังไม่ได้รับแจ้งเตือน — กด "ลงทะเบียนใหม่" ด้านล่าง</p>' : '';
    body = `${ver}<p class="small">🔔 <b>เปิดอยู่</b> — จะแจ้งเมื่อจุดที่บันทึกไว้ (${n} จุด) เสี่ยงสูงขึ้น หรือมีผู้แจ้ง กทม. ว่าท่วมหนักใกล้จุดนั้น (ไม่เกิน 1 ครั้งต่อ 2 ชม.)</p>
      <div class="row wrap">${p.verified === false ? `<button class="btn btn-primary" data-act="push-enable" ${p.busy ? 'disabled' : ''}>ลงทะเบียนใหม่</button>` : ''}<button class="btn btn-sm" data-act="push-disable" ${p.busy ? 'disabled' : ''}>ปิดแจ้งเตือน</button></div>`;
  } else if (!n) {
    body = '<p class="small">บันทึกจุดของคุณ (บ้าน/ที่จอดรถ) ก่อน — แตะแผนที่แล้วกด "บันทึกจุดนี้เป็น" ที่แท็บพยากรณ์จุด จากนั้นกลับมาเปิดแจ้งเตือน</p>';
  } else {
    body = `<p class="small">รับแจ้งเตือนบนมือถือเมื่อจุดที่บันทึกไว้ (${n} จุด) เสี่ยงท่วมสูงขึ้น แม้ไม่ได้เปิดเว็บอยู่</p>
      <div class="row"><button class="btn btn-primary" data-act="push-enable" ${p.busy ? 'disabled' : ''}>${p.busy ? 'กำลังเปิด…' : '🔔 เปิดแจ้งเตือน'}</button></div>${consent}`;
  }
  return `<section class="card"><h3>แจ้งเตือนอัตโนมัติ</h3>${body}${p.error ? `<p class="note">${esc(p.error)}</p>` : ''}</section>`;
}

export function overviewTab() {
  const st = state.stations.filter((s) => !s.upstream);
  const counts = [5, 4, 3, 2, 1, 0].map((l) => ({ l, n: st.filter((s) => s.level === l).length })).filter((c) => c.n);
  const over = st
    .filter((s) => s.level >= 4 && !s.stale)
    .sort((a, b) => b.level - a.level || (b.over ?? -9) - (a.over ?? -9))
    .slice(0, 6);
  const up = state.stations.filter((s) => s.upstream && s.q !== null).sort((a, b) => b.lat - a.lat);
  const c13 = state.stations.find((s) => s.code === 'C.13');
  const ov = state.overview;

  const mine = state.saved.length
    ? `<section class="card"><h3>จุดของฉัน</h3>${savedChips()}</section>`
    : `<section class="card hint"><h3>รู้ก่อนท่วมที่บ้านคุณ</h3>
        <p>ปักหมุดบ้าน/ที่จอดรถ แล้วทุกครั้งที่เปิดเว็บจะเห็นระดับความเสี่ยงทันที</p>
        <div class="row"><button class="btn btn-primary" data-act="locate-forecast">ใช้ตำแหน่งปัจจุบัน</button>
        <button class="btn" data-act="goto-forecast">เลือกบนแผนที่</button></div></section>`;

  const gaugeCard = state.stationsError && !st.length
    ? `<section class="card"><h3>สถานีวัดระดับน้ำ</h3><p class="note">โหลดข้อมูลสถานีไม่สำเร็จ (${esc(state.stationsError)})</p><button class="btn" data-act="reload-stations">ลองใหม่</button></section>`
    : `<section class="card"><h3>สถานีวัดระดับน้ำ กทม.+ปริมณฑล</h3>
        <div class="chips">${counts.map((c) => `<span class="chip static" style="--c:${LEVELS[c.l].color}"><span class="chip-dot"></span>${LEVELS[c.l].label} ${c.n}</span>`).join('')}</div>
        ${over.length ? `<div class="list">${over.map((s) => `
          <button class="row-item" data-act="fly-station" data-id="${esc(s.id)}">
            <span class="dot" style="background:${LEVELS[s.level].color}"></span>
            <span class="grow"><b>${esc(s.name)}</b><small>${esc(s.prov)} · ${TREND_TH[trendOf(s)]}</small></span>
            <span class="val">${s.over !== null ? `${s.over > 0 ? '+' : ''}${Math.round(s.over * 100)} ซม.` : LEVELS[s.level].label}</span>
          </button>`).join('')}</div><p class="muted tiny">ค่า = ระดับน้ำเทียบตลิ่งต่ำสุดของสถานี (+ คือสูงกว่าตลิ่ง)</p>` : '<p class="muted small">ไม่มีสถานีที่น้ำมากหรือล้นตลิ่งในตอนนี้</p>'}
        <p class="muted tiny">ข้อมูลสถานี: ${state.stationsAt ? `อัปเดต ${fmtTime(state.stationsAt)} น.` : '—'} · ที่มา: ThaiWater (สสน./กรมชลประทาน)${state.stationsSrc === 'snapshot-old' ? ' · <b>ข้อมูลเก่า</b> เชื่อมต่อไม่ได้' : ''}</p>
        <p class="muted tiny">สถานีวัดมีจำนวนจำกัด ระดับน้ำในคลองไม่เท่ากับน้ำบนถนนหน้าบ้านคุณ — ดูรายงานจากประชาชนประกอบ</p></section>`;

  const upCard = up.length
    ? `<section class="card"><h3>น้ำเหนือ (แม่น้ำเจ้าพระยา)</h3>
        <div class="list">${up.map((s) => `<div class="row-item static"><span class="dot" style="background:${LEVELS[s.level].color}"></span>
          <span class="grow"><b>${esc(s.name)}</b><small>${esc(s.prov)} · ${TREND_TH[trendOf(s)]}${s.stale ? ' · ข้อมูลเก่า' : ''}</small></span>
          <span class="val">${Math.round(s.q).toLocaleString('th-TH')} <small>ลบ.ม./วิ</small></span></div>`).join('')}</div>
        ${ov?.upstreamTrend && ov.upstreamTrend.pct !== null ? `<p class="small">แนวโน้มพยากรณ์ 5 วันที่เขื่อนเจ้าพระยา: <b>${ov.upstreamTrend.pct > 0 ? '+' : ''}${ov.upstreamTrend.pct}%</b> (${TREND_TH[ov.upstreamTrend.dir]}) — จากโมเดล GloFAS ใช้ดูแนวโน้มเท่านั้น</p>` : ''}
        ${c13 && !c13.stale && c13.q >= 2400 ? '<p class="note">น้ำท้ายเขื่อนเจ้าพระยาค่อนข้างสูง พื้นที่ริมแม่น้ำควรเฝ้าระวัง</p>' : ''}</section>`
    : '';

  const tideCard = ov?.tide
    ? `<section class="card"><h3>น้ำทะเลหนุน 48 ชม.</h3>
        <p class="small">สูงสุด <b>${ov.tide.peak} ม.</b> เหนือระดับน้ำทะเลปานกลาง ช่วง ${fmtDayHour(ov.tide.peakTime)} น.
        ${ov.tide.high ? '<span class="tag warn">หนุนสูง</span>' : '<span class="tag">ปกติ</span>'}</p>${tideChart(ov.tide)}
        <p class="muted tiny">น้ำหนุนสูงทำให้คลองระบายออกอ่าวไทยช้า ยิ่งอันตรายเมื่อฝนตกพร้อมกัน · โมเดล Open-Meteo Marine (ค่าประมาณ)</p></section>`
    : '';

  return `${floodsOverviewCard()}${rainObsOverviewCard()}${trafficOverviewCard()}${riskCard(ov, 'จุดอ้างอิงใจกลางกรุงเทพฯ (แตะแผนที่เพื่อดูจุดอื่น)')}${mine}${pushCard()}${gaugeCard}${upCard}${tideCard}${ddsOverviewCard()}<section class="card hint"><div class="row wrap" style="margin:0"><span class="small grow">ช่วยส่งต่อให้คนในพื้นที่เสี่ยง</span><button class="btn btn-sm btn-primary" data-act="line-site">ส่งทางไลน์</button><button class="btn btn-sm" data-act="share-site">แชร์…</button></div></section>`;
}

export function forecastTab() {
  const f = state.forecast;
  const saved = state.saved.length ? `<section class="card"><h3>จุดของฉัน</h3>${savedChips()}</section>` : '';
  if (!state.selected) {
    return `<section class="card hint"><h3>พยากรณ์รายจุด</h3>
      <p>แตะบนแผนที่ในจุดที่ต้องการ (บ้าน ที่ทำงาน ที่จอดรถ) หรือกดปุ่มด้านล่างเพื่อใช้ตำแหน่งปัจจุบัน</p>
      <button class="btn btn-primary" data-act="locate-forecast">ใช้ตำแหน่งปัจจุบัน</button></section>${saved}`;
  }
  if (!f || f.loading) return `${skeleton('กำลังดึงพยากรณ์และประเมินความเสี่ยง…')}${saved}`;
  if (f.error) return `<section class="card"><p class="note">ประเมินไม่สำเร็จ: ${esc(f.error)}</p><button class="btn" data-act="retry-forecast">ลองใหม่</button></section>`;

  const { rain, gauges } = f;
  const title = `${f.lat.toFixed(4)}, ${f.lng.toFixed(4)}${rain?.elevation != null ? ` · สูง ≈ ${rain.elevation} ม.` : ''}`;
  const nums = rain
    ? `<div class="stats"><div><b>${rain.next6}</b><small>มม. ใน 6 ชม.</small></div><div><b>${rain.next24}</b><small>มม. ใน 24 ชม.</small></div><div><b>${rain.next48}</b><small>มม. ใน 48 ชม.</small></div><div><b>${rain.past48}</b><small>มม. ย้อนหลัง 2 วัน</small></div></div>
       <p class="muted tiny">ช่วง 24 ชม. ข้างหน้าตามแต่ละโมเดล: ${rain.min24}–${rain.max24} มม. (${rain.models} โมเดล) · 1 มม. ≈ น้ำสูง 1 ลิตรต่อ ตร.ม.</p>`
    : '';
  const gaugeList = gauges.length
    ? `<div class="list">${gauges.map((s) => `<button class="row-item" data-act="fly-station" data-id="${esc(s.id)}">
        <span class="dot" style="background:${LEVELS[s.level].color}"></span>
        <span class="grow"><b>${esc(s.name)}</b><small>${s.km.toFixed(1)} กม. · ${TREND_TH[trendOf(s)]}${s.stale ? ' · ข้อมูลเก่า' : ''}</small></span>
        <span class="val">${s.over !== null ? `${s.over > 0 ? '+' : ''}${Math.round(s.over * 100)} ซม.` : LEVELS[s.level].label}</span></button>`).join('')}</div>`
    : '<p class="muted small">ไม่มีสถานีวัดน้ำภายใน 6 กม. — ความเสี่ยงประเมินจากฝน น้ำทะเลหนุน และความสูงพื้นที่เป็นหลัก</p>';

  const near2 = state.floods
    .map((x) => ({ ...x, km: distKm(f.lat, f.lng, x.lat, x.lng) }))
    .filter((x) => x.km <= 2)
    .sort((a, b) => b.lvl - a.lvl || a.km - b.km);
  const nearCard = `<section class="card"><h3>จุดน้ำท่วมใกล้จุดนี้ (ภายใน 2 กม.)</h3>${
    near2.length
      ? `${sevChips(near2)}<div class="list">${near2.slice(0, 6).map((x) => floodRow(x, ` · ${x.km.toFixed(1)} กม.`)).join('')}</div>${near2.length > 6 ? `<p class="muted small">และอีก ${near2.length - 6} จุด — ดูบนแผนที่</p>` : ''}`
      : '<p class="muted small">ไม่มีผู้แจ้ง กทม. ว่าน้ำท่วมในรัศมี 2 กม. (ใน 24 ชม.) — ไม่ได้แปลว่าไม่ท่วม เพราะอาจยังไม่มีคนแจ้ง</p>'
  }${floodsSourceNote()}</section>`;

  const already = state.saved.find((p) => Math.abs(p.lat - f.lat) < 1e-4 && Math.abs(p.lng - f.lng) < 1e-4);
  // Right under the risk card — this is what unlocks the home-screen risk chips and push alerts, so it must not be buried
  const saveCard = `<section class="card hint"><h3>📌 บันทึกจุดนี้</h3>
    <p class="small">บันทึกแล้วจะเห็นความเสี่ยงของจุดนี้ทันทีทุกครั้งที่เปิดเว็บ และเปิดรับแจ้งเตือนได้</p>
    <div class="row wrap" style="margin-top:6px">
    <button class="btn btn-primary" data-act="save-place" data-label="บ้าน">🏠 บ้าน</button>
    <button class="btn btn-primary" data-act="save-place" data-label="ที่จอดรถ">🚗 ที่จอดรถ</button>
    <button class="btn btn-primary" data-act="save-place" data-label="ที่ทำงาน">🏢 ที่ทำงาน</button>
    ${already ? `<button class="btn btn-ghost" data-act="del-place" data-id="${esc(already.id)}">ลบจุดที่บันทึก</button>` : ''}</div>
    ${already ? `<p class="small">✅ บันทึกไว้แล้วเป็น "${esc(already.label)}" — ไปแท็บ "สถานการณ์" เพื่อเปิดแจ้งเตือน</p>` : ''}</section>`;

  const shareRow = `<div class="row wrap"><span class="small muted">ส่งจุดนี้ให้เพื่อน:</span>
    <button class="btn btn-sm" data-act="line-point">ส่งทางไลน์</button>
    <button class="btn btn-sm" data-act="share-point">แชร์จุดนี้</button>
    <button class="btn btn-sm btn-ghost" data-act="copy-link">คัดลอกลิงก์</button></div>`;

  return `${riskCard(f, title)}
    ${saveCard}
    ${nearCard}
    ${camerasNearCard(f)}
    ${rainNearCard(f)}
    ${next3hCard(f)}
    <section class="card"><h3>ฝนพยากรณ์ 48 ชั่วโมง</h3>${nums}${rainChart(rain)}</section>
    <section class="card"><h3>สถานีวัดน้ำใกล้เคียง</h3>${gaugeList}</section>
    <section class="card">${shareRow}</section>${saved}`;
}

function searchCard() {
  const s = state.search;
  if (!s) return '';
  const head = `<div class="search-head"><h3>ผลค้นหา “${esc(s.q)}”</h3><button class="btn btn-sm btn-ghost" data-act="clear-search">ล้าง ✕</button></div>`;
  if (s.status === 'loading') return `<section class="card">${head}<div class="skel"></div><p class="muted small">กำลังค้นหา…</p></section>`;

  const parts = [];
  if (s.floods.length) {
    parts.push(`<div class="why">จุดน้ำท่วมที่แจ้ง กทม. และกล่าวถึง/อยู่ในพื้นที่นี้ (${s.floods.length})</div>${sevChips(s.floods)}
      <div class="list cards">${s.floods.slice(0, 8).map((f) => floodRow(f)).join('')}</div>
      ${s.floods.length > 8 ? `<p class="muted small">และอีก ${s.floods.length - 8} เรื่อง — กด "ดูบนแผนที่"</p>` : ''}
      <div class="row"><button class="btn btn-sm btn-primary" data-act="search-fit">ดูบนแผนที่</button></div>`);
  }
  if (s.reports.length) {
    parts.push(`<div class="why">ปักหมุดโดยประชาชน (${s.reports.length})</div><div class="list">${s.reports.slice(0, 4).map((r) => `
      <button class="row-item report" data-act="fly-report" data-id="${esc(r.id)}"><span class="grow"><b style="color:${DEPTHS[r.depth]?.color}">${esc(DEPTHS[r.depth]?.label || r.depth)}</b><small class="clip">${esc(r.note)}</small></span></button>`).join('')}</div>`);
  }
  if (s.stations.length) {
    parts.push(`<div class="why">สถานีวัดระดับน้ำ</div><div class="list">${s.stations.slice(0, 4).map((x) => `
      <button class="row-item" data-act="fly-station" data-id="${esc(x.id)}"><span class="dot" style="background:${LEVELS[x.level].color}"></span>
      <span class="grow"><b>${esc(x.name)}</b><small>${esc(x.prov)} · ${TREND_TH[trendOf(x)]}</small></span><span class="val">${x.over !== null ? `${x.over > 0 ? '+' : ''}${Math.round(x.over * 100)} ซม.` : LEVELS[x.level].label}</span></button>`).join('')}</div>`);
  }
  if (s.places.length) {
    parts.push(`<div class="why">สถานที่ที่พบบนแผนที่ (แตะเพื่อดูพยากรณ์และจุดท่วมรอบๆ)</div><div class="list">${s.places.map((p) => `
      <button class="row-item" data-act="goto-place" data-lat="${p.lat}" data-lng="${p.lng}"><span class="grow"><b>${esc(p.name)}</b></span><span class="val">ไป ›</span></button>`).join('')}</div>`);
  }
  const tr = s.traffic;
  if (tr?.events.length) {
    parts.push(`<div class="why">เหตุการณ์จราจร กทม. วันนี้ (${tr.events.length})</div><div class="list">${tr.events.slice(0, 5).map((e) => evRow(e)).join('')}</div>`);
  }
  if (tr?.dds.length) {
    parts.push(`<div class="why">รายงานน้ำท่วมถนนสายหลัก สนน. (${tr.dds.length}) — ${state.traffic.dds ? `วันที่ ${thDate(state.traffic.dds.reportDate)}` : ''}</div><div class="list">${tr.dds.slice(0, 6).map(ddsRow).join('')}</div>`);
  }
  if (tr?.cameras.length) {
    parts.push(`<div class="why">กล้องจราจร กทม. (${tr.cameras.length})</div><div class="list">${tr.cameras.slice(0, 5).map((c) => `<button class="row-item" data-act="fly-camera" data-id="${esc(c.id)}"><span class="dot" style="background:${c.flood ? '#00a6c8' : '#4a5b6c'}"></span><span class="grow"><b>${esc(c.name)}</b>${c.flood ? '<small>จุดเฝ้าระวังน้ำท่วม</small>' : ''}</span></button>`).join('')}</div>`);
  }
  const none = !parts.length
    ? `<p class="small">ไม่พบข้อมูลที่ตรงกับ “${esc(s.q)}”</p>
       <ul class="reasons small"><li>ลองพิมพ์ชื่อถนน/ซอย/เขตให้สั้นลง เช่น "รามคำแหง 174" หรือ "หนองจอก"</li>
       <li>ไม่พบ ≠ ไม่ท่วม — อาจยังไม่มีผู้แจ้ง ลองแตะแผนที่ที่จุดนั้นเพื่อดูพยากรณ์</li></ul>`
    : '';
  return `<section class="card">${head}${parts.join('')}${none}
    <p class="muted tiny">ค้นจากข้อความที่ผู้แจ้งเขียน ชื่อเขต และชื่อสถานี — การค้นชื่อสถานที่ภาษาไทยจากแผนที่ฟรีอาจไม่พบทุกที่</p></section>`;
}

export function reportsTab() {
  const list = state.floods.filter((f) => !state.district || f.district === state.district);
  const districts = districtStats();
  const shown = list.slice(0, state.floodLimit);

  const filter = `<select id="district-filter" aria-label="เลือกเขต"><option value="">ทุกเขต (${state.floods.length})</option>${districts
    .filter((s) => s.d !== 'ไม่ระบุเขต')
    .map((s) => `<option value="${esc(s.d)}" ${s.d === state.district ? 'selected' : ''}>เขต${esc(s.d)} — หนัก ${s.h} / รวม ${s.n}</option>`)
    .join('')}</select>`;

  const govt = `<section class="card"><h3>จุดน้ำท่วมที่แจ้ง กทม. ${state.district ? `· เขต${esc(state.district)}` : ''}</h3>
    ${state.floods.length ? `${sevChips(list)}${filter}
    ${shown.length ? `<div class="list cards">${shown.map((f) => floodRow(f)).join('')}</div>` : '<p class="muted small">ไม่มีรายงานในเขตนี้</p>'}
    ${list.length > shown.length ? `<button class="btn" data-act="more-floods">แสดงเพิ่ม (เหลือ ${list.length - shown.length})</button>` : ''}` : ''}
    ${floodsSourceNote()}</section>`;

  const crowd = [...state.reports].sort((a, b) => Math.max(b.createdAt, b.lastConfirmedAt) - Math.max(a.createdAt, a.lastConfirmedAt));
  const note = state.store?.mode === 'local'
    ? '<p class="note">โหมดทดลอง: ยังไม่ได้เชื่อมฐานข้อมูล รายงานที่คุณส่งจะเห็นเฉพาะในเครื่องนี้</p>'
    : '';
  const mine = `<section class="card"><h3>ปักหมุดโดยประชาชน (BKKFLOOD)</h3>${note}
    ${crowd.length ? `<div class="list cards">${crowd.map((r) => `
    <button class="row-item report" data-act="fly-report" data-id="${esc(r.id)}">
      ${r.thumb ? `<img src="${esc(r.thumb)}" alt="" width="56" height="56" />` : '<span class="dot"></span>'}
      <span class="grow"><b style="color:${DEPTHS[r.depth]?.color}">${esc(DEPTHS[r.depth]?.label || r.depth)}</b>
      <small>${esc(PASSABLE[r.passable] || '')} · ${ago(Math.max(r.createdAt, r.lastConfirmedAt))}</small>
      ${r.note ? `<small class="clip">${esc(r.note)}</small>` : ''}</span></button>`).join('')}</div>`
      : '<p class="muted small">ยังไม่มีการปักหมุดที่ยังใช้งานอยู่ (หายไปเองใน 4 ชม. ถ้าไม่มีใครยืนยัน)</p>'}
    <div class="row"><button class="btn btn-primary" data-act="open-report">แจ้งจุดน้ำท่วม</button></div></section>`;
  return `${searchCard()}${govt}${ddsListCard()}${mine}`;
}

const pct = (v) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`);

function accuracyCard() {
  const a = state.accuracy;
  if (!a) return '';
  const head = '<h3>ความแม่นยำของระบบเตือน (ทดลอง)</h3>';
  const foot = `<p class="muted tiny">วัดจากเรื่องแจ้งน้ำท่วมระดับปานกลาง/หนักที่ประชาชนแจ้ง กทม. ภายใน 24 ชม. หลังการประเมิน ในรัศมี 2 กม. — เป็นตัวแทนที่ไม่สมบูรณ์ (พื้นที่คนน้อยมักแจ้งน้อย) · อัปเดต ${a.generatedAt ? fmtTime(a.generatedAt) : ''} น.</p>`;
  if (!a.ready) {
    return `<section class="card">${head}<p class="small">กำลังเก็บข้อมูลเพื่อตรวจสอบ: มีผลประเมินครบ 24 ชม. แล้ว <b>${a.samples.toLocaleString('th-TH')}</b> ตัวอย่าง (${a.days} วัน, ${a.events} เหตุการณ์) — จะแสดงผลเมื่อมีอย่างน้อย ${a.need.minDays} วันและ ${a.need.minEvents} เหตุการณ์</p>${foot}</section>`;
  }
  const lv = a.byLevel.find((x) => x.th === 2) || a.byLevel[0];
  const p = a.persistence;
  return `<section class="card">${head}
    <p class="small">ย้อนดู ${a.days} วัน (${a.samples.toLocaleString('th-TH')} ตัวอย่าง) ทุกครั้งที่ระบบเตือนระดับ <b>"เตรียมย้ายของ" ขึ้นไป</b>:</p>
    <div class="stats"><div><b>${pct(lv.pod)}</b><small>ของเหตุน้ำท่วมจริง ที่ระบบเตือนไว้ก่อน</small></div><div><b>${pct(lv.far === null ? null : 1 - lv.far)}</b><small>ของการเตือน ที่มีเหตุท่วมตามมาจริง</small></div><div><b>${lv.warned.toLocaleString('th-TH')}</b><small>ครั้งที่เตือน</small></div><div><b>${pct(a.baseRate)}</b><small>สัดส่วนที่ท่วมโดยรวม</small></div></div>
    <p class="small">เทียบกับวิธีง่ายๆ "เมื่อวานที่นี่ท่วม วันนี้ก็ท่วม": จับเหตุได้ ${pct(p.pod)}, เตือนถูก ${pct(p.far === null ? null : 1 - p.far)} ${lv.pod !== null && p.pod !== null && lv.pod < p.pod ? '— <b>ในช่วงที่วัด ระบบเรายังไม่ดีกว่าวิธีง่ายๆ</b> ควรอ่านการเตือนควบคู่กับจุดที่มีคนแจ้งจริงบนแผนที่' : ''}</p>
    ${foot}</section>`;
}

export function helpTab() {
  const tel = (n, t, sub) => `<a class="tel" href="tel:${n}"><b>${n}</b><span>${t}<small>${sub}</small></span></a>`;
  return `<section class="card"><h3>เบอร์ฉุกเฉิน (แตะเพื่อโทร)</h3>
    <div class="tels">${tel('1669', 'แพทย์ฉุกเฉิน / กู้ภัย', 'ผู้บาดเจ็บ ติดอยู่ในพื้นที่น้ำ')}
    ${tel('191', 'ตำรวจ', 'เหตุด่วนเหตุร้าย')}
    ${tel('1784', 'ปภ. (ป้องกันและบรรเทาสาธารณภัย)', 'แจ้งเหตุอุทกภัย ขอความช่วยเหลือ')}
    ${tel('1555', 'กรุงเทพมหานคร', 'สายด่วน กทม. ร้องเรียนน้ำท่วมขัง')}
    ${tel('1130', 'การไฟฟ้านครหลวง (MEA)', 'ไฟฟ้าขัดข้อง / อันตราย')}
    ${tel('1129', 'การไฟฟ้าส่วนภูมิภาค (PEA)', 'ปริมณฑลบางพื้นที่')}</div>
    <p class="muted small">BKKFLOOD ไม่ได้รับเรื่องขอความช่วยเหลือ และไม่รับประกันการตอบสนอง หากมีอันตรายถึงชีวิตโปรดโทร 1669 ทันที</p></section>
  <section class="card"><h3>ก่อนน้ำมา — ทำอะไรก่อน</h3><ul class="reasons">
    <li>ย้ายรถไปที่สูง/อาคารจอดรถหลายชั้น <b>ก่อน</b>น้ำเข้าซอย — น้ำมักขึ้นเร็วกว่าที่คิด</li>
    <li>ยกของมีค่า เอกสารสำคัญ (ใส่ถุงซิป) ขึ้นที่สูง ชาร์จมือถือและพาวเวอร์แบงก์</li>
    <li>ถ่ายรูปสภาพบ้าน/รถ/ทรัพย์สินไว้เป็นหลักฐานเคลมประกัน</li>
    <li>ตัดวงจรไฟชั้นล่างเมื่อน้ำเริ่มเข้า ห้ามแตะปลั๊กไฟขณะยืนในน้ำ</li>
    <li>อย่าขับรถลุยน้ำลึกเกินครึ่งล้อ หากเครื่องดับห้ามสตาร์ทซ้ำ</li>
    <li>เตรียมอาหาร น้ำดื่ม ยา ไฟฉาย และช่องทางติดต่อครอบครัว</li></ul></section>
  ${accuracyCard()}
  <section class="card"><h3>แหล่งข้อมูลและเครดิต</h3>
    <p class="small">เว็บนี้รวมข้อมูลสาธารณะเพื่อช่วยตัดสินใจ ไม่ใช่ประกาศของทางราชการ ขอขอบคุณแหล่งข้อมูล:</p>
    <ul class="small src"><li><b>จุดน้ำท่วม:</b> Traffy Fondue / กรุงเทพมหานคร (เรื่องร้องเรียนของประชาชน)</li>
    <li><b>จราจร กล้อง และเหตุการณ์:</b> สำนักจัดการจราจรและขนส่ง กทม. (ระบบกล้องโทรทัศน์วงจรปิดและรายงานสภาพการจราจร) · Longdo Traffic (ดัชนีจราจร)</li>
    <li><b>รายงานน้ำท่วมถนนสายหลัก:</b> สำนักการระบายน้ำ กรุงเทพมหานคร</li>
    <li><b>ระดับน้ำ และฝนตรวจวัดจริง:</b> ThaiWater (สถาบันสารสนเทศทรัพยากรน้ำ) · กรมชลประทาน และหน่วยงานเครือข่ายสถานีวัดฝน</li>
    <li><b>พยากรณ์ฝน น้ำทะเลหนุน น้ำเหนือ:</b> Open-Meteo (ECMWF, NOAA GFS, DWD ICON, GloFAS)</li>
    <li><b>เรดาร์ฝน:</b> RainViewer · <b>แผนที่:</b> © OpenStreetMap contributors</li></ul>
    <p class="muted tiny">รูปที่ส่งเข้ามาจะถูกลบพิกัด/ข้อมูลกล้อง (EXIF) ก่อนอัปโหลด ไม่เก็บเบอร์โทร รายงานจะหายจากแผนที่ใน 4 ชม. หากไม่มีผู้ยืนยัน แต่ข้อมูลอาจยังถูกเก็บในระบบจนกว่าผู้จัดทำจะลบ</p></section>
  <section class="card"><h3>ส่งต่อให้เพื่อนบ้าน</h3>
    <p class="small">ยิ่งมีคนใช้และแจ้งมาก ข้อมูลยิ่งครบ — ช่วยกันส่งต่อลิงก์ให้คนในพื้นที่เสี่ยง</p>
    <div class="row wrap"><button class="btn btn-primary" data-act="line-site">ส่งทางไลน์</button><button class="btn" data-act="share-site">แชร์…</button><button class="btn btn-ghost" data-act="copy-site">คัดลอกลิงก์</button></div></section>
  <section class="card credit"><h3>ผู้จัดทำ</h3>
    <p class="small">นาย เอกสิทธิ์ จิตรสถาพร<br>ติดต่อ: <a href="mailto:aggasit.j@gmail.com">aggasit.j@gmail.com</a></p></section>`;
}

export const TAB_RENDER = { overview: overviewTab, forecast: forecastTab, reports: reportsTab, help: helpTab };
export { RISK };
