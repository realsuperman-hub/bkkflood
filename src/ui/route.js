// "ตรวจเส้นทาง": pick a start and a destination (type a place, use my location, or tap the map) and a vehicle → driving routes from the public OSRM demo
// server (OpenStreetMap data) are laid over the flooded-road estimate (src/lib/road-flood.js). Shows each route's flooded roads, depth and verdict for the
// chosen vehicle, recommends the least-flooded one and draws it on the map. A route is only as good as the data: roads we know nothing about are not "dry".
import { state } from '../state.js';
import { esc, toast } from '../lib/util.js';
import { geocode } from '../lib/search.js';
import { inBounds } from '../lib/geo.js';
import { osrmUrl, parseOsrm, checkRoute, rankRoutes, ROUTE_SUMMARY } from '../lib/route-check.js';
import { VERDICT_TH, VERDICT_COLOR, VEHICLES, ROADS_CREDIT, depthWord } from '../lib/road-flood.js';

const $ = (s) => document.querySelector(s);
const LABEL = ['A', 'B', 'C', 'D'];

let map = null;
const rt = { from: null, to: null, veh: 1, routes: [], sel: 0, status: 'idle', picking: null, found: { from: [], to: [] }, err: '' };

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
    id: 'route-line', type: 'line', source: 'route-line', layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['case', ['==', ['get', 'sel'], 1], '#1c7fb8', '#8a94a3'], 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 4, 16, 10], 'line-opacity': ['case', ['==', ['get', 'sel'], 1], 1, 0.7] },
  });
  map.addLayer({ id: 'route-hit', type: 'line', source: 'route-hit', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 5, 16, 12], 'line-dasharray': [1, 1.2] } });
  map.addLayer({ id: 'route-pts', type: 'circle', source: 'route-pts', paint: { 'circle-radius': 9, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 } });
}

function draw() {
  if (!map?.getSource('route-line')) return;
  const lines = rt.routes.map((r, i) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: r.coords }, properties: { sel: i === rt.sel ? 1 : 0 } }));
  // unselected routes first so the chosen one is on top
  lines.sort((a, b) => a.properties.sel - b.properties.sel);
  map.getSource('route-line').setData({ type: 'FeatureCollection', features: lines });
  const cur = rt.routes[rt.sel];
  map.getSource('route-hit').setData({
    type: 'FeatureCollection',
    features: (cur?.check.hits || []).map((f) => ({ type: 'Feature', geometry: f.geometry, properties: { color: VERDICT_COLOR[Math.max(...f.properties.v.slice(rt.veh, rt.veh + 1), f.properties.a ? 3 : 0)] } })),
  });
  const pts = [];
  if (rt.from) pts.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [rt.from.lng, rt.from.lat] }, properties: { color: '#2e9e5b' } });
  if (rt.to) pts.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [rt.to.lng, rt.to.lat] }, properties: { color: '#d7263d' } });
  map.getSource('route-pts').setData({ type: 'FeatureCollection', features: pts });
}

function fit() {
  const cur = rt.routes[rt.sel];
  if (!map || !cur) return;
  const b = cur.coords.reduce((a, c) => [[Math.min(a[0][0], c[0]), Math.min(a[0][1], c[1])], [Math.max(a[1][0], c[0]), Math.max(a[1][1], c[1])]], [[180, 90], [-180, -90]]);
  map.fitBounds(b, { padding: { top: 90, bottom: 90, left: 60, right: 60 }, maxZoom: 15, duration: 700 });
}

// ───────── route bar (shown on the map while a route is drawn) ─────────
function renderBar() {
  const bar = $('#route-bar');
  const cur = rt.routes[rt.sel];
  if (!bar) return;
  if (!cur) { bar.hidden = true; return; }
  bar.hidden = false;
  bar.style.setProperty('--c', VERDICT_COLOR[cur.check.worst]);
  bar.innerHTML = `<span class="rb-badge">${VERDICT_TH[cur.check.worst]}</span><span class="rb-txt">เส้นทาง ${LABEL[rt.sel]} · ${fmtKm(cur.distanceM)} · ${cur.check.groups.length ? `ผ่านน้ำ ${cur.check.groups.length} สาย` : 'ไม่พบถนนท่วมตามทาง'}</span>
    <button class="btn btn-sm" data-act="route-open">รายละเอียด</button><button class="btn btn-sm btn-ghost" data-act="route-clear" aria-label="ล้างเส้นทาง">✕</button>`;
}

