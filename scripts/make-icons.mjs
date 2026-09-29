// Generates the PWA / home-screen icons from the chosen logo (option B: house in rising flood water).
// Run: node scripts/make-icons.mjs   → public/icons/*.png
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';

const NAVY = '#0B3D5C';
const art = (scale) => `
  <g transform="translate(32 32) scale(${scale}) translate(-32 -32)">
    <path d="M32 9 L53 27 H47.5 V46 H16.5 V27 H11 Z" fill="#FFFFFF"/>
    <rect x="28" y="31" width="8" height="15" rx="1.5" fill="${NAVY}"/>
    <path d="M-16 40 q8 -6.5 16 0 t16 0 t16 0 t16 0 t16 0 t16 0 V96 H-16 Z" fill="#3BB4F2"/>
    <path d="M-16 48.5 q8 -6 16 0 t16 0 t16 0 t16 0 t16 0 t16 0 V96 H-16 Z" fill="#1683C9"/>
  </g>`;
// Full-bleed square: iOS/Android apply their own corner mask. `scale` < 1 keeps the art inside the maskable safe zone.
const svg = (scale) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${NAVY}"/>${art(scale)}</svg>`;

const jobs = [
  ['icon-192.png', 192, 1],
  ['icon-512.png', 512, 1],
  ['icon-maskable-512.png', 512, 0.78],
  ['apple-touch-icon.png', 180, 1],
];
await mkdir('public/icons', { recursive: true });
for (const [name, size, scale] of jobs) {
  await sharp(Buffer.from(svg(scale)), { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toFile(`public/icons/${name}`);
  console.log('wrote', name);
}
await writeFile('public/icons/icon-source.svg', svg(1));
