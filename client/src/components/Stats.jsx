import { useEffect, useState } from 'react';
import { MODES } from '../engine/modes.js';
import { MAX_ATTEMPTS } from '../engine/engine.js';
import { loadStats, summarize } from '../engine/stats.js';
import { api } from '../api.js';

// Your record in both games, and how everyone is doing. Your side comes from
// this device (localStorage) — the same numbers the reveal shows, in one
// place; everyone's side is one aggregate from the server, five minutes
// stale at most. The page is honest about an empty record rather than
// hiding it: a new player sees where the numbers will go.
export default function Stats({ navigate }) {
  const [site, setSite] = useState(undefined); // undefined: loading; null: unavailable
  const [me, setMe] = useState(null);

  useEffect(() => {
    api.stats().then(setSite).catch(() => setSite(null));
    api.me().then(setMe).catch(() => setMe(null));
  }, []);

  const synced = me?.player ? me.games.length : 0;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl bg-white p-6 text-left shadow-lg sm:p-8">
        <h1 className="text-xl font-extrabold tracking-tight text-slate-800">Your record</h1>
        <p className="mt-1 text-sm text-slate-500">
          {synced
            ? `${synced} game${synced === 1 ? '' : 's'} recorded on the server for this browser.`
            : 'Kept on this device. A server record starts the first time you finish a round.'}
        </p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {Object.values(MODES).map((mode) => (
            <YourRecord key={mode.key} mode={mode} navigate={navigate} />
          ))}
        </div>
      </section>

      <section className="rounded-2xl bg-white p-6 text-left shadow-lg sm:p-8">
        <h2 className="text-xl font-extrabold tracking-tight text-slate-800">Everyone</h2>
        {site === undefined ? (
          <p className="mt-1 text-sm text-slate-400">Counting…</p>
        ) : site === null ? (
          <p className="mt-1 text-sm text-slate-500">The server is not reachable right now.</p>
        ) : (
          <>
            <p className="mt-1 text-sm text-slate-500">Across every player, since launch. Today is {site.date}.</p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {Object.values(MODES).map((mode) => (
                <Everyone key={mode.key} mode={mode} s={site.modes[mode.key]} />
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

const pctOf = (n, d) => (d ? Math.round((n / d) * 100) : 0);

function YourRecord({ mode, navigate }) {
  const s = summarize(loadStats(mode.key));
  const rows = [
    ...Array.from({ length: MAX_ATTEMPTS }, (_, i) => ({ key: i + 1, label: `Guess ${i + 1}`, count: s.winByAttempt[i + 1] })),
    { key: 'fail', label: 'Missed', count: s.fails },
  ];
  const max = Math.max(1, ...rows.map((r) => r.count));

  return (
    <div className="rounded-xl bg-slate-50 p-4">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-semibold text-slate-700">
          <span aria-hidden className="mr-1">{mode.icon}</span>
          {mode.label}
        </span>
        <span className="text-xs text-slate-400">
          {s.played ? `${s.played} played · ${pctOf(s.won, s.played)}% won` : 'no games yet'}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Stat label="Played" value={s.played} />
        <Stat label="Streak" value={s.streak} suffix={s.streak > 0 ? ' 🔥' : ''} />
        <Stat label="Best streak" value={s.maxStreak} />
      </dl>

      {s.played > 0 ? (
        <div className="mt-3 space-y-1.5">
          {rows.map((row) => (
            <div key={row.key} className="flex items-center gap-2 text-xs">
              <span className="w-16 flex-shrink-0 text-slate-500">{row.label}</span>
              <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-200">
                <div
                  className={`h-full rounded-full ${row.key === 'fail' ? 'bg-slate-400' : 'bg-brand-500'}`}
                  style={{ width: `${(row.count / max) * 100}%` }}
                />
              </div>
              <span className="w-6 flex-shrink-0 text-right text-slate-500">{row.count}</span>
            </div>
          ))}
        </div>
      ) : (
        <button
          onClick={() => navigate(mode.homePath)}
          className="mt-3 min-h-[36px] w-full rounded-full bg-white text-sm font-semibold text-brand-700 shadow-sm hover:bg-brand-50"
        >
          Play today's {mode.label.toLowerCase()} puzzle
        </button>
      )}
    </div>
  );
}

function Everyone({ mode, s }) {
  return (
    <div className="rounded-xl bg-slate-50 p-4">
      <div className="text-sm font-semibold text-slate-700">
        <span aria-hidden className="mr-1">{mode.icon}</span>
        {mode.label}
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Stat label="Games" value={s.games} />
        <Stat label="Players" value={s.players} />
        <Stat label="Cracked it" value={s.games ? `${pctOf(s.wins, s.games)}%` : '—'} />
      </dl>
      <p className="mt-3 text-xs text-slate-500">
        {s.today.plays
          ? `Today's puzzle: ${s.today.plays} played, ${pctOf(s.today.wins, s.today.plays)}% got it.`
          : "Nobody has finished today's puzzle yet — be first."}
        {s.weekGames > 0 && ` ${s.weekGames} game${s.weekGames === 1 ? '' : 's'} this week.`}
      </p>
    </div>
  );
}

function Stat({ label, value, suffix = '' }) {
  return (
    <div className="rounded-lg bg-white px-2 py-2">
      <dt className="text-[11px] uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="text-lg font-bold tabular-nums text-slate-800">
        {typeof value === 'number' ? value.toLocaleString() : value}
        {suffix}
      </dd>
    </div>
  );
}
