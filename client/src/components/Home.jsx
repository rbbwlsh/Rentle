import { useEffect, useState } from 'react';
import { loadIndex } from '../data.js';
import { pickDaily, pickRandom, dailyNumber, londonDate } from '../engine/picker.js';
import { loadStats, summarize } from '../engine/stats.js';

// Home screen: today's puzzle, a random round, and the browse grid. The daily
// is the same listing for everyone (deterministic pick over the corpus order).
export default function Home({ navigate }) {
  const [index, setIndex] = useState(null);
  const [error, setError] = useState('');
  const stats = summarize(loadStats());

  useEffect(() => {
    loadIndex().then(setIndex).catch((err) => setError(err.message));
  }, []);

  if (error) {
    return (
      <div className="rounded-2xl bg-white p-8 text-center shadow-lg">
        <div className="text-3xl">🚫</div>
        <p className="mt-3 text-sm text-slate-600">{error}</p>
      </div>
    );
  }
  if (!index) {
    return (
      <div className="rounded-2xl bg-white p-10 text-center text-slate-400 shadow-lg">
        Loading…
      </div>
    );
  }
  if (!index.order.length) {
    return (
      <div className="rounded-2xl bg-white p-8 text-center shadow-lg">
        <div className="text-3xl">🏗️</div>
        <p className="mt-3 text-sm text-slate-600">
          No listings yet — the game data hasn&apos;t been built. Run{' '}
          <code className="rounded bg-slate-100 px-1">npm run seed</code> then{' '}
          <code className="rounded bg-slate-100 px-1">npm run images</code>.
        </p>
      </div>
    );
  }

  const today = londonDate();
  const dailyId = pickDaily(index.order, today);
  const dailyDone = Boolean(loadStats().games[String(dailyId)]);
  const playedIds = Object.keys(loadStats().games);
  const cityCount = new Set(index.listings.map((l) => l.city)).size;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white p-6 shadow-xl shadow-rose-200/50 sm:p-8">
        <p className="text-xs uppercase tracking-wide text-brand-600">
          Rentle #{dailyNumber(today)} · {formatDate(today)}
        </p>
        <h2 className="mt-1 text-lg font-bold text-slate-800">
          One real listing. Five guesses. Within 5% wins.
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          The same mystery rental for everyone, every day — from{' '}
          {index.order.length} real listings across {cityCount} UK cities.
        </p>
        {stats.streak > 0 && (
          <p className="mt-2 text-sm font-semibold text-brand-700">
            🔥 {stats.streak}-day streak — keep it going!
          </p>
        )}
        <button
          onClick={() => navigate(`/p/${dailyId}`)}
          className="mt-5 w-full rounded-xl bg-brand-600 px-4 py-3 font-semibold text-white shadow-sm transition hover:bg-brand-700"
        >
          {dailyDone ? "Revisit today's puzzle" : "Play today's Rentle"}
        </button>
        {dailyDone && (
          <p className="mt-2 text-center text-xs text-slate-400">
            You&apos;ve played today&apos;s — come back tomorrow for a new one.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <button
          onClick={() => navigate(`/p/${pickRandom(index.order, playedIds)}`)}
          className="rounded-2xl bg-white p-5 text-left shadow-lg transition hover:shadow-xl"
        >
          <div className="text-2xl" aria-hidden>🎲</div>
          <p className="mt-2 text-sm font-bold text-slate-800">Random round</p>
          <p className="mt-0.5 text-xs text-slate-500">
            A listing you haven&apos;t played yet.
          </p>
        </button>
        <button
          onClick={() => navigate('/browse')}
          className="rounded-2xl bg-white p-5 text-left shadow-lg transition hover:shadow-xl"
        >
          <div className="text-2xl" aria-hidden>🗺️</div>
          <p className="mt-2 text-sm font-bold text-slate-800">Pick a city</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Play a round from a city&apos;s pool.
          </p>
        </button>
      </div>

      {stats.played > 0 && (
        <p className="text-center text-xs text-slate-400">
          You&apos;ve played {stats.played} · won{' '}
          {Math.round((stats.won / stats.played) * 100)}%
        </p>
      )}
    </div>
  );
}

function formatDate(dateStr) {
  return new Date(`${dateStr}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });
}
