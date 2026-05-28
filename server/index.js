// Express API + (in production) static host for the built React client.
//
// Endpoints (challenges are referenced only by an opaque id `c`, never the
// Rightmove id/URL, so the actual listing can't be looked up during play):
//   POST  /api/challenge   { url }                   -> { c }      (create + warm cache)
//   GET   /api/listing?c=...                          -> public listing (rent + address hidden)
//   POST  /api/guess       { c, guess, attempt, clientId } -> result + hint
//   POST  /api/result      { c, clientId, ... }       -> { resultId, stats }
//   GET   /api/result/:id                             -> a shared opponent's score
//   PATCH /api/result/:id  { name }                   -> rename for the share card
//
// The real rent and the exact address/URL never leave the server until the
// player wins or fails: guesses are scored here against the cached listing.
// Every guess and final result is persisted (Postgres in prod, SQLite locally)
// to power the aggregate stats.

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRightmoveUrl, publicListing, ListingError } from './rightmove.js';
import { getChallenge } from './cache.js';
import { getStore, shortId } from './storage/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;
const WIN_MARGIN = 50; // £ pcm — a guess this close (or closer) wins.
const MAX_ATTEMPTS = 4;

function sendError(res, err) {
  if (err instanceof ListingError) {
    return res.status(err.status).json({ ok: false, error: err.message });
  }
  console.error('Unexpected error:', err);
  return res
    .status(500)
    .json({ ok: false, error: 'Something went wrong. Please try again.' });
}

// Persist a guess without ever blocking or failing the request.
async function recordGuessSafe(g) {
  try {
    const store = await getStore();
    await store.recordGuess(g);
  } catch (err) {
    console.error('recordGuess failed:', err.message);
  }
}

// Resolve an opaque challenge id `c` to the underlying Rightmove property id.
async function challengeProperty(c) {
  if (!c) throw new ListingError('Missing challenge id.', 400);
  const store = await getStore();
  const propertyId = await store.resolveChallenge(String(c));
  if (!propertyId) {
    throw new ListingError('That challenge link is invalid or expired.', 404);
  }
  return propertyId;
}

// Create a challenge from a pasted Rightmove URL. Warms the cache so the first
// play is fast, surfaces listing problems (sale, removed, etc.) now, and mints
// an opaque share id so the Rightmove listing can't be found during play.
app.post('/api/challenge', async (req, res) => {
  try {
    const propertyId = parseRightmoveUrl(req.body?.url);
    await getChallenge(propertyId); // validate + warm
    const store = await getStore();
    const c = await store.saveChallenge({ id: shortId(10), propertyId });
    res.json({ ok: true, c });
  } catch (err) {
    sendError(res, err);
  }
});

// The play payload: everything about the listing except the rent and anything
// that pinpoints the address.
app.get('/api/listing', async (req, res) => {
  try {
    const propertyId = await challengeProperty(req.query?.c);
    const { listing } = await getChallenge(propertyId);
    res.json({ ok: true, listing: publicListing(listing), winMargin: WIN_MARGIN });
  } catch (err) {
    sendError(res, err);
  }
});

