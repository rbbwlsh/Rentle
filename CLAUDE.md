# Rentle — working notes for Claude

Two daily games on real UK Rightmove listings, behind one toggle: guess the
**rent** (six cities), or guess the **asking price** (a UK-wide sample, studios
through 3-beds). **Static site + one function**: pre-scraped corpora are baked in
at build time, the engine runs client-side, and a single Netlify Function
(`/api/*`) records games server-side in Neon Postgres for crowd stats. Play
never depends on it — with the API down the game records to localStorage as it
always did. See README.md for the full picture — this file is the operational
stuff that isn't obvious from the code.

The two games share the board, the engine, the photo store and the image
manifest. They do NOT share corpora, daily order, puzzle numbering or streaks.
Everything mode-shaped is a table entry, not a branch: `tools/config/modes.js`
build-side, `client/src/engine/modes.js` player-side.

## Commands

```bash
npm install          # root + client deps (postinstall handles client/)
npm test             # unit tests, no network — run before every push
npm run dev          # corpus build + vite dev on :5173
npm run build        # corpus -> vite build -> prerender, into client/dist
npm run preview      # serve the real build on :4173
npm run seed         # scrape the RENT corpus (tools/config/outcodes.json)
npm run seed:buy     # scrape the BUY corpus (tools/config/outcodes.buy.json)
npm run images       # photos for every mode's corpus, into one shared store
netlify deploy --prod

NEON_DATABASE_URL=... npm run db:migrate   # apply db/migrations/ (idempotent)
NEON_DATABASE_URL=... npm run db:seed      # load the answer key from data/corpus*/
```

`npm run corpus` and `npm run images` both walk **every** mode in
`tools/config/modes.js` — there is no per-mode build or image command, and
adding a mode needs no change to either.

## The two rules that matter

**1. Never deploy via Netlify's git integration.** The photo binaries are
gitignored (~166MB on disk), so a build from a git checkout produces a
complete, working, *photo-less* site — it fails silently, not loudly. Deploy
only with `netlify deploy --prod` from a machine that has
`client/public/img/` populated. `netlify.toml` carries a `[build]` command for
completeness; treat it as documentation, not a deploy path.

**2. Deploy the whole pipeline, in order.** `npm run build` regenerates
`client/public/data/` from `data/corpus/`, but it does **not** fetch photos.
Images are a separate, earlier step.

## Setting up a fresh machine (the manifest trap)

`data/images-manifest.json` is committed and records what was processed. But
`tools/images.js` also uses it as its skip-list — `!(id in manifest)`. On a new
clone the manifest is complete while `client/public/img/` is empty, so a plain
`npm run images` reports **"0 to process"** and downloads nothing.

