import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';

import { state, emit, onChange, savePlaces, saveRoads } from './state.js';
import { isWindyPlayer, WINDY_CREDIT_URL } from './lib/windy-cams.js';
import { snapUrl as mcamSnapUrl, sameSpot, isCamId, placeLabel } from './lib/maholan-cams.js';
import { activeFlags, AI_LEVEL_TH } from './lib/maholan-ai.js';
import { MAX_ROADS, DEFAULT_MIN } from './lib/notify-roads.js';
import { DEPTH_BANDS, CLOSED_COLOR, VERDICT_TH, VERDICT_COLOR, VEHICLES, ROADS_CREDIT, confLabel, depthWord, matchRoads, roadGroup, centroid as roadCentroid } from './lib/road-flood.js';
import { initRoom, openRoom, refreshRoom } from './ui/room.js';
import { statusList } from './ui/panel.js';
import { OK, SLOW, OLD, MISSING, LOADING } from './lib/source-status.js';
import { initRouteLayers, openRoute, clearRoute, routePicking, routePick, routeHit } from './ui/route.js';
import { isDhrPage } from './lib/dhr-cams.js';
import { LEGEND, EV_COLOR, stripHtml, compactHtml, dialogHtml } from './lib/legend.js';
import { loadRoadFlood, loadMaholanAi, loadMaholanCams, loadWindyCams, loadYtLive, loadSatFlood, loadNews, loadFloodHistory, loadStations, loadFloods, loadRainObs, loadAccuracy, loadTraffic, loadLongdoIndex } from './lib/data.js';
import { SPEED_LEVEL, EVENT_LABEL, BMA_LINKS } from './lib/bma-traffic.js';
import { intensity1h, intensity24h } from './lib/rain-obs.js';
import { SEVERITY } from './lib/traffy.js';
import { evaluate } from './lib/evaluate.js';
import { createStore, isActive, hasVoted, DEPTHS, PASSABLE } from './lib/store.js';
import { LEVELS, TREND_TH, trendOf } from './lib/thaiwater.js';
import { inBounds, BOUNDS } from './lib/geo.js';
import { esc, ago, fmtTime, toast } from './lib/util.js';
import { TAB_RENDER, BKK_CENTER } from './ui/panel.js';
import { openReportDialog } from './ui/report.js';
import { matchFloods, matchStations, matchReports, matchTraffic, geocode, validQuery } from './lib/search.js';
import { historyGeoJson } from './lib/flood-history.js';
import { corroborateState, TIER } from './lib/corroborate.js';
import { openCamViewer, camViewerEnabled } from './lib/longdo-cams.js';
import { pushStatus, enablePush, disablePush, syncPush, verifyPush, verifyRoads } from './lib/push.js';
import { SITE_URL, lineLink, shareNative, siteShare, pointShare } from './lib/share.js';
import { KINDS, MIN_VERTS, MAX_VERTS, toGeometry, unflatten, validate, describe, lengthM, areaM2, fmtLen, fmtArea, anchor } from './lib/shape.js';

const $ = (s) => document.querySelector(s);
let map;
let allReports = [];
let selMarker = null;
let pickMode = false;
let draw = { mode: 'point', pts: [] };
let popup = null;

/* ───────────── panel ───────────── */
function render() {
  const body = $('#tab-body');
  const top = body.scrollTop;
  body.innerHTML = TAB_RENDER[state.tab]();
  body.scrollTop = top;
  document.querySelectorAll('.tabs [role=tab]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === state.tab)));
  const n = state.reports.length + state.floods.filter((f) => f.lvl === 3).length;
  $('#reports-count').textContent = n ? String(n) : '';
  const nb = $('#nav-badge');
  nb.hidden = !n;
  nb.textContent = n > 99 ? '99+' : String(n);
  document.querySelectorAll('[data-nav]').forEach((b) => b.classList.toggle('on', b.dataset.nav === state.tab));
  renderBanner();
  renderPeek();
}
onChange(render);

// One-line summary visible while the phone bottom sheet is collapsed.
function renderPeek() {
  const el = $('#peek');
  const first = state.saved.find((p) => state.savedEval[p.id]);
  const ev = first ? state.savedEval[first.id] : state.overview;
  if (!ev) return (el.hidden = true);
  const heavyN = state.floods.filter((f) => f.lvl === 3).length;
  const r = !first && heavyN >= 1
    ? { label: 'มีน้ำท่วมหนัก', color: heavyN >= 10 ? '#d7263d' : '#f28c28' }
    : ev.risk;
  const st = state.stations.filter((s) => !s.upstream && !s.stale);
  const over = st.filter((s) => s.level === 5).length;
  el.hidden = false;
  el.style.setProperty('--c', r.color);
  el.innerHTML = `<span class="pk-badge">${esc(r.label)}</span><span class="pk-txt">${first ? esc(first.label) : 'ใจกลางกรุงเทพฯ'}${state.floods.length ? ` · ท่วมหนัก ${state.floods.filter((f) => f.lvl === 3).length} จุด` : ''}${st.length ? ` · คลองล้นตลิ่ง ${over}/${st.length}` : ''}</span>`;
}

function setTab(tab, open = true) {
  state.tab = tab;
  if (open) $('#panel').dataset.open = 'true';
  emit();
}

function renderBanner() {
  const b = $('#banner');
  const msgs = [];
  if (!navigator.onLine) msgs.push('ออฟไลน์ — แสดงข้อมูลล่าสุดที่เครื่องบันทึกไว้ (อาจไม่ตรงปัจจุบัน) · เบอร์ฉุกเฉินในแท็บ "ช่วยเหลือ" ยังใช้ได้');
  if (state.store?.mode === 'local') msgs.push('โหมดทดลอง: รายงานที่ส่งจะเห็นเฉพาะในเครื่องนี้ (ยังไม่ได้เชื่อมฐานข้อมูล)');
  if (state.stationsError && !state.stations.length) msgs.push('โหลดข้อมูลสถานีวัดน้ำไม่ได้ในขณะนี้');
  b.hidden = !msgs.length;
  b.textContent = msgs.join(' · ');
}

/* ───────────── map layers ───────────── */
function pinImage(color) {
  const c = document.createElement('canvas');
  c.width = 44;
  c.height = 56;
  const g = c.getContext('2d');
  g.beginPath();
  g.moveTo(22, 54);
  g.bezierCurveTo(22, 54, 4, 33, 4, 21);
  g.arc(22, 21, 18, Math.PI, 0);
  g.bezierCurveTo(40, 33, 22, 54, 22, 54);
  g.closePath();
  g.fillStyle = color;
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = '#fff';
  g.stroke();
  g.beginPath();
  g.arc(22, 21, 7, 0, Math.PI * 2);
  g.fillStyle = '#fff';
  g.fill();
  return g.getImageData(0, 0, c.width, c.height);
}

// Warning-triangle icon for Traffy (BMA) complaints — a different shape from the citizen pins.
function warnImage(color) {
  const c = document.createElement('canvas');
  c.width = 48;
  c.height = 44;
  const g = c.getContext('2d');
  const tri = () => {
    g.beginPath();
    g.moveTo(24, 4);
    g.lineTo(44, 39);
    g.lineTo(4, 39);
    g.closePath();
  };
  tri();
  g.lineJoin = 'round';
  g.lineWidth = 8;
  g.strokeStyle = '#ffffff';
  g.stroke();
  tri();
  g.fillStyle = color;
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = '#12222e';
  g.stroke();
  g.fillStyle = '#12222e';
  g.fillRect(22.3, 16, 3.4, 13);
  g.beginPath();
  g.arc(24, 33, 2.2, 0, Math.PI * 2);
  g.fill();
  return g.getImageData(0, 0, c.width, c.height);
}

const emptyFC = { type: 'FeatureCollection', features: [] };

function initLayers() {
  Object.entries(DEPTHS).forEach(([k, d]) => map.addImage(`pin-${k}`, pinImage(d.color), { pixelRatio: 2 }));

  map.addSource('traffic-roads', { type: 'geojson', data: emptyFC });
  map.addLayer({ id: 'traffic-roads-casing', type: 'line', source: 'traffic-roads', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 5, 15, 13] } });
  map.addLayer({ id: 'traffic-roads', type: 'line', source: 'traffic-roads', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 3, 15, 8] } });
  // estimated flood depth on roads (Floodboard open data): white casing + a line coloured by depth; faint when the estimate is not confident
  map.addSource('roadflood', { type: 'geojson', data: emptyFC });
  map.addLayer({ id: 'roadflood-casing', type: 'line', source: 'roadflood', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-opacity': 0.85, 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 4, 13, 7, 16, 14] } });
  map.addLayer({
    id: 'roadflood', type: 'line', source: 'roadflood', layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['case', ['==', ['get', 'a'], 1], '#12222e', ['step', ['get', 'd'], '#e6b800', 15, '#f28c28', 30, '#d7263d', 50, '#8b1d4a']],
      'line-opacity': ['interpolate', ['linear'], ['get', 'c'], 0, 0.5, 100, 1],
      'line-width': ['interpolate', ['linear'], ['zoom'], 9, 2.5, 13, 5, 16, 11],
    },
  });
  map.addSource('repeat', { type: 'geojson', data: emptyFC });
  map.addLayer({
    id: 'repeat', type: 'circle', source: 'repeat', layout: { visibility: 'none' },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 3, 13, 9, 16, 22],
      'circle-color': ['step', ['get', 'days'], '#f2c200', 4, '#f28c28', 7, '#d7263d'],
      'circle-opacity': 0.55, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1,
    },
  }, 'traffic-roads-casing');
  map.addSource('sat-flood', { type: 'geojson', data: emptyFC });
  map.addLayer({
    id: 'sat-flood', type: 'circle', source: 'sat-flood', layout: { visibility: 'none' },
    paint: {
      // ~550 m cell: the circle grows with the flooded area inside it (rai), and with the zoom
      // MapLibre allows ["zoom"] only at the top of the expression, so each zoom stop carries its own rai-based size
      'circle-radius': ['interpolate', ['linear'], ['zoom'],
        8, ['*', 0.35, ['+', 3, ['sqrt', ['get', 'rai']]]],
        11, ['*', 0.8, ['+', 3, ['sqrt', ['get', 'rai']]]],
        14, ['*', 2.2, ['+', 3, ['sqrt', ['get', 'rai']]]],
        16, ['*', 4, ['+', 3, ['sqrt', ['get', 'rai']]]],
      ],
      'circle-color': '#1c5fd4', 'circle-opacity': 0.45, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 0.6,
    },
  }, 'traffic-roads-casing');
  map.addSource('windy', { type: 'geojson', data: emptyFC });
  map.addLayer({
    id: 'windy', type: 'circle', source: 'windy', minzoom: 8, layout: { visibility: 'none' },
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 3, 13, 6, 16, 9], 'circle-color': '#0e9f8e', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5 },
  });
  map.addSource('mcams', { type: 'geojson', data: emptyFC });
  map.addLayer({
    id: 'mcams', type: 'circle', source: 'mcams', minzoom: 12, layout: { visibility: 'none', 'circle-sort-key': ['case', ['==', ['get', 'ai'], 1], 1, 0] },
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 3, 16, 7], 'circle-color': ['case', ['==', ['get', 'ai'], 1], '#e0203a', '#7a4fd6'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5 },
  });
  map.addSource('cameras', { type: 'geojson', data: emptyFC });
  map.addLayer({ id: 'cameras', type: 'circle', source: 'cameras', minzoom: 11, layout: { visibility: 'none' }, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 3.5, 16, 8], 'circle-color': ['case', ['get', 'flood'], '#00a6c8', '#4a5b6c'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5 } });

  map.addSource('stations', { type: 'geojson', data: emptyFC });
  map.addLayer({
    id: 'stations',
    type: 'circle',
    source: 'stations',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 5, 13, 9],
      'circle-color': ['get', 'color'],
      'circle-stroke-color': ['case', ['get', 'stale'], '#8a94a3', '#ffffff'],
      'circle-stroke-width': 2,
      'circle-opacity': ['case', ['get', 'stale'], 0.55, 1],
    },
  });

  Object.entries(SEVERITY).forEach(([l, s]) => map.addImage(`warn-${l}`, warnImage(s.color), { pixelRatio: 2 }));
  map.addSource('traffic-events', { type: 'geojson', data: emptyFC });
  map.addLayer({ id: 'traffic-events', type: 'circle', source: 'traffic-events', paint: { 'circle-radius': ['match', ['get', 'kind'], 'flood', 9, 7], 'circle-color': ['match', ['get', 'kind'], 'flood', '#0b6fa8', 'accident', '#f28c28', 'fire', '#d7263d', 'closed', '#12222e', '#8a94a3'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2.5 } });

  map.addSource('rainobs', { type: 'geojson', data: emptyFC });
  map.addLayer({
    id: 'rainobs',
    type: 'circle',
    source: 'rainobs',
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['get', 'r1'], 0, 5, 10, 9, 30, 14],
      'circle-color': ['get', 'color'],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2,
      'circle-opacity': ['case', ['get', 'stale'], 0.4, 0.95],
    },
  });
  map.addSource('floods', { type: 'geojson', data: emptyFC });
  map.addLayer({
    id: 'floods-halo',
    type: 'circle',
    source: 'floods',
    filter: ['==', ['get', 'lvl'], 3],
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 12, 14, 26], 'circle-color': '#d7263d', 'circle-opacity': 0.22, 'circle-blur': 0.5 },
  });
  map.addLayer({
    id: 'floods',
    type: 'symbol',
    source: 'floods',
    layout: {
      'icon-image': ['concat', 'warn-', ['to-string', ['get', 'lvl']]],
      'icon-allow-overlap': true,
      'icon-size': ['match', ['get', 'lvl'], 3, 0.95, 2, 0.8, 0.65],
      'symbol-sort-key': ['get', 'lvl'], // heavy on top
    },
    paint: { 'icon-opacity': ['coalesce', ['get', 'op'], 1] }, // a single-source complaint is drawn a little fainter
  });

  map.addSource('report-shapes', { type: 'geojson', data: emptyFC });
  map.addLayer({ id: 'report-areas', type: 'fill', source: 'report-shapes', filter: ['==', ['get', 'kind'], 'area'], paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.32 } });
  map.addLayer({ id: 'report-area-lines', type: 'line', source: 'report-shapes', filter: ['==', ['get', 'kind'], 'area'], paint: { 'line-color': ['get', 'color'], 'line-width': 2.5, 'line-dasharray': [2, 1.5] } });
  map.addLayer({ id: 'report-lines-casing', type: 'line', source: 'report-shapes', filter: ['==', ['get', 'kind'], 'line'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 6, 16, 14] } });
  map.addLayer({ id: 'report-lines', type: 'line', source: 'report-shapes', filter: ['==', ['get', 'kind'], 'line'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3.5, 16, 9] } });

  map.addSource('reports', { type: 'geojson', data: emptyFC });
  map.addLayer({
    id: 'reports',
    type: 'symbol',
    source: 'reports',
    layout: { 'icon-image': ['get', 'icon'], 'icon-anchor': 'bottom', 'icon-allow-overlap': true, 'icon-size': 0.9 },
  });

  map.addSource('selected', { type: 'geojson', data: emptyFC });
  map.addLayer({
    id: 'selected',
    type: 'circle',
    source: 'selected',
    paint: { 'circle-radius': 9, 'circle-color': '#0b3d5c', 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 },
  });

  initRouteLayers(map);
  map.addSource('draft', { type: 'geojson', data: emptyFC });
  map.addLayer({ id: 'draft-fill', type: 'fill', source: 'draft', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#0b6fa8', 'fill-opacity': 0.25 } });
  map.addLayer({ id: 'draft-line', type: 'line', source: 'draft', filter: ['in', ['geometry-type'], ['literal', ['LineString', 'Polygon']]], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#0b3d5c', 'line-width': 4, 'line-dasharray': [1.5, 1.2] } });
  map.addLayer({ id: 'draft-pts', type: 'circle', source: 'draft', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 7, 'circle-color': '#ffffff', 'circle-stroke-color': '#0b3d5c', 'circle-stroke-width': 3 } });

  refreshStationsLayer();
  refreshFloodsLayer();
  refreshRainLayer();
  refreshTrafficLayers();
  refreshReportsLayer();
}

function refreshStationsLayer() {
  const src = map?.getSource('stations');
  if (!src) return;
  src.setData({
    type: 'FeatureCollection',
    features: state.stations.map((s) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
      properties: { id: s.id, color: LEVELS[s.level].color, stale: s.stale },
    })),
  });
}

