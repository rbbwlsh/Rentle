import { loadStats, summarize } from '../engine/stats.js';

// The player's own record, from localStorage — V1 has no backend, so this
// replaces the old crowd-stats panel. Same visual language: attempt bars,
// with your latest result highlighted.
export default function PersonalStats({ you }) {
  const s = summarize(loadStats());
  if (!s.played) return null;

  const rows = [
    { key: 1, label: 'Won on guess 1', count: s.winByAttempt[1] },
    { key: 2, label: 'Won on guess 2', count: s.winByAttempt[2] },
    { key: 3, label: 'Won on guess 3', count: s.winByAttempt[3] },
    { key: 4, label: 'Won on guess 4', count: s.winByAttempt[4] },
    { key: 'fail', label: "Didn't get it", count: s.fails },
  ];
  const youKey = you ? (you.won ? you.attemptWon : 'fail') : null;
  const pct = (n) => (s.played ? Math.round((n / s.played) * 100) : 0);
  const winRate = Math.round((s.won / s.played) * 100);

  return (
    <div className="rounded-xl bg-slate-50 p-4 text-left">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-semibold text-slate-700">Your record</span>
        <span className="text-xs text-slate-400">
          {s.played} game{s.played === 1 ? '' : 's'} · {winRate}% won
        </span>
      </div>

      {(s.streak > 0 || s.maxStreak > 0) && (
        <p className="mt-1 text-sm text-brand-700">
          🔥 Daily streak: <span className="font-bold">{s.streak}</span>
          {s.maxStreak > s.streak && (
            <span className="text-xs text-slate-400"> (best {s.maxStreak})</span>
          )}
        </p>
      )}

      <div className="mt-3 space-y-1.5">
        {rows.map((row) => {
          const isYou = youKey === row.key;
          return (
            <div key={row.key} className="flex items-center gap-2 text-xs">
              <span
                className={`w-28 flex-shrink-0 ${
                  isYou ? 'font-bold text-brand-700' : 'text-slate-500'
                }`}
              >
                {row.label}
                {isYou && ' ←'}
              </span>
              <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-200">
                <div
                  className={`h-full rounded-full ${
                    row.key === 'fail' ? 'bg-slate-400' : 'bg-brand-500'
                  } ${isYou ? 'ring-2 ring-brand-700' : ''}`}
                  style={{ width: `${pct(row.count)}%` }}
                />
              </div>
              <span className="w-9 flex-shrink-0 text-right text-slate-500">
                {pct(row.count)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
