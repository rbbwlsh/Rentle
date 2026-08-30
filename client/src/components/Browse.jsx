import { useEffect, useState } from 'react';
import { loadIndex } from '../data.js';
import { loadStats } from '../engine/stats.js';

// The corpus as a picker: filter by city, tap a listing to play it (and share
// your score after). No prices anywhere — every card is an unplayed puzzle.
export default function Browse({ navigate }) {
  const [index, setIndex] = useState(null);
  const [error, setError] = useState('');
  const [city, setCity] = useState('All');

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

  const cities = ['All', ...new Set(index.listings.map((l) => l.city))];
  const shown =
    city === 'All' ? index.listings : index.listings.filter((l) => l.city === city);
  const played = loadStats().games;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-center gap-2">
        {cities.map((c) => (
          <button
            key={c}
            onClick={() => setCity(c)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
              c === city
                ? 'bg-brand-600 text-white'
                : 'bg-white text-slate-600 shadow-sm hover:bg-brand-50'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {shown.map((l) => (
          <button
            key={l.id}
            onClick={() => navigate(`/p/${l.id}`)}
            className="overflow-hidden rounded-xl bg-white text-left shadow-md transition hover:shadow-lg"
          >
            <div className="relative">
              <img
                src={l.thumb}
                alt={l.area}
                loading="lazy"
                className="aspect-[4/3] w-full object-cover"
              />
              {played[String(l.id)] && (
                <span className="absolute right-1.5 top-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white">
                  {played[String(l.id)].won ? '✅ played' : '❌ played'}
                </span>
              )}
            </div>
            <div className="p-2.5">
              <p className="truncate text-xs font-semibold text-slate-700">
                {l.area}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-400">
                {[
                  l.bedrooms != null && `${l.bedrooms} bed`,
                  l.propertySubType,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
          </button>
        ))}
      </div>

      <p className="text-center text-xs text-slate-400">
        {shown.length} listing{shown.length === 1 ? '' : 's'} — guess the rent on
        any of them.
      </p>
    </div>
  );
}
