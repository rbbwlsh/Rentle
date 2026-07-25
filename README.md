# 🎰 Rentle

A "guess the rent" game in the spirit of
[Dublin Rent Roulette](https://dublinrentroulette.com), but powered by **any
Rightmove listing you paste in** — with crowd stats and shareable scores.

Paste a Rightmove *to-rent* URL, get a **shareable link**, and send it to
friends. Each player gets **4 guesses** at the monthly rent, with escalating
hints:

1. **Wrong guess #1** → a comparable rental **within 0.25 miles, with its price**.
2. **Wrong guess #2** → another nearby comparable with its price.
3. **Wrong guesses #3 & #4** → just *"too high" / "too low"*.
4. Still wrong after 4 guesses → the real rent is revealed.

**Win = guess within ±£50 pcm.** The real rent is checked **server-side** and
never sent to the browser until you win or fail, so friends can't peek.

### Crowd stats & sharing

Every guess and finished game is stored on the backend. At the reveal you see
**how you compare with everyone else who played that property**:

- the **percentile** of your closest guess ("closer than 78% of players"), and
- the **breakdown of how people did** — what share cracked it on guess 1, 2, 3,
  4, or didn't get it — with your own result highlighted.

You also get a **"beat my score" link**. When a friend opens it they play the
same property and, at the end, are compared head-to-head against your result
(a win beats a loss; fewer guesses wins; ties broken by who was closer).

## How it works

Every Rightmove property page embeds the full listing as a `window.PAGE_MODEL`
JSON blob (price, address, beds/baths, images, description, location, …). A
small Node/Express backend fetches the page server-side, extracts that JSON, and
serves a price-less version to the React frontend. Comparables come from
Rightmove's to-rent search results, filtered by real distance from the target.

- **`server/`** — Express API
  - `rightmove.js` — fetch + parse a listing from `PAGE_MODEL`
  - `comparables.js` — find nearby rentals for hints (degrades gracefully)
  - `cache.js` — in-memory TTL cache of listings (no scrape on every request)
  - `storage/` — guess/result persistence (Postgres in prod, SQLite locally)
  - `index.js` — `/api/challenge`, `/api/listing`, `/api/guess`, `/api/result`
- **`client/`** — React + Vite + Tailwind single-page app

### Data model

Two tables (created automatically on startup):

- **`guesses`** — every individual guess (`property_id, client_id, attempt,
  guess, won`). The raw record of what people guessed.
- **`results`** — one row per finished game (`property_id, client_id, name,
  won, attempt_won, best_diff`), unique per `(property, client)` so replays
  don't inflate the stats. Powers percentile, the breakdown, and share links.

Players are anonymous — a random id in `localStorage` (`rentle_client_id`) is
used only to de-duplicate replays.

## Run it locally

Requires **Node 18+** (uses the built-in `fetch`; SQLite via the built-in
`node:sqlite`). All commands below run from this `rentle/` directory.

```bash
npm install        # installs server + client deps
npm run dev        # Express on :3001, Vite on :5173 (open this one)
npm test           # run the API/integration test suite (node --test)
```

With no `DATABASE_URL`, data is stored in a local SQLite file at `data/rentle.db`.

### Production build

```bash
npm run build      # builds the client into client/dist
npm start          # Express serves the API + built client on :3001
```

## Deploy to Render

This repo ships a [`render.yaml`](../render.yaml) Blueprint that provisions a
Node web service **and** a managed Postgres database, wiring `DATABASE_URL`
automatically. It sits at the repo root (Render only looks for it there) and
points `rootDir` at this directory.

1. Push this repo to GitHub.
2. In the [Render dashboard](https://dashboard.render.com), choose
   **New → Blueprint** and pick the repo. Render reads `render.yaml`.
3. It builds with `npm install && npm run build` and starts with `npm start`.
4. Open the service URL, paste a Rightmove listing, and share away.

The service exposes `/healthz` (wired up as Render's health check). Shared
links (`?c=` / `?r=`) get per-challenge Open Graph tags + an image so previews
in WhatsApp/iMessage/Slack show a "guess the rent" card — without leaking the
price. The `/api` routes are rate-limited per IP, and outbound Rightmove
requests retry with backoff. CI (`.github/workflows/ci.yml`) runs the build +
tests on every push.

**Environment variables**

| Var            | Purpose                                                        |
| -------------- | ------------------------------------------------------------- |
| `DATABASE_URL` | Postgres connection string. **Set → uses Postgres.** Unset → SQLite. |
| `NODE_ENV`     | `production` makes Express serve the built client.            |
| `PORT`         | Port to listen on (Render sets this automatically).          |
| `SQLITE_PATH`  | Optional SQLite file path for local/single-server use.       |

> The SSL settings for Postgres are handled automatically (managed providers
> like Render/Neon/Supabase require SSL; `localhost` connections don't).

## ⚠️ Notes

- **Network / IP blocking:** Rightmove blocks automated requests from many
  datacenter/cloud IPs (and some platforms may sandbox outbound traffic). If
  Rightmove can't be reached you'll get a clear error. Render's free web
  services can reach Rightmove, but if you hit blocks consider a proxy.
- **Comparables are best-effort.** They rely on Rightmove's internal search; if
  it can't be reached, hints 1 & 2 fall back to "too high / too low" and the
  game still completes.
- Scraping Rightmove is against their Terms of Service. This is a small project
  built for fun; the backend caches results to keep request volume low. Use
  responsibly.
