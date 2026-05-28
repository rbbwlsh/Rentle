// Express API + (in production) static host for the built React client.
//
// Endpoints:
//   POST  /api/challenge   { url }                  -> { id }      (create + warm cache)
//   GET   /api/listing?id=...                        -> public listing (rent hidden)
//   POST  /api/guess       { id, guess, attempt, clientId } -> result + hint
//   POST  /api/result      { id, clientId, ... }     -> { resultId, stats }
//   GET   /api/result/:id                            -> a shared opponent's score
//   PATCH /api/result/:id  { name }                  -> rename for the share card
//
// The real rent never leaves the server until the player wins or fails: guesses
// are scored here against the cached listing. Every guess and final result is
// persisted (Postgres in prod, SQLite locally) to power the aggregate stats.

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

// Create a challenge from a pasted Rightmove URL. Warms the cache so the first
// play is fast, and surfaces any listing problems (sale, removed, etc.) now.
app.post('/api/challenge', async (req, res) => {
  try {
    const id = parseRightmoveUrl(req.body?.url);
    await getChallenge(id); // validate + warm
    res.json({ ok: true, id });
  } catch (err) {
    sendError(res, err);
  }
});

// The play payload: everything about the listing except the rent.
app.get('/api/listing', async (req, res) => {
  try {
    const id = parseRightmoveUrl(req.query?.id);
    const { listing } = await getChallenge(id);
    res.json({ ok: true, listing: publicListing(listing), winMargin: WIN_MARGIN });
  } catch (err) {
    sendError(res, err);
  }
});

// Score a guess and return the next hint (or win/fail).
app.post('/api/guess', async (req, res) => {
  try {
    const id = parseRightmoveUrl(req.body?.id);
    const guess = Number(req.body?.guess);
    const attempt = Number(req.body?.attempt);

    if (!Number.isFinite(guess) || guess <= 0) {
      throw new ListingError('Please enter a valid rent guess.', 400);
    }
    if (!Number.isInteger(attempt) || attempt < 1 || attempt > MAX_ATTEMPTS) {
      throw new ListingError('Invalid attempt number.', 400);
    }

    const { listing, comparables } = await getChallenge(id);
    const actual = listing.priceAmount;
    const diff = guess - actual;
    const direction = diff > 0 ? 'high' : 'low';
    const won = Math.abs(diff) <= WIN_MARGIN;

    // Persist the guess for aggregate stats (best-effort; never blocks play).
    recordGuessSafe({ propertyId: id, clientId: req.body?.clientId, attempt, guess, won });

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
    const id = parseRightmoveUrl(req.body?.id);
    const clientId = req.body?.clientId ? String(req.body.clientId) : null;
    const name = sanitizeName(req.body?.name);
    const won = !!req.body?.won;
    const guesses = Array.isArray(req.body?.guesses)
      ? req.body.guesses.map(Number).filter((n) => Number.isFinite(n) && n > 0)
      : [];
    if (!guesses.length) {
      throw new ListingError('No guesses to record.', 400);
    }

    const { listing } = await getChallenge(id);
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
      propertyId: id,
      clientId,
      name,
      won,
      attemptWon,
      bestDiff,
    });
    const stats = await store.getPropertyStats(id, bestDiff);

    res.json({ ok: true, resultId, stats, you: { won, attemptWon, bestDiff } });
  } catch (err) {
    sendError(res, err);
  }
});

// Look up a shared result so a friend can try to beat that score.
app.get('/api/result/:id', async (req, res) => {
  try {
    const store = await getStore();
    const result = await store.getResult(String(req.params.id));
    if (!result) throw new ListingError('That shared result could not be found.', 404);
    res.json({ ok: true, result });
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
