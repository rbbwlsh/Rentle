import { formatPcm, formatGbp } from '../format.js';

// End-of-game screen for both win and fail. Reveals the real rent, shows how
// close the best guess was, links to Rightmove, and offers a "make your own".
export default function Reveal({ won, actual, priceLabel, bestGuess, rightmoveUrl, onHome }) {
  const off = bestGuess != null ? Math.abs(bestGuess - actual) : null;

  return (
    <div className="rounded-2xl bg-white p-6 text-center shadow-xl shadow-rose-200/50 sm:p-8">
      <div className="text-4xl">{won ? '🎉' : '😬'}</div>
      <h2 className="mt-2 text-xl font-extrabold text-slate-800">
        {won ? 'Nailed it!' : 'Out of guesses!'}
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        {won
          ? 'You guessed the rent within £50.'
          : 'Better luck on the next one.'}
      </p>

      <div className="mt-6 rounded-xl bg-brand-50 px-4 py-5">
        <p className="text-xs uppercase tracking-wide text-brand-600">
          Actual rent
        </p>
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
