// Client-side photo processing. Re-encoding through <canvas> also drops EXIF (incl. GPS) metadata,
// which protects reporters' privacy. Output is a JPEG data URL small enough for Firestore.
const MAX_FULL_BYTES = 180_000; // Firestore doc limit is 1 MiB; rules allow 250 KB of base64

async function decode(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Safari < 16 etc.
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('อ่านไฟล์รูปไม่ได้'));
      img.src = URL.createObjectURL(file);
    });
  }
}

function render(src, maxSide, quality) {
  const w = src.width;
  const h = src.height;
  const k = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}

const bytesOf = (dataUrl) => Math.floor(((dataUrl.length - dataUrl.indexOf(',') - 1) * 3) / 4);

export async function processPhoto(file) {
  if (!file.type.startsWith('image/')) throw new Error('ไฟล์ที่เลือกไม่ใช่รูปภาพ');
  const src = await decode(file);
  let side = 1280;
  let q = 0.72;
  let full = render(src, side, q);
  while (bytesOf(full) > MAX_FULL_BYTES && (q > 0.4 || side > 640)) {
    if (q > 0.4) q -= 0.1;
    else side -= 160;
    full = render(src, side, q);
  }
  if (bytesOf(full) > MAX_FULL_BYTES) throw new Error('รูปใหญ่เกินไป ลองถ่ายใหม่');
  return { full, thumb: render(src, 128, 0.6) };
}
