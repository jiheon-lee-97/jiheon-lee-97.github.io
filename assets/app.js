/* ------------------------------------------------------------------
   Pixel-decay portrait.

   The whole shared state is ONE INTEGER: how many visitors there have
   been. Reveal order is a deterministic seeded shuffle of the mask's
   pixels, so every visitor derives the identical image from that number.
   Nothing about the picture is ever stored server-side.

   Composition:  show BASE everywhere; show OVERLAY wherever the mask is
   still alive. Each visitor kills PIXELS_PER_VISIT more mask pixels, so
   BASE bleeds through a little more, forever.
------------------------------------------------------------------- */

const CONFIG = {
  // Cloudflare Worker origin, no trailing slash. Empty => local-only mode.
  counterUrl: '',

  // Change this and the erosion pattern changes completely. Never change
  // it after launch or the picture will visibly scramble.
  seed: 0x5eed1e55,

  pixelsPerVisit: 1,

  // A browser may only increment the counter once per this many hours.
  cooldownHours: 24,

  // Mask pixel counts as "alive" above this (0-255).
  maskThreshold: 128,

  images: {
    base:    'images/base.png',     // image0 - the state it decays TOWARD
    overlay: 'images/overlay.png',  // image2 - drawn where the mask lives
    mask:    'images/mask.png',     // white = alive
  },
};

const $ = (id) => document.getElementById(id);
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- deterministic RNG ---------- */

// mulberry32: tiny, fast, and bit-identical across every JS engine, which
// is the only property that actually matters here.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle(arr, seed) {
  const rnd = mulberry32(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

/* ---------- asset loading ---------- */

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${src}`));
    img.src = src;
  });
}

function readPixels(img) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, c.width, c.height);
}

/* Collect the flat pixel indices the mask marks as alive.
   Auto-detects whether the mask encodes itself in alpha or in luminance,
   so a transparent-PNG cutout and a black/white matte both just work. */
function maskIndices(mask, threshold) {
  const d = mask.data;
  const n = d.length / 4;

  let usesAlpha = false;
  for (let i = 0; i < n; i++) {
    if (d[i * 4 + 3] < 250) { usesAlpha = true; break; }
  }

  const out = [];
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const v = usesAlpha
      ? d[p + 3]
      : (d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114);
    if (v >= threshold) out.push(i);
  }
  return { indices: out, usesAlpha };
}

/* ---------- shared counter ---------- */

const STORE_KEY = 'pixelhome:lastHit';

function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }

function onCooldown() {
  const last = Number(safeGet(STORE_KEY) || 0);
  return Date.now() - last < CONFIG.cooldownHours * 3600e3;
}

async function fetchCount(increment) {
  if (!CONFIG.counterUrl) return localCount(increment);
  const url = CONFIG.counterUrl.replace(/\/$/, '') + (increment ? '/hit' : '/count');
  const res = await fetch(url, {
    method: increment ? 'POST' : 'GET',
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`counter responded ${res.status}`);
  const data = await res.json();
  if (typeof data.count !== 'number') throw new Error('counter sent no count');
  return { count: data.count, source: 'remote' };
}

// Fallback so the page is fully functional before the Worker exists, and
// stays functional if it ever goes down.
function localCount(increment) {
  const k = 'pixelhome:localCount';
  let n = Number(safeGet(k) || 0);
  if (increment) { n += 1; safeSet(k, String(n)); }
  return { count: n, source: 'local' };
}

/* ---------- renderer ---------- */

class Portrait {
  constructor(canvas, fx, base, overlay, order) {
    this.canvas = canvas;
    this.fx = fx;
    this.w = base.width;
    this.h = base.height;
    this.order = order;

    canvas.width = this.w;
    canvas.height = this.h;
    this.ctx = canvas.getContext('2d');

    this.base = base.data;
    this.overlay = overlay.data;

    // Working buffer starts at generation zero: mask fully alive.
    this.work = new ImageData(new Uint8ClampedArray(base.data), this.w, this.h);
    for (const idx of order) this.write(idx, this.overlay);

    this.applied = 0;
    this.fxCtx = fx.getContext('2d');
    this.sizeFx();
    addEventListener('resize', () => this.sizeFx(), { passive: true });
  }

  write(idx, src) {
    const p = idx * 4;
    const d = this.work.data;
    d[p] = src[p]; d[p + 1] = src[p + 1]; d[p + 2] = src[p + 2]; d[p + 3] = src[p + 3];
  }

  // Advance (or rewind) the erosion to exactly `n` dead pixels.
  seek(n) {
    n = Math.max(0, Math.min(n, this.order.length));
    while (this.applied < n) this.write(this.order[this.applied++], this.base);
    while (this.applied > n) this.write(this.order[--this.applied], this.overlay);
    this.paint();
  }

  paint() { this.ctx.putImageData(this.work, 0, 0); }

  sizeFx() {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.fx.width = Math.round(r.width * dpr);
    this.fx.height = Math.round(r.height * dpr);
    this.fxScale = this.fx.width / this.w;
  }

  // Ping the pixel this visitor just destroyed.
  flash(idx) {
    if (REDUCED) return;
    const x = (idx % this.w) + 0.5;
    const y = Math.floor(idx / this.w) + 0.5;
    const ctx = this.fxCtx;
    const start = performance.now();
    const DUR = 1100;

    const step = (now) => {
      const t = Math.min((now - start) / DUR, 1);
      ctx.clearRect(0, 0, this.fx.width, this.fx.height);
      if (t < 1) {
        const ease = 1 - Math.pow(1 - t, 3);
        const cx = x * this.fxScale;
        const cy = y * this.fxScale;
        ctx.beginPath();
        ctx.arc(cx, cy, 4 + ease * 46 * this.fxScale, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,255,255,${(1 - t) * 0.85})`;
        ctx.lineWidth = 2 * this.fxScale;
        ctx.stroke();
        requestAnimationFrame(step);
      }
    };
    requestAnimationFrame(step);
  }
}

