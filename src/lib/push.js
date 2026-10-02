// Web-push opt-in (Firebase Cloud Messaging). The server side lives in scripts/notify.mjs.
// A subscription = this device's FCM token + the places the user saved, stored in Firestore `subs/{uid}`.
import { state } from '../state.js';
import { vapidKey } from '../firebase-config.js';

const FLAG = 'bkkflood.push'; // '1' when this browser opted in
const TOKEN = 'bkkflood.pushToken';

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

const ls = {
  get: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v);
    } catch {
      /* storage unavailable */
    }
  },
};

// Browsers embedded in other apps (LINE, Facebook, Instagram…) never show the notification prompt.
export const inAppBrowser = () => /Line\/|FBAN|FBAV|FB_IAB|Instagram|MicroMessenger|Messenger/i.test(navigator.userAgent);
export const platform = () => (isIOS() ? 'ios' : /Android/i.test(navigator.userAgent) ? 'android' : 'desktop');

// { ok:true } or { ok:false, reason: 'ios-install' | 'unsupported' | 'no-backend' | 'in-app' }
export function pushSupport() {
  if (state.store && state.store.mode !== 'firebase') return { ok: false, reason: 'no-backend' };
  if (inAppBrowser()) return { ok: false, reason: 'in-app' };
  const api = 'serviceWorker' in navigator && 'Notification' in window && 'PushManager' in window;
  if (api) return { ok: true };
  return { ok: false, reason: isIOS() && !isStandalone() ? 'ios-install' : 'unsupported' };
}

export function pushStatus() {
  const support = pushSupport();
  const permission = 'Notification' in window ? Notification.permission : 'denied';
  return { ...support, permission, enabled: support.ok && permission === 'granted' && ls.get(FLAG) === '1' };
}

const ROADS_FLAG = 'bkkflood.roadsSynced'; // '1' once road alerts were written to the server (so an emptied list is cleared there too)
const roadsPayload = (roads) => (roads || []).slice(0, 5).map((r) => ({ name: String(r.name).slice(0, 80), min: Math.round(r.min) }));
// the `roads` field is only sent when there is something to say (or something to clear): devices that never follow a road behave exactly as before
const roadsField = (roads) => {
  const p = roadsPayload(roads);
  if (p.length) { ls.set(ROADS_FLAG, '1'); return { roads: p }; }
  if (ls.get(ROADS_FLAG) === '1') { ls.set(ROADS_FLAG, null); return { roads: [] }; }
  return {};
};
const placesPayload = (places) => places.slice(0, 4).map((p) => ({ lat: +p.lat.toFixed(5), lng: +p.lng.toFixed(5), label: String(p.label).slice(0, 20) }));

async function getToken() {
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const [{ getApp }, { getMessaging, getToken: gt }] = await Promise.all([import('firebase/app'), import('firebase/messaging')]);
  return gt(getMessaging(getApp()), { serviceWorkerRegistration: reg, ...(vapidKey ? { vapidKey } : {}) });
}

// Runs one step of the opt-in with a time limit. If it fails or hangs, the message says WHICH step and why
// (a step that waits forever is what a user sees as "the button is stuck").
async function step(name, fn, ms, onStage) {
  onStage?.(name);
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(fn),
      new Promise((_, rej) => {
        timer = setTimeout(() => rej(Object.assign(new Error('ไม่ตอบสนองภายในเวลาที่กำหนด'), { code: 'timeout' })), ms);
      }),
    ]);
  } catch (e) {
    const detail = `${e?.code || ''} ${e?.message || e}`.trim().slice(0, 160);
    const err = new Error(`ขั้น "${name}" ไม่สำเร็จ — ${detail}`);
    err.step = name;
    err.timeout = e?.code === 'timeout';
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export const STAGE_PERMISSION = 'ขออนุญาตแจ้งเตือน';

export async function enablePush(places, onStage, roads = []) {
  if (!places.length && !roads.length) throw new Error('บันทึกจุดของคุณ (บ้าน/ที่จอดรถ) ก่อน แล้วค่อยเปิดแจ้งเตือน');
  const support = pushSupport();
  if (!support.ok) throw new Error('อุปกรณ์/เบราว์เซอร์นี้ยังเปิดแจ้งเตือนไม่ได้');
  const perm = await step(STAGE_PERMISSION, () => Notification.requestPermission(), 120000, onStage);
  if (perm === 'default') throw new Error('ยังไม่ได้เลือก "อนุญาต" ในหน้าต่างที่เบราว์เซอร์ถาม (หรือปิดหน้าต่างไปก่อน) — กดปุ่มอีกครั้งแล้วเลือก "อนุญาต"');
  if (perm !== 'granted') throw new Error('เบราว์เซอร์บล็อกการแจ้งเตือนของเว็บนี้ไว้ — ทำตามขั้นตอนด้านล่างเพื่อเปิดสิทธิ์ แล้วรีเฟรชหน้านี้');
  const token = await step('ขอรหัสอุปกรณ์จากบริการแจ้งเตือนของเบราว์เซอร์ (FCM)', () => getToken(), 30000, onStage);
  if (!token) throw new Error('ขอรหัสอุปกรณ์ไม่สำเร็จ ลองใหม่อีกครั้ง');
  await step('เข้าสู่ระบบแบบไม่ระบุตัวตน', () => state.store.signIn(), 25000, onStage);
  await step('บันทึกที่เซิร์ฟเวอร์', () => state.store.saveSub({ token, places: placesPayload(places), ...roadsField(roads) }), 25000, onStage);
  ls.set(FLAG, '1');
  ls.set(TOKEN, token);
}

// Keep the server's copy of the places in step with the ones saved on the device.
export async function syncPush(places, roads = []) {
  if (!pushStatus().enabled) return;
  const token = ls.get(TOKEN);
  if (!token) return;
  if (!places.length && !roads.length) return disablePush();
  await state.store.saveSub({ token, places: placesPayload(places), ...roadsField(roads) });
}

export async function disablePush() {
  try {
    await state.store.removeSub();
  } finally {
    try {
      const [{ getApp }, { getMessaging, deleteToken }] = await Promise.all([import('firebase/app'), import('firebase/messaging')]);
      await deleteToken(getMessaging(getApp()));
    } catch {
      /* token may already be gone */
    }
    ls.set(FLAG, null);
    ls.set(TOKEN, null);
  }
}

// Does the SERVER really hold this device's subscription? (The local flag alone can be stale or wrong.)
export async function verifyPush() {
  if (!pushStatus().enabled) return null;
  try {
    const doc = await state.store.getSub();
    return !!(doc && doc.enabled && doc.token && doc.token === ls.get(TOKEN));
  } catch {
    return false;
  }
}
