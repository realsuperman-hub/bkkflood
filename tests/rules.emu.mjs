// Firestore rules test — needs the emulator:  npm run test:rules
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, collection, writeBatch, serverTimestamp, Timestamp, increment, getDoc } from 'firebase/firestore';

const env = await initializeTestEnvironment({
  projectId: 'bkkflood-test',
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
});
const JPEG = 'data:image/jpeg;base64,' + 'A'.repeat(1000);
const report = (uid, over = {}) => ({
  lat: 13.75, lng: 100.5, depth: 'knee', passable: 'high', note: 'ทดสอบ', thumb: JPEG, photoCount: 1, uid,
  createdAt: serverTimestamp(), lastConfirmedAt: serverTimestamp(),
  expiresAt: Timestamp.fromMillis(Date.now() + 48 * 3600e3), stillCount: 0, goneCount: 0, wrongCount: 0, ...over,
});

async function create(db, uid, over = {}, { photo = JPEG, user = true } = {}) {
  const ref = doc(collection(db, 'reports'));
  const b = writeBatch(db);
  b.set(ref, report(uid, over));
  b.set(doc(db, 'reports', ref.id, 'photos', '0'), { data: photo, uid });
  if (user) b.set(doc(db, 'users', uid), { lastReportAt: serverTimestamp() });
  await b.commit();
  return ref.id;
}
async function vote(db, uid, id, type) {
  const b = writeBatch(db);
  b.set(doc(db, 'reports', id, 'votes', uid), { type, at: serverTimestamp() });
  const upd = { [`${type}Count`]: increment(1) };
  if (type === 'still') upd.lastConfirmedAt = serverTimestamp();
  b.update(doc(db, 'reports', id), upd);
  await b.commit();
}

test.beforeEach(() => env.clearFirestore());
test.after(() => env.cleanup());

test('anonymous-signed-in user can create a valid report + photo', async () => {
  const db = env.authenticatedContext('u1').firestore();
  await assertSucceeds(create(db, 'u1'));
});
test('unauthenticated cannot create; anyone can read', async () => {
  const anon = env.unauthenticatedContext().firestore();
  await assertFails(create(anon, 'u1'));
  const db = env.authenticatedContext('u1').firestore();
  const id = await create(db, 'u1');
  await assertSucceeds(getDoc(doc(anon, 'reports', id)));
});
test('rejects out-of-area, bad enum, long note, spoofed uid, missing rate stamp', async () => {
  const db = env.authenticatedContext('u1').firestore();
  await assertFails(create(db, 'u1', { lat: 35 }));
  await assertFails(create(db, 'u1', { depth: 'ocean' }));
  await assertFails(create(db, 'u1', { note: 'x'.repeat(301) }));
  await assertFails(create(db, 'u1', { uid: 'someone-else' }));
  await assertFails(create(db, 'u1', {}, { user: false }));
  await assertFails(create(db, 'u1', {}, { photo: 'data:text/html;base64,AAAA' }));
});
test('rate limit: second report within a minute is refused', async () => {
  const db = env.authenticatedContext('u1').firestore();
  await assertSucceeds(create(db, 'u1'));
  await assertFails(create(db, 'u1'));
});
test('one vote per user per report; counters must move by exactly one', async () => {
  const id = await create(env.authenticatedContext('u1').firestore(), 'u1');
  const v = env.authenticatedContext('u2').firestore();
  await assertSucceeds(vote(v, 'u2', id, 'still'));
  await assertFails(vote(v, 'u2', id, 'wrong'));
  const w = env.authenticatedContext('u3').firestore();
  const b = writeBatch(w); // cheating: +5 wrong votes
  b.set(doc(w, 'reports', id, 'votes', 'u3'), { type: 'wrong', at: serverTimestamp() });
  b.update(doc(w, 'reports', id), { wrongCount: increment(5) });
  await assertFails(b.commit());
});
test('report content cannot be edited or deleted', async () => {
  const id = await create(env.authenticatedContext('u1').firestore(), 'u1');
  const db = env.authenticatedContext('u1').firestore();
  const b = writeBatch(db);
  b.update(doc(db, 'reports', id), { depth: 'above' });
  await assertFails(b.commit());
  const d = writeBatch(db);
  d.delete(doc(db, 'reports', id));
  await assertFails(d.commit());
});

test('"gone" and "wrong" votes are accepted from different users and do not refresh the TTL', async () => {
  const id = await create(env.authenticatedContext('u1').firestore(), 'u1');
  await assertSucceeds(vote(env.authenticatedContext('u2').firestore(), 'u2', id, 'gone'));
  await assertSucceeds(vote(env.authenticatedContext('u3').firestore(), 'u3', id, 'wrong'));
});

