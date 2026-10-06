// Transparent rule-based flood-risk score (v0, experimental).
// Every point added comes with a Thai reason string so the user can see WHY.
// Thresholds are starting guesses to be calibrated against real reports — see PLAN.md §4.
import { trendOf } from './thaiwater.js';

export const RISK = [
  { id: 0, key: 'ok', label: 'ปกติ', color: '#2e9e5b', advice: 'จากข้อมูลที่มี ยังไม่พบสัญญาณน้ำท่วมรุนแรงในช่วง 48 ชม. ข้างหน้า แต่สถานการณ์เปลี่ยนเร็ว ควรติดตามต่อเนื่อง' },
  { id: 1, key: 'watch', label: 'เฝ้าระวัง', color: '#d9b300', advice: 'เตรียมความพร้อม: ตรวจเส้นทางที่จะใช้ ชาร์จมือถือ เก็บเอกสารสำคัญให้หยิบง่าย' },
  { id: 2, key: 'prepare', label: 'เตรียมย้ายของ', color: '#f28c28', advice: 'ควรย้ายรถไปที่สูงหรือที่จอดหลายชั้น และยกของมีค่าขึ้นที่สูงภายในวันนี้' },
  { id: 3, key: 'danger', label: 'อันตราย', color: '#d7263d', advice: 'ย้ายรถและของมีค่าทันที ตัดไฟชั้นล่างหากน้ำเข้าบ้าน และเตรียมอพยพหากน้ำสูงเร็ว โทร 1669 เมื่อเหตุฉุกเฉิน' },
];

// bit positions in the logged `comp` mask (do not renumber: they are part of the log format)
export const COMP = {
  nearHeavy: 0, nearMedium: 1, nearLight: 2, official: 3, obsRain1hHeavy: 4, obsRain1h: 5, obsRain1hLight: 6, obsRain24h: 7,
  fcNext24: 8, fcPeakHour: 9, fcPast48: 10, tideHigh: 11, gaugeOver: 12, gaugeHigh: 13, gaugeRising: 14, regional: 15, upstream: 16,
  lowGround: 17, // information only since 2026-10-02: logged, never scored (regional + upstream likewise since 2026-10-06)
};

