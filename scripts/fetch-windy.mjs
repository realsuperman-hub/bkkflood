// Thai webcams from the Windy Webcams API (key = env WINDY_API_KEY) → public/data/windy-cams.json. Metadata only (no image URLs: they expire in
// 15 min). Reuses the live copy for 12 h, so a normal day costs one pass of ~6 requests.
import { mkdir, writeFile } from 'node:fs/promises';
import { normalizeWebcams } from '../src/lib/windy-cams.js';

const KEY = process.env.WINDY_API_KEY;
const OUT = 'public/data/windy-cams.json';
const LIVE = 'https://bkkflood.web.app/data/windy-cams.json';
const MAX_AGE_MS = 12 * 3600e3;
const BASE = 'https://api.windy.com/webcams/api/v3/webcams';

await mkdir('public/data', { recursive: true });
try {
  const res = await fetch(LIVE, { signal: AbortSignal.timeout(15000) });
  if (res.ok) {
    const cur = await res.json();
    if (process.env.WINDY_FORCE !== 'true' && cur?.generatedAt && Date.now() - cur.generatedAt < MAX_AGE_MS) {
      await writeFile(OUT, JSON.stringify(cur));
      console.log(`windy: live copy is ${Math.round((Date.now() - cur.generatedAt) / 3600e3)} h old — reused, no API call`);
      process.exit(0);
    }
  }
} catch {
  /* no live copy yet */
}
if (!KEY) {
  console.log('windy: no WINDY_API_KEY — nothing to do');
  process.exit(1);
}

const all = [];
for (let off = 0; off < 1000; off += 50) {
  const res = await fetch(`${BASE}?countries=TH&limit=50&offset=${off}&include=location,player,urls`, { headers: { 'x-windy-api-key': KEY, accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Windy API ${res.status}: ${j.message || j.error || 'error'}`); // never print the request (it carries the key header only, but be safe)
  all.push(...(j.webcams || []));
  if (all.length >= (j.total || 0) || !(j.webcams || []).length) break;
}
const cams = normalizeWebcams(all);
if (cams.length < 20) throw new Error(`only ${cams.length} usable webcams — not updating`);
await writeFile(OUT, JSON.stringify({ generatedAt: Date.now(), source: 'Windy.com Webcams', cams }));
console.log(`windy: ${all.length} Thai webcams from the API → ${cams.length} with an embeddable timelapse player (${cams.filter((c) => c.lat > 13.4 && c.lat < 14.2 && c.lng > 100.2 && c.lng < 101).length} in the Bangkok area)`);

// can the player be framed in a page? (X-Frame-Options / frame-ancestors) — printed once so we know before building the UI
try {
  const p = await fetch(cams[0].day, { method: 'GET', signal: AbortSignal.timeout(20000) });
  console.log(`windy player check: HTTP ${p.status} · x-frame-options: ${p.headers.get('x-frame-options') || 'none'} · csp frame-ancestors: ${(p.headers.get('content-security-policy') || '').match(/frame-ancestors[^;]*/)?.[0] || 'none'}`);
} catch (e) {
  console.log(`windy player check failed: ${e.message}`);
}