function refreshWindyLayer() {
  const w = state.windyCams;
  if (!w?.cams) return;
  map?.getSource('windy')?.setData({
    type: 'FeatureCollection',
    features: w.cams.map((c) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [c.lng, c.lat] }, properties: { id: c.id } })),
  });
}
function windyPopup(c) {
  openPopup([c.lng, c.lat], `<div class="pp"><div class="pp-title">กล้อง (Windy)</div>
    <p class="small"><b>${esc(c.title)}</b></p>
    <p class="muted tiny">${c.updated ? `ภาพล่าสุด ${ago(c.updated)}` : ''} · ภาพย้อนหลัง 24 ชม. แบบเร่งเวลา เล่นผ่านตัวเล่นของ Windy</p>
    <div class="row wrap"><button class="btn btn-sm btn-primary" data-act="windy-open" data-id="${esc(c.id)}">ดูภาพย้อนหลัง 24 ชม.</button>
    ${c.detail ? `<a class="btn btn-sm" href="${esc(c.detail)}" target="_blank" rel="noopener noreferrer">เปิดที่ Windy ↗</a>` : ''}</div>
    <p class="muted tiny">Webcams provided by <a href="https://www.windy.com" target="_blank" rel="noopener noreferrer">Windy.com</a> — <a href="${WINDY_CREDIT_URL}" target="_blank" rel="noopener noreferrer">add a webcam</a></p></div>`);
}
function refreshRoadFloodLayer() {
  const r = state.roadFlood;
  if (!r?.features) return;
  map?.getSource('roadflood')?.setData({ type: 'FeatureCollection', features: r.features });
}
const following = (name) => state.myRoads.some((r) => r.name === name);
const followRow = (name) => `<div class="row wrap">${following(name) ? `<span class="small">🔔 ติดตามถนนนี้อยู่ (ดู/ตั้งค่าที่หน้า “สถานการณ์”)</span>` : `<button class="btn btn-sm" data-act="road-follow" data-name="${esc(name)}">🔔 แจ้งเตือนถนนนี้</button>`}</div>`;
// keep the server's copy in step with the roads/places saved here (silent when alerts are off)
// and says what happened for the followed roads: saving → ok (the server's copy was read back and matches) or error (with the reason, e.g. permission-denied)
async function syncAlerts(refreshStatus = false) {
  if (!pushStatus().enabled) { state.roadSync = null; if (refreshStatus) { state.push = pushStatus(); emit(); } return; }
  const withRoads = state.myRoads.length > 0;
  if (withRoads) { state.roadSync = { status: 'saving' }; emit(); }
  try {
    await syncPush(state.saved, state.myRoads);
    if (withRoads) {
      const v = await verifyRoads(state.myRoads);
      state.roadSync = v.ok ? { status: 'ok', at: Date.now() } : { status: 'error', error: v.why };
    } else state.roadSync = null;
  } catch (e) {
    state.roadSync = { status: 'error', error: `${e?.code ? `${e.code}: ` : ''}${String(e?.message || e).slice(0, 140)}` };
  }
  if (refreshStatus) state.push = pushStatus();
  emit();
}
const vehicleChips = (v) => VEHICLES.map((n, i) => `<span class="vd" style="--c:${VERDICT_COLOR[v[i]]}"><i></i>${n}: <b>${VERDICT_TH[v[i]]}</b></span>`).join('');
const roadCredit = () => `<p class="muted tiny">ค่าประมาณที่รวมจากหลายแหล่ง (เซ็นเซอร์ กทม. Traffy ข่าว โซเชียล) ไม่ใช่ค่าวัดทางการ · ข้อมูลจาก <a href="${ROADS_CREDIT.url}" target="_blank" rel="noopener noreferrer">${ROADS_CREDIT.name}</a> (<a href="${ROADS_CREDIT.licenceUrl}" target="_blank" rel="noopener noreferrer">${ROADS_CREDIT.licence}</a>) ปรับรูปแบบให้กะทัดรัด</p>`;
// one segment of a road (the coloured line you tapped)
function floodRoadPopup(p, lngLat) {
  const v = typeof p.v === 'string' ? JSON.parse(p.v) : p.v;
  const word = depthWord(+p.d);
  openPopup(lngLat, `<div class="pp"><div class="pp-title">${esc(p.n || 'ถนน/ซอย (ไม่ระบุชื่อ)')}</div>
    <p class="small">${+p.a ? '<span class="tag warn">ปิดการจราจร</span> ' : +p.s ? '<span class="tag warn">รถเล็กผ่านไม่ได้</span> ' : ''}${+p.d > 0 ? `ระดับน้ำประมาณ <b>${+p.d} ซม.</b>${word ? ` (${word})` : ''}` : 'ไม่มีค่าความลึก'}</p>
    <div class="vds">${vehicleChips(v)}</div>
    <p class="muted tiny">ความเชื่อมั่น <b>${confLabel(+p.c)}</b> · ข้อมูลอัปเดต ${ago(+p.u)}</p>${p.n ? followRow(p.n) : ''}${roadCredit()}</div>`);
}
// a whole road (opened from the list)
function floodRoadGroupPopup(name) {
  const g = roadGroup(state.roadFlood?.features || [], name);
  if (!g) return;
  const c = roadCentroid(g.coords);
  openPopup([c.lng, c.lat], `<div class="pp"><div class="pp-title">${esc(g.name)}</div>
    <p class="small">ลึกสุดราว <b>${g.maxD} ซม.</b>${depthWord(g.maxD) ? ` (${depthWord(g.maxD)})` : ''} · ${g.segs} ช่วง ราว ${(g.meters / 1000).toFixed(1)} กม.${g.closedAll ? ` · ปิดการจราจร ${g.closedAll} ช่วง` : ''}</p>
    <div class="vds">${vehicleChips(g.v)}</div>
    <p class="muted tiny">สถานะที่แย่ที่สุดของถนนสายนี้ · แตะเส้นสีบนแผนที่เพื่อดูแต่ละช่วง · ความเชื่อมั่น ${confLabel(g.conf)} · อัปเดต ${ago(g.upd)}</p>${followRow(g.name)}${roadCredit()}</div>`);
}
function refreshMcamLayer() {
  const m = state.mcams;
  if (!m?.cams) return;
  const ai = activeFlags(state.mcamAi);
  map?.getSource('mcams')?.setData({
    type: 'FeatureCollection',
    features: m.cams.map((c) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [c.lng, c.lat] }, properties: { id: c.id, ai: ai.has(c.id) ? 1 : 0 } })),
  });
}
// A camera's latest frame comes straight from cctv.maholan.net's snapshot URL (same 30 s time bucket as their own page) while it is open here;
// nothing is stored. A pole can carry several cameras (CAM1..CAM3) → step through them.
let mcamTimer = null;
const stopMcamTimer = () => { clearInterval(mcamTimer); mcamTimer = null; };
function mcamBody(c, group, i) {
  const many = group.length > 1;
  const fl = activeFlags(state.mcamAi).get(c.id);
  return `<p class="small"><b>${esc(c.n)}</b></p>
    ${fl ? `<p class="small"><span class="tag warn">💧 AI พบน้ำท่วม · ${AI_LEVEL_TH[fl.level]} ${Math.round(fl.conf * 100)}%</span> <span class="muted tiny">อ่านภาพอัตโนมัติ ยังไม่ยืนยัน — เทียบกับภาพด้านล่าง</span></p>` : ''}
    ${c.link && isDhrPage(c.link) ? `<div class="mcam-frame mcam-live"><a class="btn btn-primary" href="${esc(c.link)}" target="_blank" rel="noopener noreferrer">เปิดภาพสดที่เว็บของเทศบาล ↗</a></div>` : `<div class="mcam-frame"><img class="mcam-img" data-mcam-img="${esc(c.id)}" src="${mcamSnapUrl(c.id)}" alt="ภาพล่าสุดจากกล้อง ${esc(c.n)}" referrerpolicy="no-referrer" decoding="async" /><p class="mcam-err muted small" hidden>ภาพจากกล้องนี้ไม่พร้อมตอนนี้</p></div>`}
    <p class="muted tiny">${c.link ? 'ภาพสดดูได้ที่เว็บของเจ้าของกล้อง (เว็บนี้ไม่ได้นำภาพมาแสดง) · เลือกกล้องจากแผนที่ของเขา' : 'ภาพนิ่งล่าสุด รีเฟรชเองทุก 30 วินาที — <b>ดูเวลาที่พิมพ์บนภาพ</b> บางกล้องอัปเดตช้ากว่านั้น'}${placeLabel(c) ? ` · ${esc(placeLabel(c))}` : ''}</p>
    <div class="row wrap">${many ? `<button class="btn btn-sm" data-act="mcam-step" data-id="${esc(c.id)}" data-dir="-1">‹ ก่อนหน้า</button><span class="muted small">${i + 1}/${group.length} กล้องที่จุดนี้</span><button class="btn btn-sm" data-act="mcam-step" data-id="${esc(c.id)}" data-dir="1">ถัดไป ›</button>` : ''}
    ${c.link ? '' : `<button class="btn btn-sm btn-primary" data-act="mcam-big" data-id="${esc(c.id)}">ขยายภาพ</button>`}</div>`;
}
function wireMcamImg(root) {
  const img = root?.querySelector?.('[data-mcam-img]');
  if (!img) return;
  const err = root.querySelector('.mcam-err');
  img.onerror = () => { img.hidden = true; if (err) err.hidden = false; };
  img.onload = () => { img.hidden = false; if (err) err.hidden = true; };
  stopMcamTimer();
  const id = img.dataset.mcamImg;
  mcamTimer = setInterval(() => {
    if (!img.isConnected) return stopMcamTimer();
    if (document.hidden) return;
    img.src = mcamSnapUrl(id);
  }, 30000);
}
function mcamPopup(c, idx = null) {
  const cams = state.mcams?.cams || [];
  const group = sameSpot(cams, c);
  const i = idx ?? Math.max(0, group.findIndex((x) => x.id === c.id));
  const cur = group[i] || c;
  const p = openPopup([cur.lng, cur.lat], `<div class="pp mcam-pp"><div class="pp-title">ภาพกล้อง CCTV</div><div data-mcam-body>${mcamBody(cur, group, i)}</div></div>`);
  p.on('close', stopMcamTimer);
  wireMcamImg(p.getElement());
}
function refreshSatLayer() {
  const s = state.satFlood;
  if (!s?.cells) return;
  map?.getSource('sat-flood')?.setData({
    type: 'FeatureCollection',
    features: s.cells.map((c) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [c[1], c[0]] }, properties: { rai: c[2], people: c[3], pv: c[4] } })),
  });
}
function satPopup(p, lngLat) {
  const s = state.satFlood;
  const pv = s?.provinces?.find((x) => x.id === +p.pv);
  openPopup(lngLat, `<div class="pp"><div class="pp-title">น้ำท่วมตามภาพดาวเทียมเรดาร์</div>
    <p class="small">พื้นที่ที่ดาวเทียมเห็นว่าท่วม ≈ <b>${Math.round(p.rai).toLocaleString('th-TH')} ไร่</b> ในช่องราว 550 ม.${+p.people ? ` · ประชากรที่น่าจะได้รับผลกระทบ ≈ ${(+p.people).toLocaleString('th-TH')} คน` : ''}${pv ? ` · ${esc(pv.name)}` : ''}</p>
    <p class="muted tiny">ภาพดาวเทียมผ่านล่าสุด ${s?.lastPass ? esc(s.lastPass) : '—'} · ดาวเทียมเรดาร์เห็นน้ำนอกเมืองและนาได้ดี แต่มองถนนในเมืองหนาแน่นไม่ค่อยได้ และผ่านทุกไม่กี่วัน น้ำอาจลดหรือเพิ่มไปแล้ว · ที่มา: GISTDA (สทอภ.)</p></div>`);
}
function refreshRepeatLayer() {
  if (state.floodHistory?.cells) map?.getSource('repeat')?.setData(historyGeoJson(state.floodHistory.cells));
}
function repeatPopup(p, lngLat) {
  const h = state.floodHistory;
  openPopup(lngLat, `<div class="pp"><div class="pp-title">จุดที่มีคนแจ้งน้ำท่วมซ้ำ</div>
    <p class="small">มีการแจ้งน้ำท่วมใน <b>${p.days} วันที่ต่างกัน</b> (รวม ${p.n} เรื่อง) ในช่องพื้นที่ราว 275 ม.</p>
    <p class="muted tiny">ครั้งแรก ${esc(p.first)} · ล่าสุด ${esc(p.last)}${h ? ` · ข้อมูลแจ้งช่วง ${esc(h.from)} ถึง ${esc(h.to)}` : ''} · เป็นข้อความแจ้งของประชาชน ไม่ใช่ค่าที่วัดได้ ระบุความลึกไม่ได้</p></div>`);
}
function refreshTrafficLayers() {
  const t = state.traffic;
  map?.getSource('traffic-roads')?.setData({
    type: 'FeatureCollection',
    features: t.roads.flatMap((r) => r.paths.map((p) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: p }, properties: { lv: r.lv, sp: r.sp, t: r.t, color: SPEED_LEVEL[r.lv].color } }))),
  });
  map?.getSource('cameras')?.setData({
    type: 'FeatureCollection',
    features: t.cameras.map((c) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [c.lng, c.lat] }, properties: { id: c.id, flood: c.flood } })),
  });
  map?.getSource('traffic-events')?.setData({
    type: 'FeatureCollection',
    features: t.events.map((e) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [e.lng, e.lat] }, properties: { id: e.id, kind: e.kind } })),
  });
}

