// Parser for the BMA Drainage Department (สำนักการระบายน้ำ) daily road-flooding report:
// https://dds.bangkok.go.th/flood_report.php — a public HTML page, no API. DOM-free (used by scripts/fetch-dds.mjs and the app).
// NOTE: this is a DAILY report of a past day (with dry times and durations), not a live feed — the UI always shows its date.

export const DDS_URL = 'https://dds.bangkok.go.th/flood_report.php';

const MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const MONTH_RE = MONTHS.join('|');
const ENT = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
const clean = (s) =>
  String(s ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;/g, (m) => ENT[m])
    .replace(/\s+/g, ' ')
    .trim();

// "25 กันยายน 2569" (Buddhist year) → "2026-09-25"
export function thaiDateToIso(d, monthName, be) {
  const m = MONTHS.indexOf(monthName);
  if (m < 0) return null;
  const y = +be - 543;
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(+d).padStart(2, '0')}`;
}

const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

// the detail rows of the first table that has the road/height columns in a piece of the page
function rowsFrom(fragment) {
  const tables = fragment.match(/<table[\s\S]*?<\/table>/gi) || [];
  let rows = [];
  for (const t of tables) {
    const trs = t.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    const cellsOf = (tr) => (tr.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/gi) || []).map(clean);
    const head = trs.map(cellsOf).find((c) => c.some((x) => x.includes('ถนน')) && c.some((x) => x.includes('ความสูง')));
    if (!head) continue;
    const col = (word) => head.findIndex((x) => x.includes(word));
    const ix = {
      district: col('พื้นที่เขต'), road: col('ถนน'), place: col('บริเวณ'), depth: col('ความสูง'), length: col('ความยาว'),
      lanes: col('เลน'), from: col('เวลาท่วม'), dry: col('เวลาแห้ง'), duration: col('ระยะเวลา'), rain: col('ปริมาณฝน'),
    };
    for (const tr of trs) {
      const c = cellsOf(tr);
      if (c.length < 6 || c === head || !/^\d+$/.test(c[0])) continue; // skips header, notes, blanks
      rows.push({
        district: c[ix.district] || '',
        road: c[ix.road] || '',
        place: c[ix.place] || '',
        depthCm: num(c[ix.depth]),
        lengthM: num(c[ix.length]),
        lanes: c[ix.lanes] || '',
        from: c[ix.from] || '',
        dry: ix.dry >= 0 ? c[ix.dry] || '' : '',
        duration: ix.duration >= 0 ? c[ix.duration] || '' : '',
        rainMm: ix.rain >= 0 ? num(c[ix.rain]) : null,
      });
    }
    break;
  }
  return rows;
}

export function parseDdsReport(html) {
  if (typeof html !== 'string' || html.length < 500) throw new Error('DDS: empty page');

  // dates: the range line ("… ถึง …") and the standalone day that the table is for
  const stand = [...html.matchAll(new RegExp(`วันที่\\s*(\\d{1,2})\\s*(${MONTH_RE})\\s*(\\d{4})`, 'g'))];
  const range = html.match(new RegExp(`(\\d{1,2})\\s*(${MONTH_RE})\\s*(\\d{4})\\s*ถึง\\s*(\\d{1,2})\\s*(${MONTH_RE})\\s*(\\d{4})`));
  // The table's own date is the last "วันที่ …" BEFORE the first table — the page footer also says "วันที่ <today> เวลา …" (visitor stats)
  const firstTable = html.search(/<table/i);
  const last = stand.filter((m) => firstTable < 0 || m.index < firstTable).at(-1);
  const reportDate = last ? thaiDateToIso(last[1], last[2], last[3]) : null;
  const rangeFrom = range ? thaiDateToIso(range[1], range[2], range[3]) : null;
  const rangeTo = range ? thaiDateToIso(range[4], range[5], range[6]) : null;

  // Since the BMA page started covering a range ("25 ก.ย. ถึง 2 ต.ค.") it lists one section per day: a standalone date line, then that day's tables.
  // The newest section is the one that matters (the first one is the oldest day).
  const DATE_DIV = new RegExp(String.raw`<div[^>]*>\s*วันที่\s*(\d{1,2})\s*(${MONTH_RE})\s*(\d{4})\s*</div>`, 'g');
  const heads = [...html.matchAll(DATE_DIV)];
  let rows = [];
  let day = reportDate;
  if (heads.length) {
    for (let k = 0; k < heads.length; k++) {
      const iso = thaiDateToIso(heads[k][1], heads[k][2], heads[k][3]);
      const sec = rowsFrom(html.slice(heads[k].index + heads[k][0].length, heads[k + 1]?.index ?? html.length));
      if (sec.length && iso && (!day || rows.length === 0 || iso >= day)) { rows = sec; day = iso; }
    }
  }
  if (!rows.length) rows = rowsFrom(html); // older page layout: a single report with no per-day sections
  if (!rows.length) throw new Error('DDS: no flood rows found — page layout may have changed');
  return { reportDate: day || reportDate, rangeFrom, rangeTo, rows };
}
