// One list of every symbol on the map, used three ways: a swatch strip beside each layer checkbox, the compact key in the layers menu (only for layers that
// are switched on) and the full "สัญลักษณ์บนแผนที่" dialog. `ly` = id of the layer's checkbox in index.html. Colours come from the same constants the map uses.
import { LEVELS } from './thaiwater.js';
import { DEPTHS } from './store.js';
import { SEVERITY } from './traffy.js';
import { SPEED_LEVEL } from './bma-traffic.js';
import { esc } from './util.js';
import { DEPTH_BANDS, CLOSED_COLOR } from './road-flood.js';
import { ROAD_LEVEL, CANAL_LEVEL } from './popnix.js';
import { WIND_COLORS, SEA_COLORS } from './windfield.js';
import { RAIN_BANDS } from './rainfield.js';
import { tideColor } from './tidefield.js';

export const EV_COLOR = { flood: '#0b6fa8', accident: '#f28c28', fire: '#d7263d', closed: '#12222e', other: '#5b6876' };

const dot = (color, label) => ({ shape: 'dot', color, label });

export const LEGEND = [
  {
    id: 'roadflood', ly: 'ly-roadflood', title: 'ระดับน้ำบนถนน (ประมาณ)',
    items: [
      ...DEPTH_BANDS.slice().reverse().map((b) => ({ shape: 'ln', color: b.color, label: b.label })),
      { shape: 'ln', color: CLOSED_COLOR, label: 'ปิดการจราจร' },
    ],
    note: 'ค่าประมาณจาก Floodboard (CC BY 4.0) ที่รวมเซ็นเซอร์ กทม. Traffy ข่าว โซเชียล · เส้นจางลง = ความเชื่อมั่นต่ำ · กดเส้นเพื่อดูว่ารถแต่ละแบบผ่านได้ไหม',
  },
  {
    id: 'rainfx', ly: 'ly-rainfx', title: 'ฝนตก (เคลื่อนไหว)',
    items: RAIN_BANDS.map((b) => dot(b.color, `${b.label} — เม็ดฝน${b.min >= 10 ? 'หนาแน่น' : b.min >= 2.5 ? 'ปานกลาง' : 'บาง'}`)),
    note: 'ความหนาแน่นของเม็ดฝนตามปริมาณฝนใน 1 ชม. ล่าสุดที่สถานีวัดฝนรายงาน แสดงเฉพาะบริเวณห่างสถานีไม่เกิน 20 กม. · ไม่มีเม็ดฝนไม่ได้แปลว่าฝนไม่ตก อาจไม่มีสถานีใกล้',
  },
  {
    id: 'tide', ly: 'ly-tide', title: 'ระดับน้ำทะเลรายชั่วโมง (อ่าวไทย)',
    items: [[-1.2, 'น้ำลงต่ำ'], [0, 'ระดับทะเลปานกลาง'], [0.8, 'น้ำสูง'], [1.5, 'น้ำขึ้นสูงมาก']].map(([m, label]) => dot(tideColor(m), `${label} (${m > 0 ? '+' : ''}${m} ม.)`)),
    note: 'ค่าจากแบบจำลอง (Open-Meteo Marine) เป็นระดับเหนือทะเลปานกลาง รวมน้ำขึ้นน้ำลงและลมหนุน เลื่อนแถบเวลาเพื่อดูแต่ละชั่วโมง',
  },
  {
    id: 'wind', ly: 'ly-wind', title: 'กระแสลม (เคลื่อนไหว)',
    items: [['ลมอ่อน (ต่ำกว่า 2 ม./วิ)', 0], ['ลมปานกลาง (2–5)', 1], ['ลมค่อนข้างแรง (5–8)', 2], ['ลมแรง (8 ขึ้นไป)', 3]].map(([label, i]) => ({ shape: 'ln', color: WIND_COLORS[i][1], label })),
    note: 'เส้นที่ไหลคือทิศที่ลมพัดไป ความเร็วของการเคลื่อนไหวบนจอเป็นภาพประกอบ ไม่ใช่ความเร็วจริง · ค่าจากแบบจำลองพยากรณ์ (Open-Meteo) ที่ระดับ 10 ม. ไม่ใช่เครื่องวัดในพื้นที่',
  },
  {
    id: 'sea', ly: 'ly-sea', title: 'กระแสน้ำทะเล อ่าวไทยตอนบน (เคลื่อนไหว)',
    items: [['ไหลช้ามาก', 0], ['ไหลช้า', 1], ['ไหลปานกลาง', 2], ['ไหลเร็ว', 3]].map(([label, i]) => ({ shape: 'ln', color: SEA_COLORS[i][1], label })),
    note: 'ทิศที่น้ำทะเลไหลไป (ขึ้น-ลงตามน้ำขึ้นน้ำลง) มีเฉพาะในทะเล ความเร็วบนจอเป็นภาพประกอบ · ค่าจากแบบจำลอง Open-Meteo Marine',
  },
  {
    id: 'sensors', ly: 'ly-sensors', title: 'เซ็นเซอร์น้ำท่วมถนน กทม. (วัดจริง)',
    items: ['flood', 'slight', 'dry', 'stale'].map((k) => dot(ROAD_LEVEL[k].color, ROAD_LEVEL[k].label)),
    note: 'วัดเฉพาะจุดที่ติดตั้ง ถนนช่วงอื่นอาจลึกหรือตื้นกว่า · วงเทา = ไม่มีค่าใน 45 นาทีล่าสุด ไม่ได้แปลว่าแห้ง · ข้อมูลของ สนน. ผ่าน POPNIX Flood',
  },
  {
    id: 'canals', ly: 'ly-canals', title: 'ระดับน้ำในคลอง กทม. (วัดจริง)',
    items: ['crit', 'warn', 'ok', 'stale'].map((k) => ({ shape: 'sq', color: CANAL_LEVEL[k].color, label: CANAL_LEVEL[k].label })),
    note: 'เทียบกับระดับเฝ้าระวัง/วิกฤตที่ กทม. ตั้งไว้ ไม่ใช่การเตือนภัยทางการ · สถานีที่ไม่ส่งค่าจะเป็นสีเทา',
  },
  {
    id: 'floods', ly: 'ly-floods', title: 'จุดน้ำท่วมที่ประชาชนแจ้ง กทม.',
    items: [3, 2, 1].map((l) => ({ shape: 'tri', color: SEVERITY[l].color, label: SEVERITY[l].label })),
    note: 'สามเหลี่ยมจาง = มีผู้แจ้งเพียงแหล่งเดียว ยังไม่มีข้อมูลอื่นยืนยัน · วงแดงจางรอบจุด = ท่วมหนัก',
  },
  {
    id: 'repeat', ly: 'ly-repeat', title: 'จุดท่วมซ้ำ (ประวัติการแจ้ง)',
    items: [dot('#f2c200', 'มีคนแจ้งท่วม 2–3 วันที่ต่างกัน'), dot('#f28c28', '4–6 วัน'), dot('#d7263d', '7 วันขึ้นไป')],
    note: 'นับจากข้อความแจ้งของประชาชน ไม่ใช่ค่าที่วัดได้ · ไม่มีวงไม่ได้แปลว่าไม่เคยท่วม',
  },
  {
    id: 'windy', ly: 'ly-windy', title: 'กล้อง Windy',
    items: [dot('#0e9f8e', 'กล้อง Windy — ภาพเร่งเวลาย้อนหลัง 24 ชม.')],
    note: 'ไม่ใช่ภาพสด',
  },
  {
    id: 'mcams', ly: 'ly-mcams', title: 'ภาพกล้อง CCTV ล่าสุด',
    items: [dot('#7a4fd6', 'กล้อง CCTV — กดดูภาพนิ่งล่าสุด'), dot('#e0203a', 'AI พบน้ำท่วมจากภาพ')],
    note: 'จุดแดง = ระบบอ่านภาพอัตโนมัติ ยังไม่ผ่านการยืนยัน ใช้ดูภาพเทียบเท่านั้น · เห็นเมื่อซูมเข้า · ดูเวลาที่พิมพ์บนภาพเสมอ · บางจุดมีแค่ลิงก์ไปดูภาพสดที่เว็บของเจ้าของกล้อง',
  },
  {
    id: 'sat', ly: 'ly-sat', title: 'น้ำท่วมจากดาวเทียม (GISTDA)',
    items: [{ shape: 'big', color: '#1c5fd4', label: 'พื้นที่ที่ดาวเทียมเรดาร์เห็นน้ำท่วม (วงใหญ่ = ท่วมมากกว่า)' }],
    note: 'เห็นนอกเมืองและพื้นที่เกษตรได้ดี ในตัวเมืองที่หนาแน่นเห็นได้น้อย · ดาวเทียมผ่านทุกไม่กี่วัน',
  },
  {
    id: 'traffic', ly: 'ly-traffic', title: 'จราจร (กทม.)',
    items: [
      ...[1, 2, 3, 4].map((l) => ({ shape: 'ln', color: SPEED_LEVEL[l].color, label: SPEED_LEVEL[l].label })),
      ...Object.entries({ flood: 'เหตุน้ำท่วม', accident: 'อุบัติเหตุ', fire: 'เพลิงไหม้', closed: 'ปิดถนน' }).map(([k, t]) => dot(EV_COLOR[k], t)),
    ],
    note: 'เส้น = ความเร็วรถบนถนน · จุด = เหตุการณ์ที่ กทม. ประกาศวันนี้',
  },
  {
    id: 'cams', ly: 'ly-cams', title: 'กล้องจราจร กทม. (ตำแหน่ง)',
    items: [dot('#00a6c8', 'จุดเฝ้าระวังน้ำท่วม'), dot('#4a5b6c', 'กล้องทั่วไป')],
    note: 'แสดงตำแหน่งกล้องเท่านั้น ไม่มีภาพ · เห็นเมื่อซูมเข้า',
  },
  {
    id: 'gauges', ly: 'ly-gauges', title: 'สถานีวัดระดับน้ำ',
    items: [5, 4, 3, 2, 1].map((l) => dot(LEVELS[l].color, LEVELS[l].label)).concat([{ shape: 'ring', color: '#8a94a3', label: 'วงจาง ขอบเทา = ข้อมูลเก่า' }]),
  },
  {
    id: 'reports', ly: 'ly-reports', title: 'รายงานจากประชาชน',
    items: Object.values(DEPTHS).map((d) => ({ shape: 'pin', color: d.color, label: `${d.label} (${d.hint})` })),
    note: 'เส้นสี = ถนนช่วงที่ท่วม · พื้นที่แรเงาขอบประ = บริเวณที่ท่วม · รายงานหายไปเองใน 4 ชม. ถ้าไม่มีคนยืนยัน',
  },
  {
    id: 'rain', ly: 'ly-rain', title: 'สถานีวัดฝน (ฝนตกจริง)',
    items: [dot('#8a94a3', 'ไม่มีฝน'), dot('#4aa3df', 'ฝนเล็กน้อย (< 2.5 มม./ชม.)'), dot('#2f80c8', 'ปานกลาง (2.5–10)'), dot('#f28c28', 'หนัก (10–30)'), dot('#d7263d', 'หนักมาก (> 30)')],
    note: 'วงใหญ่ = ฝนแรงกว่า · จางลง = ข้อมูลเก่า',
  },
  {
    id: 'radar', ly: 'ly-radar', title: 'เรดาร์ฝน',
    items: [{ shape: 'none', label: 'บริเวณที่มีสีทับบนแผนที่ = มีฝน ยิ่งสีเข้ม/จัด ยิ่งฝนแรง' }],
    note: 'ภาพเรดาร์ย้อนหลังราว 2 ชม. ยังไม่ใช่การพยากรณ์',
  },
];