function refreshRainLayer() {
  const src = map?.getSource('rainobs');
  if (!src) return;
  src.setData({
    type: 'FeatureCollection',
    features: state.rainObs.map((g) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [g.lng, g.lat] },
      // colour by the 1 h rate when known, otherwise by the 24 h total
      properties: { id: g.id, r1: g.r1 ?? 0, stale: g.stale, color: (g.r1 !== null ? intensity1h(g.r1) : intensity24h(g.r24)).color },
    })),
  });
}

function refreshFloodsLayer() {
  const src = map?.getSource('floods');
  if (!src) return;
  const now = Date.now();
  src.setData({
    type: 'FeatureCollection',
    features: state.floods
      .filter((f) => now - f.t < 24 * 3600e3)
      .map((f) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [f.lng, f.lat] }, properties: { id: f.id, lvl: f.lvl, op: TIER[corroborateState(f, state, now).tier].opacity } })),
  });
}

function refreshReportsLayer() {
  state.reports = allReports.filter((r) => isActive(r));
  const src = map?.getSource('reports');
  if (src) {
    src.setData({
      type: 'FeatureCollection',
      features: state.reports.map((r) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
        properties: { id: r.id, icon: `pin-${r.depth}` },
      })),
    });
  }
  const shp = map?.getSource('report-shapes');
  if (shp) {
    shp.setData({
      type: 'FeatureCollection',
      features: state.reports
        .filter((r) => r.kind && r.kind !== 'point' && r.geom)
        .map((r) => ({
          type: 'Feature',
          geometry: toGeometry(r.kind, unflatten(r.geom)),
          properties: { id: r.id, kind: r.kind, color: DEPTHS[r.depth]?.color || '#0b6fa8' },
        })),
    });
  }
  emit();
}

function refreshSelectedLayer() {
  const src = map?.getSource('selected');
  if (!src) return;
  src.setData(
    state.selected
      ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [state.selected.lng, state.selected.lat] }, properties: {} }] }
      : emptyFC,
  );
}

