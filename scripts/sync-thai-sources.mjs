// Two BMA sources refuse connections from GitHub's (US) servers: the camera list page (HTTP 403) and dds.bangkok.go.th (timeout).
// This script runs on a Thai network (the Windows task on the owner's PC), fetches them, and stores the result in the repo under
// data-static/ via the GitHub Contents API — no local git working tree is touched. The workflow copies data-static/ into the site.
// A commit is made only when the CONTENT changed (timestamps ignored), so most runs do nothing.
//   node scripts/sync-thai-sources.mjs           update the repo through `gh api`
//   node scripts/sync-thai-sources.mjs --local   just write data-static/*.json in this checkout
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { BMA_PAGE, parseCameras } from '../src/lib/bma-traffic.js';
import { DDS_URL, parseDdsReport } from '../src/lib/dds.js';

const REPO = 'realsuperman-hub/bkkflood';
const GH = process.env.GH_EXE || 'gh';
const local = process.argv.includes('--local');
const UA = 'Mozilla/5.0 (compatible; BKKFLOOD/1.0; +https://bkkflood.web.app)';

const page = async (url) => {
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${new URL(url).host}`);
  return res.text();
};
// `input` goes through stdin: the base64 payload is far larger than Windows' ~32 KB command-line limit
const gh = (args, input) => execFileSync(GH, args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, input, stdio: ['pipe', 'pipe', 'pipe'] });
const strip = (o) => JSON.stringify({ ...o, generatedAt: 0 });

const jobs = [];
try {
  const cameras = parseCameras(await page(BMA_PAGE));
  if (cameras.length < 100) throw new Error(`only ${cameras.length} cameras`);
  jobs.push(['cameras', { generatedAt: Date.now(), source: 'กทม. — ระบบกล้องโทรทัศน์วงจรปิดและรายงานสภาพการจราจร', cameras }]);
} catch (e) {
  console.error('cameras:', e.message);
}
try {
  jobs.push(['dds', { generatedAt: Date.now(), source: 'สำนักการระบายน้ำ กรุงเทพมหานคร', ...parseDdsReport(await page(DDS_URL)) }]);
} catch (e) {
  console.error('dds:', e.message);
}

for (const [name, obj] of jobs) {
  const path = `data-static/${name}.json`;
  const text = JSON.stringify(obj);
  if (local) {
    await mkdir('data-static', { recursive: true });
    await writeFile(path, text);
    console.log(`wrote ${path}`);
    continue;
  }
  let sha;
  let old = null;
  try {
    const cur = JSON.parse(gh(['api', `repos/${REPO}/contents/${path}`]));
    sha = cur.sha;
    old = JSON.parse(Buffer.from(cur.content, 'base64').toString('utf8'));
  } catch {
    /* file does not exist yet */
  }
  if (old && strip(old) === strip(obj)) {
    console.log(`${name}: unchanged`);
    continue;
  }
  const body = { message: `data: refresh ${name} from a Thai network`, content: Buffer.from(text).toString('base64'), branch: 'main', ...(sha ? { sha } : {}) };
  gh(['api', '-X', 'PUT', `repos/${REPO}/contents/${path}`, '--input', '-'], JSON.stringify(body));
  console.log(`${name}: updated in the repo`);
}
if (!jobs.length) process.exit(1);