export function assess({ rain, tide, gauges = [], upstream, elevation, regional, nearby, obs, official }) {
  const reasons = [];
  let score = 0;
  let fcScore = 0; // part driven by forecasts/terrain only (no observed floods, gauges or rain) — used to grade forecast skill
  let comp = 0; // which parts of the score fired (bit per COMP id) — logged with every accuracy sample so each part can be calibrated on its own
  const info = []; // facts shown to the user that are NOT part of the score
  const add = (pts, text, kind = 'obs', id = null) => {
    if (pts > 0) {
      score += pts;
      if (kind === 'fc') fcScore += pts;
      if (id !== null) comp |= 1 << id;
      reasons.push({ pts, text });
    }
  };

  if (nearby) {
    const n = nearby.heavy + nearby.medium + nearby.light;
    if (nearby.heavy >= 1) add(3, `มีผู้แจ้ง กทม. ว่าน้ำท่วมสูงในรัศมี 1 กม. (${nearby.heavy} จุดหนัก จาก ${n} เรื่อง ใน 12 ชม.)`, 'obs', 0);
    else if (nearby.medium >= 1 || nearby.light >= 3) add(2, `มีผู้แจ้ง กทม. ว่าน้ำท่วมขังในรัศมี 1 กม. (${n} เรื่อง ใน 12 ชม.)`, 'obs', 1);
    else if (n >= 1) add(1, `มีผู้แจ้ง กทม. ว่ามีน้ำท่วมขังเล็กน้อยในรัศมี 1 กม. (${n} เรื่อง)`, 'obs', 2);
  }

  if (official?.length) add(2, `กทม. ประกาศเหตุน้ำท่วมถนนในรัศมี 1.5 กม.: ${official[0].title}${official.length > 1 ? ` (และอีก ${official.length - 1})` : ''}`, 'obs', 3);

  if (obs) {
    if (obs.r1 >= 30) add(3, `ฝนตรวจวัดจริงตกหนักมาก ≈ ${obs.r1} มม. ใน 1 ชม. ล่าสุด ที่${obs.r1Name} (${obs.r1Km.toFixed(1)} กม.)`, 'obs', 4);
    else if (obs.r1 >= 10) add(2, `ฝนตรวจวัดจริงตกหนัก ≈ ${obs.r1} มม. ใน 1 ชม. ล่าสุด ที่${obs.r1Name} (${obs.r1Km.toFixed(1)} กม.)`, 'obs', 5);
    else if (obs.r1 >= 2.5) add(1, `ฝนกำลังตก ≈ ${obs.r1} มม. ใน 1 ชม. ล่าสุด ที่${obs.r1Name} (${obs.r1Km.toFixed(1)} กม.)`, 'obs', 6);
    if (obs.r24 >= 90) add(1, `ฝนสะสม 24 ชม. ที่วัดได้จริง ≈ ${obs.r24} มม. ที่${obs.r24Name} — ดินและท่อระบายอิ่มน้ำ`, 'obs', 7);
  }

  if (rain) {
    const r24 = rain.next24;
    add(r24 >= 100 ? 4 : r24 >= 60 ? 3 : r24 >= 30 ? 2 : r24 >= 10 ? 1 : 0, `ฝนพยากรณ์ 24 ชม. ข้างหน้า ≈ ${r24} มม.`, 'fc', 8);
    add(rain.peakHour >= 60 ? 2 : rain.peakHour >= 30 ? 1 : 0, `ช่วงฝนหนักสุด ≈ ${rain.peakHour} มม./ชม. (ระบบระบายน้ำ กทม. รับได้ราว 60 มม./ชม.)`, 'fc', 9);
    add(rain.past48 >= 60 ? 1 : 0, `ฝนสะสมย้อนหลัง 2 วัน ≈ ${rain.past48} มม. ท่อและคลองอาจยังไม่ระบายหมด`, 'fc', 10);
  }

  const wet = rain && rain.next24 >= 10;
  if (tide?.high && wet) add(1, `น้ำทะเลหนุนสูง (≈ ${tide.peak} ม.รทก.) ตรงกับช่วงฝนตก ทำให้ระบายน้ำออกทะเลช้าลง`, 'fc', 11);

  const worst = [...gauges].sort((a, b) => b.level - a.level || (b.over ?? -9) - (a.over ?? -9))[0];
  if (worst && !worst.stale) {
    const tr = trendOf(worst);
    if (worst.level === 5) {
      add(3, `สถานี${worst.name} (${worst.km.toFixed(1)} กม.) ระดับน้ำ${worst.over !== null ? `สูงกว่าตลิ่ง ${Math.round(worst.over * 100)} ซม.` : 'ล้นตลิ่ง'} — น้ำในคลองเต็ม ระบายจากถนนได้ช้า`, 'obs', 12);
    } else if (worst.level === 4) {
      add(1, `สถานี${worst.name} (${worst.km.toFixed(1)} กม.) น้ำมาก ใกล้ตลิ่ง`, 'obs', 13);
    }
    if (worst.level >= 4 && tr === 'rising') add(1, `ระดับน้ำที่สถานี${worst.name}กำลังเพิ่มขึ้น`, 'obs', 14);
  }

  // Region-wide overbank canals and high upstream flow were +1 each until 2026-10-06. Both fire at almost every point at once (upstream 100 %, regional 87 % of
  // graded samples in deep-dive #2), so they never said WHERE water would collect — they only lifted the whole city into "prepare". Shown as information, logged as bits.
  if (regional && regional.total >= 8 && regional.over / regional.total >= 0.25) {
    comp |= 1 << COMP.regional;
    info.push(`สถานีวัดน้ำ ${regional.over} จาก ${regional.total} แห่ง${regional.area || 'ใน กทม.+ปริมณฑล'}อยู่ระดับล้นตลิ่ง — คลองเต็มทั้งระบบ ระบายน้ำฝนได้ช้า (ข้อมูลประกอบ ไม่นับเป็นคะแนน เพราะเป็นภาพรวมทั้งภูมิภาค ไม่ได้บอกว่าจุดไหนจะท่วม)`);
  }

  if (upstream?.q >= 2400) {
    comp |= 1 << COMP.upstream;
    info.push(`น้ำเหนือที่เขื่อนเจ้าพระยาไหลลงมา ${Math.round(upstream.q).toLocaleString('th-TH')} ลบ.ม./วินาที (ค่อนข้างสูง) — ข้อมูลประกอบ ไม่นับเป็นคะแนน เพราะส่งผลกับทั้งเมืองพร้อมกัน`);
  }

  // Low ground (≤ 1.5 m) was +1 until 2026-10-02. The first accuracy deep-dive found it pointing the wrong way (complaint rate 1.5 % on low cells vs 7.0 % elsewhere;
  // removing it raised the AUC), so it is now shown as information only and logged as a component bit, so a better rule can be tested later.
  if (elevation !== null && elevation !== undefined && elevation <= 1.5) {
    comp |= 1 << COMP.lowGround;
    info.push(`พื้นที่ต่ำ (ความสูงโดยประมาณ ${elevation} ม.รทก. ข้อมูลหยาบ คลาดเคลื่อนได้ ±1 ม.) — แสดงเป็นข้อมูลประกอบ ไม่นับเป็นคะแนน เพราะผลตรวจย้อนหลังยังไม่พบว่าจุดพื้นต่ำถูกแจ้งท่วมบ่อยกว่า`);
  }

  reasons.sort((a, b) => b.pts - a.pts);
  const level = score >= 7 ? 3 : score >= 5 ? 2 : score >= 3 ? 1 : 0;

  const notes = [];
  if (rain && rain.max24 >= 30 && rain.min24 < 10) {
    notes.push(`แบบจำลองสภาพอากาศไม่ตรงกัน (ฝน 24 ชม.: ${rain.min24}–${rain.max24} มม.) ควรเผื่อกรณีฝนมากกว่าที่แสดง`);
  }
  return { score, fcScore, comp, level, ...RISK[level], reasons, notes, info };
}
