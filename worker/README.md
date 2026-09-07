# pixel-counter

One integer, shared by every visitor.

    GET  /count  -> { count }
    POST /hit    -> { count, counted }

## Deploy

    npm i -g wrangler
    wrangler login
    wrangler kv namespace create COUNTER    # paste id into wrangler.toml
    wrangler deploy

Then set `CONFIG.counterUrl` in `../assets/app.js` to the deployed URL.

## Origin allowlist

`ALLOWED` in `src/index.js` gates both CORS and `/hit`. Add any custom
domain you point at the site, or increments from it will 403.

## Accuracy

KV read-modify-write is not atomic: two visitors in the same instant can
both read N and write N+1, dropping a count. That is invisible in a
portrait made of hundreds of thousands of pixels.

If you want it exact, swap KV for a Durable Object — `state.storage` gives
you real atomicity, and the free plan covers this traffic. It is ~20 extra
lines and worth it only if the precise number matters to you.

## Free-tier limits

KV allows ~1,000 writes/day. Each unique visitor writes once (the client
enforces a 24h cooldown per browser), so you have room for ~1,000
visitors/day before writes start failing. Reads are effectively unlimited,
so the picture keeps rendering correctly even if a write is refused.
