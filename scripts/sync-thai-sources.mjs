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
import { DAM_API, normalizeDams } from '../src/lib/dams.js';
import { loadWarnings } from '../src/lib/tmd.js';
import { TIDE_TABLE_URL, TIDE_STATION, parseTideTable } from '../src/lib/tide-table.js';
import { httpsText } from './https-text.mjs';

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

try {
  const bkk = (off) => new Date(Date.now() + 7 * 3600e3 - off * 86400e3).toISOString().slice(0, 10);
  const day = async (d) => {
    const j = JSON.parse(await page(`${DAM_API}/${d}`));
    return Array.isArray(j.data) && j.data.length ? j : null;
  };
  let latest = null;
  let off = 0;
  for (; off < 3 && !latest; off++) latest = await day(bkk(off));
  if (!latest) throw new Error('no report in the last 3 days');
  jobs.push(['dams', { generatedAt: Date.now(), source: 'กรมชลประทาน (ศูนย์ปฏิบัติการน้ำอัจฉริยะ) — API อ่างเก็บน้ำขนาดใหญ่', ...normalizeDams(latest, await day(bkk(off))) }]);
} catch (e) {
  console.error('dams:', e.message);
}

// TMD warnings: the workflow fetches them itself; this copy is the fallback if TMD refuses GitHub's servers
try {
  const tmd = await loadWarnings((url) => httpsText(url));
  jobs.push(['tmd-warnings', tmd]);
} catch (e) {
  console.error('tmd-warnings:', e.message);
}
// Official tide table (about a year ahead), so a copy refreshed whenever this PC is on is always good enough
try {
  jobs.push(['tide-table', { generatedAt: Date.now(), source: 'กรมอุทกศาสตร์ กองทัพเรือ (ตารางน้ำทำนาย ผ่าน สสน./HII)', station: TIDE_STATION, ...parseTideTable(await page(TIDE_TABLE_URL)) }]);
} catch (e) {
  console.error('tide-table:', e.message);
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
  // unchanged content is not committed, except once a day: the file's own timestamp is what the app's status page reads to tell "checked, same" from "source gone"
  if (old && strip(old) === strip(obj) && Date.now() - (old.generatedAt || 0) < 24 * 3600e3) {
    console.log(`${name}: unchanged`);
    continue;
  }
  const body = { message: `data: refresh ${name} from a Thai network`, content: Buffer.from(text).toString('base64'), branch: 'main', ...(sha ? { sha } : {}) };
  gh(['api', '-X', 'PUT', `repos/${REPO}/contents/${path}`, '--input', '-'], JSON.stringify(body));
  console.log(`${name}: updated in the repo`);
}
if (!jobs.length) process.exit(1);
