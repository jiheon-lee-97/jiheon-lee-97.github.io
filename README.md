# jiheon-lee-97.github.io

A homepage whose portrait is destroyed one pixel per visitor.

`images/base.png` is shown everywhere. Wherever `images/mask.png` is white,
`images/overlay.png` is shown instead. Every visitor permanently kills one
random mask pixel, so the overlay erodes and the base bleeds through.

## Why this works on GitHub Pages

The only shared state is **a single integer**: the visit count. Reveal order
is a deterministic seeded shuffle of the mask's pixels, so any visitor can
reconstruct the exact same image from that one number. No image is ever
stored or mutated server-side — the browser composites it. GitHub Pages
serves plain static files; a tiny Cloudflare Worker holds the integer.

## Setup

### 1. Drop in your images

Three PNGs in `images/`, all the **same dimensions**, square-ish:

| file | role |
|---|---|
| `base.png` | the state the picture decays **toward** (e.g. red shirt) |
| `overlay.png` | the starting state, drawn where the mask is alive (e.g. blue shirt) |
| `mask.png` | white = erodible, black = never touched |

The mask may encode itself as white-on-black **or** as PNG alpha; it is
auto-detected. Save all three as PNG — JPEG artifacts will smear the mask edge.

### 2. Deploy the counter

    cd worker
    npm i -g wrangler
    wrangler login
    wrangler kv namespace create COUNTER     # paste the id into wrangler.toml
    wrangler deploy

Put the deployed URL into `CONFIG.counterUrl` at the top of `assets/app.js`:

    counterUrl: 'https://pixel-counter.<your-subdomain>.workers.dev',

Until you do, the page runs in local mode — it works, but the count lives in
each visitor's own browser instead of being shared.

### 3. Publish

Push to `main` on a repo named exactly `jiheon-lee-97.github.io`, then
Settings -> Pages -> Source: `main` / root.

## Local preview

    python3 -m http.server 8080     # then open http://localhost:8080

`localhost:8080` is already in the Worker's allowlist.

## Knobs (top of `assets/app.js`)

| key | meaning |
|---|---|
| `seed` | the erosion pattern. **Never change after launch** — the picture would visibly scramble |
| `pixelsPerVisit` | raise it if 1px/visitor is too slow to ever finish |
| `cooldownHours` | how long before one browser may increment again (24h) |
| `maskThreshold` | 0-255 cutoff for "alive" |

## Preview any point in time

`?n=20000` freezes the picture at that generation. `?n=end` shows the
finished state. Neither increments the counter.

## Pace

A 400x400 shirt mask is ~43,000 pixels. At 1 px/visitor that is 43,000
visitors to complete. If you want it to actually finish, raise
`pixelsPerVisit` or shrink the mask.
