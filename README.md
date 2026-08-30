# 🎰 Rentle

The daily guess-the-rent game on real UK listings, in the spirit of
[Dublin Rent Roulette](https://dublinrentroulette.com). One mystery rental a
day — four guesses, within £50 pcm wins, wrong guesses unlock hints (a nearby
comparable with its price, then too-high/too-low). Play a random round, browse
the corpus by city, or send a friend a beat-my-score link.

**Fully static.** V1 has no backend at all: a pre-scraped corpus of ~400–500
Rightmove rental listings (photos re-hosted, every ad fact kept) is baked into
the site at build time, the game engine runs client-side, and personal
stats/streaks live in localStorage. Deploys to Netlify as plain files.

## How it fits together

```
tools/seed.js          scrape: search pages -> listing ids -> data/corpus/<id>.json
tools/images.js        download + recompress photos -> client/public/img/<id>/*.webp
tools/build-corpus.js  corpus -> client/public/data/ (price-free index + per-listing
                       chunks with precomputed comparable hints + base64'd answer)
client/                React + Vite + Tailwind SPA; engine in src/engine/
tools/prerender.js     after vite build: per-listing /p/<id>/ share pages with
                       Open Graph tags (answer-free), absolute URLs from
                       tools/config/site.json
```

Committed data: `data/corpus/` (the scraped listings), `data/images-manifest.json`
(what photos were processed), `data/order.json` (the append-only daily-puzzle
order — stable across re-scrapes so "today's" doesn't change on redeploy).
NOT committed: the image binaries (~300MB) and `data/state/` scrape caches —
so a full deploy must come from the machine that ran the scrape.

## Runbook

```bash
npm install                # also installs client deps

# 1. Scrape (one-off, ~25 min at polite rates). Resumable; re-run any time.
npm run seed -- --check    # preflight: is Rightmove reachable from this network?
npm run seed               # full run from tools/config/outcodes.json
npm run images             # download + recompress photos (~30 min)

# 2. Play locally
npm run dev                # vite dev server on :5173
npm test                   # engine/scraper/corpus unit tests (no network)

# 3. Ship
npm run build              # corpus -> vite build -> prerender into client/dist
npm run preview            # check the real build on :4173
netlify deploy --prod      # from this machine (it has the images)
```

First deploy: `npm i -g netlify-cli && netlify login && netlify init`, then
set the real site URL in `tools/config/site.json` and build+deploy once more so
link previews carry absolute URLs. Custom domains: Netlify dashboard →
Domain management.

If `--check` says BLOCKED (datacenter IPs often are), run the scrape from a
residential connection instead: clone, `npm install`, `npm run seed`,
`npm run images`, commit `data/`, and deploy from there.

## The corpus

`tools/config/outcodes.json` defines the coverage: London capped at ~20%, with
Manchester, Birmingham, Bristol, Leeds and Edinburgh at equal weight. Each
listing keeps the full ad: price, address (revealed only after the game), beds,
baths, size, furnishing, deposit, council-tax band, description, key features,
stations, agent, and up to 8 photos recompressed to ≤1200px webp.

Listings are a snapshot — the reveal says "listed at", and some will go off
Rightmove over time. Refresh = re-run seed/images (existing listings are kept,
new ones appended) and redeploy.

## Honesty section

- Rightmove's Terms of Service prohibit scraping. This project scrapes it
  anyway, deliberately and gently: ~1s+ between requests, aggressive caching,
  a one-off corpus rather than continuous crawling, and photos capped and
  recompressed. Expect blocking at volume; don't run seed on a schedule.
- The rent is in the page payload (base64-obscured, not encrypted). Anyone who
  opens devtools can cheat. Fine for a game between friends.
- Crowd stats ("how everyone did") went away with the server. Phase 2 is a
  small backend (likely Netlify Functions) to collect guesses again — the
  share-link codec and stats shapes are designed to be superseded, not
  migrated.
