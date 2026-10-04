// Animated rain over the map: short falling streaks whose DENSITY follows the rain actually measured at the gauges (src/lib/rainfield.js) — none where it is dry or no
// gauge is near, a light sprinkle for drizzle, a dense curtain for a downpour. Streaks live in screen space for a handful of frames, so panning and zooming need no special
// handling. Pauses when off or the tab is hidden; with "reduce motion" it draws one still frame.
import { sampleRain, dropChance, rainColor } from '../lib/rainfield.js';

const LIFE = 9; // frames a streak lives
const MAX_DROPS = 3600;

export class RainLayer {
  // getField: () => rain field | null
  constructor(map, getField) {
    this.map = map;
    this.getField = getField;
    this.on = false;
    this.raf = 0;
    this.tick = 0;
    this.drops = [];
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'flow-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.hidden = true;
    map.getCanvasContainer().appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.vis = () => (document.hidden ? this.stop() : this.on && this.start());
    this.resize = () => this.on && this.restart();
    document.addEventListener('visibilitychange', this.vis);
    map.on('resize', this.resize);
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
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.w = el.clientWidth;
    this.h = el.clientHeight;
    this.canvas.width = Math.max(1, Math.round(this.w * dpr));
    this.canvas.height = Math.max(1, Math.round(this.h * dpr));
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.lineCap = 'round';
  }

  restart() {
    this.stop();
    this.size();
    this.drops = [];
    if (this.reduced) {
      for (let k = 0; k < LIFE; k++) this.spawn(k);
      this.draw();
    } else this.start();
  }

  start() {
    if (this.raf || !this.on || document.hidden) return;
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      if (++this.tick % 2) return; // ~30 fps
      this.spawn(0);
      this.advance();
      this.draw();
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.ctx?.clearRect(0, 0, this.w || 0, this.h || 0);
  }

  // one batch of spawn attempts at random screen points; each becomes a drop with the chance the local rain rate gives
  spawn(age) {
    const field = this.getField();
    if (!field) return;
    const attempts = Math.max(120, Math.min(650, Math.round((this.w * this.h) / 1500)));
    for (let k = 0; k < attempts && this.drops.length < MAX_DROPS; k++) {
      const x = Math.random() * this.w;
      const y = Math.random() * this.h;
      const ll = this.map.unproject([x, y]);
      const { rate, cover } = sampleRain(field, ll.lat, ll.lng);
      if (Math.random() >= dropChance(rate, cover)) continue;
      const heavy = Math.min(1, rate / 20);
      this.drops.push({ x, y, age, len: 7 + heavy * 9 + Math.random() * 4, v: 6 + Math.random() * 3, color: rainColor(rate), a: 0.45 + heavy * 0.4 });
    }
  }

  advance() {
    for (const d of this.drops) {
      d.age++;
      d.y += d.v;
      d.x -= d.v * 0.28;
    }
    this.drops = this.drops.filter((d) => d.age <= LIFE);
  }

  draw() {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.lineWidth = 1.3;
    for (const d of this.drops) {
      ctx.globalAlpha = d.a * Math.min(1, (LIFE - d.age + 1) / 3);
      ctx.strokeStyle = d.color;
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x - d.len * 0.28, d.y + d.len);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  destroy() {
    this.stop();
    document.removeEventListener('visibilitychange', this.vis);
    this.map.off('resize', this.resize);
    this.canvas.remove();
  }
}
