// Generates public/og.png (1200x630) — the preview card shown when the link is shared on LINE / Facebook / Messenger.
// Run: node scripts/make-og.mjs   (uses a Thai-capable system font: Leelawadee UI / Tahoma on Windows)
import sharp from 'sharp';

const NAVY = '#0B3D5C';
const FONT = `'Leelawadee UI','Tahoma','Noto Sans Thai','Sarabun',sans-serif`;
// Thai glyphs are narrower than Latin ones, so size each pill from the character count and lay a row out left to right
const rowOfChips = (y, labels) => {
  let x = 70;
  return labels
    .map((text) => {
      const w = text.length * 14 + 52;
      const g = `<g transform="translate(${x} ${y})"><rect width="${w}" height="52" rx="26" fill="rgba(255,255,255,.14)"/><text x="26" y="35" font-size="26" fill="#EAF6FF" font-family="${FONT}">${text}</text></g>`;
      x += w + 22;
      return g;
    })
    .join('');
};

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs><clipPath id="logoClip"><rect width="64" height="64" rx="15"/></clipPath><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0d4a70"/><stop offset="1" stop-color="#082b42"/></linearGradient></defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <path d="M0 520 q75 -34 150 0 t150 0 t150 0 t150 0 t150 0 t150 0 t150 0 t150 0 V630 H0 Z" fill="#3BB4F2" opacity=".9"/>
  <path d="M0 572 q75 -30 150 0 t150 0 t150 0 t150 0 t150 0 t150 0 t150 0 t150 0 V630 H0 Z" fill="#1683C9"/>
  <g transform="translate(70 70) scale(3.3)"><rect width="64" height="64" rx="15" fill="${NAVY}"/><g clip-path="url(#logoClip)">
    <path d="M32 9 L53 27 H47.5 V46 H16.5 V27 H11 Z" fill="#fff"/><rect x="28" y="31" width="8" height="15" rx="1.5" fill="${NAVY}"/>
    <path d="M0 40 q8 -6.5 16 0 t16 0 t16 0 t16 0 V64 H0 Z" fill="#3BB4F2" opacity=".95"/><path d="M0 48.5 q8 -6 16 0 t16 0 t16 0 t16 0 V64 H0 Z" fill="#1683C9"/></g><rect width="64" height="64" rx="15" fill="none" stroke="#ffffff" stroke-opacity=".3" stroke-width="1"/></g>
  <text x="325" y="150" font-size="96" font-weight="700" fill="#fff" font-family="${FONT}" letter-spacing="2">BKK<tspan fill="#5cc8ff">FLOOD</tspan></text>
  <text x="325" y="215" font-size="42" fill="#EAF6FF" font-family="${FONT}">จุดน้ำท่วม กทม. และปริมณฑล ตอนนี้</text>
  <text x="70" y="335" font-size="34" fill="#ffffff" font-family="${FONT}">เช็กก่อนเดินทาง · รู้ก่อนน้ำมา</text>
  ${rowOfChips(370, ['แผนที่จุดท่วมจริง', 'ระดับน้ำ + ฝนจริง', 'พยากรณ์ 48 ชม.'])}
  ${rowOfChips(440, ['แจ้งเตือนอัตโนมัติ', 'ใช้ได้ตอนเน็ตอ่อน'])}
  <text x="1130" y="600" font-size="30" fill="#0B3D5C" font-weight="700" text-anchor="end" font-family="${FONT}">bkkflood.web.app</text>
</svg>`;

await sharp(Buffer.from(svg), { density: 96 }).png({ compressionLevel: 9 }).toFile('public/og.png');
console.log('wrote public/og.png');
