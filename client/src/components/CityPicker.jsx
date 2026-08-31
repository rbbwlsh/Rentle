import { useEffect, useState } from 'react';
import { loadIndex } from '../data.js';
import { loadStats } from '../engine/stats.js';
import { pickRandom } from '../engine/picker.js';
import { project, COAST_PATH, VIEW_W, VIEW_H } from '../engine/ukmap.js';

// "Pick a city" as a map, not a catalogue. Tapping a city drops you straight
// into a normal round on a listing from that city's pool — the game format
// never changes, only where the property is drawn from. Deliberately NOT a
// grid of every listing: seeing the whole corpus laid out spoils the pool.

export default function CityPicker({ navigate }) {
  const [index, setIndex] = useState(null);
  const [error, setError] = useState('');
  const [active, setActive] = useState(null);

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

  // Older builds of index.json predate `cities`; derive it if it's missing.
  const cities = (index.cities || []).filter((c) => c.lat != null && c.lon != null);
  const cityOf = new Map(index.listings.map((l) => [String(l.id), l.city]));
  const played = Object.keys(loadStats().games);

  function play(cityName) {
    const pool = index.order.filter((id) => cityOf.get(String(id)) === cityName);
    const id = pickRandom(pool, played);
    if (id) navigate(`/p/${id}`);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white p-4 shadow-xl shadow-rose-200/50 sm:p-6">
        <h2 className="text-lg font-bold text-slate-800">Pick a city</h2>
        <p className="mt-0.5 text-sm text-slate-500">
          Tap a city and we&apos;ll pull a mystery listing from its pool — same
          game, same five guesses.
        </p>

        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="mx-auto mt-4 h-auto w-full max-w-[300px]"
          role="group"
          aria-label="Map of Great Britain with the cities in the corpus"
        >
          <path
            d={COAST_PATH}
            className="fill-brand-50 stroke-brand-200"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          {cities.map((c) => {
            const [x, y] = project(c.lon, c.lat);
            const isActive = active === c.name;
            // Labels sit on the side the city is already nearest, so pins at
            // similar latitudes (Bristol/London, Manchester/Leeds) throw their
            // text apart instead of colliding down the middle.
            const labelLeft = x < VIEW_W / 2;
            return (
              <g
                key={c.name}
                role="button"
                tabIndex={0}
                aria-label={`${c.name} — ${c.count} listings`}
                onClick={() => play(c.name)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    play(c.name);
                  }
                }}
                onPointerEnter={() => setActive(c.name)}
                onPointerLeave={() => setActive(null)}
                onFocus={() => setActive(c.name)}
                onBlur={() => setActive(null)}
                className="cursor-pointer outline-none"
              >
                {/* Invisible, finger-sized hit area over the small dot. */}
                <circle cx={x} cy={y} r="12" fill="transparent" />
                <circle
                  cx={x}
                  cy={y}
                  r={isActive ? 6 : 4.5}
                  className={isActive ? 'fill-brand-700' : 'fill-brand-600'}
                />
                <circle cx={x} cy={y} r="2" className="fill-white" />
                <text
                  x={labelLeft ? x - 9 : x + 9}
                  y={y + 3.5}
                  textAnchor={labelLeft ? 'end' : 'start'}
                  className={`text-[9px] font-bold ${
                    isActive ? 'fill-brand-700' : 'fill-slate-600'
                  }`}
                >
                  {c.name}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* The same choices as plain buttons: reliable on touch, and the path
          screen readers and keyboards actually enjoy. */}
      <div className="grid grid-cols-2 gap-3">
        {cities.map((c) => (
          <button
            key={c.name}
            onClick={() => play(c.name)}
            onPointerEnter={() => setActive(c.name)}
            onPointerLeave={() => setActive(null)}
            className="flex min-h-[56px] items-center justify-between rounded-xl bg-white px-4 py-3 text-left shadow-md transition active:scale-[0.99] sm:hover:shadow-lg"
          >
            <span className="text-sm font-bold text-slate-800">{c.name}</span>
            <span className="text-xs text-slate-400">{c.count}</span>
          </button>
        ))}
      </div>

      <p className="text-center text-xs text-slate-400">
        {index.order.length} listings across {cities.length} cities.
      </p>
    </div>
  );
}