// ───────── dialog ─────────
const sugg = (which) => (rt.found[which].length ? `<div class="rt-sugg">${rt.found[which].map((p, i) => `<button class="row-item" data-rt-pick="${which}:${i}"><span class="grow"><b>${esc(p.name)}</b></span></button>`).join('')}</div>` : '');
const field = (which, title) => `<div class="rt-field"><label for="rt-${which}">${title}</label>
    <div class="rt-row"><input id="rt-${which}" type="search" autocomplete="off" placeholder="พิมพ์ชื่อสถานที่ / ถนน / เขต" value="${esc(pointLabel(rt[which]))}" data-rt-in="${which}" />
      <button class="btn btn-sm" data-rt-find="${which}">ค้นหา</button></div>
    <div class="rt-row small"><button class="btn btn-sm btn-ghost" data-rt-gps="${which}">📍 ตำแหน่งของฉัน</button><button class="btn btn-sm btn-ghost" data-rt-map="${which}">🗺 เลือกบนแผนที่</button>${rt[which] ? '<span class="muted tiny">✓ เลือกแล้ว</span>' : ''}</div>
    ${sugg(which)}</div>`;

function routeCard(r, i, best) {
  const c = r.check;
  const sel = i === rt.sel;
  return `<div class="rt-route${sel ? ' sel' : ''}" data-rt-sel="${i}" style="--c:${VERDICT_COLOR[c.worst]}">
    <div class="rt-head"><b>เส้นทาง ${LABEL[i]}</b>${i === best ? ' <span class="tag">แนะนำ</span>' : ''} <span class="muted small">${fmtKm(r.distanceM)} · ~${fmtMin(r.durationS)} (ไม่รวมรถติด)</span></div>
    <div class="rt-verdict"><span class="rt-dot"></span><b>${VEHICLES[rt.veh]}: ${VERDICT_TH[c.worst]}</b> — ${ROUTE_SUMMARY[c.worst]}</div>
    ${c.groups.length ? `<div class="list">${c.groups.slice(0, 8).map((g) => `<div class="row-item static"><span class="dot" style="background:${VERDICT_COLOR[g.worst]}"></span>
      <span class="grow"><b>${esc(g.name)}${g.closed ? ' <span class="tag warn">ปิด</span>' : ''}</b><small>น้ำลึกสุด ≈ ${g.maxD} ซม.${depthWord(g.maxD) ? ` (${depthWord(g.maxD)})` : ''} · ผ่านราว ${g.onM} ม. · ${VERDICT_TH[g.worst]}</small></span></div>`).join('')}</div>
      ${c.groups.length > 8 ? `<p class="muted tiny">และอีก ${c.groups.length - 8} สาย</p>` : ''}` : ''}
  </div>`;
}

function result() {
  if (rt.status === 'loading') return '<p class="muted small">กำลังหาเส้นทางและตรวจน้ำท่วม…</p>';
  if (rt.status === 'error') return `<p class="note">${esc(rt.err)}</p>`;
  if (!rt.routes.length) return '';
  const order = rankRoutes(rt.routes);
  const best = order[0];
  return `<div class="why">ผลการตรวจ (${VEHICLES[rt.veh]})</div>
    ${rt.routes.length > 1 ? `<p class="small">พบ ${rt.routes.length} เส้นทาง — แตะการ์ดเพื่อดูบนแผนที่ · เส้นทางที่ “แนะนำ” คือเส้นที่ผ่านน้ำท่วมน้อยที่สุดตามข้อมูล ไม่ใช่เส้นที่เร็วที่สุดเสมอไป</p>` : ''}
    ${order.map((i) => routeCard(rt.routes[i], i, best)).join('')}
    <div class="row wrap"><button class="btn btn-primary" data-act="route-show">ดูบนแผนที่</button></div>
    <p class="muted tiny">ตรวจเฉพาะถนนที่มีข้อมูลระดับน้ำในตอนนี้ (กทม. เท่านั้น) — <b>ถนนที่ไม่ขึ้นรายการ ไม่ได้แปลว่าปลอดภัย</b> ค่าความลึกเป็นค่าประมาณจาก <a href="${ROADS_CREDIT.url}" target="_blank" rel="noopener noreferrer">${ROADS_CREDIT.name}</a> (<a href="${ROADS_CREDIT.licenceUrl}" target="_blank" rel="noopener noreferrer">${ROADS_CREDIT.licence}</a>) ข้อมูลอายุ ${state.roadFlood ? Math.max(0, Math.round((Date.now() - state.roadFlood.generatedAt) / 60000)) : '—'} นาที · เส้นทางคำนวณโดย OSRM จากข้อมูล © OpenStreetMap contributors ไม่ได้คำนึงถึงรถติด · ห้ามขับผ่านน้ำไหลเชี่ยว</p>`;
}