/* ---------- boot ---------- */

function fmt(n) { return n.toLocaleString('en-US'); }

function report(dead, total, source) {
  const pct = total ? (dead / total) * 100 : 0;
  $('fill').style.width = `${Math.min(pct, 100)}%`;
  $('stat').textContent =
    `${fmt(dead)} of ${fmt(total)} pixels gone · ${pct.toFixed(pct < 1 ? 3 : 1)}%`;
  $('left').textContent = dead >= total
    ? 'It is finished.'
    : `${fmt(total - dead)} left.`;
  if (source === 'local') {
    $('stat').title = 'Counter unreachable — showing this browser\'s local tally.';
  }
}

async function main() {
  const params = new URLSearchParams(location.search);

  let base, overlay, mask;
  try {
    [base, overlay, mask] = await Promise.all([
      loadImage(CONFIG.images.base),
      loadImage(CONFIG.images.overlay),
      loadImage(CONFIG.images.mask),
    ]);
  } catch (err) {
    $('loading').textContent = err.message;
    return;
  }

  const dims = [base, overlay, mask].map((i) => `${i.naturalWidth}x${i.naturalHeight}`);
  if (new Set(dims).size !== 1) {
    $('loading').textContent = `image sizes must match (got ${dims.join(', ')})`;
    return;
  }

  const baseData = readPixels(base);
  const overlayData = readPixels(overlay);
  const { indices } = maskIndices(readPixels(mask), CONFIG.maskThreshold);

  if (!indices.length) {
    $('loading').textContent = 'mask is empty — nothing to erode';
    return;
  }

  const order = seededShuffle(Uint32Array.from(indices), CONFIG.seed);
  const total = order.length;

  const art = new Portrait($('art'), $('fx'), baseData, overlayData, order);
  $('loading').hidden = true;

  // ?n=… freezes the picture at an arbitrary generation, for previews.
  if (params.has('n')) {
    const n = params.get('n') === 'end' ? total : Number(params.get('n')) || 0;
    art.seek(n);
    report(Math.min(n, total), total, 'preview');
    return;
  }

  const counts = !onCooldown();
  let result;
  try {
    result = await fetchCount(counts);
  } catch (err) {
    console.warn('counter unavailable:', err.message);
    result = localCount(false);
  }
  if (counts && result.source === 'remote') safeSet(STORE_KEY, String(Date.now()));

  const dead = Math.min(result.count * CONFIG.pixelsPerVisit, total);

  if (counts && dead > 0) {
    // Show the world as it was one pixel ago, then take yours in front of them.
    art.seek(dead - CONFIG.pixelsPerVisit);
    report(Math.max(dead - CONFIG.pixelsPerVisit, 0), total, result.source);
    setTimeout(() => {
      art.seek(dead);
      art.flash(order[dead - 1]);
      report(dead, total, result.source);
      $('mine').hidden = false;
    }, REDUCED ? 0 : 900);
  } else {
    art.seek(dead);
    report(dead, total, result.source);
  }
}

main();
