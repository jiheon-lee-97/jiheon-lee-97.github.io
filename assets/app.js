/* ------------------------------------------------------------------
   Silent pixel dissolve.

   The page looks like an ordinary academic homepage. It isn't: every
   visitor permanently converts one pixel of the portrait from start.png
   to end.png, and nothing on the page says so. After W x H visits the
   portrait has become end.png completely.

   The whole shared state is ONE INTEGER - the visit count. The order in
   which pixels flip is a deterministic seeded shuffle of every pixel
   index, so every visitor reconstructs the identical image from that one
   number. No image is ever stored or mutated server-side.
------------------------------------------------------------------- */

const CONFIG = {
  // Cloudflare Worker origin, no trailing slash. Empty => local-only mode.
  counterUrl: '',

  // Change this and the dissolve pattern changes completely. Never change
  // it after launch or the picture will visibly scramble.
  seed: 0x5eed1e55,

  pixelsPerVisit: 10,

  // A browser may only increment the counter once per this many hours.
  cooldownHours: 24,

  images: {
    start: 'images/start.png',  // image0 - what it looks like today
    end:   'images/end.png',    // image1 - what it becomes after W*H visits
  },
};

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

/* ---------- shared counter ---------- */

const STORE_KEY = 'jl:lastHit';

function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }

function onCooldown() {
  return Date.now() - Number(safeGet(STORE_KEY) || 0) < CONFIG.cooldownHours * 3600e3;
}

async function fetchCount(increment) {
  if (!CONFIG.counterUrl) return localCount(increment);
  const url = CONFIG.counterUrl.replace(/\/$/, '') + (increment ? '/hit' : '/count');
  const res = await fetch(url, { method: increment ? 'POST' : 'GET', cache: 'no-store' });
  if (!res.ok) throw new Error(`counter responded ${res.status}`);
  const data = await res.json();
  if (typeof data.count !== 'number') throw new Error('counter sent no count');
  return { count: data.count, source: 'remote' };
}

// Fallback so the page works before the Worker exists, and keeps working
// if it ever goes down.
function localCount(increment) {
  const k = 'jl:localCount';
  let n = Number(safeGet(k) || 0);
  if (increment) { n += 1; safeSet(k, String(n)); }
  return { count: n, source: 'local' };
}

/* ---------- compositor ---------- */

function compose(canvas, start, end, order, flipped) {
  canvas.width = start.width;
  canvas.height = start.height;

  const out = new ImageData(new Uint8ClampedArray(start.data), start.width, start.height);
  const n = Math.max(0, Math.min(flipped, order.length));

  for (let i = 0; i < n; i++) {
    const p = order[i] * 4;
    out.data[p]     = end.data[p];
    out.data[p + 1] = end.data[p + 1];
    out.data[p + 2] = end.data[p + 2];
    out.data[p + 3] = end.data[p + 3];
  }

  canvas.getContext('2d').putImageData(out, 0, 0);
}

/* ---------- boot ---------- */

async function main() {
  const canvas = document.getElementById('portrait');
  if (!canvas) return;

  let start, end;
  try {
    [start, end] = await Promise.all([
      loadImage(CONFIG.images.start),
      loadImage(CONFIG.images.end),
    ]);
  } catch (err) {
    console.warn(err.message);
    return;
  }

  if (start.naturalWidth !== end.naturalWidth || start.naturalHeight !== end.naturalHeight) {
    console.warn(`image sizes must match (${start.naturalWidth}x${start.naturalHeight}` +
                 ` vs ${end.naturalWidth}x${end.naturalHeight})`);
    return;
  }

  const startData = readPixels(start);
  const endData = readPixels(end);

  // Every pixel in the image participates - no mask.
  const total = startData.width * startData.height;
  const order = seededShuffle(
    Uint32Array.from({ length: total }, (_, i) => i),
    CONFIG.seed,
  );

  // ?n=... freezes the portrait at an arbitrary generation, for previews.
  // Never increments. ?n=end shows the finished state.
  const probe = new URLSearchParams(location.search).get('n');
  if (probe !== null) {
    compose(canvas, startData, endData, order,
      probe === 'end' ? total : Number(probe) || 0);
    canvas.classList.add('ready');
    return;
  }

  let result;
  const counts = !onCooldown();
  try {
    result = await fetchCount(counts);
    if (counts && result.source === 'remote') safeSet(STORE_KEY, String(Date.now()));
  } catch (err) {
    console.warn('counter unavailable:', err.message);
    result = localCount(false);
  }

  compose(canvas, startData, endData, order, result.count * CONFIG.pixelsPerVisit);
  canvas.classList.add('ready');
}

main();
