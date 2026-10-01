// Monitoring Room (ห้องมอนิเตอร์): a full-screen wall of the latest camera frames, switched with the map. Frames come from the still-image camera
// catalogue (state.mcams). Load control: only tiles on screen fetch, one refresh per 30 s, a page of 24 tiles at a time (max 72), nothing loads
// while the room is closed or the tab is hidden, and a failed refresh keeps the last good frame (with the time it was fetched).
import { state } from '../state.js';
import { esc } from '../lib/util.js';
import { snapUrl } from '../lib/maholan-cams.js';
import { AI_LEVEL_TH, activeFlags } from '../lib/maholan-ai.js';
import { pickCams, districtList } from '../lib/room-pick.js';

const PAGE = 24;
const MAX = 72;
const REFRESH_MS = 30000;
const KEY = { district: 'room-district', fav: 'room-fav', ai: 'room-ai-only', favOnly: 'room-fav-only' };

const $ = (s) => document.querySelector(s);
const read = (k, d = '') => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

let opts = {};
let isOpen = false;
let shown = PAGE;
let here = null;
let io = null;
let timer = null;
let built = false;
let district = read(KEY.district, '');
let aiOnly = read(KEY.ai) === '1';
let favOnly = read(KEY.favOnly) === '1';
const favs = new Set((() => { try { return JSON.parse(read(KEY.fav, '[]')); } catch { return []; } })().filter((x) => typeof x === 'string'));

const aiMap = () => activeFlags(state.mcamAi);
const slow = (c) => /floodbkk/i.test(c.s || ''); // that feed updates about once an hour

function tileHtml(c, flag) {
  const star = favs.has(c.id);
  return `<article class="rm-tile${flag ? ' ai' : ''}" data-id="${esc(c.id)}">
    <button class="rm-img" type="button" data-act="mcam-big" data-id="${esc(c.id)}" aria-label="ขยายภาพ ${esc(c.n)}">
      <img alt="ภาพล่าสุดจากกล้อง ${esc(c.n)}" referrerpolicy="no-referrer" decoding="async" />
      <span class="rm-ph">กำลังโหลด…</span>
      ${flag ? `<span class="rm-ai">💧 AI พบน้ำท่วม · ${AI_LEVEL_TH[flag.level]} ${Math.round(flag.conf * 100)}%</span>` : ''}
    </button>
    <div class="rm-cap">
      <span class="rm-name" title="${esc(c.n)}">${esc(c.n)}</span>
      <button class="rm-btn" type="button" data-rm-map="${esc(c.id)}" aria-label="ดูบนแผนที่" title="ดูบนแผนที่">📍</button>
      <button class="rm-btn rm-star" type="button" data-rm-fav="${esc(c.id)}" aria-pressed="${star}" aria-label="${star ? 'เอาออกจากกล้องโปรด' : 'เก็บเป็นกล้องโปรด'}">${star ? '★' : '☆'}</button>
    </div>
    <div class="rm-meta"><span class="rm-time"></span>${slow(c) ? '<span class="rm-slow">ภาพอัปเดตช้า (~ชั่วโมงละครั้ง)</span>' : ''}<span class="rm-own">${esc(c.s || '')}${c.d ? ` · เขต${esc(c.d)}` : ''}</span></div>
  </article>`;
}

