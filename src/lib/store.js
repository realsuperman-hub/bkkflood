// Crowd-report storage. Two backends behind one interface:
//  - firebase: Firestore + anonymous auth (no login screen for the user)
//  - local:    localStorage demo mode when no Firebase config is present
import { firebaseConfig, appCheckSiteKey } from '../firebase-config.js';
import { unflatten } from './shape.js';

export const REPORT_TTL_H = 4; // a report disappears unless someone re-confirms it
export const WRONG_HIDE = 5; // "ข้อมูลผิด" votes needed to hide a report
export const GONE_HIDE = 3; // "น้ำลดแล้ว" votes needed to hide a report
const DOC_TTL_H = 48; // Firestore TTL policy deletes the doc after this (see README)

export const DEPTHS = {
  wet: { label: 'เปียก/น้ำขังเล็กน้อย', hint: 'ต่ำกว่าข้อเท้า', color: '#4aa3df' },
  ankle: { label: 'ระดับข้อเท้า', hint: '≈ 10–20 ซม.', color: '#2f80c8' },
  knee: { label: 'ระดับเข่า', hint: '≈ 30–50 ซม.', color: '#f28c28' },
  waist: { label: 'ระดับเอว', hint: '≈ 80–100 ซม.', color: '#d7263d' },
  above: { label: 'สูงกว่าเอว', hint: '> 100 ซม.', color: '#8b1d4a' },
};
export const PASSABLE = {
  all: 'รถเล็กผ่านได้',
  high: 'ผ่านได้เฉพาะรถสูง',
  none: 'รถผ่านไม่ได้',
};

const VOTED_KEY = 'bkkflood.voted';
const votedSet = () => {
  try {
    return new Set(JSON.parse(localStorage.getItem(VOTED_KEY) || '[]'));
  } catch {
    return new Set();
  }
};
const rememberVote = (id) => {
  try {
    const s = votedSet();
    s.add(id);
    localStorage.setItem(VOTED_KEY, JSON.stringify([...s].slice(-300)));
  } catch {
    /* storage unavailable — vote still counts server-side */
  }
};

export const isActive = (r, now = Date.now()) =>
  now - Math.max(r.createdAt, r.lastConfirmedAt) < REPORT_TTL_H * 3600e3 &&
  r.wrongCount < WRONG_HIDE &&
  r.goneCount < GONE_HIDE;

export const hasVoted = (id) => votedSet().has(id);

/* ───────────── local demo backend ───────────── */
function createLocalStore() {
  const KEY = 'bkkflood.reports';
  const PKEY = 'bkkflood.photos';
  const listeners = new Set();
  const read = (k) => {
    try {
      return JSON.parse(localStorage.getItem(k) || '{}');
    } catch {
      return {};
    }
  };
  const emit = () => {
    const all = Object.values(read(KEY));
    listeners.forEach((cb) => cb(all));
  };
  return {
    mode: 'local',
    subscribe(cb) {
      listeners.add(cb);
      cb(Object.values(read(KEY)));
      return () => listeners.delete(cb);
    },
    async create(r) {
      const id = `local-${Date.now().toString(36)}`;
      const now = Date.now();
      const reports = read(KEY);
      const photos = read(PKEY);
      reports[id] = {
        id, lat: r.lat, lng: r.lng, kind: r.kind || 'point', geom: r.geom || null, depth: r.depth, passable: r.passable, note: r.note, thumb: r.thumb,
        createdAt: now, lastConfirmedAt: now, stillCount: 0, goneCount: 0, wrongCount: 0, mine: true,
      };
      photos[id] = r.photos;
      localStorage.setItem(KEY, JSON.stringify(reports));
      localStorage.setItem(PKEY, JSON.stringify(photos));
      emit();
      return id;
    },
    async getPhotos(id) {
      return read(PKEY)[id] || [];
    },
    async saveSub() {
      throw new Error('ต้องเชื่อมฐานข้อมูลก่อนจึงจะเปิดแจ้งเตือนได้');
    },
    async signIn() {
      return null;
    },
    async removeSub() {},
    async getSub() {
      return null;
    },
    async vote(id, type) {
      if (hasVoted(id)) throw new Error('คุณโหวตรายงานนี้แล้ว');
      const reports = read(KEY);
      if (!reports[id]) throw new Error('ไม่พบรายงาน');
      reports[id][`${type}Count`] += 1;
      if (type === 'still') reports[id].lastConfirmedAt = Date.now();
      localStorage.setItem(KEY, JSON.stringify(reports));
      rememberVote(id);
      emit();
    },
  };
}

