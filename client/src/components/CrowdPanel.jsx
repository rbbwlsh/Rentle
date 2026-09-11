import { formatGbp } from '../format.js';
import { MAX_ATTEMPTS } from '../engine/engine.js';

// "How everyone did" on this listing, from the server. First-guess bias in
// seven ratio buckets around the answer (the middle one is the ±10% zone that
// holds every win), the crowd's median against yours, and won-on-guess bars
// with your row picked out. Renders nothing until there are enough plays for
// the shape to mean something.
export default function CrowdPanel({ crowd, actual, firstGuess, attemptWon, won }) {
  if (!crowd) return null;
  const { plays, wins, buckets, winByAttempt, medianFirstGuess, underShare } = crowd;

  if (plays < 3) {
    return (
      <div className="mt-6 rounded-xl bg-slate-50 px-4 py-3 text-left text-sm text-slate-500">
        {plays <= 1 ? "You're the first to play this one." : `${plays} people have played this one so far.`}
      </div>
    );
  }

  const max = Math.max(1, ...buckets.map((b) => b.count));
  const yourBucket = bucketIndex((firstGuess - actual) / actual);
  const bias = (guess) => {
    const pct = Math.round((Math.abs(guess - actual) / actual) * 100);
    if (pct === 0) return 'spot on';
    return `${pct}% ${guess < actual ? 'under' : 'over'}`;
  };
  const youKey = won ? attemptWon : 'fail';
  const rows = [
    ...winByAttempt.map((n, i) => ({ key: i + 1, label: String(i + 1), count: n })),
    { key: 'fail', label: '✗', count: plays - wins },
  ];

  return (
    <div className="mt-6 rounded-xl bg-slate-50 p-4 text-left">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-semibold text-slate-700">How everyone did</span>
        <span className="text-xs text-slate-400">
          {plays.toLocaleString()} played · {Math.round((wins / plays) * 100)}% cracked it
        </span>
      </div>

      <p className="mt-3 text-xs text-slate-500">First guesses</p>
      <div className="mt-1.5 flex h-24 items-end gap-1 border-b border-slate-200">
        {buckets.map((b, i) => (
          <div key={b.label} className="flex flex-1 flex-col items-center justify-end" title={`${b.label}: ${b.count}`}>
            <div
              className={`w-full rounded-t ${i === 3 ? 'bg-brand-600' : 'bg-brand-200'}`}
              style={{ height: `${Math.max(3, (b.count / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex text-[10px] text-slate-400">
        {buckets.map((b, i) => (
          <div key={b.label} className="flex flex-1 flex-col items-center leading-tight">
            {i === 0 && <span>−50%</span>}
            {i === 3 && <span className="font-semibold text-brand-700">listed</span>}
            {i === 6 && <span>+50%</span>}
            {i === yourBucket && <span className="mt-0.5 font-semibold text-slate-600">▲ you</span>}
          </div>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-white px-3 py-2.5">
          <p className="text-[11px] text-slate-400">Crowd median</p>
          <p className="text-base font-bold text-slate-800">
            {medianFirstGuess != null ? formatGbp(medianFirstGuess) : '—'}
          </p>
          <p className="text-[11px] text-amber-700">
            {medianFirstGuess != null ? bias(medianFirstGuess) : ''} · {Math.round(underShare * 100)}% guessed under
          </p>
        </div>
        <div className="rounded-lg bg-white px-3 py-2.5">
          <p className="text-[11px] text-slate-400">Your first guess</p>
          <p className="text-base font-bold text-slate-800">{formatGbp(firstGuess)}</p>
          <p className="text-[11px] text-amber-700">{bias(firstGuess)}</p>
        </div>
      </div>

      <p className="mt-3 text-xs text-slate-500">Won on guess</p>
      <div className="mt-1.5 space-y-1.5">
        {rows.map((row) => {
          const isYou = youKey === row.key;
          const pct = Math.round((row.count / plays) * 100);
          return (
            <div key={row.key} className="flex items-center gap-2 text-xs">
              <span className={`w-4 ${isYou ? 'font-bold text-brand-700' : 'text-slate-500'}`}>{row.label}</span>
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-200">
                <div
                  className={`h-full rounded-full ${row.key === 'fail' ? 'bg-slate-400' : 'bg-brand-500'} ${
                    isYou ? 'ring-2 ring-brand-700' : ''
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className={`w-12 text-right ${isYou ? 'font-bold text-brand-700' : 'text-slate-500'}`}>
                {pct}%{isYou ? ' ←' : ''}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Which of the seven buckets a signed first-guess bias lands in. Mirrors
// CROWD_BUCKETS in server/app.js.
function bucketIndex(pct) {
  if (pct < -0.5) return 0;
  if (pct < -0.25) return 1;
  if (pct < -0.1) return 2;
  if (pct <= 0.1) return 3;
  if (pct <= 0.25) return 4;
  if (pct <= 0.5) return 5;
  return 6;
}
