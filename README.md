# 🎰 Rentle

Two daily property games on real UK listings, in the spirit of
[Dublin Rent Roulette](https://dublinrentroulette.com) — flip between them with
the toggle at the top of the page:

- **Rent** — one mystery rental a day, across six UK cities.
- **Buy** — one mystery home for sale a day, from a UK-wide sample spanning
  studios, one-, two- and three-beds.

Same board either way: five guesses, within 5% wins, wrong guesses unlock hints
(too-high / too-low first, then a nearby comparable with its price for guesses
4 and 5). Play a random round, browse by town, or send a friend a
beat-my-score link. The two games keep separate dailies, separate puzzle
numbers and separate streaks.

**Fully static.** No backend at all: two pre-scraped corpora of Rightmove
listings (photos re-hosted, every ad fact kept) are baked into the site at
build time, the game engine runs client-side, and personal stats/streaks live
in localStorage. Deploys to Netlify as plain files.

## How it fits together

```
tools/config/modes.js  the mode table — corpus dir, order file, output dir,
                       Rightmove channel, routes. Adding a game is a row here.
tools/seed.js          scrape: search pages -> ids -> data/corpus[-buy]/<id>.json
tools/images.js        download + recompress photos -> client/public/img/<id>/*.webp
                       (one shared store; Rightmove ids are globally unique)
tools/lib/redact.js    strips price-revealing ad copy on the way into the build
tools/build-corpus.js  corpus -> client/public/data/<mode>/ (price-free index +
                       per-listing chunks with precomputed comparable hints +
                       base64'd answer)
client/                React + Vite + Tailwind SPA; engine in src/engine/
tools/prerender.js     after vite build: per-listing /p/<id>/ and /buy/p/<id>/
                       share pages with Open Graph tags (answer-free), absolute
                       URLs from tools/config/site.json
```

The rent game keeps the bare routes it launched with (`/`, `/browse`,
`/p/<id>`) so share links already in the wild still work; the buy game lives
under `/buy`.

Committed data: `data/corpus/` and `data/corpus-buy/` (the scraped listings),
`data/images-manifest.json` (what photos were processed), and `data/order.json`
/ `data/order-buy.json` (the append-only daily-puzzle orders — stable across
re-scrapes so "today's" doesn't change on redeploy). NOT committed: the image
binaries and `data/state/` scrape caches — so a full deploy must come from the
machine that ran the scrape.

## Runbook

```bash
npm install                # also installs client deps

# 1. Scrape (one-off, ~25 min per corpus at polite rates). Resumable.
npm run seed -- --check    # preflight: is Rightmove reachable from this network?
npm run seed               # rent corpus, from tools/config/outcodes.json
npm run seed:buy           # buy corpus, from tools/config/outcodes.buy.json
npm run images             # photos for BOTH corpora (~30 min each)

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

`tools/config/outcodes.json` defines the rent coverage: London capped at ~20%,
with Manchester, Birmingham, Bristol, Leeds and Edinburgh at equal weight.

`tools/config/outcodes.buy.json` defines the buy coverage: ~40 towns and cities
across England, Wales and Scotland, each stratified by bedroom count (0 = studio
through 3). It is deliberately **clustered by town rather than scattered** —
price per sq ft varies roughly tenfold across the UK, so a "nearby comparable"
hint is only honest if it comes from the same place. Studios are genuinely
scarce outside city centres, so those quotas routinely under-fill. Great Britain
only: the picker draws a GB coastline, so a Northern Irish town would land in
the Irish Sea.

Each listing keeps the full ad: price, address (revealed only after the game),
beds, baths, size, description, key features, stations, agent, up to 8 photos
recompressed to ≤1200px webp, and the facts specific to its channel —
furnishing, let type and tenancy length for a rental; tenure, lease remaining,
service charge and ground rent for a sale. Price per sq ft is deliberately
dropped from sale listings: with the floor area on the card it multiplies
straight back into the answer.

Listings are a snapshot — the reveal says "listed at" / "on the market at", and
some will go off Rightmove over time. Refresh = re-run seed/images (existing
listings are kept, new ones appended) and redeploy.

## Honesty section

- Rightmove's Terms of Service prohibit scraping. This project scrapes it
  anyway, deliberately and gently: ~1s+ between requests, aggressive caching,
  a one-off corpus rather than continuous crawling, and photos capped and
  recompressed. Expect blocking at volume; don't run seed on a schedule.
- The answer is in the page payload (base64-obscured, not encrypted). Anyone
  who opens devtools can cheat. Fine for a game between friends.
- Sale listings that can't be fairly guessed are filtered out — shared
  ownership, auction lots, retirement units, new-build "from £X" developments,
  and investment ads that put marketing copy where the address should be. Some
  will still slip through; the reveal always links to the real Rightmove page.
- Crowd stats ("how everyone did") went away with the server. Phase 2 is a
  small backend (likely Netlify Functions) to collect guesses again — the
  share-link codec and stats shapes are designed to be superseded, not
  migrated.
