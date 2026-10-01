// maholan's AI flood verdicts → data-static/maholan-ai.json (committed through the GitHub Contents API). Their Cloudflare front refuses GitHub's servers and
// sends no CORS headers to browsers, so this runs on the owner's PC with the other syncs (scripts/dispatch.ps1, every 15 min). Only the few real
// positives are kept (see src/lib/maholan-ai.js). A commit is made when the flagged set changes, plus a heartbeat every 2 h so the site can tell the
// PC is alive (it ignores a file older than 4 h).
//   node scripts/sync-maholan-ai.mjs            update the repo through `gh api`
//   node scripts/sync-maholan-ai.mjs --local    just write data-static/maholan-ai.json in this checkout
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { normalizeAi } from '../src/lib/maholan-ai.js';

const REPO = 'realsuperman-hub/bkkflood';
const PATH = 'data-static/maholan-ai.json';
const GH = process.env.GH_EXE || 'gh';
const local = process.argv.includes('--local');
const UA = 'BKKFLOOD/1.0 (+https://bkkflood.web.app; aggasit.j@gmail.com)';
const HEARTBEAT_MS = 2 * 3600e3;

const res = await fetch('https://cctv.maholan.net/api/detections', { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
if (!res.ok) throw new Error(`detections HTTP ${res.status}`);
const ai = normalizeAi(await res.json());
const snap = { generatedAt: Date.now(), source: 'AI ของ cctv.maholan.net (อ่านภาพกล้องอัตโนมัติ ยังไม่ผ่านการยืนยัน)', ...ai };
console.log(`maholan-ai: ${ai.flags.length} cameras flagged (scanned ${ai.scanned}/${ai.total || '?'})`);
const text = JSON.stringify(snap);
const sig = (o) => JSON.stringify((o.flags || []).map((f) => [f.id, f.level]));

// (no process.exit: on Windows it can trip a libuv assertion while the fetch's sockets are still closing)
if (local) {
  mkdirSync('data-static', { recursive: true });
  writeFileSync(PATH, text);
  console.log(`wrote ${PATH}`);
} else {
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
  if (old && sig(old) === sig(snap) && Date.now() - (old.generatedAt || 0) < HEARTBEAT_MS) {
    console.log('maholan-ai: unchanged');
  } else {
    const body = { message: 'data: refresh the AI flood flags from a Thai network', content: Buffer.from(text).toString('base64'), branch: 'main', ...(sha ? { sha } : {}) };
    gh(['api', '-X', 'PUT', `repos/${REPO}/contents/${PATH}`, '--input', '-'], JSON.stringify(body));
    console.log('maholan-ai: updated in the repo');
  }
}
