// Sends web-push alerts (FCM) to subscribers whose saved places just became risky.
// Runs inside the GitHub Actions job after the data snapshots are fetched.
//   node scripts/notify.mjs                         real run (needs GOOGLE_APPLICATION_CREDENTIALS)
//   node scripts/notify.mjs --dry                   read Firestore, decide, but send/write nothing
//   node scripts/notify.mjs --subs-file f.json      offline: use these subscriptions, implies --dry
import { readFile } from 'node:fs/promises';
import { evaluatePoint } from '../src/lib/evaluate-core.js';
import { inBounds } from '../src/lib/geo.js';
import { STALE_MS } from '../src/lib/thaiwater.js';
import { RAIN_STALE_MS } from '../src/lib/rain-obs.js';
import { distKm } from '../src/lib/geo.js';
import { decide, nextState, sanitizePlaces, placeKey, buildMessage, heaviestNearbyRain } from '../src/lib/notify-logic.js';
import { sanitizeRoads, roadKey, currentRoad, decideRoad, nextRoadState, buildRoadMessage, SNAPSHOT_MAX_AGE_MS } from '../src/lib/notify-roads.js';

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
const rainObs = (await readJson('public/data/rain.json').catch(() => ({ gauges: [] }))).gauges.map((g) => ({ ...g, stale: g.t === null || now - g.t > RAIN_STALE_MS }));
const tideTable = await readJson('public/data/tide-table.json').catch(() => null); // official tide table (data-static copy); null → tide reported missing
const events = (await readJson('public/data/traffic-events.json').catch(() => ({ events: [] }))).events;
const roadSnap = await readJson('public/data/road-flood.json').catch(() => null);
const popSnap = await readJson('public/data/popnix.json').catch(() => null); // BMA road-depth sensors + canal gauges (POPNIX Flood)
const estFresh = !!roadSnap?.features && now - (roadSnap.generatedAt || 0) < SNAPSHOT_MAX_AGE_MS; // an old snapshot never triggers a road alert
const sensorsFresh = Array.isArray(popSnap?.roads) && now - (popSnap.generatedAt || 0) < SNAPSHOT_MAX_AGE_MS;
const roadsFresh = estFresh || sensorsFresh;
console.log(`data: ${stations.length} stations, ${floods.length} flood complaints, ${rainObs.length} rain gauges, ${roadSnap?.features?.length ?? 0} flooded road segments${estFresh ? '' : ' (estimate missing/old)'}, ${popSnap?.roads?.length ?? 0} depth sensors${sensorsFresh ? '' : ' (sensors missing/old)'}${roadsFresh ? '' : ' — road alerts paused'}`);

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
    cache.set(k, evaluatePoint(p.lat, p.lng, { stations, floods, rainObs, events, now, rainAt, tideTable }));
  }
  return cache.get(k);
}

// invalid-argument is ALSO what a malformed payload returns, so only treat it as a dead token when the message says so —
// otherwise one bug in our payload would delete every real subscription.
const isDeadToken = (e) =>
  ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(e.code) ||
  (e.code === 'messaging/invalid-argument' && /registration token/i.test(e.message || ''));
let sent = 0;
let skipped = 0;
let removed = 0;
let failed = 0;

