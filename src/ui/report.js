import { state } from '../state.js';
import { DEPTHS, PASSABLE } from '../lib/store.js';
import { processPhoto } from '../lib/image.js';
import { esc, toast } from '../lib/util.js';
import { KINDS, anchor, flatten, describe } from '../lib/shape.js';

const MAX_PHOTOS = 3;

export function openReportDialog({ lat, lng, kind = 'point', pts = null }, { onRepick } = {}) {
  const dlg = document.getElementById('report-dialog');
  const photos = []; // { full, thumb }
  let busy = false;

  dlg.innerHTML = `
    <form method="dialog" class="dlg-form" novalidate>
      <div class="dlg-head"><h2>${kind === 'line' ? 'แจ้งถนนช่วงที่น้ำท่วม' : kind === 'area' ? 'แจ้งพื้นที่น้ำท่วม' : 'แจ้งจุดน้ำท่วม'}</h2><button type="button" class="btn btn-ghost" data-close aria-label="ปิด">✕</button></div>
      <p class="small muted">${kind === 'point' ? `ตำแหน่ง ${lat.toFixed(5)}, ${lng.toFixed(5)}` : `${KINDS[kind]} ${pts.length} จุด · ${describe(kind, pts)}`} · <button type="button" class="link" data-repick>${kind === 'point' ? 'เปลี่ยนตำแหน่ง' : 'แก้ไขที่วาด'}</button></p>

      <fieldset><legend>น้ำลึกเท่าไร <span class="req">*</span></legend>
        <div class="opts">${Object.entries(DEPTHS).map(([k, d], i) => `
          <label class="opt"><input type="radio" name="depth" value="${k}" ${i === 1 ? '' : ''}/>
          <span style="--c:${d.color}"><b>${esc(d.label)}</b><small>${esc(d.hint)}</small></span></label>`).join('')}</div></fieldset>

      <fieldset><legend>รถผ่านได้ไหม <span class="req">*</span></legend>
        <div class="opts row3">${Object.entries(PASSABLE).map(([k, t]) => `
          <label class="opt"><input type="radio" name="passable" value="${k}" /><span><b>${esc(t)}</b></span></label>`).join('')}</div></fieldset>

      <fieldset><legend>รูปถ่าย 1–${MAX_PHOTOS} รูป <span class="req">*</span></legend>
        <div id="photo-grid" class="photo-grid"></div>
        <input id="photo-input" type="file" accept="image/*" multiple hidden />
        <button type="button" class="btn" id="photo-add">ถ่ายรูป / เลือกรูป</button>
        <p class="muted tiny">ระบบจะลบพิกัดและข้อมูลกล้องออกจากรูปโดยอัตโนมัติ ห้ามถ่ายติดใบหน้าหรือป้ายทะเบียนที่ไม่จำเป็น</p></fieldset>

      <label class="field"><span>รายละเอียดเพิ่มเติม (ไม่บังคับ)</span>
        <textarea name="note" maxlength="300" rows="2" placeholder="เช่น ซอย/ถนน น้ำกำลังขึ้นหรือลด ทางเลี่ยง"></textarea></label>

      <p class="muted tiny">รายงานจะแสดงบนแผนที่สาธารณะ 4 ชม. และหมดอายุเองหากไม่มีใครยืนยัน อย่าใส่เบอร์โทรหรือข้อมูลส่วนตัว — หากต้องการความช่วยเหลือ โทร 1669 / 1784</p>
      <p id="form-err" class="note" hidden></p>
      <div class="dlg-actions"><button type="button" class="btn btn-ghost" data-close>ยกเลิก</button>
      <button type="submit" class="btn btn-primary" id="submit-btn">ส่งรายงาน</button></div>
    </form>`;

  const $ = (s) => dlg.querySelector(s);
  const err = (m) => {
    const el = $('#form-err');
    el.textContent = m;
    el.hidden = !m;
  };
  const renderPhotos = () => {
    $('#photo-grid').innerHTML = photos
      .map((p, i) => `<div class="ph"><img src="${p.thumb}" alt="รูปที่ ${i + 1}" /><button type="button" data-rm="${i}" aria-label="ลบรูปที่ ${i + 1}">✕</button></div>`)
      .join('');
    $('#photo-add').hidden = photos.length >= MAX_PHOTOS;
  };

  $('#photo-add').onclick = () => $('#photo-input').click();
  $('#photo-input').onchange = async (e) => {
    const files = [...e.target.files].slice(0, MAX_PHOTOS - photos.length);
    e.target.value = '';
    if (!files.length) return;
    $('#photo-add').disabled = true;
    $('#photo-add').textContent = 'กำลังประมวลผลรูป…';
    try {
      for (const f of files) photos.push(await processPhoto(f));
      err('');
    } catch (ex) {
      err(ex.message);
    } finally {
      $('#photo-add').disabled = false;
      $('#photo-add').textContent = 'ถ่ายรูป / เลือกรูป';
      renderPhotos();
    }
  };
  $('#photo-grid').onclick = (e) => {
    const i = e.target.dataset?.rm;
    if (i !== undefined) {
      photos.splice(+i, 1);
      renderPhotos();
    }
  };
  dlg.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => dlg.close()));
  $('[data-repick]').onclick = () => {
    dlg.close();
    onRepick?.();
  };
  dlg.onclick = (e) => {
    if (e.target === dlg && !busy) dlg.close();
  };

  $('form').onsubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const fd = new FormData(e.target);
    const depth = fd.get('depth');
    const passable = fd.get('passable');
    if (!depth) return err('กรุณาเลือกระดับความลึกของน้ำ');
    if (!passable) return err('กรุณาเลือกว่ารถผ่านได้หรือไม่');
    if (!photos.length) return err('กรุณาแนบรูปถ่ายอย่างน้อย 1 รูป');
    busy = true;
    err('');
    const btn = $('#submit-btn');
    btn.disabled = true;
    btn.textContent = 'กำลังส่ง…';
    try {
      const [aLat, aLng] = kind === 'point' ? [lat, lng] : anchor(kind, pts);
      await state.store.create({
        lat: aLat, lng: aLng, kind, geom: kind === 'point' ? null : flatten(pts), depth, passable,
        note: String(fd.get('note') || '').trim().slice(0, 300),
        photos: photos.map((p) => p.full),
        thumb: photos[0].thumb,
      });
      dlg.close();
      toast('ส่งรายงานแล้ว ขอบคุณที่ช่วยเพื่อนบ้าน');
    } catch (ex) {
      const denied = ex?.code === 'permission-denied';
      err(denied ? 'ส่งไม่สำเร็จ: ส่งรายงานได้ไม่เกิน 1 ครั้งต่อนาที หรือตำแหน่งอยู่นอกพื้นที่บริการ' : `ส่งไม่สำเร็จ: ${ex.message || ex}`);
    } finally {
      busy = false;
      btn.disabled = false;
      btn.textContent = 'ส่งรายงาน';
    }
  };

  renderPhotos();
  dlg.showModal();
}
