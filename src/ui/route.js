// "ตรวจเส้นทาง" in the style of a maps app: tap 🧭 (or "เส้นทาง" on a place / point) → a top bar with From / To (From defaults to my location), vehicle chips,
// and a result sheet with the route options laid over the flooded-road estimate (src/lib/road-flood.js, route-check.js). The map stays visible: the chosen
// route is drawn, flooded stretches get depth chips, tapping a line chooses that route. Not a navigator: "เปิดใน Google Maps" hands the trip over for turn-by-turn.
// Routes come from the public OSRM demo (OpenStreetMap data, car profile, no live traffic) and are requested only when the start, destination or vehicle changes.
import maplibregl from 'maplibre-gl';
import { state } from '../state.js';
import { esc, toast } from '../lib/util.js';
import { geocode } from '../lib/search.js';
import { inBounds } from '../lib/geo.js';
import { osrmUrl, parseOsrm, checkRoute, rankRoutes, gmapsUrl, ROUTE_SUMMARY } from '../lib/route-check.js';
import { VERDICT_TH, VERDICT_COLOR, VEHICLES, ROADS_CREDIT, depthWord, centroid } from '../lib/road-flood.js';

const $ = (s) => document.querySelector(s);
const LABEL = ['A', 'B', 'C', 'D'];
const VEH_ICON = ['🏍', '🚗', '🛻', '🚚'];
const RECENT_KEY = 'bkkflood.routeRecent';

let map = null;
let markers = [];
let open = false;
let built = false;
let lastKey = '';
let runId = 0;
const rt = { from: null, to: null, veh: 1, routes: [], sel: 0, status: 'idle', err: '', picking: null, sugg: null, locating: false };

const lsGet = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; } };
const lsSet = (v) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify(v)); } catch { /* private mode */ } };
const rememberPlace = (p) => {
  if (!p || p.label === 'ตำแหน่งของฉัน') return;
  const keep = lsGet().filter((x) => Math.abs(x.lat - p.lat) > 0.0003 || Math.abs(x.lng - p.lng) > 0.0003);
  lsSet([{ lat: +p.lat.toFixed(5), lng: +p.lng.toFixed(5), label: String(p.label).slice(0, 60) }, ...keep].slice(0, 5));
};