// buttons and marks that are always there (shown in the full dialog only)
export const OTHER = {
  id: 'other', ly: null, title: 'ปุ่มและเครื่องหมายอื่น',
  items: [
    { shape: 'ln', color: '#1c7fb8', label: 'เส้นทางที่ตรวจ (เส้นเทา = เส้นทางอื่น) · เส้นประสีบนเส้นทาง = ถนนที่มีน้ำท่วมตามทาง' },
    { html: '<i class="dot" style="background:#0b3d5c"></i>', label: 'จุดที่คุณเลือกบนแผนที่ (ดูพยากรณ์ของจุดนั้นที่แท็บ “พยากรณ์จุด”)' },
    { html: '<span class="lg-btn red">+</span>', label: 'ปุ่มแดง “แจ้งท่วม” — แจ้งน้ำท่วมที่คุณเห็น (บนมือถืออยู่ที่แถบล่าง “แจ้งท่วม”)' },
    { html: '<span class="lg-btn">▦</span>', label: 'ปุ่ม “กล้อง” — เปิดห้องมอนิเตอร์ (ผนังภาพกล้องเต็มจอ) และสลับไปดูแผนที่กล้องสดของ Longdo ได้ในหน้านั้น' },
    { html: '<span class="lg-btn">◎</span>', label: 'ปุ่มเล็ง — ไปยังตำแหน่งของคุณ' },
  ],
};

