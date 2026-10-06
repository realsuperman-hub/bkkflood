// TMD weather warnings → public/data/tmd-warnings.json (see src/lib/tmd.js). Runs in the Actions job; if TMD cannot be reached from there,
// the workflow falls back to data-static/tmd-warnings.json, which the Thai-network sync job keeps current.
import { mkdir, writeFile } from 'node:fs/promises';
import { loadWarnings } from '../src/lib/tmd.js';
import { httpsText } from './https-text.mjs';

const out = await loadWarnings((url) => httpsText(url));
await mkdir('public/data', { recursive: true });
await writeFile('public/data/tmd-warnings.json', JSON.stringify(out));
console.log(`tmd: ${out.warnings.length} current warning(s) of ${out.listed} listed${out.warnings.some((w) => w.bangkok) ? ' — names Bangkok' : ''}`);
