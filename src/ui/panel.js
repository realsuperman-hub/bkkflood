// Renders the four tabs of the side panel as HTML strings. Events are delegated in main.js via data-act.
import { state } from '../state.js';
import { LEVELS, TREND_TH, trendOf } from '../lib/thaiwater.js';
import { DEPTHS, PASSABLE } from '../lib/store.js';
import { esc, ago, fmtTime, fmtHourKey, fmtDayHour } from '../lib/util.js';
import { RISK } from '../lib/risk.js';
import { SEVERITY } from '../lib/traffy.js';
import { corroborateState, TIER } from '../lib/corroborate.js';
import { nearbyHistory, dayIso } from '../lib/flood-history.js';
import { mcmDayToCms, damStatus, outflowTrend } from '../lib/dams.js';
import { camViewerEnabled } from '../lib/longdo-cams.js';
import { BMA_LINKS, EVENT_LABEL, SPEED_LEVEL } from '../lib/bma-traffic.js';
import { distKm } from '../lib/geo.js';
import { validQuery } from '../lib/search.js';
import { platform } from '../lib/push.js';
import { intensity1h, intensity24h } from '../lib/rain-obs.js';

export const BKK_CENTER = { lat: 13.7563, lng: 100.5018 };

const DISCLAIMER =
  'เป็นการประเมินเพื่อช่วยตัดสินใจ ไม่ใช่ประกาศทางการ — โปรดตรวจคำเตือนอย่างเป็นทางการจาก ปภ. (1784) และกรมอุตุนิยมวิทยาประกอบเสมอ';

const skeleton = (t) => `<section class="card"><div class="skel"></div><p class="muted small">${t}</p></section>`;

/* ───────── shared components ───────── */
// Live YouTube streams in Thailand whose titles look like cameras (found with the official API; unverified, played in YouTube's own embed).
// No thumbnails on purpose: loading them would send the visitor's address to YouTube before they chose to watch anything.
function ytLiveCard() {
  const y = state.ytLive;
  const all = y?.items || [];
  if (!all.length) return '';
  const local = all.filter((v) => v.local).slice(0, 6);
  const rest = all.filter((v) => !v.local).slice(0, 12);
  const row = (v) => `<button class="row-item" data-act="yt-open" data-id="${esc(v.id)}"><span class="dot" style="background:#d7263d"></span>
      <span class="grow"><b>${esc(v.title)}</b><small>${esc(v.channel)}${v.viewers !== null ? ` · กำลังดู ${v.viewers.toLocaleString('th-TH')} คน` : ''}</small></span></button>`;
  return `<section class="card"><h3>ไลฟ์สดเกี่ยวกับกล้อง/น้ำท่วมบน YouTube (ยังไม่ยืนยัน)</h3>
    ${local.length ? `<div class="list">${local.map(row).join('')}</div>` : '<p class="small muted">ตอนนี้ไม่พบสตรีมที่เกี่ยวกับ กทม./ปริมณฑล/น้ำท่วม</p>'}
    ${rest.length ? `<details class="fold"><summary>กล้องสดอื่นในประเทศไทย (${rest.length})</summary><div class="list">${rest.map(row).join('')}</div></details>` : ''}
    <p class="muted tiny">ค้นหาอัตโนมัติจากสตรีมสดที่ชื่อเกี่ยวกับกล้อง/จราจร/แม่น้ำ/น้ำท่วมในไทย · ใครก็เปิดสตรีมได้ บางรายการเป็นรายการสรุปข่าวหรือข้อมูล ไม่ใช่ภาพจากกล้อง เราไม่ได้ตรวจสอบเนื้อหาและยืนยันไม่ได้ว่าเป็นกล้องจริง · ภาพเล่นผ่านตัวเล่นของ YouTube เมื่อคุณกดเท่านั้น${y.generatedAt ? ` · อัปเดต ${fmtTime(y.generatedAt)} น.` : ''}</p></section>`;
}