/* ───────────── Firebase backend ───────────── */
async function createFirebaseStore() {
  const [{ initializeApp }, auth, fs, appCheck] = await Promise.all([
    import('firebase/app'),
    import('firebase/auth'),
    import('firebase/firestore'),
    import('firebase/app-check'),
  ]);
  const app = initializeApp(firebaseConfig);
  // App Check must start before Auth/Firestore make their first request. It proves requests come from our real site
  // (reCAPTCHA Enterprise), so scripts cannot mass-create anonymous accounts or spam the database with the public API key.
  // If reCAPTCHA cannot load (ad-blocker, offline) we carry on: reads/writes then fail only if enforcement is on.
  try {
    if (appCheckSiteKey) {
      appCheck.initializeAppCheck(app, { provider: new appCheck.ReCaptchaEnterpriseProvider(appCheckSiteKey), isTokenAutoRefreshEnabled: true });
    }
  } catch (e) {
    console.warn('App Check init failed', e);
  }
  const db = fs.initializeFirestore(app, {
    localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
  });
  const fbAuth = auth.getAuth(app);
  let uidPromise = null;
  const ensureUid = () =>
    (uidPromise ??= new Promise((resolve, reject) => {
      const off = auth.onAuthStateChanged(fbAuth, (u) => {
        if (u) {
          off();
          resolve(u.uid);
        }
      });
      auth.signInAnonymously(fbAuth).catch((e) => {
        uidPromise = null;
        reject(e);
      });
    }));

  const ms = (t) => (t?.toMillis ? t.toMillis() : Date.now()); // pending server timestamp ≈ now
  const shape = (d, uid) => {
    const x = d.data();
    return {
      id: d.id, lat: x.lat, lng: x.lng, kind: x.kind || 'point', geom: x.geom || null, depth: x.depth, passable: x.passable, note: x.note || '',
      thumb: x.thumb, createdAt: ms(x.createdAt), lastConfirmedAt: ms(x.lastConfirmedAt),
      stillCount: x.stillCount || 0, goneCount: x.goneCount || 0, wrongCount: x.wrongCount || 0,
      mine: x.uid === uid,
    };
  };

  return {
    mode: 'firebase',
    subscribe(cb) {
      let unsub = () => {};
      let timer = null;
      const start = () => {
        unsub();
        // Only reports confirmed inside the TTL window are fetched (keeps reads — and quota — small).
        const since = fs.Timestamp.fromMillis(Date.now() - REPORT_TTL_H * 3600e3);
        const q = fs.query(
          fs.collection(db, 'reports'),
          fs.where('lastConfirmedAt', '>', since),
          fs.orderBy('lastConfirmedAt', 'desc'),
          fs.limit(400),
        );
        unsub = fs.onSnapshot(
          q,
          (snap) => cb(snap.docs.map((d) => shape(d, fbAuth.currentUser?.uid))),
          (e) => console.error('reports listener', e),
        );
      };
      start();
      timer = setInterval(start, 30 * 60 * 1000); // slide the window forward
      return () => {
        unsub();
        clearInterval(timer);
      };
    },
    async create(r) {
      const uid = await ensureUid();
      const ref = fs.doc(fs.collection(db, 'reports'));
      const batch = fs.writeBatch(db);
      batch.set(ref, {
        lat: r.lat, lng: r.lng, ...(r.kind && r.kind !== 'point' ? { kind: r.kind, geom: r.geom } : { kind: 'point' }), depth: r.depth, passable: r.passable, note: r.note, thumb: r.thumb,
        photoCount: r.photos.length, uid,
        createdAt: fs.serverTimestamp(), lastConfirmedAt: fs.serverTimestamp(),
        expiresAt: fs.Timestamp.fromMillis(Date.now() + DOC_TTL_H * 3600e3),
        stillCount: 0, goneCount: 0, wrongCount: 0,
      });
      r.photos.forEach((data, i) => batch.set(fs.doc(db, 'reports', ref.id, 'photos', String(i)), { data, uid }));
      batch.set(fs.doc(db, 'users', uid), { lastReportAt: fs.serverTimestamp() });
      await batch.commit();
      return ref.id;
    },
    async signIn() {
      return ensureUid();
    },
    async saveSub({ token, places, roads }) {
      const uid = await ensureUid();
      await fs.setDoc(fs.doc(db, 'subs', uid), { token, places, ...(roads ? { roads } : {}), enabled: true, updatedAt: fs.serverTimestamp() }, { merge: true });
    },
    async removeSub() {
      const uid = await ensureUid();
      await fs.deleteDoc(fs.doc(db, 'subs', uid));
    },
    async getSub() {
      const uid = await ensureUid();
      const snap = await fs.getDoc(fs.doc(db, 'subs', uid));
      return snap.exists() ? snap.data() : null;
    },
    async getPhotos(id) {
      const snap = await fs.getDocs(fs.collection(db, 'reports', id, 'photos'));
      return snap.docs.sort((a, b) => Number(a.id) - Number(b.id)).map((d) => d.data().data);
    },
    async vote(id, type) {
      if (hasVoted(id)) throw new Error('คุณโหวตรายงานนี้แล้ว');
      const uid = await ensureUid();
      const ref = fs.doc(db, 'reports', id);
      const batch = fs.writeBatch(db);
      batch.set(fs.doc(db, 'reports', id, 'votes', uid), { type, at: fs.serverTimestamp() });
      const upd = { [`${type}Count`]: fs.increment(1) };
      if (type === 'still') upd.lastConfirmedAt = fs.serverTimestamp();
      batch.update(ref, upd);
      try {
        await batch.commit();
      } catch (e) {
        if (e.code === 'permission-denied') {
          rememberVote(id);
          throw new Error('คุณโหวตรายงานนี้แล้ว หรือรายงานหมดอายุ');
        }
        throw e;
      }
      rememberVote(id);
    },
  };
}

export async function createStore() {
  if (!firebaseConfig) return createLocalStore();
  try {
    return await createFirebaseStore();
  } catch (e) {
    console.error('Firebase init failed, falling back to local mode', e);
    return createLocalStore();
  }
}

export const reportPoints = (r) => (r.kind && r.kind !== 'point' ? unflatten(r.geom) : [[r.lat, r.lng]]);
