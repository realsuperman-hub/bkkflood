// Live BMA/iTIC road cameras through Longdo Map's own camera overlay (longdo.Overlays.cameras).
// Longdo's API terms (§1.2) allow showing its Content inside the service "in the same manner, form, format and appearance"
// as Longdo provides it — so we embed Longdo's map and let ITS overlay draw the cameras. We never fetch or copy the images.
// Needs a free Longdo Map API key bound to https://bkkflood.web.app (src/firebase-config.js -> longdoMapKey). Without a key the feature stays hidden.
import { BMA_LINKS } from './bma-traffic.js';
import { longdoMapKey } from '../firebase-config.js';

export const camViewerEnabled = () => !!longdoMapKey;

let loading;
function loadSdk() {
  if (window.longdo?.Map) return Promise.resolve();
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `https://api.longdo.com/map3/?key=${encodeURIComponent(longdoMapKey)}`;
    s.async = true;
    s.onload = () => (window.longdo?.Map ? resolve() : reject(new Error('โหลด Longdo Map ไม่สำเร็จ')));
    s.onerror = () => reject(new Error('โหลด Longdo Map ไม่สำเร็จ'));
    document.head.appendChild(s);
  }).catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}

let map;
export async function openCamViewer({ lat, lng, zoom = 13 }) {
  const dlg = document.getElementById('cam-dialog');
  dlg.innerHTML = `<div class="cam-head"><b>กล้องจราจร (ผ่าน Longdo Map)</b><span><a class="btn btn-sm" href="${BMA_LINKS.longdoAt(lat, lng)}" target="_blank" rel="noopener">เปิดที่ Longdo ↗</a> <button class="btn btn-sm" data-cam-close>ปิด</button></span></div>
    <div id="cam-map" class="cam-map"><p class="muted small" style="padding:16px">กำลังโหลดแผนที่…</p></div>
    <p class="muted tiny cam-foot">แผนที่และกล้องจราจรโดย Longdo Map (Metamedia Technology) · ซูมเข้า/ออกเพื่อหาไอคอนกล้อง แล้วแตะเพื่อดูภาพ · กล้องเป็นของ กทม./iTIC</p>`;
  dlg.querySelector('[data-cam-close]').onclick = () => dlg.close();
  if (!dlg.open) dlg.showModal();
  try {
    await loadSdk();
    const holder = document.getElementById('cam-map');
    holder.innerHTML = '';
    map = new window.longdo.Map({ placeholder: holder, location: { lon: lng, lat }, zoom });
    window.__camMap = map; // debugging handle
    map.Event.bind('ready', () => {
      map.Overlays.load(window.longdo.Overlays.cameras);
      map.Overlays.load(window.longdo.Overlays.events);
    });
  } catch (e) {
    document.getElementById('cam-map').innerHTML = `<p class="note" style="padding:16px">${e.message} — ลองใหม่ หรือใช้ปุ่มลิงก์ไปเว็บต้นทาง</p>`;
  }
}