// Flood water seen by radar satellites (GISTDA). Shows the outskirts and the upstream provinces well, dense city streets badly.
function satFloodCard() {
  const s = state.satFlood;
  if (!s?.provinces?.length) return '';
  const rows = [...s.provinces].filter((p) => p.rai > 0).sort((a, b) => b.rai - a.rai);
  if (!rows.length) return '';
  const daysAgo = s.lastPass ? Math.max(0, Math.round((Date.now() - Date.parse(`${s.lastPass}T12:00:00+07:00`)) / 86400e3)) : null;
  return `<section class="card"><h3>น้ำท่วมจากดาวเทียม (GISTDA)</h3>
    <p class="small">ภาพดาวเทียมเรดาร์ผ่านล่าสุด <b>${s.lastPass ? thDate(s.lastPass) : '—'}</b>${daysAgo !== null ? ` (${daysAgo === 0 ? 'วันนี้' : `${daysAgo} วันที่แล้ว`})` : ''} — พื้นที่ที่ยังเห็นน้ำท่วมในภาพนั้น</p>
    <div class="list">${rows.map((p) => `<div class="row-item static"><span class="grow"><b>${esc(p.name)}</b><small>ประชากรที่น่าจะได้รับผลกระทบ ≈ ${p.people.toLocaleString('th-TH')} คน · นาข้าว ${p.rice.toLocaleString('th-TH')} ไร่</small></span>
      <span class="val">${p.rai.toLocaleString('th-TH')} <small>ไร่</small></span></div>`).join('')}</div>
    <div class="row wrap"><button class="btn btn-sm" data-act="show-sat">ดูบนแผนที่</button></div>
    <p class="muted tiny">ที่มา: GISTDA (สทอภ.) Disaster Platform · วิเคราะห์จากภาพดาวเทียมเรดาร์ Sentinel-1/RADARSAT-2 ผ่านทุกไม่กี่วัน จึงไม่ใช่ข้อมูลเรียลไทม์ · เห็นน้ำนอกเมืองและนาข้าวได้ดี แต่ถนนในเมืองหนาแน่นมองได้ไม่ดี (กทม. ที่เห็นส่วนใหญ่คือชานเมืองตะวันออก) · ตัวเลขเป็นการประมาณของ GISTDA ยังไม่ได้ตรวจสภาพจริง</p></section>`;
}

// Latest flood headlines from Thai outlets' public RSS feeds: headline + link only (we never copy the story), newest first.
// Stories about Bangkok / the metro provinces / the Chao Phraya upstream come first; political commentary is hidden by a rough keyword filter.
function newsCard() {
  const n = state.news;
  if (!n?.items?.length) return '';
  const now = Date.now();
  const fresh = n.items.filter((i) => !i.politics && now - i.t < 36 * 3600e3);
  const local = fresh.filter((i) => i.metro || i.river).slice(0, 6);
  const rest = fresh.filter((i) => !(i.metro || i.river)).slice(0, Math.max(0, 4 - local.length));
  const rows = [...local, ...rest];
  if (!rows.length) return '';
  const row = (i) => `<a class="news-item" href="${esc(i.url)}" target="_blank" rel="noopener noreferrer">
    <b>${esc(i.title)}</b>
    <small>${esc(i.source)} · ${ago(i.t)}${i.areas.length ? ` · ${esc(i.areas.slice(0, 2).join(', '))}` : i.river ? ' · น้ำเหนือ' : ' · ทั่วประเทศ'}</small></a>`;
  return `<section class="card"><h3>ข่าวน้ำท่วมล่าสุด</h3>
    ${rows.map(row).join('')}
    <p class="muted tiny">พาดหัวจากฟีด RSS สาธารณะของ ${esc((n.sources || []).join(' · '))} กดเพื่ออ่านต่อที่เว็บของสำนักข่าว · เป็นข่าวที่ยังไม่ได้ผ่านการตรวจสอบโดยเว็บนี้ · ซ่อนข่าวความเห็นทางการเมืองด้วยตัวกรองคำ (อาจพลาดได้)${n.generatedAt ? ` · อัปเดต ${fmtTime(n.generatedAt)} น.` : ''}</p></section>`;
}

// Antecedent moisture: how wet the last 7 days were (recent days count more). Shown for context only — it does not change the score yet.
// Bands are rough: a steady ~10 mm/day wet-season rain gives an index of ≈ 50 mm.
function wetnessLine(rain) {
  const a = rain?.antecedent;
  if (!a) return '';
  const band = a.api < 25 ? ['ค่อนข้างแห้ง', '#8c5a2b'] : a.api < 75 ? ['ชื้นตามฤดูฝน', '#2e9e5b'] : a.api < 125 ? ['ชื้นมาก', '#f28c28'] : ['อิ่มตัวมาก', '#d7263d'];
  return `<p class="small wet"><span class="dot" style="background:${band[1]}"></span>ความชื้นสะสม 7 วัน: <b>${band[0]}</b> (ดัชนี ${a.api} มม. · ฝนรวม ${a.past7} มม.)
    <span class="muted tiny">ท่อและคลองที่ยังไม่ระบายหมด รับฝนใหม่ได้น้อยลง · ค่าประมาณจากโมเดล ยังไม่ได้นับเข้าคะแนนความเสี่ยง</span></p>`;
}

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
    <div class="why">เพราะอะไร</div>${reasons}${notes}${wetnessLine(ev.rain)}${errs}
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

