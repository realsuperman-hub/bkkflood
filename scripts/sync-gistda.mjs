// GISTDA satellite flood extent → data-static/gistda-flood.json (committed through the GitHub Contents API, no local git tree touched).
// GISTDA's gateway refuses connections from GitHub's servers, so this runs on a Thai network: the Windows task on the owner's PC
// (scripts/dispatch.ps1). The API key is NEVER in the repo: it comes from the env var GISTDA_API_KEY or the file ~/.bkkflood/gistda.key.
// The satellite passes only every few days, so it re-fetches at most every 3 hours (the stamp file ~/.bkkflood/gistda.last), and a commit
// is made only when the content changed.
//   node scripts/sync-gistda.mjs            update the repo through `gh api`
//   node scripts/sync-gistda.mjs --local    just write data-static/gistda-flood.json in this checkout
//   node scripts/sync-gistda.mjs --force    ignore the 3-hour throttle
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { aggregateFlood, PROVINCES } from '../src/lib/gistda-flood.js';

const REPO = 'realsuperman-hub/bkkflood';
const PATH = 'data-static/gistda-flood.json';
const GH = process.env.GH_EXE || 'gh';
const local = process.argv.includes('--local');
const force = process.argv.includes('--force');
const API = 'https://api-gateway.gistda.or.th/api/2.0/resources/features/flood/7days';
const PAGE = 2000;
const THROTTLE_MS = 3 * 3600e3;

const dir = join(homedir(), '.bkkflood');
const stamp = join(dir, 'gistda.last');
const key = (process.env.GISTDA_API_KEY || (existsSync(join(dir, 'gistda.key')) ? readFileSync(join(dir, 'gistda.key'), 'utf8') : '')).trim();
if (!key) {
  console.error('gistda: no API key (env GISTDA_API_KEY or ~/.bkkflood/gistda.key)');
  process.exit(1);
}
if (!force && existsSync(stamp) && Date.now() - statSync(stamp).mtimeMs < THROTTLE_MS) {
  console.log('gistda: fetched less than 3 h ago — skipped');
  process.exit(0);
}

const page = async (pv, offset) => {
  const res = await fetch(`${API}?pv_idn=${pv}&limit=${PAGE}&offset=${offset}`, { headers: { 'API-Key': key, accept: 'application/json' }, signal: AbortSignal.timeout(90000) });
  if (!res.ok) throw new Error(`GISTDA HTTP ${res.status} (province ${pv})`); // never print the response: it carries the key inside its links
  return (await res.json()).features || [];
};

const byProvince = {};
for (const pv of Object.keys(PROVINCES)) {
  const all = [];
  for (let off = 0; ; off += PAGE) {
    const feats = await page(pv, off);
    all.push(...feats);
    if (feats.length < PAGE) break;
  }
  byProvince[pv] = all;
}
const snap = aggregateFlood(byProvince);
const total = snap.provinces.reduce((s, p) => s + p.polygons, 0);
if (Object.keys(byProvince).length !== Object.keys(PROVINCES).length) throw new Error('gistda: a province is missing — not updating');
console.log(`gistda: ${total} flood hexagons → ${snap.cells.length} cells, last satellite pass ${snap.lastPass ?? '—'}; ` + snap.provinces.map((p) => `${p.name} ${p.rai.toLocaleString('en')} rai`).join(', '));

const text = JSON.stringify(snap);
const strip = (o) => JSON.stringify({ ...o, generatedAt: 0 });
mkdirSync(dir, { recursive: true });
const touch = () => (existsSync(stamp) ? utimesSync(stamp, new Date(), new Date()) : writeFileSync(stamp, ''));

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
  /* not in the repo yet */
}
if (old && strip(old) === strip(snap)) {
  console.log('gistda: unchanged');
  touch();
  process.exit(0);
}
const body = { message: 'data: refresh GISTDA satellite flood from a Thai network', content: Buffer.from(text).toString('base64'), branch: 'main', ...(sha ? { sha } : {}) };
gh(['api', '-X', 'PUT', `repos/${REPO}/contents/${PATH}`, '--input', '-'], JSON.stringify(body));
console.log('gistda: updated in the repo');
touch();
