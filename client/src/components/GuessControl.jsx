import { useEffect, useRef, useState } from 'react';
import { formatPrice } from '../format.js';
import { clampGuess, normalizeTypedGuess, parseTypedGuess } from '../engine/guessInput.js';
import { guessToSlider, sliderToGuess, sliderBounds } from '../engine/modes.js';

// Slider + typed input for the player's guess, in whichever mode is being
// played. Everything that differs between rent and buy — the band, the scale,
// the nudge size, how many digits the box accepts — comes out of the mode
// table rather than a constant here, because those constants were rent's: six
// digits caps typing at £999,999, which makes a £1.2m listing unguessable, and
// a linear £25k–£1.5m slider gives about £1,500 a step with the whole corpus
// crammed into the left tenth.
//
// The typed field holds a RAW STRING, not a number. An earlier version clamped
// on every keystroke, which made the box impossible to use: typing "1500"
// clamped to the £200 floor on the first digit, and clearing the field snapped
// it to 200 as well. Nothing is coerced until submit — you can empty the box,
// type freely, and only then does the value get bounded.
export default function GuessControl({ mode, attempt, maxAttempts, disabled, onGuess }) {
  const cfg = mode.guess;
  const [raw, setRaw] = useState(String(cfg.initial));
  const [touched, setTouched] = useState(false);
  const inputRef = useRef(null);

  const n = parseTypedGuess(raw);
  const valid = n != null;
  const track = sliderBounds(mode);

  // A fresh box for each guess, focused on desktop so you can just type.
  useEffect(() => {
    setTouched(false);
    if (window.matchMedia?.('(min-width: 640px)').matches) inputRef.current?.focus();
  }, [attempt]);

  // Switching game resets the box to that game's opening figure — £1,500 pcm
  // is not a sane starting guess for an asking price.
  useEffect(() => {
    setRaw(String(cfg.initial));
  }, [mode.key, cfg.initial]);

  const setNumber = (v) =>
    setRaw(String(Math.max(0, Math.min(cfg.typedMax, Math.round(v)))));

  // Rent nudges by a flat £50; a flat £50 against a £400k asking price is
  // noise, so buy nudges by a proportion instead.
  const nudge = (direction) => {
    const from = valid ? n : cfg.initial;
    if (cfg.nudge < 1) {
      const next = from * (1 + direction * cfg.nudge);
      const grain = next >= 500000 ? 10000 : next >= 100000 ? 5000 : 1000;
      setNumber(Math.round(next / grain) * grain);
    } else {
      setNumber(from + direction * cfg.nudge);
    }
  };

  function onType(e) {
    setRaw(normalizeTypedGuess(e.target.value, cfg.maxDigits));
  }

  function submit(e) {
    e.preventDefault();
    setTouched(true);
    if (disabled || !valid) return;
    onGuess(clampGuess(n, cfg.typedMax));
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-2xl bg-white p-4 shadow-lg shadow-rose-200/40 sm:p-6"
    >
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-slate-500">Your guess</span>
        <span className="text-sm text-slate-400">
          Guess {attempt} of {maxAttempts}
        </span>
      </div>

      {/* The typed amount is the primary control — big enough to hit on a phone.
          text-2xl keeps it over the 16px threshold that makes iOS zoom the page
          on focus. */}
      <div
        className={`mt-3 flex items-center gap-2 rounded-xl border-2 bg-white px-3 transition ${
          touched && !valid
            ? 'border-rose-400'
            : 'border-slate-200 focus-within:border-brand-500'
        }`}
      >
        <span className="text-2xl font-bold text-slate-400">£</span>
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          enterKeyHint="go"
          aria-label={`${mode.prompt} in pounds`}
          placeholder="0"
          value={raw}
          onChange={onType}
          disabled={disabled}
          className="w-full min-w-0 bg-transparent py-3 text-2xl font-extrabold tabular-nums text-slate-800 outline-none placeholder:text-slate-300"
        />
        {mode.unit && (
          <span className="flex-shrink-0 text-sm font-medium text-slate-400">
            {mode.unit}
          </span>
        )}
      </div>

      <div className="mt-1.5 flex h-5 items-center justify-between text-xs">
        {touched && !valid ? (
          <span className="font-medium text-rose-500">Enter an amount to guess.</span>
        ) : (
          <span className="text-slate-400">{valid ? formatPrice(n, mode) : ' '}</span>
        )}
        <div className="flex gap-1.5">
          {[-1, 1].map((d) => (
            <button
              key={d}
              type="button"
              disabled={disabled}
              onClick={() => nudge(d)}
              className="rounded-lg bg-slate-100 px-2.5 py-1 font-semibold text-slate-600 transition active:bg-slate-200 disabled:opacity-50"
            >
              {cfg.nudgeLabel(d * (cfg.nudge < 1 ? 1 : cfg.nudge))}
            </button>
          ))}
        </div>
      </div>

      <input
        type="range"
        min={track.min}
        max={track.max}
        step={track.step}
        value={guessToSlider(mode, valid ? n : cfg.min)}
        onChange={(e) => setRaw(String(sliderToGuess(mode, e.target.value)))}
        disabled={disabled}
        aria-label="Drag to set your guess"
        className="mt-4 w-full"
      />
      <div className="mt-1 flex justify-between text-xs text-slate-400">
        <span>{formatPrice(cfg.min, mode)}</span>
        <span>{formatPrice(cfg.max, mode)}+</span>
      </div>

      <button
        type="submit"
        disabled={disabled || !valid}
        className="mt-4 min-h-[52px] w-full rounded-xl bg-brand-600 px-4 py-3.5 text-base font-semibold text-white shadow-sm transition hover:bg-brand-700 active:scale-[0.99] disabled:opacity-40"
      >
        Submit guess
      </button>

      {/* One pip per guess, so "how many left" is glanceable mid-game. */}
      <div className="mt-3 flex justify-center gap-1.5" aria-hidden>
        {Array.from({ length: maxAttempts }, (_, i) => (
          <span
            key={i}
            className={`h-1.5 rounded-full transition-all ${
              i < attempt - 1 ? 'w-6 bg-brand-300' : i === attempt - 1 ? 'w-6 bg-brand-600' : 'w-1.5 bg-slate-200'
            }`}
          />
        ))}
      </div>
    </form>
  );
}
