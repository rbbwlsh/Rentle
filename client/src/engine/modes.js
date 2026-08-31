// The two games, from the player's side: guess the RENT, or guess the ASKING
// PRICE. Same board, same five guesses, same 5% win margin — only the corpus
// and the units differ. The build-time half of this table lives in
// tools/config/modes.js.
//
// Everything mode-shaped is data here rather than a branch in a component, so
// adding a third channel later is a table entry and not a sweep through the UI.

export const MODES = {
  rent: {
    key: 'rent',
    label: 'Rent',
    icon: '🔑',
    tagline: 'The daily guess-the-rent game on real UK listings.',
    dataDir: '/data/rent',
    homePath: '/',
    browsePath: '/browse',
    playPath: (id) => `/p/${id}`,
    // Unchanged from before the buy mode existed: players keep their history
    // and their streak.
    storageKey: 'rentle_stats_v1',
    epoch: '2026-08-31',
    puzzleName: 'Rentle',
    prompt: 'Guess the monthly rent',
    unit: 'pcm',
    revealLabel: 'Listed at',
    ogNoun: 'rent',
    subject: 'rental',
    comparableNoun: 'a nearby rental',
    // The guess control. Rent spans £200–£10k and reads naturally on a linear
    // slider; asking prices span £25k–£1.5m, where linear gives ~£5k per pixel
    // and the whole corpus bunches into the left tenth — so buy is log-scaled.
    guess: {
      scale: 'linear',
      min: 200,
      max: 10000,
      step: 25,
      nudge: 50,
      nudgeLabel: (n) => (n > 0 ? `+${n}` : `${n}`),
      typedMax: 50000,
      maxDigits: 6,
      initial: 1500,
    },
  },
  buy: {
    key: 'buy',
    label: 'Buy',
    icon: '🏷️',
    tagline: 'The daily guess-the-asking-price game on real UK listings.',
    dataDir: '/data/buy',
    homePath: '/buy',
    browsePath: '/buy/browse',
    playPath: (id) => `/buy/p/${id}`,
    storageKey: 'rentle_buy_stats_v1',
    epoch: '2026-08-31',
    puzzleName: 'Rentle Buy',
    prompt: 'Guess the asking price',
    unit: '',
    revealLabel: 'On the market at',
    ogNoun: 'asking price',
    subject: 'home for sale',
    comparableNoun: 'a nearby home for sale',
    guess: {
      scale: 'log',
      min: 25000,
      max: 1500000,
      step: 1000,
      // A flat ±£50 is meaningless against a £400k asking price; nudge by a
      // proportion instead, so the buttons stay useful at both ends.
      nudge: 0.05,
      nudgeLabel: (n) => (n > 0 ? '+5%' : '−5%'),
      typedMax: 2000000,
      maxDigits: 7,
      initial: 250000,
    },
  },
};

export const MODE_KEYS = Object.keys(MODES);
export const DEFAULT_MODE = 'rent';
export const modeOf = (key) => MODES[key] || MODES[DEFAULT_MODE];

// Map a guess onto the slider's 0..1000 track and back. Log-scaled modes keep
// the same proportional resolution everywhere on the track, so a £60k terrace
// and a £900k townhouse are both reachable without pixel-hunting.
const TRACK = 1000;

export function guessToSlider(mode, value) {
  const { scale, min, max } = mode.guess;
  const v = Math.min(Math.max(value ?? min, min), max);
  if (scale !== 'log') return v;
  const t = (Math.log(v) - Math.log(min)) / (Math.log(max) - Math.log(min));
  return Math.round(t * TRACK);
}

export function sliderToGuess(mode, position) {
  const { scale, min, max, step } = mode.guess;
  if (scale !== 'log') return Number(position);
  const t = Math.min(Math.max(Number(position) / TRACK, 0), 1);
  const raw = Math.exp(Math.log(min) + t * (Math.log(max) - Math.log(min)));
  // Snap to a round number a person would actually say out loud.
  const grain = raw >= 500000 ? 10000 : raw >= 100000 ? 5000 : step;
  return Math.round(raw / grain) * grain;
}

export const sliderBounds = (mode) =>
  mode.guess.scale === 'log'
    ? { min: 0, max: TRACK, step: 1 }
    : { min: mode.guess.min, max: mode.guess.max, step: mode.guess.step };