// Highest modelled sea level of each coming day; the days the model puts among the month's highest are painted red
function tideDays(tide) {
  const d = tide.days || [];
  if (d.length < 2) return '';
  const W = 480;
  const H = 96;
  const lo = 0;
  const hi = Math.max(2.2, ...d.map((x) => x.peak)) + 0.1;
  const bw = W / d.length;
  const y = (v) => 6 + (1 - (v - lo) / (hi - lo)) * (H - 30);
  const bars = d.map((x, i) => `<rect x="${(i * bw + 4).toFixed(1)}" y="${y(x.peak).toFixed(1)}" width="${(bw - 8).toFixed(1)}" height="${(H - 24 - y(x.peak)).toFixed(1)}" rx="3" fill="${x.high ? '#d7263d' : '#0b6fa8'}" opacity="${x.high ? 1 : 0.55}"/>
    <text x="${(i * bw + bw / 2).toFixed(1)}" y="${H - 8}" font-size="12" text-anchor="middle" fill="#5b6876">${+x.date.slice(8, 10)}</text>
    <text x="${(i * bw + bw / 2).toFixed(1)}" y="${(y(x.peak) - 3).toFixed(1)}" font-size="11" text-anchor="middle" fill="#14202b">${x.peak.toFixed(1)}</text>`).join('');
  const highs = d.filter((x) => x.high);
  const line = highs.length
    ? `วันที่โมเดลให้น้ำหนุนสูง (สีแดง): <b>${highs.map((x) => thDate(x.date).slice(0, -3)).join(', ')}</b>`
    : 'ช่วงนี้ไม่มีวันที่หนุนสูงเด่นกว่าปกติ';
  return `<div class="why" style="margin-top:8px">ระดับน้ำทะเลสูงสุดรายวัน (ม. เหนือระดับน้ำทะเลปานกลาง)</div>
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="ระดับน้ำทะเลสูงสุดรายวัน">${bars}</svg>
    <p class="small">${line}</p>
    <p class="muted tiny">เกณฑ์ "สูง" = อยู่ใน 20% สูงสุดของช่วง 14 วันที่ผ่านมา + พยากรณ์ (≥ ${tide.dayThreshold} ม.)</p>`;
}

// The reservoirs upstream of the Chao Phraya: how full they are and whether they are holding water back or releasing it.
// Data = Royal Irrigation Department open API, one report per day (million m³/day, shown as m³/s like the river gauges).
function damsCard() {
  const d = state.dams;
  if (!d?.dams?.length) return '';
  const cms = (v) => (v === null ? '—' : mcmDayToCms(v).toLocaleString('th-TH'));
  const inSum = d.dams.reduce((s, x) => s + (x.inflow ?? 0), 0);
  const outSum = d.dams.reduce((s, x) => s + (x.outflow ?? 0), 0);
  const kept = inSum > 0.05 ? Math.round((1 - outSum / inSum) * 100) : null;
  const rows = d.dams.map((x) => {
    const st = damStatus(x);
    const tr = outflowTrend(x);
    const pct = x.percent === null ? 0 : Math.min(100, x.percent);
    const col = ['#2e9e5b', '#d9b300', '#f28c28', '#d7263d'][st.level];
    return `<div class="dam"><div class="dam-head"><b>เขื่อน${esc(x.name)}</b><span class="tag${st.level >= 2 ? ' warn' : ''}">${st.tag}</span></div>
      <div class="dam-bar" role="img" aria-label="เก็บน้ำ ${x.percent ?? '—'}%"><span style="width:${pct}%;background:${col}"></span></div>
      <small>เก็บน้ำ <b>${x.percent ?? '—'}%</b> ของความจุ · ไหลเข้า <b>${cms(x.inflow)}</b> · ระบายออก <b>${cms(x.outflow)}</b> ลบ.ม./วิ${tr === 'rising' ? ' <b>(ระบายเพิ่มขึ้น)</b>' : tr === 'falling' ? ' (ระบายลดลง)' : ''}</small>
      <small class="muted">${esc(x.river)}</small></div>`;
  }).join('');
  return `<section class="card"><h3>เขื่อนต้นน้ำเจ้าพระยา</h3>
    ${kept !== null ? `<p class="small">เขื่อนหลัก ${d.dams.length} แห่งรับน้ำเข้ารวม <b>${cms(inSum)}</b> ลบ.ม./วิ ระบายออกรวม <b>${cms(outSum)}</b> ลบ.ม./วิ — <b>เก็บน้ำไว้ได้ราว ${kept}%</b> ของน้ำที่ไหลเข้า</p>` : ''}
    ${rows}
    <p class="muted tiny">ข้อมูลรายวัน วันที่ ${thDate(d.date)} · ที่มา กรมชลประทาน (API เปิด) · เขื่อนเจ้าพระยา (ชัยนาท) เป็นเขื่อนทดน้ำ ปริมาณระบายดูที่สถานี "ท้ายเขื่อนเจ้าพระยา" ด้านบน · 100% = ความจุเก็บกักปกติ ไม่ใช่ขีดจำกัดของตัวเขื่อน · ค่ารายวัน แปลงจากล้าน ลบ.ม./วัน เป็น ลบ.ม./วิ</p></section>`;
}

