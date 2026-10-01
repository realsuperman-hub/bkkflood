// Flood verdicts that cctv.maholan.net's own AI makes from each camera frame (/api/detections). Their server shares no CORS headers, so the Thai-network task
// (scripts/sync-maholan-ai.mjs) copies the few positives into data-static/maholan-ai.json. This is a third party's automatic reading of a picture, never a
// measurement — we show it as "AI พบน้ำท่วม (ยังไม่ยืนยัน)" and keep it out of the risk score. DOM-free.
import { isCamId } from './maholan-cams.js';

export const AI_LEVEL_TH = { minor: 'เล็กน้อย', moderate: 'ปานกลาง', severe: 'รุนแรง' };
export const AI_MIN_CONF = 0.7;
export const AI_STALE_MS = 4 * 3600e3; // the task refreshes the file at least every 2 h; older than 4 h means the PC was off → show nothing

// their feed also marks `flood:true, level:'none', confidence:0` for "image would not load — keep watching": that is NOT a finding, drop it
export function normalizeAi(json, now = Date.now()) {
  const det = Array.isArray(json?.detections) ? json.detections : [];
  const flags = [];
  for (const d of det) {
    if (d?.flood !== true || !(d.level in AI_LEVEL_TH) || !(d.confidence >= AI_MIN_CONF) || !(d.floodUntil > now) || !isCamId(d.id)) continue;
    flags.push({ id: d.id, level: d.level, conf: Math.round(d.confidence * 100) / 100, at: d.at || 0, until: d.floodUntil });
  }
  flags.sort((a, b) => a.id.localeCompare(b.id));
  return { scanned: Number(json?.progress?.scanned) || det.length, total: Number(json?.progress?.total) || 0, flags };
}

// id → flag, only while the file is fresh and the verdict has not expired
export function activeFlags(file, now = Date.now()) {
  const out = new Map();
  if (!file?.generatedAt || now - file.generatedAt > AI_STALE_MS) return out;
  for (const f of file.flags || []) if (f.until > now && f.level in AI_LEVEL_TH && isCamId(f.id)) out.set(f.id, f);
  return out;
}