const fmtKm = (m) => `${(m / 1000).toFixed(1)} กม.`;
const fmtMin = (s) => { const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)} ชม. ${m % 60} นาที` : `${m} นาที`; };
const pointLabel = (p) => p?.label || (p ? `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}` : '');

// ───────── map layers ─────────
export function initRouteLayers(m) {
  map = m;
  const empty = { type: 'FeatureCollection', features: [] };
  map.addSource('route-line', { type: 'geojson', data: empty });
  map.addSource('route-hit', { type: 'geojson', data: empty });
  map.addSource('route-pts', { type: 'geojson', data: empty });
  map.addLayer({ id: 'route-casing', type: 'line', source: 'route-line', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 7, 16, 16], 'line-opacity': 0.9 } });
  map.addLayer({
    id: 'route-line', type: 'line', source: 'route-line', layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['get', 'sel'] },
    paint: { 'line-color': ['case', ['==', ['get', 'sel'], 1], '#1c7fb8', '#8a94a3'], 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 4, 16, 10], 'line-opacity': ['case', ['==', ['get', 'sel'], 1], 1, 0.75] },
  });
  map.addLayer({ id: 'route-hit', type: 'line', source: 'route-hit', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 5, 16, 12], 'line-dasharray': [1, 1.2] } });
  map.addLayer({ id: 'route-pts', type: 'circle', source: 'route-pts', paint: { 'circle-radius': 9, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 } });  if (open) draw(); // a route chosen before the layers existed
}

const verdictOfFeature = (f) => (f.properties.a ? 3 : f.properties.v?.[rt.veh] ?? 1);

function clearMarkers() {
  markers.forEach((m) => m.remove());
  markers = [];
}
// a depth chip on each flooded road along the chosen route
function drawMarkers() {
  clearMarkers();
  const cur = rt.routes[rt.sel];
  if (!map || !cur) return;
  for (const g of cur.check.groups.slice(0, 6)) {
    const segs = cur.check.hits.filter((f) => (f.properties.n || 'ถนน/ซอย (ไม่ระบุชื่อ)') === g.name);
    if (!segs.length) continue;
    const c = centroid(segs.flatMap((f) => f.geometry.coordinates));
    const el = document.createElement('button');
    el.className = 'rt-pin';
    el.style.setProperty('--c', VERDICT_COLOR[g.worst]);
    el.innerHTML = `≈${g.maxD}<small>ซม.</small>`;
    el.setAttribute('aria-label', `${g.name} น้ำลึกประมาณ ${g.maxD} เซนติเมตร`);
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      new maplibregl.Popup({ offset: 14, maxWidth: '260px' }).setLngLat([c.lng, c.lat])
        .setHTML(`<div class="pp"><div class="pp-title">${esc(g.name)}</div><p class="small">น้ำลึกสุดราว <b>${g.maxD} ซม.</b>${depthWord(g.maxD) ? ` (${depthWord(g.maxD)})` : ''} · ผ่านราว ${g.onM} ม.<br>${VEHICLES[rt.veh]}: <b>${VERDICT_TH[g.worst]}</b>${g.closed ? ' · ปิดการจราจร' : ''}</p></div>`).addTo(map);
    });
    markers.push(new maplibregl.Marker({ element: el }).setLngLat([c.lng, c.lat]).addTo(map));
  }
}

function draw() {
  drawMarkers();
  if (!map?.getSource('route-line')) return;
  map.getSource('route-line').setData({ type: 'FeatureCollection', features: rt.routes.map((r, i) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: r.coords }, properties: { sel: i === rt.sel ? 1 : 0, i } })) });
  const cur = rt.routes[rt.sel];
  map.getSource('route-hit').setData({ type: 'FeatureCollection', features: (cur?.check.hits || []).map((f) => ({ type: 'Feature', geometry: f.geometry, properties: { color: VERDICT_COLOR[verdictOfFeature(f)] } })) });
  const pts = [];
  if (rt.from) pts.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [rt.from.lng, rt.from.lat] }, properties: { color: '#2e9e5b' } });
  if (rt.to) pts.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [rt.to.lng, rt.to.lat] }, properties: { color: '#d7263d' } });
  map.getSource('route-pts').setData({ type: 'FeatureCollection', features: pts });
}

function fit() {
  const cur = rt.routes[rt.sel];
  if (!map || !cur) return;
  const b = cur.coords.reduce((a, c) => [[Math.min(a[0][0], c[0]), Math.min(a[0][1], c[1])], [Math.max(a[1][0], c[0]), Math.max(a[1][1], c[1])]], [[180, 90], [-180, -90]]);
  const wide = window.matchMedia('(min-width: 900px)').matches;
  map.fitBounds(b, { padding: wide ? { top: 80, bottom: 80, left: 80, right: 80 } : { top: 190, bottom: Math.round(window.innerHeight * 0.42), left: 40, right: 40 }, maxZoom: 15, duration: 700 });
}

// ───────── UI ─────────
function build() {
  if (built) return;
  built = true;
  const ui = $('#route-ui');
  ui.innerHTML = `<div class="rtu-top">
      <div class="rtu-row">
        <button class="rtu-back" data-rtu="close" aria-label="ปิดตรวจเส้นทาง">←</button>
        <div class="rtu-fields">
          <label class="rtu-f"><i class="rtu-dot from"></i><input id="rt-from" type="search" autocomplete="off" placeholder="ต้นทาง" data-rtu-in="from" /></label>
          <label class="rtu-f"><i class="rtu-dot to"></i><input id="rt-to" type="search" autocomplete="off" placeholder="ปลายทาง — พิมพ์ชื่อสถานที่ แล้วกดค้นหา" data-rtu-in="to" /></label>
        </div>
        <button class="rtu-swap" data-rtu="swap" aria-label="สลับต้นทางกับปลายทาง">⇅</button>
      </div>
      <div class="rtu-sugg" id="rt-sugg" hidden></div>
      <div class="rtu-veh" id="rt-veh" role="group" aria-label="ยานพาหนะ"></div>
    </div>
    <div class="rtu-pick" id="rt-pick" hidden></div>
    <div class="rtu-sheet" id="rt-sheet"></div>`;

  ui.addEventListener('focusin', (e) => { if (e.target.matches('[data-rtu-in]')) showQuick(e.target.dataset.rtuIn); });
  ui.addEventListener('input', (e) => { if (e.target.matches('[data-rtu-in]')) { const w = e.target.dataset.rtuIn; if (rt[w]) { rt[w] = null; rt.routes = []; rt.status = 'idle'; lastKey = ''; clearMarkers(); draw(); renderSheet(); } } });
  ui.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('[data-rtu-in]')) { e.preventDefault(); search(e.target.dataset.rtuIn); }
    if (e.key === 'Escape') { rt.sugg = null; renderSugg(); }
  });
  ui.addEventListener('click', (e) => {
    const t = e.target.closest('[data-rtu],[data-rtu-pick],[data-rtu-veh],[data-rtu-sel],[data-rtu-set]');
    if (!t) return;
    if (t.dataset.rtu === 'close') close();
    else if (t.dataset.rtu === 'swap') swap();
    else if (t.dataset.rtu === 'retry') run(true);
    else if (t.dataset.rtu === 'fit') fit();
    else if (t.dataset.rtu === 'search') search(t.dataset.which);
    else if (t.dataset.rtu === 'gps') gps(t.dataset.which);
    else if (t.dataset.rtu === 'map') startPick(t.dataset.which);
    else if (t.dataset.rtuPick) pickFromList(t.dataset.rtuPick);
    else if (t.dataset.rtuVeh) { rt.veh = +t.dataset.rtuVeh; renderVeh(); recheck(); }
    else if (t.dataset.rtuSel) selectRoute(+t.dataset.rtuSel);
  });
}

function renderFields() {
  for (const w of ['from', 'to']) {
    const el = $(`#rt-${w}`);
    if (!el) continue;
    if (document.activeElement !== el || rt[w]) el.value = rt[w] ? pointLabel(rt[w]) : (el.value && document.activeElement === el ? el.value : '');
  }
  const from = $('#rt-from');
  if (from) from.placeholder = rt.locating ? 'กำลังหาตำแหน่งของคุณ…' : 'ต้นทาง';
}