/* ───────────── radar ───────────── */
const radar = { frames: null, host: '', i: 0, timer: null, on: false };
async function setRadar(on) {
  radar.on = on;
  const label = $('#radar-time');
  label.hidden = !on;
  clearInterval(radar.timer);
  if (!radar.frames && on) {
    try {
      const j = await (await fetch('https://api.rainviewer.com/public/weather-maps.json')).json();
      radar.host = j.host;
      radar.frames = j.radar.past.slice(-8);
      radar.frames.forEach((f, k) => {
        map.addSource(`radar-${k}`, {
          type: 'raster', tileSize: 256, maxzoom: 7, // RainViewer free tiles stop at zoom 7 (map overzooms)
          tiles: [`${radar.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`],
        });
        map.addLayer({ id: `radar-${k}`, type: 'raster', source: `radar-${k}`, paint: { 'raster-opacity': 0, 'raster-fade-duration': 0 } }, 'stations');
      });
    } catch {
      toast('โหลดเรดาร์ฝนไม่ได้ในขณะนี้');
      $('#ly-radar').checked = false;
      radar.on = false;
      label.hidden = true;
      return;
    }
  }
  if (!radar.frames) return;
  const show = (k) => {
    radar.frames.forEach((_, j) => map.setPaintProperty(`radar-${j}`, 'raster-opacity', on && j === k ? 0.65 : 0));
    label.textContent = on ? `เรดาร์ ${fmtTime(radar.frames[k].time * 1000)} น.` : '';
  };
  if (!on) return show(-1);
  radar.i = radar.frames.length - 1;
  show(radar.i);
  radar.timer = setInterval(() => {
    radar.i = (radar.i + 1) % radar.frames.length;
    show(radar.i);
  }, 700);
}

/* ───────────── popups ───────────── */
function openPopup(lngLat, html) {
  popup?.remove();
  popup = new maplibregl.Popup({ maxWidth: '300px', offset: 12 }).setLngLat(lngLat).setHTML(html).addTo(map);
  return popup;
}

function stationPopup(s) {
  const lv = LEVELS[s.level];
  openPopup([s.lng, s.lat], `<div class="pp">
    <div class="pp-title">${esc(s.name)}</div><div class="muted small">${esc(s.prov)} · ${esc(s.agency)}</div>
    <p><span class="tag" style="background:${lv.color};color:#fff">${lv.label}</span> ${TREND_TH[trendOf(s)]}</p>
    ${s.over !== null ? `<p class="small">ระดับน้ำ${s.over >= 0 ? 'สูงกว่า' : 'ต่ำกว่า'}ตลิ่ง <b>${Math.abs(Math.round(s.over * 100))} ซม.</b></p>` : ''}
    ${s.msl !== null ? `<p class="small muted">ระดับน้ำ ${s.msl} ม.รทก.</p>` : ''}
    ${s.q !== null ? `<p class="small">ปริมาณน้ำ <b>${Math.round(s.q).toLocaleString('th-TH')}</b> ลบ.ม./วินาที</p>` : ''}
    <p class="muted tiny">${s.t ? `อัปเดต ${fmtTime(s.t)} น.` : ''}${s.stale ? ' · <b>ข้อมูลเก่า อาจไม่ตรงปัจจุบัน</b>' : ''}</p>
    <button class="btn btn-sm btn-primary" data-act="station-forecast" data-id="${esc(s.id)}">ดูพยากรณ์ตรงนี้</button></div>`);
}

function eventPopup(e) {
  openPopup([e.lng, e.lat], `<div class="pp">
    <div class="pp-title" style="color:${EV_COLOR[e.kind]}">${EVENT_LABEL[e.kind] || 'เหตุการณ์'}</div>
    <p class="small"><b>${esc(e.title)}</b></p>
    ${e.detail ? `<p class="small">${esc(e.detail)}</p>` : ''}
    <p class="muted tiny">${e.t ? `เหตุเมื่อ ${ago(e.t)}` : ''} · ที่มา: ศูนย์ข้อมูลจราจร กทม. (ประกาศทางการ)</p>
    <div class="row wrap"><button class="btn btn-sm btn-primary" data-act="point-forecast" data-lat="${e.lat}" data-lng="${e.lng}">ดูพยากรณ์ตรงนี้</button>
    <a class="btn btn-sm" href="${BMA_LINKS.bma}" target="_blank" rel="noopener">เว็บจราจร กทม. ↗</a></div></div>`);
}
function cameraPopup(c) {
  openPopup([c.lng, c.lat], `<div class="pp">
    <div class="pp-title">กล้องจราจร กทม.${c.flood ? ' <span class="tag warn">จุดเฝ้าระวังน้ำท่วม</span>' : ''}</div>
    <p class="small"><b>${esc(c.name)}</b></p>
    ${c.desc && c.desc !== '-' ? `<p class="small muted">${esc(c.desc)}</p>` : ''}
    <p class="muted tiny">ภาพสดต้องดูที่เว็บทางการของ กทม. (เว็บนี้ไม่ได้นำภาพมาแสดงเอง) — ค้นหารหัส/ชื่อกล้องด้านบนในแผนที่ของเขา</p>
    <div class="row wrap"><a class="btn btn-sm btn-primary" href="${BMA_LINKS.bma}" target="_blank" rel="noopener">เปิดกล้อง กทม. ↗</a>
    <a class="btn btn-sm" href="${BMA_LINKS.itic}" target="_blank" rel="noopener">iTIC live ↗</a></div></div>`);
}
function roadPopup(p, lngLat) {
  const lv = SPEED_LEVEL[p.lv];
  openPopup(lngLat, `<div class="pp"><div class="pp-title" style="color:${lv.color}">${lv.label}</div>
    <p class="small">ความเร็วเฉลี่ยช่วงนี้ ≈ <b>${p.sp ?? '—'} กม./ชม.</b></p>
    <p class="muted tiny">อัปเดต ${p.t ? ago(+p.t) : '—'} · ที่มา: ระบบตรวจสภาพจราจร กทม. (ครอบคลุมเฉพาะถนนหลักที่มีเซ็นเซอร์)</p></div>`);
}

function rainPopup(g) {
  const i1 = intensity1h(g.r1);
  const i24 = intensity24h(g.r24);
  openPopup([g.lng, g.lat], `<div class="pp">
    <div class="pp-title">${esc(g.name || 'สถานีวัดฝน')}</div><div class="muted small">${esc(g.prov)} · ${esc(g.agency)}</div>
    <p class="small">1 ชม. ล่าสุด: <b style="color:${i1.color}">${g.r1 ?? '—'} มม.</b> (${i1.label})<br>สะสม 24 ชม.: <b style="color:${i24.color}">${g.r24 ?? '—'} มม.</b> (${i24.label})</p>
    <p class="muted tiny">${g.t ? `ข้อมูล ${fmtTime(g.t)} น.` : ''}${g.stale ? ' · <b>ข้อมูลเก่า</b>' : ''} · ที่มา: ThaiWater</p>
    <button class="btn btn-sm btn-primary" data-act="point-forecast" data-lat="${g.lat}" data-lng="${g.lng}">ดูพยากรณ์ตรงนี้</button></div>`);
}

// "How well is this backed up?" — see src/lib/corroborate.js
function confidenceHtml(f) {
  const c = corroborateState(f, state);
  const list = c.signals.length
    ? `<ul class="reasons">${c.signals.map((s) => `<li>${esc(s.text)}</li>`).join('')}</ul>`
    : '<p class="muted tiny">ยังไม่พบแหล่งอื่นยืนยันบริเวณนี้ — ไม่ได้แปลว่าไม่จริง อาจยังไม่มีคนอื่นเห็น/แจ้ง ใช้ประกอบการตัดสินใจ</p>';
  return `<p class="small"><span class="tag" style="background:${c.color}22;color:${c.color}">${c.label}</span></p>${list}`;
}
function floodPopup(f) {
  const sv = SEVERITY[f.lvl];
  openPopup([f.lng, f.lat], `<div class="pp">
    <div class="pp-title" style="color:${sv.color}">⚠ ${sv.label}</div>
    <div class="muted small">${esc(f.district ? `เขต${f.district}` : 'กทม.')} · แจ้งเมื่อ ${ago(f.t)}</div>
    ${f.depth ? `<p class="small">ระดับน้ำที่ผู้แจ้งระบุ ≈ <b>${f.depth} ซม.</b></p>` : ''}
    ${f.help ? '<p class="note">มีผู้ร้องขอความช่วยเหลือ — หากอันตรายถึงชีวิตโทร 1669 / 1784</p>' : ''}
    ${confidenceHtml(f)}
    <p class="small">${esc(f.text)}</p>
    ${f.photo ? `<a href="${esc(f.photo)}" target="_blank" rel="noopener"><img class="pp-img" src="${esc(f.photo)}" loading="lazy" alt="รูปจากผู้แจ้ง" /></a>` : ''}
    <p class="muted tiny">สถานะ: ${esc(f.state)}${f.near ? ` · มีแจ้งใกล้เคียง ${f.near} เรื่อง (300 ม.)` : ''}<br>ความหนักประเมินจากข้อความร้องเรียน ไม่ใช่ค่าที่วัดจริง · ที่มา: Traffy Fondue / กทม.</p>
    <button class="btn btn-sm btn-primary" data-act="point-forecast" data-lat="${f.lat}" data-lng="${f.lng}">ดูพยากรณ์ตรงนี้</button></div>`);
}

function reportPopup(r) {
  const d = DEPTHS[r.depth];
  const voted = hasVoted(r.id);
  const p = openPopup([r.lng, r.lat], `<div class="pp">
    <div class="pp-title" style="color:${d?.color}">${esc(d?.label || r.depth)}</div>
    <div class="small">${esc(PASSABLE[r.passable] || '')} · ${ago(Math.max(r.createdAt, r.lastConfirmedAt))}</div>
    ${r.kind && r.kind !== 'point' ? `<div class="small muted">${KINDS[r.kind]} · ${describe(r.kind, unflatten(r.geom))}</div>` : ''}
    ${r.note ? `<p class="small">${esc(r.note)}</p>` : ''}
    <div class="pp-photos">${r.thumb ? `<img src="${esc(r.thumb)}" alt="" />` : ''}</div>
    <div class="muted tiny">ยืนยัน ${r.stillCount} · น้ำลด ${r.goneCount} · ผิด ${r.wrongCount}</div>
    <div class="row wrap">
      <button class="btn btn-sm" data-act="vote" data-type="still" data-id="${esc(r.id)}" ${voted ? 'disabled' : ''}>ยังท่วมอยู่</button>
      <button class="btn btn-sm" data-act="vote" data-type="gone" data-id="${esc(r.id)}" ${voted ? 'disabled' : ''}>น้ำลดแล้ว</button>
      <button class="btn btn-sm btn-ghost" data-act="vote" data-type="wrong" data-id="${esc(r.id)}" ${voted ? 'disabled' : ''}>ข้อมูลผิด</button></div>
    ${voted ? '<div class="muted tiny">คุณโหวตรายงานนี้แล้ว</div>' : ''}</div>`);
  state.store.getPhotos(r.id).then((ph) => {
    const box = p.getElement()?.querySelector('.pp-photos');
    if (box && ph.length) box.innerHTML = ph.map((u) => `<img src="${u}" alt="รูปน้ำท่วม" />`).join('');
  }).catch(() => {});
}

