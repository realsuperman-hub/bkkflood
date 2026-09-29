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

export function assess({ rain, tide, gauges = [], upstream, elevation, regional, nearby, obs }) {
  const reasons = [];
  let score = 0;
  let fcScore = 0; // part driven by forecasts/terrain only (no observed floods, gauges or rain) — used to grade forecast skill
  const add = (pts, text, kind = 'obs') => {
    if (pts > 0) {
      score += pts;
      if (kind === 'fc') fcScore += pts;
      reasons.push({ pts, text });
    }
  };

  if (nearby) {
    const n = nearby.heavy + nearby.medium + nearby.light;
    if (nearby.heavy >= 1) add(3, `มีผู้แจ้ง กทม. ว่าน้ำท่วมสูงในรัศมี 1 กม. (${nearby.heavy} จุดหนัก จาก ${n} เรื่อง ใน 12 ชม.)`);
    else if (nearby.medium >= 1 || nearby.light >= 3) add(2, `มีผู้แจ้ง กทม. ว่าน้ำท่วมขังในรัศมี 1 กม. (${n} เรื่อง ใน 12 ชม.)`);
    else if (n >= 1) add(1, `มีผู้แจ้ง กทม. ว่ามีน้ำท่วมขังเล็กน้อยในรัศมี 1 กม. (${n} เรื่อง)`);
  }

  if (obs) {
    if (obs.r1 >= 30) add(3, `ฝนตรวจวัดจริงตกหนักมาก ≈ ${obs.r1} มม. ใน 1 ชม. ล่าสุด ที่${obs.r1Name} (${obs.r1Km.toFixed(1)} กม.)`);
    else if (obs.r1 >= 10) add(2, `ฝนตรวจวัดจริงตกหนัก ≈ ${obs.r1} มม. ใน 1 ชม. ล่าสุด ที่${obs.r1Name} (${obs.r1Km.toFixed(1)} กม.)`);
    else if (obs.r1 >= 2.5) add(1, `ฝนกำลังตก ≈ ${obs.r1} มม. ใน 1 ชม. ล่าสุด ที่${obs.r1Name} (${obs.r1Km.toFixed(1)} กม.)`);
    if (obs.r24 >= 90) add(1, `ฝนสะสม 24 ชม. ที่วัดได้จริง ≈ ${obs.r24} มม. ที่${obs.r24Name} — ดินและท่อระบายอิ่มน้ำ`);
  }

  if (rain) {
    const r24 = rain.next24;
    add(r24 >= 100 ? 4 : r24 >= 60 ? 3 : r24 >= 30 ? 2 : r24 >= 10 ? 1 : 0, `ฝนพยากรณ์ 24 ชม. ข้างหน้า ≈ ${r24} มม.`, 'fc');
    add(rain.peakHour >= 60 ? 2 : rain.peakHour >= 30 ? 1 : 0, `ช่วงฝนหนักสุด ≈ ${rain.peakHour} มม./ชม. (ระบบระบายน้ำ กทม. รับได้ราว 60 มม./ชม.)`, 'fc');
    add(rain.past48 >= 60 ? 1 : 0, `ฝนสะสมย้อนหลัง 2 วัน ≈ ${rain.past48} มม. ท่อและคลองอาจยังไม่ระบายหมด`, 'fc');
  }

  const wet = rain && rain.next24 >= 10;
  if (tide?.high && wet) add(1, `น้ำทะเลหนุนสูง (≈ ${tide.peak} ม.รทก.) ตรงกับช่วงฝนตก ทำให้ระบายน้ำออกทะเลช้าลง`, 'fc');

  const worst = [...gauges].sort((a, b) => b.level - a.level || (b.over ?? -9) - (a.over ?? -9))[0];
  if (worst && !worst.stale) {
    const tr = trendOf(worst);
    if (worst.level === 5) {
      add(3, `สถานี${worst.name} (${worst.km.toFixed(1)} กม.) ระดับน้ำ${worst.over !== null ? `สูงกว่าตลิ่ง ${Math.round(worst.over * 100)} ซม.` : 'ล้นตลิ่ง'} — น้ำในคลองเต็ม ระบายจากถนนได้ช้า`);
    } else if (worst.level === 4) {
      add(1, `สถานี${worst.name} (${worst.km.toFixed(1)} กม.) น้ำมาก ใกล้ตลิ่ง`);
    }
    if (worst.level >= 4 && tr === 'rising') add(1, `ระดับน้ำที่สถานี${worst.name}กำลังเพิ่มขึ้น`);
  }

  if (regional && regional.total >= 8 && regional.over / regional.total >= 0.25) {
    add(1, `สถานีวัดน้ำ ${regional.over} จาก ${regional.total} แห่งใน กทม.+ปริมณฑลอยู่ระดับล้นตลิ่ง — คลองเต็มทั้งระบบ ระบายน้ำฝนได้ช้า`);
  }

  if (upstream?.q >= 2400) add(1, `น้ำเหนือที่เขื่อนเจ้าพระยาไหลลงมา ${Math.round(upstream.q).toLocaleString('th-TH')} ลบ.ม./วินาที (ค่อนข้างสูง)`);

  if (elevation !== null && elevation !== undefined && elevation <= 1.5) {
    add(1, `พื้นที่ต่ำ (ความสูงโดยประมาณ ${elevation} ม.รทก. — ข้อมูลหยาบ คลาดเคลื่อนได้ ±1 ม.)`, 'fc');
  }

  reasons.sort((a, b) => b.pts - a.pts);
  const level = score >= 7 ? 3 : score >= 5 ? 2 : score >= 3 ? 1 : 0;

  const notes = [];
  if (rain && rain.max24 >= 30 && rain.min24 < 10) {
    notes.push(`แบบจำลองสภาพอากาศไม่ตรงกัน (ฝน 24 ชม.: ${rain.min24}–${rain.max24} มม.) ควรเผื่อกรณีฝนมากกว่าที่แสดง`);
  }
  return { score, fcScore, level, ...RISK[level], reasons, notes };
}
