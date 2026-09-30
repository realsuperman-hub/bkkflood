// Big-dam storage and releases from the Royal Irrigation Department's official open API (documented at
// https://app.rid.go.th/reservoir/api/document/dam — CORS-enabled, current day + history). DOM-free (used by scripts/fetch-dams.mjs).
// inflow/outflow are in million m³ PER DAY: checked 2026-09-30 by mass balance (Δvolume ≈ inflow − outflow for Bhumibol, Pasak,
// Khwae Noi and Mae Kuang), although the API document leaves the unit unstated.
// The Chao Phraya Dam (Chai Nat) is a barrage, not in this list — its release is the C.13 gauge already on the river card.

export const DAM_API = 'https://app.rid.go.th/reservoir/api/dam/public';

// The reservoirs that feed the Chao Phraya: Ping (Bhumibol), Nan (Sirikit + Khwae Noi Bamrung Daen), Pasak (joins at Ayutthaya).
export const KEY_DAMS = {
  200101: { label: 'ภูมิพล', river: 'แม่น้ำปิง' },
  200102: { label: 'สิริกิติ์', river: 'แม่น้ำน่าน' },
  100107: { label: 'แควน้อยบำรุงแดน', river: 'แม่น้ำน่าน (สาขา)' },
  100301: { label: 'ป่าสักชลสิทธิ์', river: 'แม่น้ำป่าสัก (ไหลลงเจ้าพระยาที่อยุธยา)' },
};

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const flatten = (day) => new Map((day?.data || []).flatMap((reg) => (reg.dam || []).map((d) => [String(d.id), d])));

// Combine "latest day" and "day before" API responses into one small, self-describing snapshot.
export function normalizeDams(latest, previous) {
  const now = flatten(latest);
  const before = flatten(previous);
  if (!now.size) throw new Error('RID dam API: no data for the latest day');
  const dams = [];
  for (const [id, meta] of Object.entries(KEY_DAMS)) {
    const d = now.get(id);
    if (!d) continue;
    const p = before.get(id);
    dams.push({
      id,
      name: meta.label,
      river: meta.river,
      owner: d.owner || '',
      capacity: num(d.capacity),
      volume: num(d.volume),
      percent: num(d.percent_storage),
      inflow: num(d.inflow),
      outflow: num(d.outflow),
      prevInflow: num(p?.inflow),
      prevOutflow: num(p?.outflow),
      prevVolume: num(p?.volume),
    });
  }
  if (!dams.length) throw new Error('RID dam API: none of the key dams found');
  return { date: latest.date, prevDate: previous?.date ?? null, dams };
}

// million m³/day → m³/s (the unit used on the river gauges)
export const mcmDayToCms = (v) => (v === null || v === undefined ? null : Math.round((v * 1e6) / 86400));

// Share of yesterday's inflow the dam kept instead of passing downstream (null when inflow is ~0)
export const retainedShare = (d) => (d.inflow && d.inflow > 0.05 && d.outflow !== null ? Math.max(0, Math.min(1, 1 - d.outflow / d.inflow)) : null);

// Plain-language status. 100 % = the dam's normal storage capacity, not a structural limit.
export function damStatus(d) {
  if (d.percent === null) return { tag: 'ไม่มีข้อมูล', level: 0 };
  if (d.percent >= 100) return { tag: 'เกินความจุเก็บกักปกติ', level: 3 };
  if (d.percent >= 90) return { tag: 'ใกล้เต็ม', level: 2 };
  if (d.percent >= 75) return { tag: 'น้ำมาก', level: 1 };
  return { tag: 'ยังรับน้ำได้', level: 0 };
}

export const outflowTrend = (d) => {
  if (d.outflow === null || d.prevOutflow === null) return 'unknown';
  const diff = d.outflow - d.prevOutflow;
  if (diff > Math.max(0.5, d.prevOutflow * 0.15)) return 'rising';
  if (diff < -Math.max(0.5, d.prevOutflow * 0.15)) return 'falling';
  return 'steady';
};