/* ───────────── selection / forecast ───────────── */
let evalSeq = 0;
async function selectPoint(lat, lng, { fly = false } = {}) {
  if (!inBounds(lat, lng)) return toast('จุดนี้อยู่นอกพื้นที่บริการ (กทม. ปริมณฑล และภาคตะวันออก)');
  state.selected = { lat, lng };
  state.forecast = { loading: true };
  refreshSelectedLayer();
  if (fly) map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 12.5) });
  setTab('forecast');
  const seq = ++evalSeq;
  try {
    const ev = await evaluate(lat, lng);
    if (seq !== evalSeq) return;
    state.forecast = ev;
  } catch (e) {
    if (seq !== evalSeq) return;
    state.forecast = { error: e.message || String(e) };
  }
  emit();
}

async function refreshSaved() {
  await Promise.all(
    state.saved.map(async (p) => {
      try {
        state.savedEval[p.id] = await evaluate(p.lat, p.lng);
      } catch {
        /* chip stays "กำลังประเมิน…" */
      }
    }),
  );
  emit();
}
async function refreshOverview() {
  try {
    state.overview = await evaluate(BKK_CENTER.lat, BKK_CENTER.lng);
  } catch {
    state.overview = null;
  }
  emit();
}

function locate() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('เบราว์เซอร์ไม่รองรับตำแหน่ง'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => reject(new Error(e.code === 1 ? 'ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง — เปิดสิทธิ์ตำแหน่งในเบราว์เซอร์' : 'หาตำแหน่งไม่ได้')),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
    );
  });
}

/* ───────────── report flow ───────────── */
const PICK_HINT = {
  point: 'เลื่อนแผนที่ให้หมุดตรงจุดที่น้ำท่วม แล้วกดยืนยัน',
  line: 'แตะแผนที่ตามแนวถนนที่น้ำท่วม ทีละจุด (หรือเลื่อนแผนที่แล้วกด "+ จุดกลางจอ") อย่างน้อย 2 จุด',
  area: 'แตะแผนที่รอบขอบเขตที่น้ำท่วม ทีละจุด อย่างน้อย 3 จุด (เช่น หมู่บ้าน ลานจอดรถ ทุ่ง)',
};

function refreshDraft() {
  const src = map?.getSource('draft');
  if (src) {
    const f = [];
    const p = draw.pts;
    if (draw.mode !== 'point' && p.length >= 2) f.push({ type: 'Feature', geometry: toGeometry(draw.mode === 'area' && p.length >= 3 ? 'area' : 'line', p), properties: {} });
    if (draw.mode !== 'point') p.forEach(([la, ln]) => f.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [ln, la] }, properties: {} }));
    src.setData({ type: 'FeatureCollection', features: f });
  }
  const isDraw = draw.mode !== 'point';
  $('#draw-add').hidden = $('#draw-undo').hidden = $('#draw-clear').hidden = !isDraw;
  $('#pick-gps').hidden = false;
  const stats = $('#draw-stats');
  stats.hidden = !isDraw;
  if (isDraw) {
    const n = draw.pts.length;
    const info = n >= MIN_VERTS[draw.mode] ? describe(draw.mode, draw.pts) : `ต้องมีอย่างน้อย ${MIN_VERTS[draw.mode]} จุด`;
    stats.textContent = `${n} จุด · ${info}`;
  }
  $('#pick-ok').disabled = isDraw && draw.pts.length < MIN_VERTS[draw.mode];
  document.querySelectorAll('[data-pmode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.pmode === draw.mode)));
  $('#pick-hint').textContent = PICK_HINT[draw.mode];
}

function setPickMode(mode, pts = []) {
  draw = { mode, pts: [...pts] };
  if (mode === 'point') map.doubleClickZoom.enable();
  else map.doubleClickZoom.disable(); // two quick taps must add two vertices, not zoom
  refreshDraft();
}

function startPick(mode = 'point', pts = []) {
  pickMode = true;
  $('#app').classList.add('picking');
  $('#pickbar').hidden = false;
  $('#panel').dataset.open = 'false';
  setPickMode(mode, pts);
}
function endPick() {
  pickMode = false;
  $('#app').classList.remove('picking');
  $('#pickbar').hidden = true;
  map.doubleClickZoom.enable();
  draw = { mode: 'point', pts: [] };
  refreshDraft();
}

function addVertex(lat, lng) {
  if (draw.mode === 'point') return;
  if (!inBounds(lat, lng)) return toast('จุดนี้อยู่นอกพื้นที่บริการ (กทม. ปริมณฑล และภาคตะวันออก)');
  if (draw.pts.length >= MAX_VERTS) return toast(`วาดได้ไม่เกิน ${MAX_VERTS} จุด`);
  draw.pts.push([lat, lng]);
  refreshDraft();
}

async function doShare(payload) {
  try {
    const r = await shareNative(payload);
    if (r === 'copied') toast('คัดลอกข้อความและลิงก์แล้ว — วางส่งต่อได้เลย');
  } catch {
    toast(payload.url, 8000);
  }
}

/* ───────────── search ───────────── */
function fitTo(pts) {
  const b = new maplibregl.LngLatBounds();
  pts.forEach((p) => b.extend(p));
  const narrow = innerWidth < 900;
  // keep the result clear of the bottom sheet on phones
  map.fitBounds(b, { padding: { top: 130, left: 40, right: 40, bottom: narrow ? 340 : 60 }, maxZoom: 16, duration: 900 });
  if (narrow) $('#panel').dataset.open = 'false';
}

let searchSeq = 0;
async function runSearch(q) {
  if (!validQuery(q)) return toast('พิมพ์ชื่อถนน ซอย เขต หรือสถานที่ อย่างน้อย 2 ตัวอักษร');
  const seq = ++searchSeq;
  state.search = { q, status: 'loading', floods: [], stations: [], reports: [], places: [], roads: [], traffic: { events: [], dds: [], cameras: [] } };
  state.tab = 'reports';
  state.district = '';
  $('#panel').dataset.open = 'true';
  emit();

  // local results are instant; places (network) are added when they arrive
  const floods = matchFloods(state.floods, q);
  state.search = { q, status: 'loading', floods, stations: matchStations(state.stations, q), reports: matchReports(allReports.filter((r) => isActive(r)), q), places: [], roads: matchRoads(state.roadFlood?.features || [], q), traffic: matchTraffic(state.traffic, q) };
  emit();
  if (floods.length) fitTo(floods.slice(0, 60).map((f) => [f.lng, f.lat]));

  const places = await geocode(q);
  if (seq !== searchSeq) return;
  state.search = { ...state.search, status: 'done', places };
  emit();
  if (!floods.length && places[0]) {
    map.flyTo({ center: [places[0].lng, places[0].lat], zoom: 15 });
  }
}
$('#search').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('#search-q').value.trim();
  if (q) runSearch(q);
});

