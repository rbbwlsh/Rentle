import { useEffect, useState } from 'react';
import { getListing, submitGuess } from '../api.js';
import ListingCard from './ListingCard.jsx';
import GuessControl from './GuessControl.jsx';
import HintList from './HintList.jsx';
import Reveal from './Reveal.jsx';

const MAX_ATTEMPTS = 4;

// The 4-guess game. Loads the (price-less) listing, collects guesses, shows the
// hints the server returns, and ends in a win or fail reveal.
export default function Game({ id, onHome }) {
  const [phase, setPhase] = useState('loading'); // loading|error|playing|won|lost
  const [error, setError] = useState('');
  const [listing, setListing] = useState(null);

  const [attempt, setAttempt] = useState(1);
  const [hints, setHints] = useState([]);
  const [guesses, setGuesses] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null); // { actual, priceLabel, rightmoveUrl }

  useEffect(() => {
    let cancelled = false;
    setPhase('loading');
    getListing(id)
      .then((data) => {
        if (cancelled) return;
        setListing(data.listing);
        setPhase('playing');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        setPhase('error');
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function handleGuess(guess) {
    if (submitting) return;
    setSubmitting(true);
    const nextGuesses = [...guesses, guess];
    setGuesses(nextGuesses);
    try {
      const res = await submitGuess(id, guess, attempt);
      if (res.status === 'win' || res.status === 'fail') {
        setResult({
          actual: res.actual,
          priceLabel: res.priceLabel,
          rightmoveUrl: res.rightmoveUrl,
        });
        setPhase(res.status === 'win' ? 'won' : 'lost');
      } else {
        setHints((h) => [...h, res.hint]);
        setAttempt((a) => a + 1);
      }
    } catch (err) {
      // Roll back the optimistic guess so the player can retry.
      setGuesses(guesses);
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (phase === 'loading') {
    return (
      <div className="rounded-2xl bg-white p-10 text-center text-slate-400 shadow-lg">
        Loading listing…
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="rounded-2xl bg-white p-8 text-center shadow-lg">
        <div className="text-3xl">🚫</div>
        <p className="mt-3 text-sm text-slate-600">{error}</p>
        <button
          onClick={onHome}
          className="mt-5 rounded-xl bg-brand-600 px-4 py-2.5 font-semibold text-white hover:bg-brand-700"
        >
          Back to start
        </button>
      </div>
    );
  }

  if (phase === 'won' || phase === 'lost') {
    const bestGuess =
      result && guesses.length
        ? guesses.reduce((best, g) =>
            Math.abs(g - result.actual) < Math.abs(best - result.actual) ? g : best
          )
        : null;
    return (
      <Reveal
        won={phase === 'won'}
        actual={result.actual}
        priceLabel={result.priceLabel}
        bestGuess={bestGuess}
        rightmoveUrl={result.rightmoveUrl}
        onHome={onHome}
      />
    );
  }

  // phase === 'playing'
  return (
    <div className="space-y-5">
      <ListingCard listing={listing} />

      <HintList hints={hints} />

      {error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}

      <GuessControl
        attempt={attempt}
        maxAttempts={MAX_ATTEMPTS}
        disabled={submitting}
        onGuess={handleGuess}
      />

      <p className="text-center text-xs text-slate-400">
        Guess the monthly rent. Get within £50 to win. Wrong guesses unlock
        hints.
      </p>
    </div>
  );
}
