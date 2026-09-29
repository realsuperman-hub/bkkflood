// Sends web-push alerts (FCM) to subscribers whose saved places just became risky.
// Runs inside the GitHub Actions job after the data snapshots are fetched.
//   node scripts/notify.mjs                         real run (needs GOOGLE_APPLICATION_CREDENTIALS)
//   node scripts/notify.mjs --dry                   read Firestore, decide, but send/write nothing
//   node scripts/notify.mjs --subs-file f.json      offline: use these subscriptions, implies --dry
import { readFile } from 'node:fs/promises';
import { evaluatePoint } from '../src/lib/evaluate-core.js';
import { inBounds } from '../src/lib/geo.js';
import { STALE_MS } from '../src/lib/thaiwater.js';
import { decide, nextState, sanitizePlaces, placeKey, buildMessage } from '../src/lib/notify-logic.js';

const arg = (n) => {
  const i = process.argv.indexOf(n);
  return i > -1 ? process.argv[i + 1] : null;
};
const subsFile = arg('--subs-file');
const dry = process.argv.includes('--dry') || !!subsFile;
const MAX_SUBS = 500; // protects the Firestore free quota if someone floods the collection
const now = Date.now();

const readJson = async (f) => JSON.parse(await readFile(f, 'utf8'));
const stations = (await readJson('public/data/stations.json').catch(() => ({ stations: [] }))).stations.map((s) => ({
  ...s,
  stale: s.t === null || now - s.t > STALE_MS,
}));
const floods = (await readJson('public/data/floods.json').catch(() => ({ floods: [] }))).floods.filter((f) => now - f.t < 24 * 3600e3);
console.log(`data: ${stations.length} stations, ${floods.length} flood complaints`);

let db = null;
let messaging = null;
let subs;
if (subsFile) {
  subs = await readJson(subsFile);
} else {
  const { initializeApp, applicationDefault } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const { getMessaging } = await import('firebase-admin/messaging');
  initializeApp({ credential: applicationDefault(), projectId: 'bkkflood-d54cc' });
  db = getFirestore();
  messaging = getMessaging();
  const snap = await db.collection('subs').where('enabled', '==', true).limit(MAX_SUBS).get();
  subs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
console.log(`subscribers: ${subs.length}${dry ? ' (dry run)' : ''}`);

const cache = new Map(); // evaluation per place (several devices often save the same spot)
function evalPlace(p) {
  const k = placeKey(p);
  if (!cache.has(k)) {
    // forecast models are ~10 km grids, so share one forecast call between nearby places
    const rainAt = [Math.round(p.lat * 10) / 10, Math.round(p.lng * 10) / 10];
    cache.set(k, evaluatePoint(p.lat, p.lng, { stations, floods, now, rainAt }));
  }
  return cache.get(k);
}

const DEAD = ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token', 'messaging/invalid-argument'];
let sent = 0;
let skipped = 0;
let removed = 0;
let failed = 0;

for (const sub of subs) {
  try {
    const places = sanitizePlaces(sub.places, inBounds);
    if (!sub.token || !places.length) continue;

    const prevState = sub.state || {};
    const results = [];
    let best = null; // the single most important alert for this device this run
    for (const p of places) {
      const ev = await evalPlace(p);
      const key = placeKey(p);
      const cur = { level: ev.risk.level, heavy: ev.nearby.heavy };
      const d = decide(prevState[key], cur, { now, lastSentAt: sub.lastSentAt || 0 });
      const r = { key, d, cur, prev: prevState[key], place: p, ev };
      results.push(r);
      if (d.notify && (!best || cur.level > best.cur.level || (cur.level === best.cur.level && cur.heavy > best.cur.heavy))) best = r;
    }

    let notified = false;
    if (best) {
      const msg = buildMessage(best.place, best.ev, best.d.kind);
      if (dry) {
        console.log(`[dry] ${sub.id}: would send "${msg.title}" — ${msg.body}`);
        notified = true;
      } else {
        try {
          await messaging.send({ token: sub.token, data: msg, webpush: { headers: { Urgency: 'high', TTL: '7200' } } });
          notified = true;
          sent++;
        } catch (e) {
          if (DEAD.includes(e.code)) {
            await db.doc(`subs/${sub.id}`).delete();
            removed++;
            console.log(`removed dead subscription ${sub.id} (${e.code})`);
            continue;
          }
          throw e;
        }
      }
    } else if (results.some((r) => r.d.suppressed)) {
      skipped++;
    }

    if (!dry) {
      const state = {};
      for (const r of results) state[r.key] = nextState(r.prev, r.cur, { notified: notified && best === r, suppressed: r.d.suppressed, now });
      await db.doc(`subs/${sub.id}`).set({ state, ...(notified ? { lastSentAt: now } : {}) }, { merge: true });
    }
  } catch (e) {
    failed++;
    console.error(`sub ${sub.id}: ${e.message}`);
  }
}
console.log(`done: sent ${sent}, cooldown-skipped ${skipped}, removed ${removed}, failed ${failed}`);
if (failed && failed === subs.length) process.exit(1);