function renderVeh() {
  $('#rt-veh').innerHTML = VEHICLES.map((v, i) => `<button class="rtu-chip${i === rt.veh ? ' on' : ''}" data-rtu-veh="${i}" aria-pressed="${i === rt.veh}">${VEH_ICON[i]} ${v}</button>`).join('');
}

// quick picks under the focused field: my location, pick on map, saved places, recent places
function showQuick(which) {
  const saved = (state.saved || []).map((p) => ({ lat: p.lat, lng: p.lng, label: p.label, kind: '⭐' }));
  const recent = lsGet().map((p) => ({ ...p, kind: '🕘' }));
  rt.sugg = { which, items: [...saved, ...recent].slice(0, 7), mode: 'quick' };
  renderSugg();
}
function renderSugg() {
  const box = $('#rt-sugg');
  const s = rt.sugg;
  if (!s) { box.hidden = true; box.innerHTML = ''; return; }
  const w = s.which;
  const head = `<button class="rtu-opt" data-rtu="gps" data-which="${w}">📍 <b>ตำแหน่งของฉัน</b></button><button class="rtu-opt" data-rtu="map" data-which="${w}">🗺 <b>เลือกบนแผนที่</b></button>`;
  const q = ($(`#rt-${w}`)?.value || '').trim();
  const find = s.mode === 'quick' && q.length >= 2 && !rt[w] ? `<button class="rtu-opt" data-rtu="search" data-which="${w}">🔍 ค้นหา “${esc(q)}”</button>` : '';
  const items = s.items.map((p, i) => `<button class="rtu-opt" data-rtu-pick="${w}:${i}">${p.kind || '📌'} ${esc(p.name || p.label)}</button>`).join('');
  box.hidden = false;
  box.innerHTML = `${find}${s.mode === 'results' ? '' : head}${items}${s.mode === 'results' && !s.items.length ? '<p class="muted small" style="padding:8px 12px">ไม่พบสถานที่นี้ในพื้นที่บริการ ลองชื่อสั้นลง หรือเลือกบนแผนที่</p>' : ''}`;
}

