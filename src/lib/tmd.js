// Weather warnings from the Thai Meteorological Department (กรมอุตุนิยมวิทยา). No token is needed: the list page and each warning's page are public HTML.
// (TMD's XML feeds /api/xml/warning-news and data.tmd.go.th WeatherWarningNews are frozen at 2025 / 2022 — do not use them.)
// Information only: shown and linked as the official word, never scored (it covers whole regions, not places).
// DOM-free (used by scripts/fetch-tmd.mjs and the Thai-network sync job).
export const TMD_BASE = 'https://www.tmd.go.th';
export const TMD_WARNINGS = `${TMD_BASE}/warning-and-events/warning-storm`;
export const MAX_SERIES = 3; // newest issue of at most this many different warnings
export const MAX_AGE_DAYS = 3; // a warning whose newest issue is older than this is dropped

const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

export const decodeEntities = (s) =>
  String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
const text = (html) => decodeEntities(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

// "06 ตุลาคม 2569" → "2026-10-06"
export function thaiDateIso(s) {
  const m = String(s).match(/(\d{1,2})\s+(\S+)\s+(\d{4})/);
  if (!m) return null;
  const mon = TH_MONTHS.indexOf(m[2]);
  if (mon < 0) return null;
  return `${+m[3] - 543}-${String(mon + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

// the same warning keeps its title and only changes "ฉบับที่ N (NNN/YYYY)" with each issue
export const seriesKey = (title) => title.replace(/ฉบับที่\s*\d+.*$/, '').replace(/\(มีผลกระทบ[^)]*\)/, '').trim();
const issueNo = (title) => +(title.match(/ฉบับที่\s*(\d+)/)?.[1] ?? 0);

// List page → [{ title, summary, date, url, category }] newest first, as the page orders them
export function parseWarningList(html) {
  const out = [];
  for (const block of String(html).split('<div class="link-list">').slice(1)) {
    const a = block.match(/<div class="link-list-title">\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    const href = decodeEntities(a[1]);
    const caption = text(block.match(/<div class="link-list-caption[\s\S]*$/)?.[0] || '');
    out.push({
      title: text(a[2]),
      summary: text(block.match(/<div class="link-list-description">([\s\S]*?)<\/div>/)?.[1] || ''),
      date: thaiDateIso(caption.match(/วันที่ข้อมูล:\s*([^|]+)/)?.[1] || ''),
      url: href.startsWith('http') ? href : TMD_BASE + encodeURI(href),
      category: caption.match(/หมวดหมู่:\s*([^|]+?)(?:\s*\||$)/)?.[1]?.trim() || '',
    });
  }
  return out;
}

// One warning's page → the announcement text, and whether it names Bangkok / its metro area.
// The page footer carries TMD's own Bangkok address, so only the announcement itself is searched.
export function parseWarningBody(html) {
  const t = text(String(html).replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, ''));
  const from = t.indexOf('ประกาศกรมอุตุนิยมวิทยา');
  const end = t.indexOf('( ลงชื่อ)', from) >= 0 ? t.indexOf('( ลงชื่อ)', from) : t.indexOf('ลงชื่อ', from);
  if (from < 0) return null;
  const body = t.slice(from, end > from ? end : from + 4000).trim();
  return {
    body,
    bangkok: /กรุงเทพ|ปริมณฑล/.test(body),
    issuedAt: body.match(/ณ วันที่\s*([^ ]+ \S+ (?:พ\.ศ\. )?\d{4}) เวลา\s*(\d{1,2}[.:]\d{2})/)?.slice(1).join(' ') || null,
  };
}

// newest issue of each warning, newest first, recent ones only
export function latestSeries(items, now = Date.now()) {
  const seen = new Map();
  for (const it of items) {
    const k = seriesKey(it.title);
    const cur = seen.get(k);
    if (!cur || issueNo(it.title) > issueNo(cur.title)) seen.set(k, it);
  }
  const cutoff = new Date(now + 7 * 3600e3 - MAX_AGE_DAYS * 86400e3).toISOString().slice(0, 10);
  return [...seen.values()].filter((it) => it.date && it.date >= cutoff).sort((a, b) => (b.date || '').localeCompare(a.date || '') || issueNo(b.title) - issueNo(a.title)).slice(0, MAX_SERIES);
}

// fetchText(url) → html. Returns the JSON written to tmd-warnings.json.
export async function loadWarnings(fetchText, now = Date.now()) {
  const list = parseWarningList(await fetchText(TMD_WARNINGS));
  if (!list.length) throw new Error('TMD: no warnings on the list page (layout changed?)');
  const warnings = [];
  for (const it of latestSeries(list, now)) {
    let detail = null;
    try {
      detail = parseWarningBody(await fetchText(it.url));
    } catch {
      /* the list entry alone is still worth showing */
    }
    warnings.push({ ...it, bangkok: detail?.bangkok ?? /กรุงเทพ|ปริมณฑล/.test(it.summary), body: detail?.body?.slice(0, 2500) || '', issuedAt: detail?.issuedAt || null });
  }
  return { generatedAt: now, source: 'กรมอุตุนิยมวิทยา — ประกาศเตือนภัยลักษณะอากาศ', page: TMD_WARNINGS, listed: list.length, warnings };
}