// Whole Chao Phraya route in one fold-out list (north → south): tells whether the water coming down is still rising
function riverRoute() {
  const ch = state.stations.filter((s) => s.chain).sort((a, b) => b.lat - a.lat);
  if (ch.length < 3) return '';
  const fresh = ch.filter((s) => !s.stale);
  const rising = fresh.filter((s) => trendOf(s) === 'rising').length;
  const falling = fresh.filter((s) => trendOf(s) === 'falling').length;
  const over = fresh.filter((s) => s.level === 5).length;
  return `<p class="small">ตามแนวแม่น้ำเจ้าพระยา ${fresh.length} สถานี: ล้นตลิ่ง <b>${over}</b> · กำลังขึ้น <b>${rising}</b> · กำลังลด <b>${falling}</b></p>
    <details class="fold"><summary>ดูทุกสถานีตามแม่น้ำ (เหนือ → ใต้)</summary>
      <div class="list">${ch.map((s) => `<div class="row-item static"><span class="dot" style="background:${LEVELS[s.level].color}"></span>
        <span class="grow"><b>${esc(s.name)}</b><small>${esc(s.prov)} · ${TREND_TH[trendOf(s)]}${s.stale ? ' · ข้อมูลเก่า' : ''}${s.q !== null ? ` · ${Math.round(s.q).toLocaleString('th-TH')} ลบ.ม./วิ` : ''}</small></span>
        <span class="val">${s.over !== null ? `${s.over > 0 ? '+' : ''}${Math.round(s.over * 100)} ซม.` : LEVELS[s.level].label}</span></div>`).join('')}</div>
      <p class="muted tiny">ค่า = ระดับน้ำเทียบตลิ่งต่ำสุดของสถานี (+ คือสูงกว่าตลิ่ง) · ที่มา ThaiWater (สสน./กรมชลประทาน)</p></details>`;
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
const linkBtns = () => `<div class="row wrap"><a class="btn btn-sm" href="${BMA_LINKS.bma}" target="_blank" rel="noopener">กล้อง/จราจร กทม. ↗</a><a class="btn btn-sm" href="${BMA_LINKS.itic}" target="_blank" rel="noopener">iTIC live ↗</a><a class="btn btn-sm" href="${BMA_LINKS.longdoCameras}" target="_blank" rel="noopener">รายการกล้อง Longdo ↗</a><a class="btn btn-sm" href="${BMA_LINKS.longdo}" target="_blank" rel="noopener">Longdo Traffic ↗</a></div>`;
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

// Has this spot flooded before? Counts DIFFERENT DAYS on which citizens reported flooding within ~400 m (Traffy history).
function repeatHistoryCard(f) {
  const h = state.floodHistory;
  if (!h?.cells) return '';
  const n = nearbyHistory(h.cells, f.lat, f.lng);
  const span = `${thDate(h.from)} – ${thDate(h.to)}`;
  const band = n.days >= 7 ? ['ท่วมซ้ำบ่อย', '#d7263d'] : n.days >= 4 ? ['ท่วมซ้ำ', '#f28c28'] : ['เคยท่วมซ้ำ', '#d9a300'];
  const body = n.days >= 2
    ? `<p class="small"><span class="tag warn" style="background:${band[1]}22;color:${band[1]}">${band[0]}</span> ในรัศมีราว 400 ม. เคยมีคนแจ้งน้ำท่วมใน <b>${n.days} วันที่ต่างกัน</b> (รวม ${n.n} เรื่อง) · ล่าสุด ${thDate(dayIso(n.last))}</p>
       <div class="row wrap"><button class="btn btn-sm" data-act="show-repeat" data-lat="${f.lat}" data-lng="${f.lng}">ดูจุดท่วมซ้ำบนแผนที่</button></div>`
    : `<p class="small">ช่วง ${span} ไม่พบว่ามีคนแจ้งน้ำท่วมซ้ำหลายวันในรัศมีราว 400 ม. — <b>ไม่ได้แปลว่าไม่เคยท่วม</b> คนแจ้งกันเฉพาะบางจุด</p>`;
  return `<section class="card"><h3>ประวัติน้ำท่วมซ้ำรอบจุดนี้</h3>${body}
    <p class="muted tiny">นับจากข้อความแจ้งน้ำท่วมของประชาชนใน Traffy Fondue ช่วง ${span} (${h.complaints.toLocaleString('th-TH')} เรื่อง) — เป็นการแจ้ง ไม่ใช่ค่าที่วัดได้ บอกความลึกไม่ได้ และจุดที่คนน้อยแจ้งอาจไม่ขึ้น</p></section>`;
}

function camerasNearCard(f) {
  const t = state.traffic;
  const windy = (state.windyCams?.cams || []).map((c) => ({ ...c, km: distKm(f.lat, f.lng, c.lat, c.lng) })).filter((c) => c.km <= 3).sort((a, b) => a.km - b.km).slice(0, 4);
  const mcSpots = new Map(); // several cameras on one pole → one row ("N กล้อง"), the popup steps through them
  for (const c of (state.mcams?.cams || []).map((x) => ({ ...x, km: distKm(f.lat, f.lng, x.lat, x.lng) })).filter((x) => x.km <= 1.5).sort((a, b) => a.km - b.km)) {
    const k = `${c.lat.toFixed(4)},${c.lng.toFixed(4)}`;
    if (mcSpots.has(k)) mcSpots.get(k).count++;
    else mcSpots.set(k, { ...c, count: 1 });
  }
  const mc = [...mcSpots.values()].slice(0, 5);
  if (!t.cameras.length && !t.events.length && !windy.length && !mc.length) return '';
  const near = t.cameras.map((c) => ({ ...c, km: distKm(f.lat, f.lng, c.lat, c.lng) })).filter((c) => c.km <= 3).sort((a, b) => a.km - b.km).slice(0, 4);
  const evs = t.events.map((e) => ({ ...e, km: distKm(f.lat, f.lng, e.lat, e.lng) })).filter((e) => e.km <= 3).sort((a, b) => (b.kind === 'flood') - (a.kind === 'flood') || a.km - b.km);
  return `<section class="card"><h3>สภาพถนนรอบจุดนี้ (ภายใน 3 กม.)</h3>
    ${evs.length ? `<div class="why">เหตุการณ์จราจรวันนี้ (กทม.)</div><div class="list">${evs.slice(0, 4).map((e) => evRow(e, ` · ${e.km.toFixed(1)} กม.`)).join('')}</div>` : '<p class="small">ไม่มีเหตุการณ์จราจรที่ กทม. ประกาศรอบจุดนี้วันนี้</p>'}
    ${near.length ? `<div class="why">กล้องจราจรใกล้เคียง — ดูภาพสดที่เว็บทางการ</div><div class="list">${near.map((c) => `<button class="row-item" data-act="fly-camera" data-id="${esc(c.id)}"><span class="dot" style="background:${c.flood ? '#00a6c8' : '#4a5b6c'}"></span>
      <span class="grow"><b>${esc(c.name)}</b><small>${c.km.toFixed(1)} กม.${c.flood ? ' · จุดเฝ้าระวังน้ำท่วม' : ''}${c.desc && c.desc !== '-' ? ` · ${esc(c.desc)}` : ''}</small></span></button>`).join('')}</div>` : '<p class="muted small">ไม่มีกล้อง กทม. ภายใน 3 กม. (ครอบคลุมเฉพาะกรุงเทพฯ)</p>'}
    ${mc.length ? `<div class="why">ภาพกล้อง CCTV ล่าสุดใกล้จุดนี้ (ภายใน 1.5 กม.) — กดเพื่อดูภาพ</div><div class="list">${mc.map((c) => `<button class="row-item" data-act="mcam-open" data-id="${esc(c.id)}"><span class="dot" style="background:#7a4fd6"></span>
      <span class="grow"><b>${esc(c.n)}</b><small>${c.km.toFixed(1)} กม.${c.count > 1 ? ` · ${c.count} กล้องที่จุดนี้` : ''} · ${esc(c.s || 'เจ้าของกล้องไม่ระบุ')}</small></span></button>`).join('')}</div>
      <p class="muted tiny">ภาพนิ่งล่าสุดรวบรวมโดย <a href="https://cctv.maholan.net" target="_blank" rel="noopener noreferrer">cctv.maholan.net</a> ดูเวลาที่พิมพ์บนภาพเสมอ</p>` : ''}
    ${windy.length ? `<div class="why">กล้องจาก Windy ใกล้จุดนี้ — ดูภาพย้อนหลัง 24 ชม.</div><div class="list">${windy.map((c) => `<button class="row-item" data-act="windy-open" data-id="${esc(c.id)}"><span class="dot" style="background:#0e9f8e"></span>
      <span class="grow"><b>${esc(c.title)}</b><small>${c.km.toFixed(1)} กม.${c.updated ? ` · ภาพล่าสุด ${ago(c.updated)}` : ''}</small></span></button>`).join('')}</div>
      <p class="muted tiny">Webcams provided by <a href="https://www.windy.com" target="_blank" rel="noopener noreferrer">Windy.com</a> — <a href="https://www.windy.com/webcams/add" target="_blank" rel="noopener noreferrer">add a webcam</a></p>` : ''}
    <div class="row wrap">${camViewerEnabled() ? `<button class="btn btn-sm btn-primary" data-act="cam-viewer" data-lat="${f.lat}" data-lng="${f.lng}">📷 ดูภาพกล้องสดรอบจุดนี้</button>` : ''}
    <a class="btn btn-sm${camViewerEnabled() ? '' : ' btn-primary'}" href="${BMA_LINKS.longdoAt(f.lat, f.lng)}" target="_blank" rel="noopener">เปิดใน Longdo Traffic ↗</a></div>
    ${linkBtns()}
    <p class="muted tiny">${camViewerEnabled() ? 'ภาพกล้องแสดงที่เว็บ/แผนที่ของ Longdo โดยตรง เว็บนี้ไม่ได้ดึงหรือเก็บภาพ' : 'เว็บนี้ไม่แสดงภาพกล้อง — กดปุ่มด้านบนเพื่อดูภาพสดที่เว็บของเจ้าของกล้อง แล้วค้นหาชื่อกล้อง'}</p></section>`;
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

const confTag = (f) => {
  const c = corroborateState(f, state);
  return `<span style="color:${c.color}">${c.label}</span>`;
};
const floodRow = (f, extra = '') => `<button class="row-item report" data-act="fly-flood" data-id="${esc(f.id)}">
  <span class="sev-ic" style="--c:${SEVERITY[f.lvl].color}" aria-hidden="true"></span>
  <span class="grow"><b style="color:${SEVERITY[f.lvl].color}">${SEVERITY[f.lvl].label}</b>${f.help ? ' <span class="tag warn">ขอความช่วยเหลือ</span>' : ''}
  <small>${esc(f.district ? `เขต${f.district}` : 'กทม.')} · ${ago(f.t)}${f.depth ? ` · ≈ ${f.depth} ซม.` : ''}${extra} · ${confTag(f)}</small>
  <small class="clip">${esc(f.text)}</small></span></button>`;

function floodsSourceNote() {
  if (state.floodsError && !state.floods.length) return `<p class="note">โหลดข้อมูลแจ้งน้ำท่วมจาก กทม. ไม่สำเร็จ (${esc(state.floodsError)})</p>`;
  return `<p class="muted tiny">ที่มา: Traffy Fondue / กทม. — เรื่องร้องเรียน 24 ชม. ล่าสุดที่ยังไม่ปิดเรื่อง${state.floodsAt ? ` · ข้อมูล ณ ${fmtTime(state.floodsAt)} น.` : ''}${state.floodsSrc === 'snapshot-old' ? ' · <b>ข้อมูลเก่า</b>' : ''}<br>
  ความหนัก (หนัก/ปานกลาง/เล็กน้อย) <b>ประเมินจากข้อความที่ผู้แจ้งเขียน</b> และจำนวนเรื่องใกล้เคียง ไม่ใช่ค่าที่วัดจริง — บางจุดอาจลดแล้ว ตรวจสภาพจริงก่อนเดินทาง</p>`;
}

// How many of the reported spots are backed by other sources (see src/lib/corroborate.js)
function tierLine() {
  const n = { multi: 0, some: 0, single: 0 };
  for (const f of state.floods) n[corroborateState(f, state).tier] += 1;
  return `<p class="small conf-line">ความน่าเชื่อถือของจุดที่แจ้ง: <span style="color:${TIER.multi.color}"><b>${n.multi}</b> ${TIER.multi.label}</span> · <span style="color:${TIER.some.color}"><b>${n.some}</b> ${TIER.some.label}</span> · <span style="color:${TIER.single.color}"><b>${n.single}</b> ${TIER.single.label}</span>
    <span class="muted tiny">"ยังไม่ยืนยัน" ไม่ได้แปลว่าไม่จริง แค่ยังไม่มีแหล่งอื่นบริเวณนั้น</span></p>`;
}

function floodsOverviewCard() {
  if (!state.floods.length) return state.floodsError ? `<section class="card">${floodsSourceNote()}</section>` : skeleton('กำลังโหลดจุดน้ำท่วมจาก กทม.…');
  const top = districtStats().slice(0, 6);
  const heavy = state.floods.filter((f) => f.lvl === 3).length;
  const nDist = new Set(state.floods.filter((f) => f.lvl === 3).map((f) => f.district)).size;
  return `<section class="card${heavy >= 10 ? ' alert' : ''}"><h3>จุดน้ำท่วมตอนนี้ (แจ้ง กทม.)</h3>${heavy ? `<p class="alert-line">⚠ ท่วมหนัก ${heavy} จุด ใน ${nDist} เขต — ตรวจเส้นทางก่อนเดินทาง</p>` : ''}
    ${sevChips(state.floods)}
    ${tierLine()}
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
  } else if (p.reason === 'in-app') {
    body = '<p class="note">คุณกำลังเปิดเว็บนี้ในเบราว์เซอร์ที่ฝังอยู่ในแอป (เช่น LINE / Facebook) ซึ่ง<b>ไม่สามารถรับแจ้งเตือนได้</b></p><p class="small">กดปุ่มเมนู <b>⋯</b> หรือ <b>⋮</b> มุมจอ แล้วเลือก <b>"เปิดในเบราว์เซอร์"</b> (Chrome หรือ Safari) จากนั้นกลับมาเปิดแจ้งเตือนที่การ์ดนี้</p>';
  } else if (p.reason === 'unsupported') {
    body = '<p class="small">เบราว์เซอร์นี้ยังไม่รองรับการแจ้งเตือนจากเว็บ ลองใช้ Chrome (Android/คอมพิวเตอร์) หรือ Safari 16.4+ ที่ติดตั้งลงหน้าจอโฮม</p>';
  } else if (p.permission === 'denied') {
    const steps = {
      android: '<li>แตะไอคอนแม่กุญแจ (หรือ ⓘ) ข้างชื่อเว็บในแถบที่อยู่ของ Chrome</li><li>เลือก <b>สิทธิ์</b> → <b>การแจ้งเตือน</b> → <b>อนุญาต</b> (ถ้าไม่เห็น ให้ไปที่ ⋮ → การตั้งค่า → การตั้งค่าเว็บไซต์ → การแจ้งเตือน → หา bkkflood.web.app)</li><li>ตรวจว่าเปิดการแจ้งเตือนของแอป Chrome ในตั้งค่าเครื่องด้วย (ตั้งค่า → แอป → Chrome → การแจ้งเตือน)</li><li>กลับมารีเฟรชหน้านี้ แล้วกด 🔔 อีกครั้ง</li>',
      ios: '<li>ไปที่ <b>ตั้งค่า → การแจ้งเตือน</b> ของ iPhone แล้วหา <b>BKKFLOOD</b> (ต้องเพิ่มลงหน้าจอโฮมและเปิดจากไอคอนก่อน)</li><li>เปิด <b>อนุญาตการแจ้งเตือน</b></li><li>กลับมาที่แอป กด 🔔 อีกครั้ง</li>',
      desktop: '<li>คลิกไอคอนแม่กุญแจข้างชื่อเว็บในแถบที่อยู่</li><li>ตั้ง <b>การแจ้งเตือน</b> เป็น <b>อนุญาต</b></li><li>รีเฟรชหน้า แล้วกด 🔔 อีกครั้ง</li>',
    }[platform()];
    body = `<p class="note">เบราว์เซอร์บล็อกการแจ้งเตือนของเว็บนี้ไว้ (เคยกด "บล็อก" หรือปิดหน้าต่างขออนุญาตหลายครั้ง) — เว็บสั่งเปิดเองไม่ได้ ต้องเปิดที่ตั้งค่าของเบราว์เซอร์:</p><ol class="small steps">${steps}</ol>`;
  } else if (p.enabled) {
    const ver = p.verified === true ? '<p class="small">✅ ลงทะเบียนกับเซิร์ฟเวอร์เรียบร้อยแล้ว</p>' : p.verified === false ? '<p class="note">⚠ เครื่องนี้บอกว่าเปิดอยู่ แต่<b>ไม่พบการลงทะเบียนบนเซิร์ฟเวอร์</b> จึงจะยังไม่ได้รับแจ้งเตือน — กด "ลงทะเบียนใหม่" ด้านล่าง</p>' : '';
    body = `${ver}<p class="small">🔔 <b>เปิดอยู่</b> — จะแจ้งเมื่อจุดที่บันทึกไว้ (${n} จุด) เสี่ยงสูงขึ้น หรือมีผู้แจ้ง กทม. ว่าท่วมหนักใกล้จุดนั้น (ไม่เกิน 1 ครั้งต่อ 2 ชม.)</p>
      <div class="row wrap">${p.verified === false ? `<button class="btn btn-primary" data-act="push-enable" ${p.busy ? 'disabled' : ''}>ลงทะเบียนใหม่</button>` : ''}<button class="btn btn-sm" data-act="push-disable" ${p.busy ? 'disabled' : ''}>ปิดแจ้งเตือน</button></div>`;
  } else if (!n) {
    body = '<p class="small">บันทึกจุดของคุณ (บ้าน/ที่จอดรถ) ก่อน — แตะแผนที่แล้วกด "บันทึกจุดนี้เป็น" ที่แท็บพยากรณ์จุด จากนั้นกลับมาเปิดแจ้งเตือน</p>';
  } else {
    body = `<p class="small">รับแจ้งเตือนบนมือถือเมื่อจุดที่บันทึกไว้ (${n} จุด) เสี่ยงท่วมสูงขึ้น แม้ไม่ได้เปิดเว็บอยู่</p>
      <div class="row"><button class="btn btn-primary" data-act="push-enable" ${p.busy ? 'disabled' : ''}>${p.busy ? 'กำลังเปิด…' : '🔔 เปิดแจ้งเตือน'}</button></div>
      ${p.busy && p.stage ? `<p class="small muted">ขั้นตอนตอนนี้: ${esc(p.stage)}</p>${p.stage === 'ขออนุญาตแจ้งเตือน' ? '<p class="note">ถ้าไม่เห็นหน้าต่างถาม ให้มองหา <b>ไอคอนรูประฆัง 🔔</b> ที่แถบที่อยู่ด้านบน (Edge/Chrome บางครั้งซ่อนหน้าต่างไว้ที่นั่น) แล้วคลิกเลือก <b>"อนุญาต"</b></p>' : ''}` : ''}${consent}`;
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
        ${c13 && !c13.stale && c13.q >= 2400 ? '<p class="note">น้ำท้ายเขื่อนเจ้าพระยาค่อนข้างสูง พื้นที่ริมแม่น้ำควรเฝ้าระวัง</p>' : ''}
        ${riverRoute()}</section>`
    : '';
  const damCard = damsCard();
  const satCard = satFloodCard();

  const tideCard = ov?.tide
    ? `<section class="card"><h3>น้ำทะเลหนุน</h3>
        <p class="small">48 ชม. ข้างหน้า สูงสุด <b>${ov.tide.peak} ม.</b> เหนือระดับน้ำทะเลปานกลาง ช่วง ${fmtDayHour(ov.tide.peakTime)} น.
        ${ov.tide.high ? '<span class="tag warn">หนุนสูง</span>' : '<span class="tag">ปกติ</span>'}</p>${tideChart(ov.tide)}
        ${tideDays(ov.tide)}
        <p class="muted tiny">น้ำหนุนสูงทำให้คลองระบายออกอ่าวไทยช้า ยิ่งอันตรายเมื่อฝนตกพร้อมกัน · ตัวเลขจากโมเดล Open-Meteo Marine ที่ปากอ่าวเจ้าพระยา (ค่าประมาณ ไม่ใช่ตารางน้ำขึ้นน้ำลงทางการของกองทัพเรือ)</p></section>`
    : '';

  return `${floodsOverviewCard()}${rainObsOverviewCard()}${trafficOverviewCard()}${newsCard()}${ytLiveCard()}${riskCard(ov, 'จุดอ้างอิงใจกลางกรุงเทพฯ (แตะแผนที่เพื่อดูจุดอื่น)')}${mine}${pushCard()}${gaugeCard}${upCard}${damCard}${satCard}${tideCard}${ddsOverviewCard()}<section class="card hint"><div class="row wrap" style="margin:0"><span class="small grow">ช่วยส่งต่อให้คนในพื้นที่เสี่ยง</span><button class="btn btn-sm btn-primary" data-act="line-site">ส่งทางไลน์</button><button class="btn btn-sm" data-act="share-site">แชร์…</button></div></section>`;
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

  // right under the risk card: the user just tapped this point, so the camera view is one tap away without leaving this tab
  const camRow = camViewerEnabled() ? `<div class="row wrap"><button class="btn btn-primary" data-act="cam-viewer" data-lat="${f.lat}" data-lng="${f.lng}" data-zoom="14">📷 ดูกล้องสดรอบจุดนี้</button></div>` : '';

  return `${riskCard(f, title)}
    ${camRow}
    ${saveCard}
    ${nearCard}
    ${repeatHistoryCard(f)}
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