/* ───────────── events ───────────── */
const actions = {
  'fly-station': ({ id }) => {
    const s = state.stations.find((x) => String(x.id) === id);
    if (!s) return;
    $('#panel').dataset.open = 'false';
    map.flyTo({ center: [s.lng, s.lat], zoom: 14 });
    stationPopup(s);
  },
  'station-forecast': ({ id }) => {
    const s = state.stations.find((x) => String(x.id) === id);
    if (s) selectPoint(s.lat, s.lng);
  },
  'push-enable': async () => {
    state.push = { ...pushStatus(), busy: true };
    emit();
    try {
      await enablePush(state.saved, (stage) => {
        state.push = { ...state.push, busy: true, stage };
        emit();
      }, state.myRoads);
      toast('เปิดแจ้งเตือนแล้ว');
      state.push = { ...pushStatus(), verified: await verifyPush() };
      if (state.myRoads.length) { const v = await verifyRoads(state.myRoads); state.roadSync = v.ok ? { status: 'ok', at: Date.now() } : { status: 'error', error: v.why }; }
    } catch (e) {
      state.push = { ...pushStatus(), error: e.message || String(e) };
    }
    emit();
  },
  'push-disable': async () => {
    state.push = { ...pushStatus(), busy: true };
    emit();
    try {
      await disablePush();
      toast('ปิดแจ้งเตือนแล้ว และลบข้อมูลของคุณออกจากเซิร์ฟเวอร์');
      state.push = pushStatus();
    } catch (e) {
      state.push = { ...pushStatus(), error: e.message || String(e) };
    }
    emit();
  },
  'share-site': () => doShare(siteShare()),
  'line-site': () => window.open(lineLink(siteShare().text, SITE_URL), '_blank', 'noopener'),
  'copy-site': async () => {
    try {
      await navigator.clipboard.writeText(SITE_URL);
      toast('คัดลอกลิงก์แล้ว');
    } catch {
      toast(SITE_URL, 8000);
    }
  },
  'share-point': () => {
    const f = state.selected;
    if (f) doShare(pointShare(f.lat, f.lng, state.forecast));
  },
  'line-point': () => {
    const f = state.selected;
    if (!f) return;
    const s = pointShare(f.lat, f.lng, state.forecast);
    window.open(lineLink(s.text, s.url), '_blank', 'noopener');
  },
  'clear-search': () => {
    state.search = null;
    $('#search-q').value = '';
    emit();
  },
  'search-fit': () => {
    const s = state.search;
    if (!s) return;
    const pts = [...s.floods.map((f) => [f.lng, f.lat]), ...s.reports.map((r) => [r.lng, r.lat])];
    if (!pts.length) return;
    fitTo(pts);
  },
  'goto-place': ({ lat, lng }) => {
    $('#panel').dataset.open = 'false';
    selectPoint(+lat, +lng, { fly: true });
  },
  'fly-event': ({ id }) => {
    const ev = state.traffic.events.find((x) => String(x.id) === id);
    if (!ev) return;
    $('#panel').dataset.open = 'false';
    map.flyTo({ center: [ev.lng, ev.lat], zoom: 15 });
    eventPopup(ev);
  },
  'fly-camera': ({ id }) => {
    const c = state.traffic.cameras.find((x) => String(x.id) === id);
    if (!c) return;
    $('#panel').dataset.open = 'false';
    if (!$('#ly-cams').checked) {
      $('#ly-cams').checked = true;
      map.setLayoutProperty('cameras', 'visibility', 'visible');
    }
    map.flyTo({ center: [c.lng, c.lat], zoom: 15 });
    cameraPopup(c);
  },
  'fly-rain': ({ id }) => {
    const g = state.rainObs.find((x) => String(x.id) === id);
    if (!g) return;
    $('#panel').dataset.open = 'false';
    map.flyTo({ center: [g.lng, g.lat], zoom: 13 });
    rainPopup(g);
  },
  'fly-flood': ({ id }) => {
    const f = state.floods.find((x) => String(x.id) === id);
    if (!f) return;
    $('#panel').dataset.open = 'false';
    map.flyTo({ center: [f.lng, f.lat], zoom: 16 });
    floodPopup(f);
  },
  'point-forecast': ({ lat, lng }) => selectPoint(+lat, +lng),
  'legend-open': () => openLegend(),
  'status-open': () => openStatus(),
  'route-open': () => openRoute(),
  'route-to': ({ lat, lng, label }) => openRoute({ to: { lat: +lat, lng: +lng, label: label || 'จุดที่เลือกบนแผนที่' } }),
  'route-close': () => clearRoute(),
  'road-resync': () => { syncAlerts(true); },
  'road-follow': ({ name }) => {
    if (!name || following(name)) return;
    if (state.myRoads.length >= MAX_ROADS) return toast(`ติดตามได้สูงสุด ${MAX_ROADS} สาย — ลบสายเก่าที่หน้า “สถานการณ์” ก่อน`);
    state.myRoads.push({ name, min: DEFAULT_MIN });
    saveRoads();
    state.roadFind = { q: '', results: [] };
    toast(`ติดตาม “${name}” แล้ว — เตือนเมื่อน้ำท่วมถึง ${DEFAULT_MIN} ซม. · ตั้งค่าและเปิดแจ้งเตือนที่หน้า “สถานการณ์”`, 7000);
    popup?.remove();
    emit();
    syncAlerts(true);
  },
  'road-unfollow': ({ name }) => {
    state.myRoads = state.myRoads.filter((r) => r.name !== name);
    saveRoads();
    emit();
    syncAlerts(true);
  },
  'road-find': () => {
    const q = String(document.querySelector('#road-q')?.value || '').trim();
    const names = state.roadFlood?.names || [];
    const loose = (x) => String(x).toLowerCase().replace(/[\s.\-]+/g, '');
    const nq = loose(q);
    state.roadFind = { q, results: nq.length >= 2 ? names.filter((n) => loose(n).includes(nq) && !following(n)).slice(0, 8) : [] };
    if (nq.length < 2) toast('พิมพ์ชื่อถนนอย่างน้อย 2 ตัวอักษร');
    emit();
  },
  'road-open': ({ name }) => {
    const g = roadGroup(state.roadFlood?.features || [], name);
    if (!g) return;
    $('#panel').dataset.open = 'false';
    const pts = g.coords.flat();
    const b = pts.reduce((a, c) => [[Math.min(a[0][0], c[0]), Math.min(a[0][1], c[1])], [Math.max(a[1][0], c[0]), Math.max(a[1][1], c[1])]], [[180, 90], [-180, -90]]);
    map.fitBounds(b, { padding: 70, maxZoom: 16, duration: 700 });
    floodRoadGroupPopup(name);
  },
  'mcam-open': ({ id }) => {
    const c = state.mcams?.cams?.find((x) => x.id === id);
    if (!c) return;
    $('#panel').dataset.open = 'false';
    map.flyTo({ center: [c.lng, c.lat], zoom: 16 });
    mcamPopup(c);
  },
  'mcam-step': ({ id, dir }) => {
    const cams = state.mcams?.cams || [];
    const c = cams.find((x) => x.id === id);
    if (!c || !popup) return;
    const group = sameSpot(cams, c);
    const i = (group.findIndex((x) => x.id === id) + (+dir || 1) + group.length) % group.length;
    const el = popup.getElement()?.querySelector('[data-mcam-body]');
    if (!el) return;
    el.innerHTML = mcamBody(group[i], group, i);
    wireMcamImg(popup.getElement());
  },
  'mcam-big': ({ id }) => {
    const c = state.mcams?.cams?.find((x) => x.id === id);
    if (!c || !isCamId(c.id)) return;
    const dlg = $('#mcam-dialog');
    dlg.innerHTML = `<div class="cam-head"><b class="clip">${esc(c.n)}</b><span><button class="btn btn-sm" data-mcam-close>ปิด</button></span></div>
      <div class="mcam-big"><img data-mcam-img="${esc(c.id)}" src="${mcamSnapUrl(c.id)}" alt="ภาพล่าสุดจากกล้อง ${esc(c.n)}" referrerpolicy="no-referrer" /><p class="mcam-err muted small" hidden>ภาพจากกล้องนี้ไม่พร้อมตอนนี้</p></div>
      <p class="muted tiny cam-foot">ภาพนิ่งล่าสุด รีเฟรชเองทุก 30 วินาที — ดูเวลาที่พิมพ์บนภาพ${placeLabel(c) ? ` · ${esc(placeLabel(c))}` : ''}</p>`;
    dlg.querySelector('[data-mcam-close]').onclick = () => dlg.close();
    dlg.addEventListener('close', () => { stopMcamTimer(); dlg.innerHTML = ''; }, { once: true });
    dlg.showModal();
    wireMcamImg(dlg);
  },
  'windy-open': ({ id }) => {
    const c = state.windyCams?.cams?.find((x) => x.id === String(id));
    if (!c || !isWindyPlayer(c.day)) return;
    const dlg = $('#windy-dialog');
    dlg.innerHTML = `<div class="cam-head"><b class="clip">${esc(c.title)}</b><span>${c.detail ? `<a class="btn btn-sm" href="${esc(c.detail)}" target="_blank" rel="noopener noreferrer">เปิดที่ Windy ↗</a> ` : ''}<button class="btn btn-sm" data-windy-close>ปิด</button></span></div>
      <div class="yt-frame"><iframe src="${esc(c.day)}" title="${esc(c.title)}" allow="fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>
      <p class="muted tiny cam-foot">ภาพเร่งเวลาย้อนหลัง 24 ชม. ของกล้องนี้ (ไม่ใช่ภาพสด) · Webcams provided by <a href="https://www.windy.com" target="_blank" rel="noopener noreferrer">Windy.com</a> — <a href="${WINDY_CREDIT_URL}" target="_blank" rel="noopener noreferrer">add a webcam</a></p>`;
    dlg.querySelector('[data-windy-close]').onclick = () => dlg.close();
    dlg.addEventListener('close', () => { dlg.innerHTML = ''; }, { once: true });
    dlg.showModal();
  },
  'yt-open': ({ id }) => {
    const v = state.ytLive?.items?.find((x) => x.id === id);
    if (!v || !/^[\w-]{11}$/.test(id)) return;
    const dlg = $('#yt-dialog');
    dlg.innerHTML = `<div class="cam-head"><b class="clip">${esc(v.title)}</b><span><a class="btn btn-sm" href="https://www.youtube.com/watch?v=${id}" target="_blank" rel="noopener noreferrer">เปิดที่ YouTube ↗</a> <button class="btn btn-sm" data-yt-close>ปิด</button></span></div>
      <div class="yt-frame"><iframe src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0" title="${esc(v.title)}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>
      <p class="muted tiny cam-foot">สตรีมสดจาก YouTube ช่อง "${esc(v.channel)}" — เว็บนี้ไม่ได้ตรวจสอบเนื้อหา และยืนยันไม่ได้ว่าเป็นกล้องจริงหรือตรงกับชื่อ ภาพอาจเปลี่ยนหรือหยุดได้ทุกเมื่อ</p>`;
    const close = () => { dlg.close(); dlg.innerHTML = ''; }; // emptying the dialog also stops the video
    dlg.querySelector('[data-yt-close]').onclick = close;
    dlg.addEventListener('close', () => { dlg.innerHTML = ''; }, { once: true });
    dlg.showModal();
  },
  'show-sat': () => {
    $('#ly-sat').checked = true;
    map.setLayoutProperty('sat-flood', 'visibility', 'visible');
    map.flyTo({ center: [100.6, 14.0], zoom: 9.2 });
    if (window.matchMedia('(max-width: 720px)').matches) $('#panel').dataset.open = 'false';
  },
  'show-repeat': ({ lat, lng }) => {
    $('#ly-repeat').checked = true;
    map.setLayoutProperty('repeat', 'visibility', 'visible');
    map.flyTo({ center: [+lng, +lat], zoom: Math.max(map.getZoom(), 14) });
    if (window.matchMedia('(max-width: 720px)').matches) $('#panel').dataset.open = 'false';
  },
  'goto-district': ({ d }) => {
    state.district = d;
    state.floodLimit = 40;
    setTab('reports');
  },
  'more-floods': () => {
    state.floodLimit += 40;
    emit();
  },
  'fly-report': ({ id }) => {
    const r = state.reports.find((x) => x.id === id);
    if (!r) return;
    $('#panel').dataset.open = 'false';
    map.flyTo({ center: [r.lng, r.lat], zoom: 16 });
    reportPopup(r);
  },
  'pick-saved': ({ id }) => {
    const p = state.saved.find((x) => x.id === id);
    if (p) selectPoint(p.lat, p.lng, { fly: true });
  },
  'goto-forecast': () => {
    setTab('forecast');
    $('#panel').dataset.open = 'false';
    toast('แตะบนแผนที่ในจุดที่ต้องการ');
  },
  'locate-forecast': async () => {
    try {
      const p = await locate();
      selectPoint(p.lat, p.lng, { fly: true });
    } catch (e) {
      toast(e.message);
    }
  },
  'save-place': ({ label }) => {
    const f = state.selected;
    if (!f) return;
    state.saved = state.saved.filter((p) => p.label !== label);
    state.saved.push({ id: `p${Date.now().toString(36)}`, label, lat: f.lat, lng: f.lng });
    state.saved = state.saved.slice(-4);
    savePlaces();
    toast(`บันทึก "${label}" แล้ว — ไปแท็บ "สถานการณ์" เพื่อเปิดแจ้งเตือน`, 7000);
    refreshSaved();
    syncAlerts();
  },
  'del-place': ({ id }) => {
    state.saved = state.saved.filter((p) => p.id !== id);
    delete state.savedEval[id];
    savePlaces();
    emit();
    syncAlerts(true);
  },
  'copy-link': async () => {
    const f = state.selected;
    if (!f) return;
    const url = `${location.origin}${location.pathname}?p=${f.lat.toFixed(5)},${f.lng.toFixed(5)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast('คัดลอกลิงก์แล้ว');
    } catch {
      toast(url, 8000);
    }
  },
  'retry-forecast': () => state.selected && selectPoint(state.selected.lat, state.selected.lng),
  'reload-stations': () => reloadStations(),
  'open-report': () => $('#btn-report').click(),
  vote: async ({ id, type }) => {
    try {
      await state.store.vote(id, type);
      popup?.remove();
      toast({ still: 'ขอบคุณที่ยืนยันว่ายังท่วมอยู่', gone: 'บันทึกว่าน้ำลดแล้ว', wrong: 'รับทราบว่าข้อมูลไม่ถูกต้อง' }[type]);
    } catch (e) {
      toast(e.message || 'โหวตไม่สำเร็จ');
    }
  },
};

actions['cam-viewer'] = ({ lat, lng, zoom }) => openCamViewer({ lat: +lat, lng: +lng, ...(zoom ? { zoom: +zoom } : {}) });
// One camera button: it opens the Monitoring Room, or the Longdo live-camera map if that was the last one used; each has a switch to the other.
const camLast = () => { try { return localStorage.getItem('cam-last'); } catch { return null; } };
const setCamLast = (v) => { try { localStorage.setItem('cam-last', v); } catch { /* private mode */ } };
function openRoomMode() { setCamLast('room'); openRoom(); }
function openLongdoHere() {
  const c = map.getCenter();
  setCamLast('longdo');
  openCamViewer({ lat: c.lat, lng: c.lng, zoom: Math.min(15, Math.max(12, Math.round(map.getZoom()))), onRoom: state.mcams?.cams?.length ? openRoomMode : null });
}
function openCameras() {
  const haveRoom = !!state.mcams?.cams?.length;
  if (camViewerEnabled() && (camLast() === 'longdo' || !haveRoom)) openLongdoHere();
  else if (haveRoom) openRoomMode();
}
if (camViewerEnabled()) $('#btn-room').hidden = false; // shown as soon as either view is available

document.addEventListener('change', (e) => {
  const sel = e.target.closest?.('[data-road-min]');
  if (!sel) return;
  const r = state.myRoads.find((x) => x.name === sel.dataset.roadMin);
  if (!r) return;
  r.min = +sel.value;
  saveRoads();
  syncAlerts();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target?.id === 'road-q') { e.preventDefault(); actions['road-find'](); }
});
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  actions[el.dataset.act]?.({ ...el.dataset });
});

document.querySelectorAll('.tabs [role=tab]').forEach((t) => t.addEventListener('click', () => setTab(t.dataset.tab)));
// phone bottom bar: tapping the tab that is already open folds the sheet away (familiar tab-bar behaviour)
document.querySelectorAll('[data-nav]').forEach((b) =>
  b.addEventListener('click', () => {
    const p = $('#panel');
    if (state.tab === b.dataset.nav && p.dataset.open === 'true') {
      p.dataset.open = 'false';
      return;
    }
    setTab(b.dataset.nav);
  }),
);
$('#nav-report').addEventListener('click', () => $('#btn-report').click());
$('#grabber').addEventListener('click', () => {
  const p = $('#panel');
  p.dataset.open = p.dataset.open === 'true' ? 'false' : 'true';
});

$('#btn-layers').addEventListener('click', () => {
  const pop = $('#layers-pop');
  pop.hidden = !pop.hidden;
  $('#btn-layers').setAttribute('aria-expanded', String(!pop.hidden));
});
$('#ly-floods').addEventListener('change', (e) => {
  const v = e.target.checked ? 'visible' : 'none';
  map.setLayoutProperty('floods', 'visibility', v);
  map.setLayoutProperty('floods-halo', 'visibility', v);
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'district-filter') {
    state.district = e.target.value;
    state.floodLimit = 40;
    emit();
  }
});
$('#ly-traffic').addEventListener('change', (e) => {
  const v = e.target.checked ? 'visible' : 'none';
  ['traffic-roads-casing', 'traffic-roads', 'traffic-events'].forEach((l) => map.setLayoutProperty(l, 'visibility', v));
});
$('#layers-pop').addEventListener('change', renderLegend);
initRoom({ showOnMap: (id) => actions['mcam-open']({ id }), toast, openLongdo: camViewerEnabled() ? openLongdoHere : null });
$('#btn-room').addEventListener('click', openCameras);
$('#btn-route').addEventListener('click', () => openRoute());
$('#ly-roadflood').addEventListener('change', (e) => ['roadflood-casing', 'roadflood'].forEach((l) => map.setLayoutProperty(l, 'visibility', e.target.checked ? 'visible' : 'none')));
$('#ly-mcams').addEventListener('change', (e) => map.setLayoutProperty('mcams', 'visibility', e.target.checked ? 'visible' : 'none'));
$('#ly-windy').addEventListener('change', (e) => map.setLayoutProperty('windy', 'visibility', e.target.checked ? 'visible' : 'none'));
$('#ly-sat').addEventListener('change', (e) => map.setLayoutProperty('sat-flood', 'visibility', e.target.checked ? 'visible' : 'none'));
$('#ly-repeat').addEventListener('change', (e) => map.setLayoutProperty('repeat', 'visibility', e.target.checked ? 'visible' : 'none'));
$('#ly-cams').addEventListener('change', (e) => map.setLayoutProperty('cameras', 'visibility', e.target.checked ? 'visible' : 'none'));
$('#ly-rain').addEventListener('change', (e) => map.setLayoutProperty('rainobs', 'visibility', e.target.checked ? 'visible' : 'none'));
$('#ly-gauges').addEventListener('change', (e) => map.setLayoutProperty('stations', 'visibility', e.target.checked ? 'visible' : 'none'));
$('#ly-reports').addEventListener('change', (e) => map.setLayoutProperty('reports', 'visibility', e.target.checked ? 'visible' : 'none'));
$('#ly-radar').addEventListener('change', (e) => setRadar(e.target.checked));

$('#btn-locate').addEventListener('click', async () => {
  try {
    const p = await locate();
    if (!inBounds(p.lat, p.lng)) return toast('ตำแหน่งของคุณอยู่นอกพื้นที่บริการ (กทม. ปริมณฑล และภาคตะวันออก)');
    map.flyTo({ center: [p.lng, p.lat], zoom: 14 });
  } catch (e) {
    toast(e.message);
  }
});

$('#btn-report').addEventListener('click', () => {
  $('#layers-pop').hidden = true;
  startPick();
});
$('#pick-cancel').addEventListener('click', endPick);
$('#pick-gps').addEventListener('click', async () => {
  try {
    const p = await locate();
    if (!inBounds(p.lat, p.lng)) return toast('ตำแหน่งของคุณอยู่นอกพื้นที่บริการ');
    map.jumpTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 16) });
  } catch (e) {
    toast(e.message);
  }
});
$('#pick-ok').addEventListener('click', () => {
  if (draw.mode === 'point') {
    const c = map.getCenter();
    if (!inBounds(c.lat, c.lng)) return toast('ตำแหน่งนี้อยู่นอกพื้นที่บริการ (กทม. ปริมณฑล และภาคตะวันออก)');
    endPick();
    openReportDialog({ lat: c.lat, lng: c.lng }, { onRepick: () => startPick('point') });
    return;
  }
  const err = validate(draw.mode, draw.pts, inBounds);
  if (err) return toast(err);
  const { mode, pts } = draw;
  const [lat, lng] = anchor(mode, pts);
  endPick();
  openReportDialog({ lat, lng, kind: mode, pts }, { onRepick: () => startPick(mode, pts) });
});
document.querySelectorAll('[data-pmode]').forEach((b) => b.addEventListener('click', () => setPickMode(b.dataset.pmode, [])));
$('#draw-add').addEventListener('click', () => {
  const c = map.getCenter();
  addVertex(c.lat, c.lng);
});
$('#draw-undo').addEventListener('click', () => {
  draw.pts.pop();
  refreshDraft();
});
$('#draw-clear').addEventListener('click', () => {
  draw.pts = [];
  refreshDraft();
});

/* ───────────── data loops ───────────── */
async function reloadStations() {
  try {
    const r = await loadStations();
    state.stations = r.stations;
    state.stationsAt = r.at;
    state.stationsSrc = r.source;
    state.stationsError = null;
  } catch (e) {
    state.stationsError = e.message || String(e);
  }
  refreshStationsLayer();
  refreshFloodsLayer();
  emit();
}

async function reloadTraffic() {
  const t = state.traffic;
  try {
    const r = await loadTraffic();
    if (r.events) { t.events = r.events.events || []; t.eventsAt = r.events.generatedAt; }
    if (r.roads) { t.roads = r.roads.roads || []; t.roadsFresh = r.roads.freshSegments ?? null; t.roadsTotal = r.roads.totalSegments ?? null; t.roadsAt = r.roads.generatedAt; }
    if (r.cameras) { t.cameras = r.cameras.cameras || []; t.camerasAt = r.cameras.generatedAt; }
    if (r.dds) t.dds = r.dds;
    if (r.dams) state.dams = r.dams;
  } catch {
    /* keep whatever we had */
  }
  refreshTrafficLayers();
  refreshFloodsLayer();
  emit();
}

async function reloadLongdo() {
  try {
    state.traffic.longdo = await loadLongdoIndex();
  } catch {
    /* optional extra — the card just omits it */
  }
  emit();
}

async function reloadRainObs() {
  try {
    const r = await loadRainObs();
    state.rainObs = r.gauges;
    state.rainObsAt = r.at;
    state.rainObsSrc = r.source;
    state.rainObsError = null;
  } catch (e) {
    state.rainObsError = e.message || String(e);
  }
  refreshRainLayer();
  refreshFloodsLayer(); // the evidence around each reported spot changed
  emit();
}

async function reloadFloods() {
  try {
    const r = await loadFloods();
    state.floods = r.floods;
    state.floodsAt = r.at;
    state.floodsSrc = r.source;
    state.floodsError = null;
  } catch (e) {
    state.floodsError = e.message || String(e);
  }
  refreshFloodsLayer();
  emit();
}

// symbols: a swatch strip beside every layer checkbox, a key under the menu for the layers that are on, and the full dialog (src/lib/legend.js)
function buildLegend() {
  for (const g of LEGEND) {
    const label = document.getElementById(g.ly)?.closest('label');
    if (label && !label.querySelector('.sws')) label.querySelector('input').insertAdjacentHTML('afterend', stripHtml(g));
  }
  renderLegend();
}
function renderLegend() {
  const on = LEGEND.filter((g) => document.getElementById(g.ly)?.checked);
  $('#legend-items').innerHTML = on.length ? on.map(compactHtml).join('') : '<p class="muted small">เปิดเลเยอร์ด้านบนเพื่อดูสัญลักษณ์ของเลเยอร์นั้น</p>';
}
const SDOT = { [OK]: ['#2e9e5b', 'ปกติ'], [SLOW]: ['#d9b300', 'ล่าช้า'], [OLD]: ['#d7263d', 'ไม่อัปเดต'], [MISSING]: ['#8a94a3', 'ไม่มีข้อมูล'], [LOADING]: ['#8a94a3', 'กำลังโหลด'] };
function openStatus() {
  const dlg = $('#status-dialog');
  const list = statusList();
  const row = (x) => {
    const [c, w] = SDOT[x.level] ?? SDOT[MISSING];
    return `<div class="st-row"><span class="st-dot" style="background:${c}" aria-hidden="true"></span><div class="grow"><b>${esc(x.label)}</b> <span class="st-word" style="color:${c}">${w}</span>
      <small>${x.at ? `ข้อมูลล่าสุด ${ago(x.at)}` : 'ยังไม่ได้ข้อมูล'}${x.note ? ` · ${esc(x.note)}` : ''}</small><small class="muted">${esc(x.feeds)}</small></div></div>`;
  };
  dlg.innerHTML = `<div class="cam-head"><b>สถานะแหล่งข้อมูล</b><button class="btn btn-sm" data-status-close>ปิด</button></div>
    <div class="lg-body"><h4 class="st-h">ข้อมูลหลัก (ที่คะแนนความเสี่ยงและตัวเลขหน้าแรกอ้างอิง)</h4>${list.filter((x) => x.group === 'core').map(row).join('')}
    <h4 class="st-h">ข้อมูลเสริม</h4>${list.filter((x) => x.group === 'extra').map(row).join('')}
    <p class="muted tiny">เว็บนี้รวมข้อมูลใหม่ทุก ~15 นาที แต่ต้นทางบางแห่งอัปเดตช้ากว่านั้นเป็นปกติ (เช่น ระดับน้ำรายชั่วโมง รายงานรายวัน ภาพดาวเทียมทุกไม่กี่วัน) · “ล่าช้า” = เก่ากว่าปกติ “ไม่อัปเดต” = เก่ามาก ให้ใช้ตัวเลขนั้นด้วยความระวัง · เวลาคำนวณจากข้อมูลที่เครื่องของคุณโหลดมา เปิดหน้าเว็บใหม่เพื่อโหลดล่าสุด</p></div>`;
  dlg.querySelector('[data-status-close]').onclick = () => dlg.close();
  dlg.addEventListener('close', () => { dlg.innerHTML = ''; }, { once: true });
  dlg.showModal();
}
function openLegend() {
  const dlg = $('#legend-dialog');
  dlg.innerHTML = `<div class="cam-head"><b>สัญลักษณ์บนแผนที่</b><button class="btn btn-sm" data-legend-close>ปิด</button></div>
    <div class="lg-body">${dialogHtml((id) => !!document.getElementById(id)?.checked)}
    <p class="muted tiny">เลเยอร์ที่ปิดอยู่ไม่แสดงบนแผนที่ เปิดได้ที่ปุ่ม “เลเยอร์” มุมบนขวา · กดสัญลักษณ์บนแผนที่เพื่อดูรายละเอียดของจุดนั้น</p></div>`;
  dlg.querySelector('[data-legend-close]').onclick = () => dlg.close();
  dlg.addEventListener('close', () => { dlg.innerHTML = ''; }, { once: true });
  dlg.showModal();
}

async function main() {
  buildLegend();
  map = new maplibregl.Map({
    container: 'map',
    style: {
      version: 8,
      sources: {
        osm: {
          type: 'raster', tileSize: 256, maxzoom: 19,
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        },
      },
      layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
    },
    center: [BKK_CENTER.lng, BKK_CENTER.lat],
    zoom: 10.3,
    minZoom: 8.5,
    maxBounds: [[BOUNDS.west - 0.7, BOUNDS.south - 0.5], [BOUNDS.east + 0.7, BOUNDS.north + 0.5]],
    attributionControl: { compact: true },
  });
  state.map = map;
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  window.__map = map; // handy for debugging in devtools
  window.__state = state;

  map.on('click', (e) => {
    if (pickMode) return addVertex(e.lngLat.lat, e.lngLat.lng);
    if (routePicking()) return routePick(e.lngLat.lat, e.lngLat.lng);
    if (routeHit(e.point)) return;
    const hit = map.queryRenderedFeatures(e.point, { layers: ['reports', 'report-lines', 'report-areas', 'floods', 'traffic-events', 'cameras', 'rainobs', 'stations', 'traffic-roads', 'repeat', 'sat-flood', 'windy', 'mcams', 'roadflood'].filter((l) => map.getLayoutProperty(l, 'visibility') !== 'none') })[0];
    // thin road lines are hard to hit exactly: if nothing else is under the finger, look in a small box for a flooded road
    const roadHit = !hit && map.getLayoutProperty('roadflood', 'visibility') !== 'none'
      ? map.queryRenderedFeatures([[e.point.x - 9, e.point.y - 9], [e.point.x + 9, e.point.y + 9]], { layers: ['roadflood'] })[0]
      : null;
    if (roadHit) return floodRoadPopup(roadHit.properties, e.lngLat);
    if (hit) {
      if (hit.layer.id === 'roadflood') return floodRoadPopup(hit.properties, e.lngLat);
      if (['reports', 'report-lines', 'report-areas'].includes(hit.layer.id)) {
        const r = state.reports.find((x) => x.id === hit.properties.id);
        if (r) reportPopup(r);
      } else if (hit.layer.id === 'traffic-events') {
        const ev = state.traffic.events.find((x) => String(x.id) === String(hit.properties.id));
        if (ev) eventPopup(ev);
      } else if (hit.layer.id === 'cameras') {
        const c = state.traffic.cameras.find((x) => String(x.id) === String(hit.properties.id));
        if (c) cameraPopup(c);
      } else if (hit.layer.id === 'traffic-roads') {
        roadPopup(hit.properties, e.lngLat);
      } else if (hit.layer.id === 'repeat') {
        repeatPopup(hit.properties, e.lngLat);
      } else if (hit.layer.id === 'sat-flood') {
        satPopup(hit.properties, e.lngLat);
      } else if (hit.layer.id === 'mcams') {
        const c = state.mcams?.cams?.find((x) => x.id === String(hit.properties.id));
        if (c) mcamPopup(c);
      } else if (hit.layer.id === 'windy') {
        const c = state.windyCams?.cams?.find((x) => x.id === String(hit.properties.id));
        if (c) windyPopup(c);
      } else if (hit.layer.id === 'rainobs') {
        const g = state.rainObs.find((x) => String(x.id) === String(hit.properties.id));
        if (g) rainPopup(g);
      } else if (hit.layer.id === 'floods') {
        const f = state.floods.find((x) => String(x.id) === String(hit.properties.id));
        if (f) floodPopup(f);
      } else {
        const s = state.stations.find((x) => String(x.id) === String(hit.properties.id));
        if (s) stationPopup(s);
      }
      return;
    }
    selectPoint(e.lngLat.lat, e.lngLat.lng);
  });
  ['reports', 'report-lines', 'report-areas', 'floods', 'traffic-events', 'cameras', 'rainobs', 'stations', 'traffic-roads', 'repeat', 'sat-flood', 'windy', 'mcams', 'roadflood'].forEach((l) => {
    map.on('mouseenter', l, () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', l, () => (map.getCanvas().style.cursor = ''));
  });

  const loaded = new Promise((res) => map.on('load', res));
  render();

  const storeP = createStore().then((s) => {
    state.store = s;
    s.subscribe((list) => {
      allReports = list;
      refreshReportsLayer();
      refreshFloodsLayer();
    });
  });
  const stationsP = reloadStations();
  const floodsP = reloadFloods();
  const rainP = reloadRainObs();
  const trafficP = reloadTraffic();
  reloadLongdo();

  // Nothing below the data layer may wait for map tiles: on a weak signal the tiles are the slowest thing,
  // yet risk chips, alerts and offline support must still come up. Production only (dev uses ?sw=1) so Vite HMR is never cached.
  if ('serviceWorker' in navigator && (import.meta.env.PROD || location.search.includes('sw=1'))) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
  const shared = new URLSearchParams(location.search).get('p');
  const sharedPt = shared && shared.match(/^(-?\d+(\.\d+)?),(-?\d+(\.\d+)?)$/);

  Promise.all([storeP, stationsP, floodsP, rainP, trafficP]).then(() => {
    render();
    refreshOverview();
    refreshSaved();
    if (sharedPt) selectPoint(+sharedPt[1], +sharedPt[3], { fly: true });
    state.push = pushStatus();
    verifyPush().then((v) => {
      if (v !== null) { state.push = { ...state.push, verified: v }; emit(); }
      if (v && state.myRoads.length) verifyRoads(state.myRoads).then((r) => { if (r.ok) { state.roadSync = { status: 'ok', at: Date.now() }; emit(); } else syncAlerts(); }); // the server copy lacks my roads → send them
    });
    loadAccuracy().then((a) => { state.accuracy = a; emit(); }).catch(() => {});
    loadNews().then((n) => { state.news = n; emit(); }).catch(() => {});
    let roadLinkHandled = false;
    const reloadRoads = () => loadRoadFlood().then((r) => {
      state.roadFlood = r;
      $('#ly-roadflood').closest('label').hidden = false;
      refreshRoadFloodLayer();
      emit();
      $('#btn-route').hidden = false;
      const want = !roadLinkHandled && new URLSearchParams(location.search).get('road'); // opened from a road alert
      if (want) {
        roadLinkHandled = true;
        if (roadGroup(r.features, want)) actions['road-open']({ name: want });
        else toast(`ตอนนี้ไม่พบน้ำท่วมบน “${want}” ตามข้อมูลล่าสุด`);
      }
    }).catch(() => {});
    reloadRoads();
    setInterval(reloadRoads, 5 * 60 * 1000);
    loadMaholanCams().then((m) => { state.mcams = m; $('#ly-mcams').closest('label').hidden = false; $('#btn-room').hidden = false; refreshMcamLayer(); refreshRoom(); emit(); }).catch(() => {});
    const reloadAi = () => loadMaholanAi().then((a) => { state.mcamAi = a; refreshMcamLayer(); refreshRoom(); }).catch(() => {});
    reloadAi();
    setInterval(reloadAi, 5 * 60 * 1000);
    loadWindyCams().then((w) => { state.windyCams = w; $('#ly-windy').closest('label').hidden = false; refreshWindyLayer(); emit(); }).catch(() => {});
    loadYtLive().then((y) => { state.ytLive = y; emit(); }).catch(() => {});
    loadSatFlood().then((s) => { state.satFlood = s; $('#ly-sat').closest('label').hidden = false; refreshSatLayer(); emit(); }).catch(() => {});
    loadFloodHistory().then((h) => { state.floodHistory = h; $('#ly-repeat').closest('label').hidden = false; refreshRepeatLayer(); emit(); }).catch(() => {});
    emit();
  });
  window.addEventListener('online', () => { renderBanner(); reloadStations(); reloadFloods(); });
  window.addEventListener('offline', renderBanner);

  setInterval(reloadStations, 10 * 60 * 1000);
  setInterval(reloadFloods, 5 * 60 * 1000);
  setInterval(reloadRainObs, 10 * 60 * 1000);
  setInterval(reloadTraffic, 5 * 60 * 1000);
  setInterval(reloadLongdo, 5 * 60 * 1000);
  setInterval(() => {
    refreshOverview();
    refreshSaved();
  }, 15 * 60 * 1000);
  setInterval(refreshReportsLayer, 60 * 1000); // expire old reports without a network round-trip

  await loaded;
  map.resize();
  if (!sharedPt) map.jumpTo({ center: [BKK_CENTER.lng, BKK_CENTER.lat], zoom: 10.3 });
  initLayers();
  refreshRepeatLayer(); // the history may have arrived before the layers existed
  refreshSatLayer();
  refreshWindyLayer();
  refreshMcamLayer();
  refreshRoadFloodLayer();
  refreshSelectedLayer();
}

main();