const sym = (it) => it.html ?? (it.shape === 'none' ? '' : `<i class="${it.shape}" style="background:${esc(it.color)}"></i>`);
export const itemsHtml = (g) => g.items.map((it) => `<div class="lg">${sym(it)}<span>${esc(it.label)}</span></div>`).join('');

// compact key for the layers menu
export const compactHtml = (g) => `<div class="legend-title">${esc(g.title)}</div><div class="lg-grp">${itemsHtml(g)}</div>`;

// 1–3 mini symbols to sit beside the layer's checkbox
export function stripHtml(g) {
  const pick = g.items.filter((it) => it.shape !== 'none').slice(0, 3);
  return pick.length ? `<span class="lg sws" aria-hidden="true">${pick.map((it) => `<i class="${it.shape}" style="background:${esc(it.color)}"></i>`).join('')}</span>` : '';
}

// full dialog: every group, with its note and whether the layer is currently switched on
export function dialogHtml(isOn) {
  const sec = (g) => `<section class="lg-sec"><h4>${esc(g.title)}${g.ly && !isOn(g.ly) ? ' <span class="lg-off">ปิดอยู่</span>' : ''}</h4>${itemsHtml(g)}${g.note ? `<p class="muted tiny">${esc(g.note)}</p>` : ''}</section>`;
  return [...LEGEND, OTHER].map(sec).join('');
}
