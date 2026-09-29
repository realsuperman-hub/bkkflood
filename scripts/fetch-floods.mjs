// Writes public/data/floods.json — flood complaints from BMA Traffy Fondue, pre-filtered and classified.
// (Traffy's raw response is ~2 MB; visitors get ~40 KB from the CDN instead.)
import { mkdir, writeFile } from 'node:fs/promises';
import { traffyUrl, normalizeFloods } from '../src/lib/traffy.js';

const res = await fetch(traffyUrl(), { signal: AbortSignal.timeout(60000) });
if (!res.ok) throw new Error(`Traffy HTTP ${res.status}`);
const floods = normalizeFloods(await res.json());

await mkdir('public/data', { recursive: true });
await writeFile('public/data/floods.json', JSON.stringify({ generatedAt: Date.now(), source: 'Traffy Fondue (กทม.)', floods }));
const by = (l) => floods.filter((f) => f.lvl === l).length;
console.log(`wrote ${floods.length} flood complaints (heavy ${by(3)}, medium ${by(2)}, light ${by(1)})`);
