import { useState } from 'react';
import { formatPcm } from '../format.js';

const MIN = 200;
const MAX = 10000;
const STEP = 25;

// Slider + synced numeric input for the player's monthly-rent guess.
export default function GuessControl({ attempt, maxAttempts, disabled, onGuess }) {
  const [value, setValue] = useState(1500);

  const clamp = (n) => Math.max(MIN, Math.min(MAX, n));

  function submit(e) {
    e.preventDefault();
    if (disabled) return;
    onGuess(value);
  }

  return (
    <form onSubmit={submit} className="rounded-2xl bg-white p-5 shadow-lg shadow-rose-200/40 sm:p-6">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-slate-500">Your guess</span>
        <span className="text-2xl font-extrabold text-brand-700">
          {formatPcm(value)}
        </span>
      </div>

      <input
        type="range"
        min={MIN}
        max={MAX}
        step={STEP}
        value={Math.min(value, MAX)}
        onChange={(e) => setValue(Number(e.target.value))}
        disabled={disabled}
        className="mt-4 w-full"
      />
      <div className="mt-1 flex justify-between text-xs text-slate-400">
        <span>{formatPcm(MIN)}</span>
        <span>{formatPcm(MAX)}+</span>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <span className="text-slate-400">£</span>
        <input
          type="number"
          min={0}
          step={STEP}
          value={value}
          onChange={(e) => setValue(clamp(Number(e.target.value) || 0))}
          disabled={disabled}
          className="w-32 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-200 outline-none"
        />
        <span className="text-sm text-slate-400">pcm</span>
      </div>

      <button
        type="submit"
        disabled={disabled}
        className="mt-5 w-full rounded-xl bg-brand-600 px-4 py-3 font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-50"
      >
        Submit guess ({attempt} of {maxAttempts})
      </button>
    </form>
  );
}