function renderSheet() {
  const sh = $('#rt-sheet');
  if (!sh) return;
  const hint = !rt.to ? 'เลือกปลายทางเพื่อตรวจว่าเส้นทางผ่านถนนที่น้ำท่วมหรือไม่' : !rt.from ? (rt.locating ? 'กำลังหาตำแหน่งของคุณ…' : 'เลือกต้นทาง (หรือกด “ตำแหน่งของฉัน” ที่ช่องต้นทาง)') : '';
  if (rt.status === 'loading') { sh.innerHTML = '<div class="rtu-msg">กำลังหาเส้นทางและตรวจน้ำท่วม…</div>'; return; }
  if (rt.status === 'error') { sh.innerHTML = `<div class="rtu-msg"><p class="note">${esc(rt.err)}</p><button class="btn btn-sm" data-rtu="retry">ลองใหม่</button></div>`; return; }
  if (!rt.routes.length) { sh.innerHTML = `<div class="rtu-msg"><p class="small">${hint}</p>${credit()}</div>`; return; }
  const order = rankRoutes(rt.routes);
  const best = order[0];
  sh.innerHTML = `<div class="rtu-grab"></div>${order.map((i) => card(rt.routes[i], i, best)).join('')}${credit()}`;
}

const credit = () => `<p class="muted tiny rtu-credit">ตรวจเฉพาะถนนที่มีข้อมูลระดับน้ำตอนนี้ (กทม. เท่านั้น) — <b>ถนนที่ไม่ขึ้นรายการ ไม่ได้แปลว่าปลอดภัย</b> · ความลึกเป็นค่าประมาณจาก <a href="${ROADS_CREDIT.url}" target="_blank" rel="noopener noreferrer">${ROADS_CREDIT.name}</a> (<a href="${ROADS_CREDIT.licenceUrl}" target="_blank" rel="noopener noreferrer">${ROADS_CREDIT.licence}</a>)${state.roadFlood ? ` อายุ ${Math.max(0, Math.round((Date.now() - state.roadFlood.generatedAt) / 60000))} นาที` : ''} · เส้นทางจาก OSRM © OpenStreetMap contributors (ไม่รวมรถติด) · ห้ามขับผ่านน้ำไหลเชี่ยว</p>`;

function card(r, i, best) {
  const c = r.check;
  const sel = i === rt.sel;
  const sum = c.groups.length ? `ผ่านน้ำ <b>${c.groups.length}</b> สาย ราว ${c.floodedM >= 1000 ? fmtKm(c.floodedM) : `${c.floodedM} ม.`} · ลึกสุด ≈ ${Math.max(...c.groups.map((g) => g.maxD))} ซม.` : 'ไม่พบถนนท่วมตามทาง (จากข้อมูลที่มี)';
  const detail = sel ? `<div class="rtu-detail">
      <p class="small">${ROUTE_SUMMARY[c.worst]}</p>
      ${c.groups.length ? `<div class="list">${c.groups.slice(0, 8).map((g) => `<div class="row-item static"><span class="dot" style="background:${VERDICT_COLOR[g.worst]}"></span><span class="grow"><b>${esc(g.name)}${g.closed ? ' <span class="tag warn">ปิด</span>' : ''}</b><small>ลึกสุด ≈ ${g.maxD} ซม.${depthWord(g.maxD) ? ` (${depthWord(g.maxD)})` : ''} · ผ่านราว ${g.onM} ม. · ${VEHICLES[rt.veh]}: ${VERDICT_TH[g.worst]}</small></span></div>`).join('')}</div>${c.groups.length > 8 ? `<p class="muted tiny">และอีก ${c.groups.length - 8} สาย</p>` : ''}` : ''}
      <div class="row wrap"><a class="btn btn-primary btn-sm" href="${esc(gmapsUrl(rt.from, rt.to, r.coords))}" target="_blank" rel="noopener noreferrer">เปิดใน Google Maps ↗</a><button class="btn btn-sm" data-rtu="fit">ดูทั้งเส้นทาง</button></div>
      <p class="muted tiny">Google Maps จะคำนวณเส้นทางเอง (ผมใส่จุดกลางทางให้ใกล้เส้นทางนี้) — ตรวจชื่อถนนอีกครั้งก่อนออกเดินทาง</p>
    </div>` : '';
  return `<div class="rtu-card${sel ? ' sel' : ''}" data-rtu-sel="${i}" style="--c:${VERDICT_COLOR[c.worst]}">
    <div class="rtu-head"><span class="rtu-time">${fmtMin(r.durationS)}</span><span class="muted small">${fmtKm(r.distanceM)}</span>${i === best ? '<span class="tag">แนะนำ</span>' : ''}<span class="rtu-badge">${VEHICLES[rt.veh]}: ${VERDICT_TH[c.worst]}</span></div>
    <div class="rtu-sum">เส้นทาง ${LABEL[i]} · ${sum}</div>${detail}</div>`;
}