// Score a guess and return the next hint (or win/fail).
app.post('/api/guess', async (req, res) => {
  try {
    const propertyId = await challengeProperty(req.body?.c);
    const guess = Number(req.body?.guess);
    const attempt = Number(req.body?.attempt);

    if (!Number.isFinite(guess) || guess <= 0) {
      throw new ListingError('Please enter a valid rent guess.', 400);
    }
    if (!Number.isInteger(attempt) || attempt < 1 || attempt > MAX_ATTEMPTS) {
      throw new ListingError('Invalid attempt number.', 400);
    }

    const { listing, comparables } = await getChallenge(propertyId);
    const actual = listing.priceAmount;
    const diff = guess - actual;
    const direction = diff > 0 ? 'high' : 'low';
    const won = Math.abs(diff) <= WIN_MARGIN;

    // Persist the guess for aggregate stats (best-effort; never blocks play).
    recordGuessSafe({ propertyId, clientId: req.body?.clientId, attempt, guess, won });

    // Win.
    if (won) {
      return res.json({
        ok: true,
        status: 'win',
        actual,
        priceLabel: listing.priceLabel,
        rightmoveUrl: listing.rightmoveUrl,
      });
    }

    // Final attempt used up -> fail, reveal the answer.
    if (attempt >= MAX_ATTEMPTS) {
      return res.json({
        ok: true,
        status: 'fail',
        actual,
        direction,
        priceLabel: listing.priceLabel,
        rightmoveUrl: listing.rightmoveUrl,
      });
    }

    // Otherwise: build the hint for this attempt.
    //   attempt 1 -> comparable #1, attempt 2 -> comparable #2 (if available),
    //   later attempts (or missing comparables) -> too high / too low.
    let hint;
    if (attempt <= comparables.length && attempt <= 2) {
      hint = { type: 'comparable', property: comparables[attempt - 1], direction };
    } else {
      hint = { type: 'direction', direction };
    }

    res.json({ ok: true, status: 'continue', attempt, hint });
  } catch (err) {
    sendError(res, err);
  }
});

// Record a finished game and return how the player compares with everyone else
// on this property. Creates the shareable result id.
app.post('/api/result', async (req, res) => {
  try {
    const propertyId = await challengeProperty(req.body?.c);
    const clientId = req.body?.clientId ? String(req.body.clientId) : null;
    const name = sanitizeName(req.body?.name);
    const won = !!req.body?.won;
    const guesses = Array.isArray(req.body?.guesses)
      ? req.body.guesses.map(Number).filter((n) => Number.isFinite(n) && n > 0)
      : [];
    if (!guesses.length) {
      throw new ListingError('No guesses to record.', 400);
    }

    const { listing } = await getChallenge(propertyId);
    const actual = listing.priceAmount;
    const bestDiff = Math.min(...guesses.map((g) => Math.abs(g - actual)));

    // attempt_won = which guess (1-based) first landed within the margin.
    let attemptWon = null;
    if (won) {
      const idx = guesses.findIndex((g) => Math.abs(g - actual) <= WIN_MARGIN);
      attemptWon = idx >= 0 ? idx + 1 : guesses.length;
    }

    const store = await getStore();
    const resultId = await store.recordResult({
      id: shortId(),
      propertyId,
      clientId,
      name,
      won,
      attemptWon,
      bestDiff,
    });
    const stats = await store.getPropertyStats(propertyId, bestDiff);

    res.json({ ok: true, resultId, stats, you: { won, attemptWon, bestDiff } });
  } catch (err) {
    sendError(res, err);
  }
});

// Look up a shared result so a friend can try to beat that score. Returns the
// opaque challenge id to replay — never the Rightmove id.
app.get('/api/result/:id', async (req, res) => {
  try {
    const store = await getStore();
    const result = await store.getResult(String(req.params.id));
    if (!result) throw new ListingError('That shared result could not be found.', 404);
    const c = await store.saveChallenge({ id: shortId(10), propertyId: result.propertyId });
    res.json({
      ok: true,
      result: {
        challengeId: c,
        name: result.name,
        won: result.won,
        attemptWon: result.attemptWon,
        bestDiff: result.bestDiff,
      },
    });
  } catch (err) {
    sendError(res, err);
  }
});

// Let a player put their name on the share card after the fact.
app.patch('/api/result/:id', async (req, res) => {
  try {
    const store = await getStore();
    await store.updateResultName({
      id: String(req.params.id),
      name: sanitizeName(req.body?.name),
    });
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
});

function sanitizeName(raw) {
  if (raw == null) return null;
  const name = String(raw).trim().slice(0, 24);
  return name || null;
}

// Production: serve the built client and let the SPA handle client-side routes.
if (process.env.NODE_ENV === 'production') {
  const dist = path.join(__dirname, '..', 'client', 'dist');
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// Only start listening when run directly (so tests can import `app`).
if (import.meta.url === `file://${process.argv[1]}`) {
  app.listen(PORT, () => {
    console.log(`Rentle server listening on http://localhost:${PORT}`);
  });
}

export { app };