Reconcile the manifest against what's actually on disk first: drop the entries
whose files are missing, then run. Keep entries with `[]` (listings with no
usable photos) — there's nothing to fetch for them. A re-run after a complete
download is a no-op, and the regenerated manifest should match the committed
one; check `git diff data/images-manifest.json` afterwards and treat a
non-empty diff as real news (a listing's photos went 404 on Rightmove).

`npm run images` takes ~30 min per ~500 listings at 300ms/photo, and it now
walks both corpora — budget roughly double for a cold start. It's resumable —
interrupt and re-run.

## Data: committed vs not

| Committed | Not committed |
|---|---|
| `data/corpus/*.json` — scraped rent listings | `client/public/img/` — photo binaries |
| `data/corpus-buy/*.json` — scraped sale listings | `client/public/data/` — built corpora |
| `data/images-manifest.json` — what was processed | `data/state/` — scrape caches |
| `data/order.json`, `data/order-buy.json` — daily order | `.env` — never; secrets live on Netlify |
| `db/migrations/*.sql` — the schema | |

Both order files are **append-only on purpose**: they fix which listing is
"today's" puzzle. Never reorder or rewrite them, or every player's day shifts.
`data/order.json` in particular must keep its name and contents — it predates
the buy mode and carries the live rent game's schedule.

The image manifest and `client/public/img/` are **shared** across modes:
Rightmove ids are globally unique, so one photo store serves both corpora.

## Layout

```
tools/config/modes.js  the mode table: corpus dir, order file, output dir,
                       search channel, routes. Everything else reads it.
tools/seed.js          scrape -> data/corpus[-buy]/<id>.json  (--mode buy)
tools/lib/redact.js    strips price-revealing copy at build time
tools/images.js        photos -> client/public/img/<id>/*.webp (all modes)
tools/build-corpus.js  corpus -> client/public/data/<mode>/ (price-free index
                       + per-listing chunks, answer base64'd)
tools/prerender.js     /p/<id>/ and /buy/p/<id>/ share pages w/ OG tags,
                       absolute URLs from tools/config/site.json
client/src/engine/     engine.js picker.js share.js stats.js modes.js
```

Routes: the rent game keeps the bare paths it launched with (`/`, `/browse`,
`/p/<id>`) so share links already in the wild still resolve; the buy game lives
under `/buy`. The header toggle switches between them.

## The API and the database

`netlify/functions/api.mjs` is a thin wrapper; the whole API is
`server/app.js`, which the tests call directly against PGlite (real Postgres
in WASM — `test/api.test.mjs` runs the production migrations and SQL with no
network). Production uses Neon over its HTTP driver via `NEON_DATABASE_URL`.

The rules that matter:

- **The server never trusts the client's result.** `/api/games` takes raw
  guesses, looks the price up in `listings`, and scores with the same
  `engine.js` the browser runs. Stats are built from what the server stored.
- **`listings` is the answer key and must be re-seeded after any re-scrape**
  (`npm run db:seed`, upsert, safe to repeat). A game on a listing the table
  doesn't know is a 404. `position` is the listing's slot in `data/order*.json`
  and is how the server stamps `daily_date` — `test/api.test.mjs` proves the
  server and client pick the same daily over the real corpus.
- **First play stands** via the unique constraint on
  `(player_id, mode, listing_id)`; every write is idempotent.
- **Identity is a server-set httpOnly cookie** (`rentle_session`), stored only
  as a SHA-256 hex. `Secure` follows the request scheme so `netlify dev` works.
- **No database → 503 on every route**, and the client carries on locally.
  A deploy without `NEON_DATABASE_URL` is a working game with no crowd stats.
- Migrations are plain SQL in `db/migrations/`, one statement per
  `;`-terminated line, no `$$` bodies (Neon's HTTP driver runs one statement
  per request; `server/db.js` splits on that rule). No `citext` — PGlite
  doesn't bundle it; emails use a unique index on `lower(email)`.
- The function's `path: '/api/*'` is matched before redirects (Netlify's
  documented request chain), so the SPA fallback needs no exception.
- Setting env vars: `netlify env:set NEON_DATABASE_URL "..."`, then redeploy.
  Pick an EU/UK Neon region: the data is pseudonymous personal data under
  UK GDPR, and a UK→EU transfer needs nothing extra.
- Don't `pkill -f` a pattern that appears in your own command line — it kills
  the shell running it. Match on the process name instead.

## The buy channel, specifically

Sale pages are not lettings pages with a different number on them:

- **There is no numeric `prices.price` on a sale detail page** — only the
  search rows carry one. The asking price is parsed out of the formatted
  `prices.primaryPrice` string ("£340,000").
- `prices.pricePerSqFt` must never reach the client. The floor area is on the
  card, so it multiplies straight back into the answer.
- Four categories have a headline number that isn't an asking price and are
  rejected: shared ownership (the figure is a 25–40% share), auction lots,
  retirement units, and new-home developments quoting "from £X". The search
  filter `dontShow=retirement,sharedOwnership,newHome` kills most (verified
  live: an M1 2-bed search fell 351 -> 258 results and every `development` row
  went), but a studio search still returned an auction lot with it applied, so
  `normalize` re-checks every listing against its detail page.
- Investment and development ads put **marketing copy where the address goes**
  ("Fully Furnished Homes in Manchester City Centre"). Those make terrible
  rounds — no street, no tenure, no floor area — and are rejected by
  `looksLikeAddress`. In a live M1 smoke run they were 3 of the first 6 hits.
- Real studios often report `bedrooms: null` even when the search that found
  them filtered on 0 beds, so seed passes the stratum's bed count as
  `bedsHint`.
- The buy config is **clustered by town, not scattered**. Price per sq ft
  varies ~10x across the UK, so a comparable hint is only honest if it comes
  from the same town — and `pickComparables` ranks same-outcode ahead of merely
  nearby for the same reason.
- Great Britain only. The city picker draws a GB coastline, so a Northern
  Irish town would render as a pin floating in the Irish Sea.

## Scraping etiquette

Rightmove's ToS prohibits scraping; this project does it deliberately and
gently. Keep the ~1s seed delay and 300ms image delay, don't run `seed` on a
schedule, and don't parallelise the fetches. Two corpora is twice the traffic —
the buy run alone is ~1,000 requests once outcode ids are cached. Datacenter IPs get blocked at
volume — `npm run seed -- --check` is the preflight. (This Codespace's IP
reached the media CDN fine as of Aug 2026.)

## Gotchas

- Node 24 locally, Node 22 in CI (`.github/workflows/ci.yml` runs
  install/test/build on every push — imageless, which is fine).
- The rent is base64-obscured in the payload, not encrypted. Anyone with
  devtools can cheat. Known and accepted.
- `tools/config/site.json` `siteUrl` must match the deployed origin or link
  previews break. Rebuild + redeploy after changing it.
