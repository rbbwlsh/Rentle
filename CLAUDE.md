# Rentle — working notes for Claude

Two daily games on real UK Rightmove listings, behind one toggle: guess the
**rent** (six cities), or guess the **asking price** (a UK-wide sample, studios
through 3-beds). **Static site + one Worker**: pre-scraped corpora are baked in
at build time, the engine runs client-side, and one Cloudflare Worker serves
the build and, on `/api/*`, records games server-side in Neon Postgres for
crowd stats. Photos are served from an R2 bucket. Play never depends on the
API — with it down the game records to localStorage as it always did. See README.md for the full picture — this file is the operational
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
npm run preview:worker  # build + wrangler dev: the real Worker + assets on :8787
npm run seed         # scrape the RENT corpus (tools/config/outcodes.json)
npm run seed:buy     # scrape the BUY corpus (tools/config/outcodes.buy.json)
npm run images       # photos for every mode's corpus, into one shared store
rclone sync client/public/img r2:rentle-img   # ...then up to the bucket
npm run deploy       # build + wrangler deploy (CI does this on push to main)

NEON_DATABASE_URL=... npm run db:migrate   # apply db/migrations/ (idempotent)
NEON_DATABASE_URL=... npm run db:seed      # load the answer key from data/corpus*/
wrangler secret put NEON_DATABASE_URL      # the production secret, once
```

`npm run corpus` and `npm run images` both walk **every** mode in
`tools/config/modes.js` — there is no per-mode build or image command, and
adding a mode needs no change to either.

## The two rules that matter

**1. Photos come from R2, not the deploy.** `imageBase` in
`tools/config/site.json` is the bucket's custom domain, so every image URL in
`/data/*` and every `og:image` is absolute and a checkout with no
`client/public/img/` builds a complete site — which is what lets CI deploy on
push. If `imageBase` is ever set back to `/img`, the old trap returns: the
binaries are gitignored, so a CI build ships a working, *photo-less* site,
silently. After `npm run images`, sync the store up
(`rclone sync client/public/img r2:rentle-img`) BEFORE deploying the corpus
that references the new photos.

**2. Deploy the whole pipeline, in order.** seed → images → rclone sync →
`db:seed` → build → deploy. `npm run build` regenerates `client/public/data/`
from `data/corpus/`, but it does **not** fetch photos, and the database's
answer key does not update itself.

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
| `data/order.json`, `data/order-buy.json` — daily order | `.env`, `.dev.vars` — never; the secret lives in Cloudflare |
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
server/                app.js (the API) db.js session.js retention.js migrate.js
worker/index.js        the Worker: assets + /api/* + cron. wrangler.jsonc.
```

Routes: the rent game keeps the bare paths it launched with (`/`, `/browse`,
`/p/<id>`) so share links already in the wild still resolve; the buy game lives
under `/buy`. The header toggle switches between them.

## The API and the database

`worker/index.js` is a thin wrapper; the whole API is `server/app.js`, which
the tests call directly against PGlite (real Postgres in WASM —
`test/api.test.mjs` runs the production migrations and SQL with no network).
Production uses Neon over its HTTP driver via the `NEON_DATABASE_URL` secret.
Nothing under `server/` that the Worker imports may touch `node:fs` — that's
why `migrate()` lives in `server/migrate.js`, not `db.js`.

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
  as a SHA-256 hex. `Secure` follows the request scheme so `wrangler dev` works.
- **Nothing is called on page load.** The cookie and the `players` row are
  created by the first `POST /games` (or `/import`, if the browser has
  pre-server history); `bootstrap()` in `client/src/api.js` makes no request
  otherwise. This is what makes the cookie "strictly necessary" under PECR
  (no banner), and it keeps crawlers out of the table. `POST /games` validates
  and scores *before* `ensurePlayer`, so a bad request leaves no row behind.
  Don't add a hello-on-load back.
- **Retention is code, not policy.** `server/retention.js` holds the periods
  and the SQL; the Worker's `scheduled` handler runs it on the cron in
  `wrangler.jsonc` (03:30 UTC daily); `/privacy`
  (`client/src/components/Privacy.jsx`) imports `RETENTION` and prints the
  same numbers. Change them in one place. `GET /api/me` is the export,
  `DELETE /api/me` the erase (it also removes merge tombstones pointing at the
  player, which would otherwise block the delete on the FK).
- **Listing ids are `bigint`** since migration 002. Both drivers accept a
  numeric string as a parameter, but they *return* bigint differently (PGlite
  a number, Neon a string) — always `::text` a listing id in a SELECT, and
  never compare a raw one to a string. `LISTING_ID` in `server/app.js` rejects
  non-numeric ids as 404 before they can reach a cast.
- **Sessions touch `last_used_at` at most once a day** (it only feeds
  retention), and the daily pick is memoised per (mode, date) for five
  minutes. `/import` handles `IMPORT_BATCH` (200) games per call and the
  client sends slices — resending the same object would re-skip the same first
  batch forever.
- **Regions:** Neon in London (`aws-eu-west-2`). The Worker runs at the edge
  nearest the player, so a UK player's game is scored a few ms from the
  database. `/privacy` says "London"; keep it true.
- **No database → 503 on every route**, and the client carries on locally.
  A deploy without `NEON_DATABASE_URL` is a working game with no crowd stats.
- Migrations are plain SQL in `db/migrations/`, one statement per
  `;`-terminated line, no `$$` bodies (Neon's HTTP driver runs one statement
  per request; `server/db.js` splits on that rule). No `citext` — PGlite
  doesn't bundle it; emails use a unique index on `lower(email)`.
- `wrangler.jsonc` routes `/api/*` to the Worker **before** the asset layer
  (`run_worker_first`), so the SPA fallback (`not_found_handling`) can never
  swallow an API call; every other path is a static asset. `_headers` in
  `client/public/` still sets the cache rules; there is no `_redirects`.
- The secret: `wrangler secret put NEON_DATABASE_URL`, no redeploy needed.
  Locally, `.dev.vars` (gitignored) feeds `wrangler dev`. The data is
  pseudonymous personal data under UK GDPR; London keeps it simple.
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

## R2, specifically

The bucket `rentle` was created in R2's **EU jurisdiction**, which has its own
S3 endpoint: `https://<account-id>.eu.r2.cloudflarestorage.com` (the default
`…r2.cloudflarestorage.com` reports "bucket does not exist" and rclone then
tries to *create* one, which the token refuses). The R2 REST API needs the
header `cf-r2-jurisdiction: eu` for the same reason. rclone is configured by
environment, not a config file, from the gitignored `.env`:

```bash
set -a; . ./.env; set +a          # CLOUDFLARE_API_TOKEN, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
export RCLONE_CONFIG_R2_TYPE=s3 RCLONE_CONFIG_R2_PROVIDER=Cloudflare \
  RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
  RCLONE_CONFIG_R2_ENDPOINT="https://<account-id>.eu.r2.cloudflarestorage.com"
rclone sync client/public/img r2:rentle --transfers 8
```

Never `. ./.dev.vars` in a shell: the Neon URL contains `&`, which bash reads
as a job separator and echoes the command line — password included — into
the output. Read it with `grep '^NEON_DATABASE_URL=' .dev.vars | cut -d= -f2-`
and pipe it (`| npx wrangler secret put NEON_DATABASE_URL`). wrangler reads
`.dev.vars` itself for `wrangler dev`.

The photo bucket's custom domain is `img.rentle-uk.uk`. The apex must NOT be
attached to the bucket — it belongs to the Worker (wrangler.jsonc `routes`),
and wrangler refuses a hostname that already has a DNS record it didn't make.

## Honouring a takedown

`/privacy` promises removal "normally within two working days", so this is
the procedure, not a judgement call. For Rightmove id `<id>`:

```bash
rm data/corpus/<id>.json data/corpus-buy/<id>.json 2>/dev/null   # whichever exists
rm -rf client/public/img/<id>
rclone delete r2:rentle/<id>            # the served photos (see "R2" below)
git commit -am "Remove listing <id> on request" && git push      # CI redeploys
```

`buildOrder` drops ids that have left the corpus, so the daily order stays
append-only and nobody's puzzle shifts; the `listings` row in Neon can stay
(games reference it; the client can no longer reach it). Reply to the
requester when the deploy is green.

## Scraping etiquette

Rightmove's ToS prohibits scraping; this project does it deliberately and
gently. Keep the ~1s seed delay and 300ms image delay, don't run `seed` on a
schedule, and don't parallelise the fetches. Two corpora is twice the traffic —
the buy run alone is ~1,000 requests once outcode ids are cached. Datacenter IPs get blocked at
volume — `npm run seed -- --check` is the preflight. (This Codespace's IP
reached the media CDN fine as of Aug 2026.)

## Gotchas

- Node 24 locally, Node 22 in CI. `ci.yml` runs install/test/build on every
  push; `deploy.yml` additionally runs `wrangler deploy` on `main`, and skips
  that step until the `CLOUDFLARE_API_TOKEN` repo secret exists.
- Workers static assets cap a deploy at 20,000 files. With photos on R2 the
  build is ~2,000; with `client/public/img/` present it's ~12,000 today and
  would cross the cap around 1,700 listings.
- The rent is base64-obscured in the payload, not encrypted. Anyone with
  devtools can cheat. Known and accepted.
- `tools/config/site.json` `siteUrl` must match the deployed origin or link
  previews break; `contactEmail` is printed on `/privacy`; `imageBase` is
  where photos are served from. Rebuild + redeploy after changing any.
- `tools/prerender.js` must run on a fresh `vite build` output: injecting the
  root page consumes the `META_START/END` markers, so a second run would stamp
  the home tags on every share page. It now throws instead — use
  `npm run build`, never `node tools/prerender.js` alone.
- The client imports `server/retention.js` and `tools/config/site.json` from
  outside `client/` — Vite resolves both, in dev and build, because the
  workspace root is the repo root (the lockfile is there).
