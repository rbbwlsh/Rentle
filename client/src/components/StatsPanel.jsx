// Shows how the player compares with everyone else on this property: their
// percentile, and the breakdown of which guess people cracked it on (or didn't).
export default function StatsPanel({ stats, you }) {
  if (!stats || !stats.players) {
    return (
      <p className="text-center text-xs text-slate-400">
        You&apos;re the first to play this one — share it to see how others do!
      </p>
    );
  }

  const { players, winByAttempt, fails, percentile } = stats;
  const rows = [
    { key: 1, label: 'Won on guess 1', count: winByAttempt[1] },
    { key: 2, label: 'Won on guess 2', count: winByAttempt[2] },
    { key: 3, label: 'Won on guess 3', count: winByAttempt[3] },
    { key: 4, label: 'Won on guess 4', count: winByAttempt[4] },
    { key: 'fail', label: "Didn't get it", count: fails },
  ];

  const youKey = you ? (you.won ? you.attemptWon : 'fail') : null;
  const pct = (n) => (players ? Math.round((n / players) * 100) : 0);

  return (
    <div className="rounded-xl bg-slate-50 p-4 text-left">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-semibold text-slate-700">
          How everyone did
        </span>
        <span className="text-xs text-slate-400">
          {players} player{players === 1 ? '' : 's'}
        </span>
      </div>

      <p className="mt-1 text-sm text-brand-700">
        You guessed closer than{' '}
        <span className="font-bold">{percentile}%</span> of players.
      </p>

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
