# jiheon-lee-97.github.io

Academic homepage for Jiheon Lee (KIAS).

It also has a hidden feature. `images/start.png` is what the portrait looks
like today; `images/end.png` is what it becomes. **Every visitor permanently
converts one random pixel from start to end**, and nothing on the page says
so. After W x H visits the portrait has completely become `end.png`.

## Why this works on GitHub Pages

The only shared state is **a single integer**: the visit count. The order in
which pixels flip is a deterministic seeded shuffle of every pixel index, so
any visitor reconstructs the exact same image from that one number. No image
is ever stored or mutated server-side — the browser composites it. GitHub
Pages serves plain static files; a tiny Cloudflare Worker holds the integer.

## Setup

### 1. The two portraits

Both in `images/`, **identical dimensions**, PNG, square:

| file | role |
|---|---|
| `start.png` | what visitors see today |
| `end.png` | what W x H visitors will have turned it into |

PNG only — JPEG artifacts would make the two images disagree in ways that
show up as noise.

### 2. Deploy the counter

    cd worker
    npm i -g wrangler
    wrangler login
    wrangler kv namespace create COUNTER     # paste the id into wrangler.toml
    wrangler deploy

Then set `CONFIG.counterUrl` at the top of `assets/app.js`:

    counterUrl: 'https://pixel-counter.<your-subdomain>.workers.dev',

Until you do, the page runs in local mode: it works, but the count lives in
each visitor's own browser instead of being shared globally.

### 3. Publish

Push to `main`. GitHub Pages is already enabled and cannot be turned off for
a `<user>.github.io` repo.

## Local preview

    python3 -m http.server 8080     # http://localhost:8080

`localhost:8080` is already in the Worker's origin allowlist.

## Knobs (top of `assets/app.js`)

| key | meaning |
|---|---|
| `seed` | the dissolve pattern. **Never change after launch** — the portrait would visibly scramble |
| `pixelsPerVisit` | raise it if 1 px/visitor is too slow |
| `cooldownHours` | how long before one browser may increment again (24h) |

## Preview any point in time

`?n=180000` freezes the portrait at that generation; `?n=end` shows the
finished state. Neither increments the counter. Nothing else on the page
reveals the mechanic.

## Pace

A 600x600 portrait is 360,000 pixels, so at 1 px/visitor it takes 360,000
visits to fully become `end.png`. If you want it to actually converge in your
lifetime, either use a smaller portrait or raise `pixelsPerVisit`.