function render() {
  const dlg = $('#route-dialog');
  if (!dlg.open) return;
  const body = dlg.querySelector('.rt-body');
  const keep = { from: body?.querySelector('#rt-from')?.value, to: body?.querySelector('#rt-to')?.value };
  dlg.innerHTML = `<div class="cam-head"><b>ตรวจเส้นทางน้ำท่วม</b><button class="btn btn-sm" data-act="route-close">ปิด</button></div>
    <div class="rt-body">
      ${field('from', 'ต้นทาง')}
      ${field('to', 'ปลายทาง')}
      <div class="rt-field"><label for="rt-veh">ยานพาหนะ</label>
        <select id="rt-veh" class="rm-select">${VEHICLES.map((v, i) => `<option value="${i}"${i === rt.veh ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="row wrap"><button class="btn btn-primary" data-act="route-go"${rt.status === 'loading' ? ' disabled' : ''}>ตรวจเส้นทาง</button>
        <button class="btn btn-ghost" data-act="route-swap">⇅ สลับ</button></div>
      <div id="rt-result">${result()}</div>
    </div>`;
  // keep what the user is typing in a field that has no chosen point yet
  for (const w of ['from', 'to']) if (keep[w] && !rt[w]) dlg.querySelector(`#rt-${w}`).value = keep[w];
}

async function find(which) {
  const q = $(`#rt-${which}`).value.trim();
  if (q.length < 2) return toast('พิมพ์ชื่อสถานที่อย่างน้อย 2 ตัวอักษร');
  rt.found[which] = [];
  $(`#rt-${which}`).closest('.rt-field').insertAdjacentHTML('beforeend', '<p class="muted small rt-wait">กำลังค้นหา…</p>');
  const r = await geocode(q);
  rt.found[which] = r;
  if (!r.length) toast('ไม่พบสถานที่นี้ในพื้นที่บริการ ลองชื่อสั้นลง หรือเลือกบนแผนที่');
  else if (r.length === 1) { rt[which] = { lat: r[0].lat, lng: r[0].lng, label: r[0].name }; rt.found[which] = []; }
  render();
}

function gps(which) {
  if (!navigator.geolocation) return toast('อุปกรณ์นี้ไม่รองรับการหาตำแหน่ง');
  navigator.geolocation.getCurrentPosition(
    (p) => {
      if (!inBounds(p.coords.latitude, p.coords.longitude)) return toast('ตำแหน่งของคุณอยู่นอกพื้นที่บริการ');
      rt[which] = { lat: p.coords.latitude, lng: p.coords.longitude, label: 'ตำแหน่งของฉัน' };
      rt.found[which] = [];
      render();
    },
    () => toast('ไม่ได้รับตำแหน่ง — อนุญาตการเข้าถึงตำแหน่ง หรือพิมพ์ชื่อสถานที่แทน'),
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 120000 },
  );
}