test('drawn shapes: valid line/area accepted; malformed geometry rejected', async () => {
  const mk = () => env.authenticatedContext('u' + Math.random()).firestore();
  const ok = async (over) => { const db = mk(); const uid = db._authCredentials ? '' : ''; void uid; return db; };
  void ok;
  const attempt = async (over, expectOk) => {
    const uid = 'u' + Math.random().toString(36).slice(2);
    const db = env.authenticatedContext(uid).firestore();
    const p = create(db, uid, over);
    return expectOk ? assertSucceeds(p) : assertFails(p);
  };
  await attempt({ kind: 'point' }, true);
  await attempt({ kind: 'line', geom: [13.75, 100.5, 13.751, 100.501] }, true);
  await attempt({ kind: 'area', geom: [13.75, 100.5, 13.751, 100.501, 13.75, 100.502] }, true);
  await attempt({ kind: 'line', geom: [13.75, 100.5, 13.751] }, false); // odd length
  await attempt({ kind: 'line', geom: [13.75, 100.5] }, false); // one vertex
  await attempt({ kind: 'area', geom: [13.75, 100.5, 13.751, 100.501] }, false); // only 2 vertices
  await attempt({ kind: 'point', geom: [13.75, 100.5] }, false); // point must not carry geom
  await attempt({ kind: 'polygonx', geom: [13.75, 100.5, 13.751, 100.501] }, false);
  await attempt({ kind: 'line', geom: [40, 100.5, 13.751, 100.501] }, false); // first vertex out of area
  await attempt({ kind: 'line', geom: Array.from({ length: 82 }, () => 13.75) }, false); // > 40 vertices
  await attempt({ kind: 'line' }, false); // missing geom
});

test('push subscriptions: owner-only, validated, and clients cannot touch server-written fields', async () => {
  const { setDoc, getDoc, deleteDoc } = await import('firebase/firestore');
  const a = env.authenticatedContext('ua').firestore();
  const b = env.authenticatedContext('ub').firestore();
  const token = 'T'.repeat(60);
  const place = { lat: 13.75, lng: 100.5, label: 'บ้าน' };
  const sub = (o = {}) => ({ token, places: [place], enabled: true, updatedAt: serverTimestamp(), ...o });
  await assertSucceeds(setDoc(doc(a, 'subs', 'ua'), sub(), { merge: true })); // create
  await assertSucceeds(setDoc(doc(a, 'subs', 'ua'), sub({ places: [place, place] }), { merge: true })); // update
  await assertFails(setDoc(doc(a, 'subs', 'ub'), sub(), { merge: true })); // someone else's doc id
  await assertFails(getDoc(doc(b, 'subs', 'ua'))); // others cannot read
  await assertSucceeds(getDoc(doc(a, 'subs', 'ua')));
  await assertFails(setDoc(doc(a, 'subs', 'ua'), sub({ lastSentAt: 1 }), { merge: true })); // server-only field
  await assertFails(setDoc(doc(a, 'subs', 'ua'), sub({ state: { x: { level: 0 } } }), { merge: true }));
  await assertFails(setDoc(doc(b, 'subs', 'ub'), sub({ token: 'short' }), { merge: true }));
  await assertFails(setDoc(doc(b, 'subs', 'ub'), sub({ places: [] }), { merge: true }));
  await assertFails(setDoc(doc(b, 'subs', 'ub'), sub({ places: Array(5).fill(place) }), { merge: true }));
  await assertFails(setDoc(doc(b, 'subs', 'ub'), sub({ enabled: 'yes' }), { merge: true }));
  await assertFails(deleteDoc(doc(b, 'subs', 'ua')));
  await assertSucceeds(deleteDoc(doc(a, 'subs', 'ua')));
});

test('push subscriptions can follow up to 5 roads (validated); a road-only device is allowed, an empty one is not', async () => {
  const { setDoc } = await import('firebase/firestore');
  const a = env.authenticatedContext('ra').firestore();
  const road = { name: 'ถนนรามคำแหง', min: 20 };
  const sub = (over = {}) => ({ token: 'T'.repeat(40), places: [], enabled: true, updatedAt: serverTimestamp(), ...over });
  await assertSucceeds(setDoc(doc(a, 'subs', 'ra'), sub({ roads: [road] }), { merge: true })); // roads only
  await assertSucceeds(setDoc(doc(a, 'subs', 'ra'), sub({ roads: Array(5).fill(road) }), { merge: true }));
  await assertSucceeds(setDoc(doc(a, 'subs', 'ra'), sub({ places: [{ lat: 13.7, lng: 100.5, label: 'บ้าน' }], roads: [] }), { merge: true })); // cleared roads, one place
  await assertFails(setDoc(doc(a, 'subs', 'ra'), sub({ roads: Array(6).fill(road) }), { merge: true })); // too many
  await assertFails(setDoc(doc(a, 'subs', 'ra'), sub({ roads: [{ name: 'x', min: 500 }] }), { merge: true })); // threshold out of range
  await assertFails(setDoc(doc(a, 'subs', 'ra'), sub({ roads: [{ name: '', min: 20 }] }), { merge: true })); // empty name
  await assertFails(setDoc(doc(a, 'subs', 'ra'), sub({ roads: [{ name: 'x', min: 20, extra: 1 }] }), { merge: true })); // unknown field
  await assertFails(setDoc(doc(a, 'subs', 'ra'), sub({ roads: 'ถนน' }), { merge: true })); // not a list
  await assertFails(setDoc(doc(a, 'subs', 'ra'), sub({ rstate: { x: { on: true } } }), { merge: true })); // notifier-only field
  const b = env.authenticatedContext('rb').firestore();
  await assertFails(setDoc(doc(b, 'subs', 'rb'), sub({ places: [], roads: [] }), { merge: true })); // nothing to alert on
});

test('reports can be created in the eastern provinces (service area widened) but not outside it', async () => {
  const a = env.authenticatedContext('ea').firestore();
  await assertSucceeds(create(a, 'ea', { lat: 12.68, lng: 101.28 })); // Rayong
  const b = env.authenticatedContext('eb').firestore();
  await assertFails(create(b, 'eb', { lat: 12.2, lng: 101.28 })); // south of the area
  const c = env.authenticatedContext('ec').firestore();
  await assertFails(create(c, 'ec', { lat: 13.7, lng: 102.5 })); // east of the area
});
