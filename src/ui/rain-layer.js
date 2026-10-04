// Animated rain over the map: falling streaks whose DENSITY follows the rain actually measured at the gauges (src/lib/rainfield.js) — none where it is dry or no gauge is
// near, a light sprinkle for drizzle, a dense curtain for a downpour. Built to stay smooth on a phone:
//  · motion is time-based (px per second), drawn on every display frame, so 60/120 Hz screens look fluid and slow frames do not slow the rain down;
//  · the screen is cut into cells and the rain rate of each cell is looked up ONCE per map move (not once per drop);
//  · all streaks of one colour are drawn as ONE path, so a frame costs a handful of canvas calls instead of thousands.
// Pauses when the layer is off or the tab is hidden; while the map is being dragged no new drops appear (they would not match the ground); with "reduce motion" it draws one still frame.
import { sampleRain, dropChance, rainColor } from '../lib/rainfield.js';

const CELL = 26; // px
const LIFE = 0.75; // s a streak lives
const SPEED = 300; // px/s it falls (an illustrative speed, not the real fall speed)
const SPAWN_PER_CELL = 2.3; // streaks per second in a cell at full density
const SLANT = 0.28; // sideways drift per px fallen
const MAX_DROPS = 2600;
const FADE_IN = 0.12; // fractions of LIFE
const FADE_OUT = 0.3;

export class RainLayer {
  // getField: () => rain field | null
  constructor(map, getField) {
    this.map = map;
    this.getField = getField;
    this.on = false;
    this.raf = 0;
    this.last = 0;
    this.cells = [];
    this.drops = [];
    this.moving = false;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'flow-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.hidden = true;
    map.getCanvasContainer().appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.vis = () => (document.hidden ? this.stop() : this.on && this.start());
    this.onStart = () => { this.moving = true; };
    this.onEnd = () => { this.moving = false; this.rebuild(); };
    this.onResize = () => this.on && (this.size(), this.rebuild());
    document.addEventListener('visibilitychange', this.vis);
    map.on('movestart', this.onStart);
    map.on('moveend', this.onEnd);
    map.on('resize', this.onResize);
  }

  get reduced() {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  }

  setVisible(v) {
    this.on = v;
    this.canvas.hidden = !v;
    if (v) this.restart();
    else {
      this.stop();
      this.drops = [];
    }
  }

  size() {
    const el = this.map.getContainer();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = el.clientWidth;
    this.h = el.clientHeight;
    this.canvas.width = Math.max(1, Math.round(this.w * dpr));
    this.canvas.height = Math.max(1, Math.round(this.h * dpr));
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.lineCap = 'round';
    this.ctx.lineWidth = 1.4;
  }

  // the cells that get rain right now: [{ x, y, chance, color, heavy }] — refreshed when the map stops moving or the data changes
  rebuild() {
    const field = this.getField();
    this.cells = [];
    if (!field || !this.on) return;
    for (let y = 0; y < this.h; y += CELL) {
      for (let x = 0; x < this.w; x += CELL) {
        const ll = this.map.unproject([x + CELL / 2, y + CELL / 2]);
        const { rate, cover } = sampleRain(field, ll.lat, ll.lng);
        const chance = dropChance(rate, cover);
        if (chance > 0) this.cells.push({ x, y, chance, color: rainColor(rate), heavy: Math.min(1, rate / 20) });
      }
    }
  }

  restart() {
    this.stop();
    this.size();
    this.drops = [];
    this.rebuild();
    if (this.reduced) {
      for (const c of this.cells) {
        for (let k = 0; k < Math.ceil(c.chance * 2); k++) this.drops.push(this.make(c, Math.random() * 0.6 * LIFE));
      }
      this.draw();
    } else this.start();
  }

  start() {
    if (this.raf || !this.on || document.hidden) return;
    this.last = performance.now();
    const loop = (now) => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - this.last) / 1000); // a stalled frame must not teleport the rain
      this.last = now;
      this.spawn(dt);
      this.advance(dt);
      this.draw();
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.ctx?.clearRect(0, 0, this.w || 0, this.h || 0);
  }

  make(c, age = 0) {
    const heavy = c.heavy;
    return { x: c.x + Math.random() * CELL, y: c.y + Math.random() * CELL, age, len: 9 + heavy * 9 + Math.random() * 4, color: c.color, a: 0.5 + heavy * 0.4, v: SPEED * (0.85 + Math.random() * 0.3) };
  }

  spawn(dt) {
    if (this.moving || this.drops.length >= MAX_DROPS) return;
    for (const c of this.cells) if (Math.random() < c.chance * SPAWN_PER_CELL * dt) this.drops.push(this.make(c));
  }

  advance(dt) {
    let w = 0;
    for (const d of this.drops) {
      d.age += dt;
      if (d.age > LIFE) continue;
      const dy = d.v * dt;
      d.y += dy;
      d.x -= dy * SLANT;
      this.drops[w++] = d;
    }
    this.drops.length = w;
  }

  // streaks are grouped by colour and by how visible they are (fading in/out or fully shown) so each group is one stroke
  draw() {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.w, this.h);
    const groups = new Map();
    for (const d of this.drops) {
      const f = d.age / LIFE;
      const vis = f < FADE_IN ? 0.35 : f > 1 - FADE_OUT ? (f > 1 - FADE_OUT / 2 ? 0.25 : 0.55) : 1;
      const key = `${d.color}|${vis}|${d.a > 0.7 ? 1 : 0}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { color: d.color, alpha: d.a * vis, items: [] }));
      g.items.push(d);
    }
    for (const g of groups.values()) {
      ctx.globalAlpha = g.alpha;
      ctx.strokeStyle = g.color;
      ctx.beginPath();
      for (const d of g.items) {
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - d.len * SLANT, d.y + d.len);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  destroy() {
    this.stop();
    document.removeEventListener('visibilitychange', this.vis);
    this.map.off('movestart', this.onStart);
    this.map.off('moveend', this.onEnd);
    this.map.off('resize', this.onResize);
    this.canvas.remove();
  }
}
