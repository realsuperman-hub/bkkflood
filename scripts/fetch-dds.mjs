// BMA Drainage Dept daily road-flooding report → public/data/dds.json (a past-day report, not a live feed)
import { mkdir, writeFile } from 'node:fs/promises';
import { DDS_URL, parseDdsReport } from '../src/lib/dds.js';

const res = await fetch(DDS_URL, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; BKKFLOOD/1.0; +https://bkkflood.web.app)' }, signal: AbortSignal.timeout(60000) });
if (!res.ok) throw new Error(`DDS HTTP ${res.status}`);
const report = parseDdsReport(await res.text());

await mkdir('public/data', { recursive: true });
await writeFile('public/data/dds.json', JSON.stringify({ generatedAt: Date.now(), source: 'สำนักการระบายน้ำ กรุงเทพมหานคร', ...report }));
console.log(`wrote DDS report for ${report.reportDate}: ${report.rows.length} flooded road spots (range ${report.rangeFrom} → ${report.rangeTo})`);