for (const sub of subs) {
  try {
    const places = sanitizePlaces(sub.places, inBounds);
    const roads = sanitizeRoads(sub.roads);
    if (!sub.token || (!places.length && !roads.length)) continue;

    const prevState = sub.state || {};
    const results = [];
    let best = null; // the single most important alert for this device this run
    for (const p of places) {
      const ev = await evalPlace(p);
      const key = placeKey(p);
      const rainG = heaviestNearbyRain(rainObs, p.lat, p.lng, distKm);
      const cur = { level: ev.risk.level, heavy: ev.nearby.heavy, rain: rainG?.r1 ?? 0, rainG };
      const d = decide(prevState[key], cur, { now, lastSentAt: sub.lastSentAt || 0 });
      const r = { key, d, cur, prev: prevState[key], place: p, ev };
      results.push(r);
      const rank = (x) => [x.cur.level, x.cur.heavy, x.cur.rain];
      const worse = (a, b) => { const A = rank(a), B = rank(b); for (let i = 0; i < A.length; i++) if (A[i] !== B[i]) return A[i] > B[i]; return false; };
      if (d.notify && (!best || worse(r, best))) best = r;
    }

    let notified = false;
    if (best) {
      const msg = buildMessage(best.place, best.ev, best.d.kind, best.cur.rainG);
      if (dry) {
        console.log(`[dry] ${sub.id}: would send "${msg.title}" — ${msg.body}`);
        notified = true;
      } else {
        try {
          await messaging.send({ token: sub.token, data: msg, webpush: { headers: { Urgency: 'high', TTL: '7200' } } });
          notified = true;
          sent++;
        } catch (e) {
          if (isDeadToken(e)) {
            await db.doc(`subs/${sub.id}`).delete();
            removed++;
            console.log(`removed dead subscription ${sub.id} (${e.code}: ${String(e.message).slice(0, 120)})`);
            continue;
          }
          throw e;
        }
      }
    } else if (results.some((r) => r.d.suppressed)) {
      skipped++;
    }

    // followed roads: at most one road push per device per run, and none in a run that already sent a place alert (it fires next run instead)
    const rstate = {};
    let roadSent = false;
    if (roadsFresh && roads.length) {
      const rprev = sub.rstate || {};
      const rres = roads.map((r) => {
        const cur = currentRoad(estFresh ? roadSnap.features : [], r.name, { sensors: sensorsFresh ? popSnap.roads : null, now });
        const key = roadKey(r.name);
        const d = decideRoad(rprev[key], cur, { now, min: r.min, lastRoadSentAt: sub.lastRoadSentAt || 0 });
        return { r, cur, key, d };
      });
      const cand = rres.filter((x) => x.d.notify).sort((a, b) => (b.cur.closed - a.cur.closed) || b.cur.depth - a.cur.depth)[0];
      const send = cand && !notified;
      if (send) {
        const msg = buildRoadMessage(cand.r.name, cand.cur, cand.r.min);
        if (dry) {
          console.log(`[dry] ${sub.id}: would send road alert "${msg.title}" — ${msg.body}`);
          roadSent = true;
        } else {
          try {
            await messaging.send({ token: sub.token, data: msg, webpush: { headers: { Urgency: 'high', TTL: '7200' } } });
            roadSent = true;
            sent++;
          } catch (e) {
            if (isDeadToken(e)) {
              await db.doc(`subs/${sub.id}`).delete();
              removed++;
              console.log(`removed dead subscription ${sub.id} (${e.code})`);
              continue;
            }
            throw e;
          }
        }
      }
      for (const x of rres) {
        const waiting = x.d.notify && !(send && x === cand); // wanted to notify but another push went first this run
        rstate[x.key] = nextRoadState(rprev[x.key], x.cur, { notified: send && x === cand && roadSent, suppressed: !!x.d.suppressed || waiting, now, min: x.r.min });
      }
    }

    if (!dry) {
      const state = {};
      for (const r of results) state[r.key] = nextState(r.prev, r.cur, { notified: notified && best === r, suppressed: r.d.suppressed || (r.d.notify && best !== r), now });
      await db.doc(`subs/${sub.id}`).set({ state, ...(Object.keys(rstate).length ? { rstate } : {}), ...(notified ? { lastSentAt: now } : {}), ...(roadSent ? { lastRoadSentAt: now } : {}) }, { merge: true });
    }
  } catch (e) {
    failed++;
    console.error(`sub ${sub.id}: ${e.message}`);
  }
}
console.log(`done: sent ${sent}, cooldown-skipped ${skipped}, removed ${removed}, failed ${failed}`);
if (failed && failed === subs.length) process.exit(1);
