// Camera catalogue from cctv.maholan.net → data-static/maholan-cams.json (committed through the GitHub Contents API, no local git tree touched).
// Their Cloudflare front refuses GitHub's servers (HTTP 403), so this runs on the owner's PC: the Windows task (scripts/dispatch.ps1), like the BMA and
// GISTDA syncs; the workflow just copies the committed file into the site. It reads their catalogue (one request) and probes each Bangkok-area
// camera's latest frame once (5 at a time, paced) so the map only offers cameras that currently return a fresh image. Stateless: a camera that fails
// this round is left out until the next round re-probes the whole catalogue. Re-runs at most every 12 h (stamp file ~/.bkkflood/maholan.last).
//   node scripts/fetch-maholan.mjs            update the repo through `gh api`
//   node scripts/fetch-maholan.mjs --local    just write data-static/maholan-cams.json in this checkout
//   node scripts/fetch-maholan.mjs --force    ignore the 12-hour throttle
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { MAHOLAN_API, normalizeCatalog, snapUrl, frameIsUsable } from '../src/lib/maholan-cams.js';

const REPO = 'realsuperman-hub/bkkflood';
const PATH = 'data-static/maholan-cams.json';
const GH = process.env.GH_EXE || 'gh';
const local = process.argv.includes('--local');
const force = process.argv.includes('--force');
const UA = 'BKKFLOOD/1.0 (+https://bkkflood.web.app; aggasit.j@gmail.com)';
const THROTTLE_MS = 12 * 3600e3;
const CONC = 5;
const PAUSE_MS = 150;

const dir = join(homedir(), '.bkkflood');
const stamp = join(dir, 'maholan.last');
mkdirSync(dir, { recursive: true });
if (!force && existsSync(stamp) && Date.now() - statSync(stamp).mtimeMs < THROTTLE_MS) {
  console.log('maholan: probed less than 12 h ago — skipped');
  process.exit(0);
}
const touch = () => (existsSync(stamp) ? utimesSync(stamp, new Date(), new Date()) : writeFileSync(stamp, ''));

const res = await fetch(MAHOLAN_API, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
if (!res.ok) throw new Error(`catalogue HTTP ${res.status}`);
const all = normalizeCatalog((await res.json()).cameras);
if (all.length < 200) throw new Error(`only ${all.length} cameras in the Bangkok area — not updating`);

const keep = [];
const failed = {};
let next = 0;
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
const snap = { generatedAt: Date.now(), source: 'cctv.maholan.net (รวบรวมจากกล้องของหน่วยงานต่าง ๆ)', total: all.length, cams: keep };
console.log(`maholan: ${all.length} cameras in the Bangkok area → ${keep.length} returned a fresh frame; dropped ${all.length - keep.length} ${JSON.stringify(failed)}`);

const text = JSON.stringify(snap);
const strip = (o) => JSON.stringify({ ...o, generatedAt: 0 });
if (local) {
  mkdirSync('data-static', { recursive: true });
  writeFileSync(PATH, text);
  console.log(`wrote ${PATH}`);
  touch();
  process.exit(0);
}

// `input` goes through stdin: the base64 payload is far larger than Windows' ~32 KB command-line limit
const gh = (args, input) => execFileSync(GH, args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, input, stdio: ['pipe', 'pipe', 'pipe'] });
let sha;
let old = null;
try {
  const cur = JSON.parse(gh(['api', `repos/${REPO}/contents/${PATH}`]));
  sha = cur.sha;
  old = JSON.parse(Buffer.from(cur.content, 'base64').toString('utf8'));
} catch {
  /* not in the repo yet (or larger than the inline limit — then we just rewrite it) */
}
if (old && strip(old) === strip(snap)) {
  console.log('maholan: unchanged');
  touch();
  process.exit(0);
}
const body = { message: 'data: refresh the CCTV camera catalogue from a Thai network', content: Buffer.from(text).toString('base64'), branch: 'main', ...(sha ? { sha } : {}) };
gh(['api', '-X', 'PUT', `repos/${REPO}/contents/${PATH}`, '--input', '-'], JSON.stringify(body));
console.log('maholan: updated in the repo');
touch();
