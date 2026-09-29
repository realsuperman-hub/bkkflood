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

// { ok:true } or { ok:false, reason: 'ios-install' | 'unsupported' | 'no-backend' }
export function pushSupport() {
  if (state.store && state.store.mode !== 'firebase') return { ok: false, reason: 'no-backend' };
  const api = 'serviceWorker' in navigator && 'Notification' in window && 'PushManager' in window;
  if (api) return { ok: true };
  return { ok: false, reason: isIOS() && !isStandalone() ? 'ios-install' : 'unsupported' };
}

export function pushStatus() {
  const support = pushSupport();
  const permission = 'Notification' in window ? Notification.permission : 'denied';
  return { ...support, permission, enabled: support.ok && permission === 'granted' && ls.get(FLAG) === '1' };
}

const placesPayload = (places) => places.slice(0, 4).map((p) => ({ lat: +p.lat.toFixed(5), lng: +p.lng.toFixed(5), label: String(p.label).slice(0, 20) }));

async function getToken() {
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const [{ getApp }, { getMessaging, getToken: gt }] = await Promise.all([import('firebase/app'), import('firebase/messaging')]);
  return gt(getMessaging(getApp()), { serviceWorkerRegistration: reg, ...(vapidKey ? { vapidKey } : {}) });
}

export async function enablePush(places) {
  if (!places.length) throw new Error('บันทึกจุดของคุณ (บ้าน/ที่จอดรถ) ก่อน แล้วค่อยเปิดแจ้งเตือน');
  const support = pushSupport();
  if (!support.ok) throw new Error('อุปกรณ์/เบราว์เซอร์นี้ยังเปิดแจ้งเตือนไม่ได้');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('ไม่ได้รับอนุญาตให้แจ้งเตือน — เปิดสิทธิ์ในการตั้งค่าเว็บไซต์ของเบราว์เซอร์');
  const token = await getToken();
  if (!token) throw new Error('ขอรหัสอุปกรณ์ไม่สำเร็จ ลองใหม่อีกครั้ง');
  await state.store.saveSub({ token, places: placesPayload(places) });
  ls.set(FLAG, '1');
  ls.set(TOKEN, token);
}

// Keep the server's copy of the places in step with the ones saved on the device.
export async function syncPush(places) {
  if (!pushStatus().enabled) return;
  const token = ls.get(TOKEN);
  if (!token) return;
  if (!places.length) return disablePush();
  await state.store.saveSub({ token, places: placesPayload(places) });
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