async function go() {
  // a field with text but no chosen place: search it first
  for (const w of ['from', 'to']) {
    const txt = $(`#rt-${w}`)?.value.trim();
    if (!rt[w] && txt) { await find(w); }
  }
  if (!rt.from || !rt.to) return toast(rt.found.from.length || rt.found.to.length ? 'เลือกสถานที่จากรายการที่พบก่อน' : 'เลือกต้นทางและปลายทางก่อน');
  if (!state.roadFlood?.features) return toast('ยังไม่มีข้อมูลน้ำท่วมบนถนน ลองใหม่อีกครั้ง');
  rt.veh = +($('#rt-veh')?.value ?? rt.veh);
  rt.status = 'loading';
  rt.err = '';
  rt.routes = [];
  render();
  try {
    const res = await fetch(osrmUrl(rt.from, rt.to), { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const routes = parseOsrm(await res.json());
    rt.routes = routes.slice(0, 4).map((r) => ({ ...r, check: checkRoute(state.roadFlood.features, r.coords, rt.veh) }));
    rt.sel = rankRoutes(rt.routes)[0];
    rt.status = 'done';
    draw();
    renderBar();
  } catch (e) {
    rt.status = 'error';
    rt.err = /NoRoute|no route/i.test(e.message) ? 'ไม่พบเส้นทางรถยนต์ระหว่างสองจุดนี้' : 'หาเส้นทางไม่สำเร็จ (บริการคำนวณเส้นทางไม่ตอบ) ลองใหม่อีกครั้งในอีกสักครู่';
  }
  render();
}

// recompute the flood check when the vehicle changes (same routes, new verdicts)
function recheck() {
  if (!rt.routes.length || !state.roadFlood?.features) return;
  rt.routes = rt.routes.map((r) => ({ ...r, check: checkRoute(state.roadFlood.features, r.coords, rt.veh) }));
  rt.sel = rankRoutes(rt.routes)[0];
  draw();
  renderBar();
}

function bind() {
  const dlg = $('#route-dialog');
  if (dlg.dataset.bound) return;
  dlg.dataset.bound = '1';
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('[data-rt-in]')) { e.preventDefault(); find(e.target.dataset.rtIn); }
  });
  dlg.addEventListener('input', (e) => {
    if (e.target.matches('[data-rt-in]')) { const w = e.target.dataset.rtIn; rt[w] = null; } // typing again clears the chosen point
  });
  dlg.addEventListener('change', (e) => {
    if (e.target.id === 'rt-veh') { rt.veh = +e.target.value; recheck(); render(); }
  });
  dlg.addEventListener('click', (e) => {
    const t = e.target.closest('[data-rt-find],[data-rt-gps],[data-rt-map],[data-rt-pick],[data-rt-sel]');
    if (!t) return;
    if (t.dataset.rtFind) find(t.dataset.rtFind);
    else if (t.dataset.rtGps) gps(t.dataset.rtGps);
    else if (t.dataset.rtMap) startPick(t.dataset.rtMap);
    else if (t.dataset.rtPick) {
      const [w, i] = t.dataset.rtPick.split(':');
      const p = rt.found[w][+i];
      rt[w] = { lat: p.lat, lng: p.lng, label: p.name };
      rt.found[w] = [];
      render();
    } else if (t.dataset.rtSel) { rt.sel = +t.dataset.rtSel; draw(); renderBar(); render(); }
  });
}

// ───────── map picking ─────────
function startPick(which) {
  rt.picking = which;
  $('#route-dialog').close();
  toast(which === 'from' ? 'แตะบนแผนที่เพื่อเลือกต้นทาง' : 'แตะบนแผนที่เพื่อเลือกปลายทาง', 5000);
}
export const routePicking = () => !!rt.picking;
export function routePick(lat, lng) {
  const which = rt.picking;
  if (!which) return false;
  if (!inBounds(lat, lng)) { toast('จุดนี้อยู่นอกพื้นที่บริการ'); return true; }
  rt[which] = { lat, lng, label: `จุดบนแผนที่ (${lat.toFixed(4)}, ${lng.toFixed(4)})` };
  rt.found[which] = [];
  rt.picking = null;
  draw();
  openDialog();
  return true;
}

function openDialog() {
  const dlg = $('#route-dialog');
  bind();
  if (!dlg.open) dlg.showModal();
  render();
}

// ───────── public actions ─────────
export function openRoute({ to = null, from = null } = {}) {
  if (to) { rt.to = { ...to, label: to.label || 'จุดที่เลือกบนแผนที่' }; rt.found.to = []; }
  if (from) { rt.from = from; rt.found.from = []; }
  openDialog();
}
export function routeShow() { $('#route-dialog').close(); draw(); fit(); }
export function routeClose() { $('#route-dialog').close(); }
export function routeSwap() { [rt.from, rt.to] = [rt.to, rt.from]; rt.routes = []; rt.status = 'idle'; draw(); renderBar(); render(); }
export function routeGo() { go(); }
export function clearRoute() {
  rt.routes = [];
  rt.status = 'idle';
  rt.sel = 0;
  rt.from = null;
  rt.to = null;
  rt.found = { from: [], to: [] };
  draw();
  renderBar();
}
