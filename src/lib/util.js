const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

const TZ = 'Asia/Bangkok';
export const fmtTime = (ms) =>
  ms ? new Date(ms).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: TZ }) : '—';
export const fmtHourKey = (key) => key.slice(11, 16); // "YYYY-MM-DDTHH:00" (already Bangkok time)
export const fmtDayHour = (key) => {
  const d = new Date(key + ':00+07:00');
  return d.toLocaleString('th-TH', { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ });
};

export function ago(ms, now = Date.now()) {
  const m = Math.max(0, Math.round((now - ms) / 60000));
  if (m < 1) return 'เมื่อสักครู่';
  if (m < 60) return `${m} นาทีที่แล้ว`;
  const h = Math.floor(m / 60);
  return `${h} ชม. ${m % 60} นาทีที่แล้ว`;
}

let toastTimer;
export function toast(msg, ms = 3500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}
