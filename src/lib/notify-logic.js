// Decides whether a subscriber should be notified. Pure — unit-tested; used by scripts/notify.mjs.
export const MIN_GAP_MS = 2 * 3600e3; // at most one push per device per 2 h (unless danger appears)
// Alerts driven by the risk SCORE are paused (2026-10-02): the accuracy deep-dive found the "prepare/danger" levels had 0 hits in 451 graded samples where complaints
// can be seen. Alerts about things that were actually observed (a heavy complaint near a saved place, a followed road reaching its depth) are unchanged.
// 2026-10-06 (deep-dive #2): every graded flood still came from ONE storm (4–5 Oct), so cut-offs fitted now would describe that storm only. Regional/upstream
// were made information-only (they lifted the whole city at once); the logs now keep 45 days. Turn this back on only after the public report shows
// floodDays >= 5 under the current rules, with cut-offs chosen from those numbers.
export const RISK_ALERTS = false;

// Heavy rain MEASURED by a gauge near a saved place (rain in the last hour, from the ThaiWater gauges). Observed, not forecast, so it is not paused with the score alerts.
// It fires once when a fresh gauge within RAIN_RADIUS_KM reaches RAIN_ALERT_MM and re-arms when every such gauge is back under RAIN_REARM_MM.
export const RAIN_ALERT_MM = 30;
export const RAIN_REARM_MM = 10;
export const RAIN_RADIUS_KM = 6;

// the heaviest fresh gauge near a place → { r1, name, km } | null.  gauges: [{ lat, lng, r1, stale, name }]
export function heaviestNearbyRain(gauges, lat, lng, distKm, radiusKm = RAIN_RADIUS_KM) {
  let best = null;
  for (const g of gauges) {
    if (g.stale || g.r1 === null || g.r1 === undefined || !Number.isFinite(g.r1)) continue;
    const km = distKm(lat, lng, g.lat, g.lng);
    if (km <= radiusKm && (!best || g.r1 > best.r1)) best = { r1: g.r1, name: g.name || '', km };
  }
  return best;
}

// Safe as a Firestore map key (no dots): 13.7500,100.5000 -> p137500_1005000
export const placeKey = (p) => `p${Math.round(p.lat * 1e4)}_${Math.round(p.lng * 1e4)}`;

// prev: { level, heavy, rainOn, at } | undefined      cur: { level, heavy, rain }  (rain = heaviest fresh gauge nearby, mm in 1 h, 0 when none)
// Returns { notify: false } or { notify: true, kind: 'risk'|'observed'|'rain', dangerJump }
export function decide(prev, cur, { now, lastSentAt = 0, riskAlerts = RISK_ALERTS }) {
  const p = prev || { level: 0, heavy: 0 };
  const rainUp = (cur.rain || 0) >= RAIN_ALERT_MM && !p.rainOn;
  const riskUp = riskAlerts && cur.level >= 2 && cur.level > p.level;
  const heavyUp = cur.heavy >= 1 && cur.heavy > p.heavy;
  if (!riskUp && !heavyUp && !rainUp) return { notify: false };
  const dangerJump = riskAlerts && cur.level === 3 && p.level < 3;
  if (now - lastSentAt < MIN_GAP_MS && !dangerJump) return { notify: false, suppressed: true };
  return { notify: true, kind: riskUp ? 'risk' : heavyUp ? 'observed' : 'rain', dangerJump };
}

// State to store after a run. If a notification was suppressed we keep the old baseline so it can fire later.
export function nextState(prev, cur, { notified, suppressed, now }) {
  const p = prev || { level: 0, heavy: 0, at: 0 };
  const rain = cur.rain || 0;
  // rainOn: set once the rain has reached the alert level (alerted or not), cleared only when it is back under the re-arm level; a suppressed alert keeps it off so it can fire later
  const rainOn = suppressed ? !!p.rainOn : rain >= RAIN_ALERT_MM ? true : rain < RAIN_REARM_MM ? false : !!p.rainOn;
  if (suppressed) return { level: Math.min(p.level, cur.level), heavy: Math.min(p.heavy, cur.heavy), rainOn, at: p.at || 0 };
  return { level: cur.level, heavy: cur.heavy, rainOn, at: notified ? now : p.at || 0 };
}

export function sanitizePlaces(places, inBounds) {
  if (!Array.isArray(places)) return [];
  return places
    .filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && inBounds(p.lat, p.lng))
    .slice(0, 4)
    .map((p) => ({ lat: +p.lat, lng: +p.lng, label: String(p.label || 'จุดของฉัน').slice(0, 20) }));
}

// Data-only FCM payload; the service worker turns it into a notification.
export function buildMessage(place, ev, kind, rainG = null) {
  const r = ev.risk;
  const url = `/?p=${(+place.lat).toFixed(5)},${(+place.lng).toFixed(5)}`;
  if (kind === 'rain' && rainG) {
    return {
      title: `ฝนตกหนักใกล้${place.label}`,
      body: `สถานีวัดฝน${rainG.name ? ` ${rainG.name}` : ''} วัดได้ ${rainG.r1} มม. ใน 1 ชม. ล่าสุด (ห่างจุดของคุณ ${rainG.km.toFixed(1)} กม.) — ค่าวัดจริงที่สถานีเดียว ฝนอาจต่างกันในแต่ละพื้นที่ · ที่มา ThaiWater`,
      url,
      tag: `rain-${placeKey(place)}`,
    };
  }
  if (kind === 'observed') {
    return {
      title: `น้ำท่วมหนักใกล้${place.label}`,
      body: `มีผู้แจ้ง กทม. ${ev.nearby.heavy} จุด ในรัศมี 1 กม. (12 ชม. ล่าสุด) — เป็นรายงานจากประชาชน ยังไม่ผ่านการยืนยัน`,
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
