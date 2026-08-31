# Rentle — working notes for Claude

Daily guess-the-rent game on real UK Rightmove listings. **Fully static**: a
pre-scraped corpus is baked in at build time, the engine runs client-side,
stats live in localStorage. No backend. See README.md for the full picture —
this file is the operational stuff that isn't obvious from the code.

## Commands

```bash
npm install          # root + client deps (postinstall handles client/)
npm test             # 31 unit tests, no network — run before every push
npm run dev          # corpus build + vite dev on :5173
npm run build        # corpus -> vite build -> prerender, into client/dist
npm run preview      # serve the real build on :4173
netlify deploy --prod
```

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

`npm run images` takes ~30 min for ~500 listings at 300ms/photo. It's
resumable — interrupt and re-run.

## Data: committed vs not

| Committed | Not committed |
|---|---|
| `data/corpus/*.json` — 500 scraped listings | `client/public/img/` — photo binaries |
| `data/images-manifest.json` — what was processed | `client/public/data/` — built corpus |
| `data/order.json` — append-only daily order | `data/state/` — scrape caches |

`data/order.json` is **append-only on purpose**: it fixes which listing is
"today's" puzzle. Never reorder or rewrite it, or every player's day shifts.

## Layout

```
tools/seed.js          scrape -> data/corpus/<id>.json
tools/images.js        photos -> client/public/img/<id>/*.webp
tools/build-corpus.js  corpus -> client/public/data/ (price-free index +
                       per-listing chunks, answer base64'd)
tools/prerender.js     /p/<id>/ share pages w/ OG tags, absolute URLs from
                       tools/config/site.json
client/src/engine/     engine.js picker.js share.js stats.js
```

## Scraping etiquette

Rightmove's ToS prohibits scraping; this project does it deliberately and
gently. Keep the ~1s seed delay and 300ms image delay, don't run `seed` on a
schedule, and don't parallelise the fetches. Datacenter IPs get blocked at
volume — `npm run seed -- --check` is the preflight. (This Codespace's IP
reached the media CDN fine as of Aug 2026.)

## Gotchas

- Node 24 locally, Node 22 in CI (`.github/workflows/ci.yml` runs
  install/test/build on every push — imageless, which is fine).
- The rent is base64-obscured in the payload, not encrypted. Anyone with
  devtools can cheat. Known and accepted.
- `tools/config/site.json` `siteUrl` must match the deployed origin or link
  previews break. Rebuild + redeploy after changing it.