// fetch a frame off-screen first so a failure never replaces the last good one with a broken image
function load(tile) {
  const id = tile.dataset.id;
  const img = tile.querySelector('img');
  const ph = tile.querySelector('.rm-ph');
  const probe = new Image();
  probe.referrerPolicy = 'no-referrer';
  probe.onload = () => {
    img.src = probe.src;
    tile.dataset.state = 'ok';
    ph.hidden = true;
    tile.querySelector('.rm-time').textContent = `รีเฟรช ${new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
  };
  probe.onerror = () => {
    if (tile.dataset.state !== 'ok') { tile.dataset.state = 'err'; ph.hidden = false; ph.textContent = 'ภาพจากกล้องนี้ไม่พร้อม'; }
  };
  probe.src = snapUrl(id);
}

function observer() {
  io?.disconnect();
  io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const t = e.target;
      const was = t.dataset.vis === '1';
      t.dataset.vis = e.isIntersecting ? '1' : '0';
      if (e.isIntersecting && !was && !t.dataset.state) load(t); // first time on screen
    }
  }, { root: $('#room-grid'), rootMargin: '200px' });
}

function tick() {
  if (!isOpen || document.hidden) return;
  for (const t of $('#room-grid').querySelectorAll('.rm-tile[data-vis="1"]')) load(t);
}

function render() {
  if (!built) return;
  const cams = state.mcams?.cams || [];
  const ai = aiMap();
  const list = pickCams(cams, { district, here, aiOnly, favOnly, ai, favs });
  const page = list.slice(0, Math.min(shown, MAX));
  const grid = $('#room-grid');
  observer();
  grid.innerHTML = page.map((c) => tileHtml(c, ai.get(c.id))).join('');
  grid.querySelectorAll('.rm-tile').forEach((t) => io.observe(t));

  const note = $('#room-note');
  const aiCount = [...ai.keys()].filter((id) => cams.some((c) => c.id === id)).length;
  const lines = [];
  if (!cams.length) lines.push('ยังไม่มีรายการกล้อง');
  else if (!list.length) {
    lines.push(district === '' && !aiOnly && !favOnly ? 'เลือกเขตด้านบน หรือกด “ใกล้ฉัน” เพื่อดูภาพกล้อง — กล้องที่ AI พบน้ำท่วมและกล้องโปรดจะขึ้นก่อนเสมอ' : district === '@' && !here ? 'กำลังหาตำแหน่งของคุณ…' : aiOnly ? 'ตอนนี้ AI ไม่พบกล้องที่น้ำท่วม (ดูเพิ่มเติมได้โดยเลือกเขต)' : favOnly ? 'ยังไม่มีกล้องโปรด กดดาวที่ใต้ภาพเพื่อเก็บไว้' : 'ไม่พบกล้องในตัวเลือกนี้');
  } else lines.push(`${list.length.toLocaleString('th-TH')} กล้อง${list.length > page.length ? ` · แสดง ${page.length}` : ''}`);
  if (aiCount) lines.push(`💧 AI พบน้ำท่วม ${aiCount} กล้อง (ยังไม่ยืนยัน)`);
  note.innerHTML = lines.map((l) => `<span>${esc(l)}</span>`).join('');
  $('#room-more').hidden = list.length <= page.length || page.length >= MAX;
  $('#room-fav-only').setAttribute('aria-pressed', String(favOnly));
  $('#room-ai-only').setAttribute('aria-pressed', String(aiOnly));
  $('#room-near').setAttribute('aria-pressed', String(district === '@'));
}

function buildDistricts() {
  const sel = $('#room-district');
  const ds = districtList(state.mcams?.cams);
  sel.innerHTML = `<option value="">เลือกเขต…</option><option value="*">ทุกเขต / ทุกกล้อง</option>${district === '@' ? '<option value="@">ใกล้ฉัน</option>' : ''}` + ds.map((d) => `<option value="${esc(d.name)}">เขต${esc(d.name)} (${d.n})</option>`).join('');
  sel.value = [...sel.options].some((o) => o.value === district) ? district : '';
}

function build() {
  if (built) return;
  built = true;
  $('#room').addEventListener('click', (e) => {
    const f = e.target.closest('[data-rm-fav]');
    if (f) {
      const id = f.dataset.rmFav;
      favs.has(id) ? favs.delete(id) : favs.add(id);
      write(KEY.fav, JSON.stringify([...favs]));
      f.setAttribute('aria-pressed', String(favs.has(id)));
      f.textContent = favs.has(id) ? '★' : '☆';
      if (favOnly) render();
      return;
    }
    const m = e.target.closest('[data-rm-map]');
    if (m) { close(); opts.showOnMap?.(m.dataset.rmMap); return; }
    if (e.target.closest('[data-room-mode="map"]')) close();
  });
  $('#room-district').addEventListener('change', (e) => {
    district = e.target.value;
    write(KEY.district, district === '@' ? '' : district); // "near me" is per visit
    shown = PAGE;
    if (district === '@') locate(); else render();
  });
  $('#room-near').addEventListener('click', () => { district = '@'; shown = PAGE; buildDistricts(); $('#room-district').value = '@'; locate(); });
  $('#room-fav-only').addEventListener('click', () => { favOnly = !favOnly; write(KEY.favOnly, favOnly ? '1' : '0'); shown = PAGE; render(); });
  $('#room-ai-only').addEventListener('click', () => { aiOnly = !aiOnly; write(KEY.ai, aiOnly ? '1' : '0'); shown = PAGE; render(); });
  $('#room-more').addEventListener('click', () => { shown += PAGE; render(); });
  window.addEventListener('keydown', (e) => { if (isOpen && e.key === 'Escape' && !document.querySelector('dialog[open]')) close(); });
  window.addEventListener('popstate', () => { if (isOpen) close(true); });
}

function locate() {
  if (!navigator.geolocation) { here = null; render(); return; }
  render();
  navigator.geolocation.getCurrentPosition(
    (p) => { here = { lat: p.coords.latitude, lng: p.coords.longitude }; render(); },
    () => { here = null; district = ''; buildDistricts(); render(); opts.toast?.('ไม่ได้รับตำแหน่ง — เลือกเขตแทนได้เลย'); },
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
  );
}

export function openRoom() {
  if (!state.mcams?.cams?.length) return;
  build();
  if (district === '@') district = '';
  buildDistricts();
  isOpen = true;
  shown = PAGE;
  $('#room').hidden = false;
  document.body.classList.add('room-open');
  try { history.pushState({ room: 1 }, ''); } catch { /* ignore */ }
  render();
  clearInterval(timer);
  timer = setInterval(tick, REFRESH_MS);
}

export function close(fromPop = false) {
  if (!isOpen) return;
  isOpen = false;
  clearInterval(timer);
  io?.disconnect();
  $('#room').hidden = true;
  $('#room-grid').innerHTML = ''; // drops every image: no frames are held or fetched while the room is closed
  document.body.classList.remove('room-open');
  if (!fromPop) { try { if (history.state?.room) history.back(); } catch { /* ignore */ } }
}

// the AI flags / catalogue arrived or changed while the room is open
export function refreshRoom() {
  if (!isOpen) return;
  buildDistricts();
  render();
}

export const initRoom = (o) => { opts = o || {}; };
export const roomIsOpen = () => isOpen;
