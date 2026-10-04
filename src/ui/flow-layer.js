// Animated flow particles over the map (the same idea as the wind layer on cctv.maholan.net, which uses the Leaflet-only leaflet-velocity plugin; this is a small
// canvas overlay for MapLibre, so no new dependency). Thousands of short-lived particles are pushed along a vector field (src/lib/windfield.js) and leave
// fading trails. The animation speed on screen is illustrative (a fixed number of pixels per m/s), NOT the real speed of the air or water.
// Pauses when the layer is off or the tab is hidden; with "reduce motion" it draws one still frame of streaks instead of animating.
import { sample, speedOf, colorFor } from '../lib/windfield.js';

export class FlowLayer {
  // opts: { getField: () => field|null, colors: [[maxSpeed, colour]…], speedUnit: m/s→colour-scale factor, pxPerMs: screen px per frame per m/s, density: particles per 1000 px² }
  constructor(map, opts) {
    this.map = map;
    this.o = { speedUnit: 1, pxPerMs: 0.35, density: 1.1, maxAge: 90, ...opts };
    this.on = false;
    this.raf = 0;
    this.parts = [];
    this.tick = 0;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'flow-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.hidden = true;
    map.getCanvasContainer().appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.pause = () => {
      if (!this.on) return;
      this.stop(); // a pan/zoom gesture would smear the trails: blank the canvas, draw again when the map settles
      this.ctx.clearRect(0, 0, this.w, this.h);
    };
    this.reset = () => this.restart();
    this.vis = () => (document.hidden ? this.stop() : this.on && this.start());
    document.addEventListener('visibilitychange', this.vis);
    map.on('movestart', this.pause);
    map.on('moveend', this.reset);
    map.on('resize', this.reset);
  }

  get reduced() {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  }

  setVisible(v) {
    this.on = v;
    this.canvas.hidden = !v;
    if (v) this.restart();
    else this.stop();
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
    this.ctx.lineWidth = 1.8;
    this.ctx.lineCap = 'round';
  }

  restart() {
    if (!this.on) return;
    this.stop();
    this.size();
    this.ctx.clearRect(0, 0, this.w, this.h);
    const n = Math.max(300, Math.min(2200, Math.round(((this.w * this.h) / 1000) * this.o.density)));
    this.parts = Array.from({ length: n }, () => this.spawn({}));
    if (this.reduced) this.still();
    else this.start();
  }

  spawn(p) {
    const b = this.map.getBounds();
    p.lng = b.getWest() + Math.random() * (b.getEast() - b.getWest());
    p.lat = b.getSouth() + Math.random() * (b.getNorth() - b.getSouth());
    p.age = Math.floor(Math.random() * this.o.maxAge);
    p.x = null;
    return p;
  }

  start() {
    if (this.raf || !this.on || document.hidden) return;
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      if (++this.tick % 2) return; // ~30 fps is plenty and kinder to phones
      this.step(true);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  // one frame: fade the old trails, move every particle, draw the short segment it travelled
  step(fade) {
    const field = this.o.getField();
    const { ctx, map } = this;
    if (!field) return;
    if (fade) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,0.07)';
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.globalCompositeOperation = 'source-over';
    }
    const dpp = 360 / (512 * 2 ** map.getZoom()); // degrees of longitude per screen pixel
    const b = map.getBounds();
    for (const p of this.parts) {
      const uv = sample(field, p.lat, p.lng);
      if (!uv || ++p.age > this.o.maxAge || p.lng < b.getWest() || p.lng > b.getEast() || p.lat < b.getSouth() || p.lat > b.getNorth()) {
        this.spawn(p);
        continue;
      }
      const k = this.o.pxPerMs * dpp;
      const cos = Math.cos((p.lat * Math.PI) / 180);
      const a = map.project([p.lng, p.lat]);
      p.lng += uv[0] * k;
      p.lat += uv[1] * k * cos;
      const c = map.project([p.lng, p.lat]);
      if (p.x !== null) {
        ctx.strokeStyle = colorFor(this.o.colors, speedOf(uv) * this.o.speedUnit);
        ctx.globalAlpha = Math.min(1, p.age / 8) * Math.min(1, (this.o.maxAge - p.age) / 12) * 0.9;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(c.x, c.y);
        ctx.stroke();
      }
      p.x = c.x;
    }
    ctx.globalAlpha = 1;
  }

  // reduced motion: long still streaks, drawn once
  still() {
    const field = this.o.getField();
    if (!field) return;
    const { ctx, map } = this;
    const dpp = 360 / (512 * 2 ** map.getZoom());
    for (const p of this.parts) {
      let lng = p.lng, lat = p.lat;
      const pts = [map.project([lng, lat])];
      let last = null;
      for (let s = 0; s < 14; s++) {
        const uv = sample(field, lat, lng);
        if (!uv) break;
        last = uv;
        lng += uv[0] * this.o.pxPerMs * dpp * 3;
        lat += uv[1] * this.o.pxPerMs * dpp * 3 * Math.cos((lat * Math.PI) / 180);
        pts.push(map.project([lng, lat]));
      }
      if (pts.length < 4 || !last) continue;
      ctx.strokeStyle = colorFor(this.o.colors, speedOf(last) * this.o.speedUnit);
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  destroy() {
    this.stop();
    document.removeEventListener('visibilitychange', this.vis);
    this.map.off('movestart', this.pause);
    this.map.off('moveend', this.reset);
    this.map.off('resize', this.reset);
    this.canvas.remove();
  }
}
