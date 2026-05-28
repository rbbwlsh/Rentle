// Express API + (in production) static host for the built React client.
//
// Endpoints:
//   POST /api/challenge  { url }            -> { id }            (create + warm cache)
//   GET  /api/listing?id=...                -> public listing    (rent hidden)
//   POST /api/guess      { id, guess, attempt } -> guess result + hint
//
// The real rent never leaves the server until the player wins or fails: guesses
// are scored here against the cached listing.

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRightmoveUrl, publicListing, ListingError } from './rightmove.js';
import { getChallenge } from './cache.js';

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

    // Win.
    if (Math.abs(diff) <= WIN_MARGIN) {
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

// Production: serve the built client and let the SPA handle client-side routes.
if (process.env.NODE_ENV === 'production') {
  const dist = path.join(__dirname, '..', 'client', 'dist');
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// Only start listening when run directly (so tests can import `app`).
if (import.meta.url === `file://${process.argv[1]}`) {
  app.listen(PORT, () => {
    console.log(`Rent Roulette server listening on http://localhost:${PORT}`);
  });
}

export { app };
