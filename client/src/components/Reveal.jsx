import { useEffect, useState } from 'react';
import { formatPcm, formatGbp } from '../format.js';
import { updateResultName } from '../api.js';
import StatsPanel from './StatsPanel.jsx';

// End-of-game screen. Reveals the rent, shows how the crowd did, compares
// against a shared opponent (if any), and offers a shareable score link.
export default function Reveal({
  won,
  actual,
  priceLabel,
  bestGuess,
  rightmoveUrl,
  outcome,
  opponent,
  onHome,
}) {
  const off = bestGuess != null ? Math.abs(bestGuess - actual) : null;

  // `you` for comparisons: prefer the server's computed result, else derive it.
  const you =
    outcome?.you || (off != null ? { won, attemptWon: null, bestDiff: off } : null);

  return (
    <div className="rounded-2xl bg-white p-6 text-center shadow-xl shadow-rose-200/50 sm:p-8">
      <div className="text-4xl">{won ? '🎉' : '😬'}</div>
      <h2 className="mt-2 text-xl font-extrabold text-slate-800">
        {won ? 'Nailed it!' : 'Out of guesses!'}
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        {won ? 'You guessed the rent within £50.' : 'Better luck on the next one.'}
      </p>

      <div className="mt-6 rounded-xl bg-brand-50 px-4 py-5">
        <p className="text-xs uppercase tracking-wide text-brand-600">Actual rent</p>
        <p className="mt-1 text-3xl font-extrabold text-brand-700">
          {priceLabel || formatPcm(actual)}
        </p>
        {off != null && (
          <p className="mt-2 text-sm text-slate-500">
            Your best guess was {formatGbp(bestGuess)} —{' '}
            <span className="font-semibold text-slate-700">
              {off === 0 ? 'spot on' : `${formatGbp(off)} off`}
            </span>
          </p>
        )}
      </div>

      {opponent && you && (
        <OpponentResult opponent={opponent} you={you} />
      )}

      <div className="mt-6">
        <StatsPanel stats={outcome?.stats} you={you} />
      </div>

      {outcome?.resultId && <ShareScore resultId={outcome.resultId} />}

      <div className="mt-6 flex flex-col gap-2">
        {rightmoveUrl && (
          <a
            href={rightmoveUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-brand-300"
          >
            View on Rightmove ↗
          </a>
        )}
        <button
          onClick={onHome}
          className="rounded-xl bg-brand-600 px-4 py-3 font-semibold text-white shadow-sm transition hover:bg-brand-700"
        >
          Create your own challenge
        </button>
      </div>
    </div>
  );
}

// Decide who did better. Lower is better: a win beats a loss; among wins, fewer
// attempts wins; ties broken by who was closer (smaller bestDiff).
function compare(a, b) {
  if (a.won !== b.won) return a.won ? -1 : 1;
  if (a.won && b.won && a.attemptWon !== b.attemptWon)
    return (a.attemptWon ?? 99) - (b.attemptWon ?? 99);
  return a.bestDiff - b.bestDiff;
}

function OpponentResult({ opponent, you }) {
  const name = opponent.name || 'Your friend';
  const cmp = compare(you, opponent);
  const [verdict, tone] =
    cmp < 0
      ? [`You beat ${name}! 🏆`, 'bg-emerald-50 text-emerald-700']
      : cmp > 0
        ? [`${name} wins this round.`, 'bg-amber-50 text-amber-700']
        : [`Dead heat with ${name}!`, 'bg-sky-50 text-sky-700'];

  const theirLine = opponent.won
    ? `won on guess ${opponent.attemptWon}`
    : `within ${formatGbp(opponent.bestDiff)}`;

  return (
    <div className={`mt-6 rounded-xl px-4 py-3 text-sm font-semibold ${tone}`}>
      {verdict}
      <div className="mt-0.5 text-xs font-normal opacity-80">
        {name}: {theirLine}
      </div>
    </div>
  );
}

function ShareScore({ resultId }) {
  const [name, setName] = useState(localStorage.getItem('rentle_name') || '');
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}${window.location.pathname}?r=${resultId}`;

  // Persist the name and push it to the shared card (debounced on idle).
  useEffect(() => {
    localStorage.setItem('rentle_name', name);
    const t = setTimeout(() => {
      updateResultName(resultId, name).catch(() => {});
    }, 600);
    return () => clearTimeout(t);
  }, [name, resultId]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className="mt-6 rounded-xl border border-brand-100 bg-brand-50 p-4 text-left">
      <p className="text-sm font-semibold text-brand-700">
        Challenge your friends 🏁
      </p>
      <p className="mt-1 text-xs text-slate-500">
        Share this link — they&apos;ll play the same property and get pitted
        against your score.
      </p>
      <input
        type="text"
        value={name}
        maxLength={24}
        onChange={(e) => setName(e.target.value)}
        placeholder="Your name (optional)"
        className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-200 outline-none"
      />
      <div className="mt-2 flex gap-2">
        <input
          readOnly
          value={link}
          onFocus={(e) => e.target.select()}
          className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600"
        />
        <button
          onClick={copy}
          className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-700"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
    </div>
  );
}
