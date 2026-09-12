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

**Static site, one Worker.** Two pre-scraped corpora of Rightmove listings
(photos re-hosted on R2, every ad fact kept) are baked into the site at build
time and the game engine runs client-side. One Cloudflare Worker serves the
static build and, on `/api/*`, records each finished game in Neon Postgres —
re-scoring it from the raw guesses rather than believing the browser — and
answers with how everyone else did on the same listing. The game never depends on it: with the API down, play and personal
stats carry on in localStorage exactly as before. Nothing is stored until a
game is finished — a visitor who only looks gets no cookie — and `/privacy`
says what is held, for how long, with a button each to export it and delete it.

## How it fits together

```
tools/config/modes.js  the mode table — corpus dir, order file, output dir,
                       Rightmove channel, routes. Adding a game is a row here.
tools/seed.js          scrape: search pages -> ids -> data/corpus[-buy]/<id>.json
tools/images.js        download + recompress photos -> client/public/img/<id>/*.webp
                       (one shared store; Rightmove ids are globally unique),
                       then synced to the R2 bucket that serves them
tools/lib/redact.js    strips price-revealing ad copy on the way into the build
tools/build-corpus.js  corpus -> client/public/data/<mode>/ (price-free index +
                       per-listing chunks with precomputed comparable hints +
                       base64'd answer)
client/                React + Vite + Tailwind SPA; engine in src/engine/
tools/prerender.js     after vite build: per-listing /p/<id>/ and /buy/p/<id>/
                       share pages with Open Graph tags (answer-free), absolute
                       URLs from tools/config/site.json
server/app.js          the API: session, games (server-scored), crowd, import,
                       export-me, delete-me. Pure (Request) -> Response.
server/retention.js    what the database forgets and when; quoted by /privacy
worker/index.js        the Cloudflare Worker: static assets + /api/* -> app.js
                       + the daily cron -> retention.js. wrangler.jsonc configures it.
db/migrations/         the schema; tools/migrate.js applies it, tools/seed-db.js
                       loads the answer key from the corpora
```

The rent game keeps the bare routes it launched with (`/`, `/browse`,
`/p/<id>`) so share links already in the wild still work; the buy game lives
under `/buy`.

Committed data: `data/corpus/` and `data/corpus-buy/` (the scraped listings),
`data/images-manifest.json` (what photos were processed), and `data/order.json`
/ `data/order-buy.json` (the append-only daily-puzzle orders — stable across
re-scrapes so "today's" doesn't change on redeploy). NOT committed: the image
binaries (they live in the R2 bucket) and `data/state/` scrape caches.

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

# 3. Ship (from any checkout — photos are served from R2, not the build)
npm run build              # corpus -> vite build -> prerender into client/dist
npm run preview            # check the real build on :4173
npm run preview:worker     # or the real Worker + assets locally on :8787
npm run deploy             # build + wrangler deploy

# 4. The database (once, then after every re-scrape)
NEON_DATABASE_URL="postgres://..." npm run db:migrate
NEON_DATABASE_URL="postgres://..." npm run db:seed
```

## Setting up production, once

Everything runs on free tiers; the domain is the only bill. In order:

1. **Cloudflare account** + the domain (Cloudflare Registrar sells at cost).
   `npm i -g wrangler && wrangler login`.
2. **Neon** — new project, region **London (aws-eu-west-2)**. Copy the
   connection string. `npm run db:migrate` then `npm run db:seed` with it.
3. **The secret** — `wrangler secret put NEON_DATABASE_URL` (paste it). Locally,
   put the same line in `.dev.vars` (gitignored) for `wrangler dev`.
4. **R2** — create bucket `rentle-img`; R2 → the bucket → Settings → Custom
   domains → `img.<yourdomain>`. Create an R2 API token (object read & write)
   and configure rclone with it (`rclone config`: type `s3`, provider
   `Cloudflare`, endpoint `https://<account-id>.r2.cloudflarestorage.com`).
   Upload: `rclone sync client/public/img r2:rentle-img --transfers 8`.
5. **site.json** — `imageBase: "https://img.<yourdomain>"`,
   `siteUrl: "https://<yourdomain>"`, `contactEmail`.
6. **First deploy** — `npm run deploy`. Then Workers & Pages → rentle →
   Settings → Domains & Routes → add `<yourdomain>` and `www.<yourdomain>`
   (Cloudflare writes the DNS records for you when the zone is in the same
   account).
7. **CI deploys** — GitHub repo → Settings → Secrets → `CLOUDFLARE_API_TOKEN`
   (Cloudflare → My Profile → API Tokens → "Edit Cloudflare Workers"
   template). From then on every push to `main` deploys itself
   (`.github/workflows/deploy.yml`); until the secret exists the step skips.
8. **Paperwork** — accept Neon's and Cloudflare's DPAs; run the ICO fee
   self-assessment; read `/privacy` once as a player would. Every claim on it
   is a fact about this code (what `server/app.js` stores, the periods in
   `server/retention.js`, London), so if you change a rule, change the page.

Photos are why the bucket exists: ~380KB a listing, the whole bandwidth bill,
and the reason a deploy used to have to come from the scraping machine. With
`imageBase` pointing at R2 every image URL is absolute, a checkout without
`client/public/img/` builds a complete site, and the deploy is ~2,000 files
instead of ~12,000 (the Workers static-asset cap is 20,000). If the folder is
present at build time Vite copies it into `dist/` too — harmless, just slow.

If `--check` says BLOCKED (datacenter IPs often are), run the scrape from a
residential connection instead: clone, `npm install`, `npm run seed`,
`npm run images`, `rclone sync ...`, commit `data/`, push — CI deploys it.

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
- What the server stores is personal data under UK GDPR even before anyone
  gives an email: a random player id and a guess history. It is held in
  London, never sold or shared, exportable and deletable in one tap
  (`/privacy`, backed by `GET`/`DELETE /api/me`), and forgotten on a schedule
  (`server/retention.js`). The session cookie is only set by the first game
  a browser finishes, which is what makes it strictly necessary for a feature
  the player chose rather than one they were given — so there is no consent
  banner. Cloudflare and Neon are US companies: accept both DPAs, and check
  whether the site needs to pay the ICO data-protection fee.
