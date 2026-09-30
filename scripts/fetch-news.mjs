// Flood headlines from Thai outlets' public RSS feeds → public/data/news.json (headline + link + outlet only).
import { mkdir, writeFile } from 'node:fs/promises';
import { FEEDS, parseRss, collectNews } from '../src/lib/news.js';

const UA = 'Mozilla/5.0 (compatible; BKKFLOOD/1.0; +https://bkkflood.web.app)';
const results = await Promise.allSettled(
  FEEDS.map(async (f) => {
    const res = await fetch(f.url, { headers: { 'user-agent': UA, accept: 'application/rss+xml, application/xml, text/xml' }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`${f.id} HTTP ${res.status}`);
    return { source: f.name, sourceId: f.id, entries: parseRss(await res.text()) };
  }),
);
const ok = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
results.filter((r) => r.status === 'rejected').forEach((r) => console.error(`news feed failed: ${r.reason.message}`));
if (!ok.length) throw new Error('no news feed could be read');

const items = collectNews(ok);
await mkdir('public/data', { recursive: true });
await writeFile('public/data/news.json', JSON.stringify({ generatedAt: Date.now(), sources: ok.map((f) => f.source), items }));
console.log(`wrote ${items.length} flood headlines from ${ok.length}/${FEEDS.length} feeds (${items.filter((i) => i.metro).length} mention Bangkok/metro)`);
