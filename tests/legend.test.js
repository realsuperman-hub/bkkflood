import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LEGEND, OTHER, compactHtml, stripHtml, dialogHtml } from '../src/lib/legend.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('every legend group points at a real layer checkbox, and every layer checkbox has a group', () => {
  const boxes = [...html.matchAll(/id="(ly-[\w-]+)"/g)].map((m) => m[1]).sort();
  const groups = LEGEND.map((g) => g.ly).sort();
  assert.deepEqual(groups, boxes);
});

test('every item has a label and, unless it is a custom button, a colour', () => {
  for (const g of [...LEGEND, OTHER]) {
    assert.ok(g.title && g.items.length, g.id);
    for (const it of g.items) {
      assert.ok(it.label, `${g.id}: label`);
      if (!it.html && it.shape !== 'none') assert.match(it.color, /^#[0-9a-f]{6}$/i, `${g.id}: ${it.label}`);
    }
  }
});

test('compact key, strip and dialog render; the dialog marks switched-off layers', () => {
  const g = LEGEND.find((x) => x.id === 'mcams');
  assert.match(compactHtml(g), /AI พบน้ำท่วมจากภาพ/);
  assert.equal((stripHtml(LEGEND.find((x) => x.id === 'gauges')).match(/<i /g) || []).length, 3);
  assert.equal(stripHtml(LEGEND.find((x) => x.id === 'radar')), ''); // text-only group: no swatch
  const d = dialogHtml((id) => id !== 'ly-mcams');
  assert.equal((d.match(/ปิดอยู่/g) || []).length, 1);
  assert.match(d, /แจ้งจุดน้ำท่วม/);
});