// ───────── actions ─────────
function selectRoute(i) {
  if (i === rt.sel || !rt.routes[i]) return;
  rt.sel = i;
  draw();
  renderSheet();
}

// tapping a line on the map chooses that route (called by the main click handler)
export function routeHit(point) {
  if (!open || !map || !rt.routes.length) return false;
  const f = map.queryRenderedFeatures([[point.x - 10, point.y - 10], [point.x + 10, point.y + 10]], { layers: ['route-line'] })[0];
  if (!f) return false;
  selectRoute(+f.properties.i);
  return true;
}

function swap() {
  [rt.from, rt.to] = [rt.to, rt.from];
  rt.routes = [];
  lastKey = '';
  renderFields();
  draw();
  renderSheet();
  run();
}

async function search(which) {
  const q = ($(`#rt-${which}`)?.value || '').trim();
  if (q.length < 2) return toast('พิมพ์ชื่อสถานที่อย่างน้อย 2 ตัวอักษร');
  rt.sugg = { which, items: [], mode: 'results' };
  $('#rt-sugg').hidden = false;
  $('#rt-sugg').innerHTML = '<p class="muted small" style="padding:8px 12px">กำลังค้นหา…</p>';
  const r = await geocode(q);
  if (r.length === 1) return setPoint(which, { lat: r[0].lat, lng: r[0].lng, label: r[0].name });
  rt.sugg = { which, items: r, mode: 'results' };
  renderSugg();
}

function pickFromList(code) {
  const [w, i] = code.split(':');
  const p = rt.sugg?.items?.[+i];
  if (p) setPoint(w, { lat: p.lat, lng: p.lng, label: p.name || p.label });
}

function setPoint(which, p) {
  rt[which] = p;
  if (which === 'to') rememberPlace(p);
  rt.sugg = null;
  renderSugg();
  renderFields();
  draw();
  if (document.activeElement?.blur) document.activeElement.blur();
  run();
}

function gps(which, { quiet = false } = {}) {
  if (!navigator.geolocation) { if (!quiet) toast('อุปกรณ์นี้ไม่รองรับการหาตำแหน่ง'); return Promise.resolve(false); }
  rt.locating = which === 'from';
  renderFields();
  renderSheet();
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => {
        rt.locating = false;
        if (!inBounds(p.coords.latitude, p.coords.longitude)) { toast('ตำแหน่งของคุณอยู่นอกพื้นที่บริการ (กทม. ปริมณฑล และภาคตะวันออก)'); renderFields(); renderSheet(); return resolve(false); }
        setPoint(which, { lat: p.coords.latitude, lng: p.coords.longitude, label: 'ตำแหน่งของฉัน' });
        resolve(true);
      },
      () => {
        rt.locating = false;
        if (!quiet) toast('ไม่ได้รับตำแหน่ง — อนุญาตการเข้าถึงตำแหน่ง หรือพิมพ์/เลือกต้นทางเอง');
        renderFields();
        renderSheet();
        resolve(false);
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 120000 },
    );
  });
}

// map picking: the sheet gives way to a one-line prompt
function startPick(which) {
  rt.picking = which;
  rt.sugg = null;
  renderSugg();
  const b = $('#rt-pick');
  b.hidden = false;
  b.innerHTML = `${which === 'from' ? 'แตะบนแผนที่เพื่อเลือกต้นทาง' : 'แตะบนแผนที่เพื่อเลือกปลายทาง'} <button class="btn btn-sm" data-rtu="close-pick">ยกเลิก</button>`;
  b.querySelector('[data-rtu=close-pick]').onclick = () => { rt.picking = null; b.hidden = true; };
  $('#route-ui').classList.add('picking');
}
export const routePicking = () => !!rt.picking;
export function routePick(lat, lng) {
  const which = rt.picking;
  if (!which) return false;
  if (!inBounds(lat, lng)) { toast('จุดนี้อยู่นอกพื้นที่บริการ'); return true; }
  rt.picking = null;
  $('#rt-pick').hidden = true;
  $('#route-ui').classList.remove('picking');
  setPoint(which, { lat, lng, label: `จุดบนแผนที่ (${lat.toFixed(4)}, ${lng.toFixed(4)})` });
  return true;
}

