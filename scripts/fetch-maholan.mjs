// Camera catalogue from cctv.maholan.net → public/data/maholan-cams.json. Reuses the live copy for 12 h; otherwise reads their catalogue (one request) and
// probes each Bangkok-area camera's latest frame once (3 at a time, paced) so the map only offers cameras that currently return a fresh image.
// Stateless: a camera that fails this round is simply left out until the next round re-probes the whole catalogue.
import { mkdir, writeFile } from 'node:fs/promises';
import { MAHOLAN_API, normalizeCatalog, snapUrl, frameIsUsable } from '../src/lib/maholan-cams.js';

const OUT = 'public/data/maholan-cams.json';
const LIVE = 'https://bkkflood.web.app/data/maholan-cams.json';
const MAX_AGE_MS = 12 * 3600e3;
const UA = 'BKKFLOOD/1.0 (+https://bkkflood.web.app; aggasit.j@gmail.com)';
const CONC = 3;
const PAUSE_MS = 250;

await mkdir('public/data', { recursive: true });
try {
  const res = await fetch(LIVE, { signal: AbortSignal.timeout(15000) });
  if (res.ok) {
    const cur = await res.json();
    if (process.env.MAHOLAN_FORCE !== 'true' && cur?.generatedAt && Date.now() - cur.generatedAt < MAX_AGE_MS) {
      await writeFile(OUT, JSON.stringify(cur));
      console.log(`maholan: live copy is ${Math.round((Date.now() - cur.generatedAt) / 3600e3)} h old — reused, no requests to their server`);
      process.exit(0);
    }
  }
} catch {
  /* no live copy yet */
}

const res = await fetch(MAHOLAN_API, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
if (!res.ok) throw new Error(`catalogue HTTP ${res.status}`);
const all = normalizeCatalog((await res.json()).cameras);
if (all.length < 200) throw new Error(`only ${all.length} cameras in the Bangkok area — not updating`);

const keep = [];
let next = 0;
const failed = {};
async function worker() {
  while (next < all.length) {
    const c = all[next++];
    let ok = false;
    try {
      const r = await fetch(snapUrl(c.id), { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(25000) });
      const bytes = r.ok ? (await r.arrayBuffer()).byteLength : 0;
      ok = frameIsUsable({ status: r.status, bytes, imageTime: r.headers.get('x-image-time') });
      if (!ok) failed[r.status] = (failed[r.status] || 0) + 1;
    } catch (e) {
      failed[e.name] = (failed[e.name] || 0) + 1;
    }
    if (ok) keep.push(c);
    await new Promise((r) => setTimeout(r, PAUSE_MS));
  }
}
await Promise.all(Array.from({ length: CONC }, worker));

// a bad round (their server down) must not wipe the map: keep the previous copy instead
if (keep.length < all.length * 0.3) throw new Error(`only ${keep.length}/${all.length} cameras answered — keeping the previous list`);
keep.sort((a, b) => a.id.localeCompare(b.id));
await writeFile(OUT, JSON.stringify({ generatedAt: Date.now(), source: 'cctv.maholan.net (รวบรวมจากกล้องของหน่วยงานต่าง ๆ)', total: all.length, cams: keep }));
console.log(`maholan: ${all.length} cameras in the Bangkok area → ${keep.length} returned a fresh frame; dropped ${all.length - keep.length} ${JSON.stringify(failed)}`);
