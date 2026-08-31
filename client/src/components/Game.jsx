import { useEffect, useState } from 'react';
import { loadIndex, loadListing } from '../data.js';
import { scoreGuess, summarizeGuesses, MAX_ATTEMPTS, TIERS } from '../engine/engine.js';
import { pickDaily, dailyNumber, londonDate } from '../engine/picker.js';
import { recordGame } from '../engine/stats.js';
import { formatGbp } from '../format.js';
import ListingCard from './ListingCard.jsx';
import GuessControl from './GuessControl.jsx';
import HintList from './HintList.jsx';
import Reveal from './Reveal.jsx';

// The 5-guess game. Loads a listing chunk from the static data, scores
// guesses client-side, and shows a Wordle-style closeness row after each one.
// Ends in a win or fail reveal. If `opponent` is set (from a ?s= share link),
// the player is trying to beat a friend's score.
export default function Game({ mode, listingId, opponent, onHome, navigate }) {
  const [phase, setPhase] = useState('loading'); // loading|error|playing|won|lost
  const [error, setError] = useState('');
  const [listing, setListing] = useState(null);
  const [answer, setAnswer] = useState(null);

  const [attempt, setAttempt] = useState(1);
  const [hints, setHints] = useState([]);
  const [guesses, setGuesses] = useState([]);
  const [tiers, setTiers] = useState([]);
  const [directions, setDirections] = useState([]);
  const [you, setYou] = useState(null); // { won, attemptWon, bestDiff, bestPct }
  const [puzzleNo, setPuzzleNo] = useState(null); // set when this is today's daily

  useEffect(() => {
    let cancelled = false;
    setPhase('loading');
    loadListing(mode.key, listingId)
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
  }, [mode.key, listingId]);

  // Is this listing today's daily? (Drives streaks and the "Rentle #N" label.)
  useEffect(() => {
    loadIndex(mode.key)
      .then((index) => {
        if (String(pickDaily(index.order, londonDate())) === String(listingId)) {
          setPuzzleNo(dailyNumber(londonDate(), mode.epoch));
        }
      })
      .catch(() => {});
  }, [mode.key, mode.epoch, listingId]);

  async function finish(won, allGuesses, allTiers) {
    const { bestDiff, bestPct, attemptWon } = summarizeGuesses(
      allGuesses,
      answer.priceAmount
    );
    setYou({ won, attemptWon, bestDiff, bestPct });
    setPhase(won ? 'won' : 'lost');
    try {
      recordGame({
        mode: mode.key,
        id: String(listingId),
        won,
        attemptWon,
        bestDiff,
        bestPct,
        guesses: allGuesses,
        isDaily: puzzleNo != null,
        dateStr: londonDate(),
      });
    } catch {
      /* stats are non-essential */
    }
  }

  function handleGuess(guess) {
    const res = scoreGuess({
      actual: answer.priceAmount,
      guess,
      attempt,
      comparables: listing.comparables || [],
    });
    const nextGuesses = [...guesses, guess];
    const nextTiers = [...tiers, res.tier];
    setGuesses(nextGuesses);
    setTiers(nextTiers);
    setDirections((d) => [...d, guess > answer.priceAmount ? 'high' : 'low']);
    if (res.status === 'win' || res.status === 'fail') {
      finish(res.status === 'win', nextGuesses, nextTiers);
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
        mode={mode}
        won={phase === 'won'}
        actual={answer.priceAmount}
        priceLabel={answer.priceLabel}
        displayAddress={answer.displayAddress}
        bestGuess={bestGuess}
        rightmoveUrl={answer.rightmoveUrl}
        listingId={listingId}
        tiers={tiers}
        puzzleNo={puzzleNo}
        you={you}
        opponent={opponent}
        city={listing.city}
        onHome={onHome}
        navigate={navigate}
      />
    );
  }

  // phase === 'playing'
  return (
    <div className="space-y-5">
      {opponent && <OpponentBanner opponent={opponent} />}

      <ListingCard mode={mode} listing={listing} />

      <GuessHistory guesses={guesses} tiers={tiers} directions={directions} />

      <HintList mode={mode} hints={hints} />

      <GuessControl
        mode={mode}
        attempt={attempt}
        maxAttempts={MAX_ATTEMPTS}
        onGuess={handleGuess}
      />

      <p className="text-center text-xs text-slate-400">
        {mode.prompt} — within 5% wins. Guesses 1–3 tell you only higher or
        lower; a nearby comparable unlocks for guesses 4 and 5.
      </p>
    </div>
  );
}

const SQUARE_COLORS = {
  green: 'bg-emerald-500',
  yellow: 'bg-yellow-400',
  orange: 'bg-orange-400',
  red: 'bg-rose-500',
};

// One row per past guess: amount, five closeness squares, hot/cold word, and
// which way to move. The squares are the game's temperature language — same
// scale as the share grid.
export function GuessHistory({ guesses, tiers, directions }) {
  if (!guesses.length) return null;
  return (
    <div className="rounded-2xl bg-white p-4 shadow-lg shadow-rose-200/40">
      <div className="space-y-2">
        {guesses.map((g, i) => {
          const t = TIERS[tiers[i]];
          return (
            <div key={i} className="flex items-center gap-3 text-sm">
              <span className="w-16 text-right font-semibold text-slate-600">
                {formatGbp(g)}
              </span>
              <div className="flex gap-1">
                {[0, 1, 2, 3, 4].map((s) => (
                  <span
                    key={s}
                    className={`h-4 w-4 rounded ${
                      s < t.squares ? SQUARE_COLORS[t.color] : 'bg-slate-200'
                    }`}
                  />
                ))}
              </div>
              <span className="text-xs font-semibold text-slate-500">{t.label}</span>
              {tiers[i] !== 0 && (
                <span className="ml-auto text-xs text-slate-400">
                  {directions[i] === 'high' ? 'too high ↓' : 'too low ↑'}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OpponentBanner({ opponent }) {
  const name = opponent.name || 'A friend';
  const summary = opponent.won
    ? `won on guess ${opponent.attemptWon}`
    : opponent.bestPct != null
      ? `got within ${Math.round(opponent.bestPct * 100)}% but didn't crack it`
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
