import { useEffect, useState } from 'react';
import { loadIndex, loadListing } from '../data.js';
import { scoreGuess, summarizeGuesses, MAX_ATTEMPTS } from '../engine/engine.js';
import { pickDaily, londonDate } from '../engine/picker.js';
import { recordGame } from '../engine/stats.js';
import { formatGbp } from '../format.js';
import ListingCard from './ListingCard.jsx';
import GuessControl from './GuessControl.jsx';
import HintList from './HintList.jsx';
import Reveal from './Reveal.jsx';

// The 4-guess game. Loads a listing chunk from the static corpus, scores
// guesses client-side, and ends in a win or fail reveal with personal stats.
// If `opponent` is set (from a ?s= share link), the player is trying to beat
// a friend's score.
export default function Game({ listingId, opponent, onHome, navigate }) {
  const [phase, setPhase] = useState('loading'); // loading|error|playing|won|lost
  const [error, setError] = useState('');
  const [listing, setListing] = useState(null);
  const [answer, setAnswer] = useState(null);

  const [attempt, setAttempt] = useState(1);
  const [hints, setHints] = useState([]);
  const [guesses, setGuesses] = useState([]);
  const [you, setYou] = useState(null); // { won, attemptWon, bestDiff }

  useEffect(() => {
    let cancelled = false;
    setPhase('loading');
    loadListing(listingId)
      .then((data) => {
        if (cancelled) return;
        if (!data.answer) throw new Error('This listing could not be loaded.');
        setListing(data.listing);
        setAnswer(data.answer);
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
  }, [listingId]);

  async function finish(won, allGuesses) {
    const { bestDiff, attemptWon } = summarizeGuesses(allGuesses, answer.priceAmount);
    setYou({ won, attemptWon, bestDiff });
    setPhase(won ? 'won' : 'lost');
    // Streaks only count for today's daily listing.
    try {
      const index = await loadIndex();
      const today = londonDate();
      recordGame({
        id: String(listingId),
        won,
        attemptWon,
        bestDiff,
        guesses: allGuesses,
        isDaily: String(pickDaily(index.order, today)) === String(listingId),
        dateStr: today,
      });
    } catch {
      /* stats are non-essential */
    }
  }

  function handleGuess(guess) {
    const nextGuesses = [...guesses, guess];
    setGuesses(nextGuesses);
    const res = scoreGuess({
      actual: answer.priceAmount,
      guess,
      attempt,
      comparables: listing.comparables || [],
    });
    if (res.status === 'win' || res.status === 'fail') {
      finish(res.status === 'win', nextGuesses);
    } else {
      setHints((h) => [...h, res.hint]);
      setAttempt((a) => a + 1);
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
    const bestGuess = guesses.length
      ? guesses.reduce((best, g) =>
          Math.abs(g - answer.priceAmount) < Math.abs(best - answer.priceAmount)
            ? g
            : best
        )
      : null;
    return (
      <Reveal
        won={phase === 'won'}
        actual={answer.priceAmount}
        priceLabel={answer.priceLabel}
        displayAddress={answer.displayAddress}
        bestGuess={bestGuess}
        rightmoveUrl={answer.rightmoveUrl}
        listingId={listingId}
        you={you}
        opponent={opponent}
        onHome={onHome}
        navigate={navigate}
      />
    );
  }

  // phase === 'playing'
  return (
    <div className="space-y-5">
      {opponent && <OpponentBanner opponent={opponent} />}

      <ListingCard listing={listing} />

      <HintList hints={hints} />

      <GuessControl attempt={attempt} maxAttempts={MAX_ATTEMPTS} onGuess={handleGuess} />

      <p className="text-center text-xs text-slate-400">
        Guess the monthly rent. Get within £50 to win. Wrong guesses unlock hints.
      </p>
    </div>
  );
}

function OpponentBanner({ opponent }) {
  const name = opponent.name || 'A friend';
  const summary = opponent.won
    ? `won on guess ${opponent.attemptWon}`
    : `got within ${formatGbp(opponent.bestDiff)} but didn't crack it`;
  return (
    <div className="rounded-2xl bg-brand-600 px-5 py-4 text-center text-white shadow-lg">
      <p className="text-sm font-semibold">🏁 Beat {name}</p>
      <p className="text-xs text-brand-100">
        They {summary}. Can you do better?
      </p>
    </div>
  );
}
