// Live YouTube streams from Thailand that look like cameras (city, road, river, flood). Found with the official YouTube Data API v3
// (search.list → videos.list), shown through YouTube's own embedded player, always labelled "unverified": anyone can start a stream,
// and we cannot moderate what they show. DOM-free (used by scripts/fetch-youtube-live.mjs and the browser).
//
// Quota: the free allowance is 10,000 units/day; search.list costs 100 units, videos.list 1. The fetch script runs at most once an hour
// with 3 searches (~7,300 units/day).

export const API = 'https://www.googleapis.com/youtube/v3';
// Long queries returned almost nothing (YouTube wants every word), so the queries are short and three sets take turns hour by hour;
// the script also remembers streams found earlier. 3 searches per run × 24 runs = 7,200 units/day of the 10,000 free.
export const QUERY_SETS = [
  ['กล้องสด', 'กล้องจราจร', 'น้ำท่วม สด'],
  ['CCTV live Thailand', 'แม่น้ำเจ้าพระยา สด', 'กล้องวงจรปิด สด'],
  ['Bangkok live cam', 'ระดับน้ำ สด', 'traffic camera Thailand live'],
];
export const queriesFor = (now = Date.now()) => QUERY_SETS[Math.floor(now / 3600e3) % QUERY_SETS.length];

export const searchUrl = (q, key) =>
  `${API}/search?part=snippet&type=video&eventType=live&regionCode=TH&relevanceLanguage=th&maxResults=25&q=${encodeURIComponent(q)}&key=${key}`;
export const videosUrl = (ids, key) => `${API}/videos?part=snippet,status,liveStreamingDetails&id=${ids.join(',')}&key=${key}`;

// Streams whose title says they are a camera/flood/traffic/river view. Music, games and chat streams also carry "live", so this filter matters.
// YouTube's regionCode only nudges results toward a country, so a stream must also look Thai: Thai script (or a well-known Thai place).
const THAI = /[฀-๿]|thailand|bangkok|phuket|pattaya|chiang ?mai|samui|krabi|hua ?hin|ayutthaya|chao ?phraya|koh |ko (?:samui|phangan|tao)/i;
// "local" = about Bangkok, its neighbouring provinces or flooding — what this app is for. Beach/bar webcams elsewhere are kept but shown apart.
const LOCAL = /bangkok|กรุงเทพ|กทม|นนทบุรี|ปทุมธานี|สมุทรปราการ|สมุทรสาคร|นครปฐม|สุขุมวิท|เจ้าพระยา|วิภาวดี|ลาดพร้าว|รังสิต|ดอนเมือง|น้ำท่วม|flood|ระดับน้ำ/i;
const RELEVANT = /กล้อง|cctv|cam\b|webcam|live cam|จราจร|ถนน|น้ำท่วม|ระดับน้ำ|แม่น้ำ|เจ้าพระยา|เขื่อน|คลอง|สะพาน|แยก|traffic|flood|river|bridge|street/i;

// searchItems: items from search.list; videoItems: items from videos.list for the same ids
export function normalizeLive(searchItems, videoItems, now = Date.now()) {
  const info = new Map((videoItems || []).map((v) => [v.id, v]));
  const out = [];
  const seen = new Set();
  for (const s of searchItems || []) {
    const id = s.id?.videoId;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const v = info.get(id);
    if (!v) continue;
    const live = v.liveStreamingDetails || {};
    if (v.status?.embeddable !== true || v.status?.privacyStatus !== 'public') continue; // the player would refuse, or it is not public
    if (live.actualEndTime) continue; // already ended
    if (!live.actualStartTime) continue; // scheduled, not live yet
    const title = String(v.snippet?.title || '').trim();
    if (!RELEVANT.test(title)) continue;
    if (!THAI.test(`${title} ${v.snippet?.channelTitle || ''}`)) continue;
    out.push({
      id,
      title: title.slice(0, 120),
      channel: String(v.snippet?.channelTitle || '').slice(0, 60),
      thumb: v.snippet?.thumbnails?.medium?.url || v.snippet?.thumbnails?.default?.url || null,
      local: LOCAL.test(`${title} ${v.snippet?.channelTitle || ''}`),
      viewers: Number.isFinite(+live.concurrentViewers) ? +live.concurrentViewers : null,
      startedAt: Date.parse(live.actualStartTime) || null,
    });
  }
  return out.sort((a, b) => b.local - a.local || (b.viewers ?? -1) - (a.viewers ?? -1) || (b.startedAt ?? 0) - (a.startedAt ?? 0)).slice(0, 30);
}
