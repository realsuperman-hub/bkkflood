// Decides whether a subscriber should be notified. Pure — unit-tested; used by scripts/notify.mjs.
export const MIN_GAP_MS = 2 * 3600e3; // at most one push per device per 2 h (unless danger appears)

// Safe as a Firestore map key (no dots): 13.7500,100.5000 -> p137500_1005000
export const placeKey = (p) => `p${Math.round(p.lat * 1e4)}_${Math.round(p.lng * 1e4)}`;

// prev: { level, heavy, at } | undefined      cur: { level, heavy }
// Returns { notify: false } or { notify: true, kind: 'risk'|'observed', dangerJump }
export function decide(prev, cur, { now, lastSentAt = 0 }) {
  const p = prev || { level: 0, heavy: 0 };
  const riskUp = cur.level >= 2 && cur.level > p.level;
  const heavyUp = cur.heavy >= 1 && cur.heavy > p.heavy;
  if (!riskUp && !heavyUp) return { notify: false };
  const dangerJump = cur.level === 3 && p.level < 3;
  if (now - lastSentAt < MIN_GAP_MS && !dangerJump) return { notify: false, suppressed: true };
  return { notify: true, kind: riskUp ? 'risk' : 'observed', dangerJump };
}

// State to store after a run. If a notification was suppressed we keep the old baseline so it can fire later.
export function nextState(prev, cur, { notified, suppressed, now }) {
  const p = prev || { level: 0, heavy: 0, at: 0 };
  if (suppressed) return { level: Math.min(p.level, cur.level), heavy: Math.min(p.heavy, cur.heavy), at: p.at || 0 };
  return { level: cur.level, heavy: cur.heavy, at: notified ? now : p.at || 0 };
}

export function sanitizePlaces(places, inBounds) {
  if (!Array.isArray(places)) return [];
  return places
    .filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && inBounds(p.lat, p.lng))
    .slice(0, 4)
    .map((p) => ({ lat: +p.lat, lng: +p.lng, label: String(p.label || 'จุดของฉัน').slice(0, 20) }));
}

// Data-only FCM payload; the service worker turns it into a notification.
export function buildMessage(place, ev, kind) {
  const r = ev.risk;
  const url = `/?p=${(+place.lat).toFixed(5)},${(+place.lng).toFixed(5)}`;
  if (kind === 'observed') {
    return {
      title: `น้ำท่วมหนักใกล้${place.label}`,
      body: `มีผู้แจ้ง กทม. ${ev.nearby.heavy} จุด ในรัศมี 1 กม. (12 ชม. ล่าสุด) · ระดับความเสี่ยง: ${r.label}`,
      url,
      tag: `obs-${placeKey(place)}`,
    };
  }
  return {
    title: `${place.label}: ${r.label}`,
    body: `${r.reasons[0]?.text || r.advice}`.slice(0, 140),
    url,
    tag: `risk-${placeKey(place)}`,
  };
}