// ask for the route once both ends are known (and again only when an end changes); the vehicle only re-scores the same routes
async function run(force = false) {
  if (!rt.from || !rt.to) { renderSheet(); return; }
  if (!state.roadFlood?.features) { rt.status = 'error'; rt.err = 'ยังไม่มีข้อมูลน้ำท่วมบนถนน ลองใหม่อีกครั้งในสักครู่'; renderSheet(); return; }
  const key = `${rt.from.lat.toFixed(4)},${rt.from.lng.toFixed(4)}>${rt.to.lat.toFixed(4)},${rt.to.lng.toFixed(4)}`;
  if (!force && key === lastKey && rt.routes.length) return;
  const id = ++runId;
  rt.status = 'loading';
  rt.err = '';
  renderSheet();
  try {
    const res = await fetch(osrmUrl(rt.from, rt.to), { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const routes = parseOsrm(await res.json());
    state.routeSvc = { ok: true, at: Date.now() };
    if (id !== runId) return; // the user changed an end meanwhile
    rt.routes = routes.slice(0, 4).map((r) => ({ ...r, check: checkRoute(state.roadFlood.features, r.coords, rt.veh) }));
    rt.sel = rankRoutes(rt.routes)[0];
    rt.status = 'done';
    lastKey = key;
    draw();
    renderSheet();
    fit();
  } catch (e) {
    if (id !== runId) return;
    if (!/NoRoute|no route/i.test(e.message)) state.routeSvc = { ok: false, at: Date.now() };
    rt.status = 'error';
    rt.err = /NoRoute|no route/i.test(e.message) ? 'ไม่พบเส้นทางรถยนต์ระหว่างสองจุดนี้' : 'หาเส้นทางไม่สำเร็จ (บริการคำนวณเส้นทางไม่ตอบ) ลองใหม่อีกครั้งในอีกสักครู่';
    renderSheet();
  }
}

function recheck() {
  if (!rt.routes.length || !state.roadFlood?.features) return;
  rt.routes = rt.routes.map((r) => ({ ...r, check: checkRoute(state.roadFlood.features, r.coords, rt.veh) }));
  rt.sel = rankRoutes(rt.routes)[0];
  draw();
  renderSheet();
}

// ───────── public ─────────
const onPop = () => { if (open) close(true); };
export async function openRoute({ to = null, from = null } = {}) {
  build();
  map ||= state.map; // normally set by initRouteLayers; the app's own reference covers a route opened before the style finished loading
  if (to) { rt.to = { ...to, label: to.label || 'จุดที่เลือกบนแผนที่' }; rememberPlace(rt.to); }
  if (from) rt.from = from;
  if (!open) {
    open = true;
    $('#route-ui').hidden = false;
    document.body.classList.add('route-open');
    try { history.pushState({ route: 1 }, ''); } catch { /* ignore */ }
    window.addEventListener('popstate', onPop);
  }
  renderVeh();
  renderFields();
  renderSheet();
  draw();
  if (rt.from && rt.to) return run();
  if (!rt.from) {
    // like a maps app: the start is where I am — ask now, because tapping "route" is the intent
    await gps('from', { quiet: false });
  }
  if (!rt.to) { $('#rt-to')?.focus(); }
}

export function close(fromPop = false) {
  if (!open) return;
  open = false;
  runId++;
  rt.routes = [];
  rt.from = null;
  rt.to = null;
  rt.status = 'idle';
  rt.sugg = null;
  rt.picking = null;
  lastKey = '';
  clearMarkers();
  draw();
  $('#route-ui').hidden = true;
  $('#route-ui').classList.remove('picking');
  document.body.classList.remove('route-open');
  window.removeEventListener('popstate', onPop);
  if (!fromPop) { try { if (history.state?.route) history.back(); } catch { /* ignore */ } }
}
export const clearRoute = close;
export const routeIsOpen = () => open;
