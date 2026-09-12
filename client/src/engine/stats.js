// Personal stats in localStorage — the V1 replacement for the old server's
// crowd stats. Stores one result per listing (first play stands; replays don't
// overwrite) plus the daily streak. Totals are derived, never stored, so the
// shape can't drift. The server (server/app.js) is the record of truth when
// it answers; this is the record when it doesn't.
//
// `storage` is injectable for tests; every access is guarded because
// localStorage can throw (private windows, blocked site data).

import { MAX_ATTEMPTS } from './engine.js';
import { modeOf } from './modes.js';

// One bucket per mode. Rent keeps its original key so existing players keep
// their history; buy gets its own, because a streak shared between two
// separate dailies is not a streak of anything.
const keyFor = (modeKey) => modeOf(modeKey).storageKey;
// The player's display name is theirs, not the mode's.
const NAME_KEY = 'rentle_name';

const emptyStats = () => ({
  name: '',
  games: {},
  daily: { lastDate: null, streak: 0, maxStreak: 0 },
});

function safeStorage(storage) {
  try {
    return storage || globalThis.localStorage;
  } catch {
    return null;
  }
}

export function loadStats(modeKey, storage) {
  const s = safeStorage(storage);
  try {
    const parsed = JSON.parse(s.getItem(keyFor(modeKey)));
    if (parsed && typeof parsed.games === 'object') {
      // Migrate the old standalone name key if present.
      if (!parsed.name) parsed.name = s.getItem(NAME_KEY) || '';
      return { ...emptyStats(), ...parsed };
    }
  } catch {
    /* fall through */
  }
  const fresh = emptyStats();
  try {
    fresh.name = s.getItem(NAME_KEY) || '';
  } catch {
    /* ignore */
  }
  return fresh;
}

function saveStats(modeKey, stats, storage) {
  try {
    safeStorage(storage).setItem(keyFor(modeKey), JSON.stringify(stats));
  } catch {
    /* stats are a convenience, never fatal */
  }
}

// Forget everything for a mode on this device. The privacy page's delete
// button calls this after the server has forgotten too.
export function clearStats(modeKey, storage) {
  try {
    safeStorage(storage).removeItem(keyFor(modeKey));
  } catch {
    /* ignore */
  }
}

const dayBefore = (dateStr) => {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

// Record a finished game. `isDaily` + `dateStr` drive the streak; a replayed
// listing keeps its first result. Returns the updated stats.
export function recordGame(
  { mode, id, won, attemptWon, bestDiff, bestPct, guesses, isDaily = false, dateStr },
  storage
) {
  const stats = loadStats(mode, storage);

  if (!stats.games[id]) {
    stats.games[id] = {
      won,
      attemptWon,
      bestDiff,
      bestPct: bestPct ?? null,
      guesses,
      completedAt: new Date().toISOString(),
    };

    if (isDaily && dateStr && stats.daily.lastDate !== dateStr) {
      if (won) {
        stats.daily.streak =
          stats.daily.lastDate === dayBefore(dateStr) ? stats.daily.streak + 1 : 1;
        stats.daily.maxStreak = Math.max(stats.daily.maxStreak, stats.daily.streak);
      } else {
        stats.daily.streak = 0;
      }
      stats.daily.lastDate = dateStr;
    }
    saveStats(mode, stats, storage);
  }
  return stats;
}

export function setName(modeKey, name, storage) {
  const stats = loadStats(modeKey, storage);
  stats.name = String(name || '').trim().slice(0, 24);
  saveStats(modeKey, stats, storage);
  try {
    safeStorage(storage).setItem(NAME_KEY, stats.name);
  } catch {
    /* ignore */
  }
  return stats;
}

// Derived personal totals for the stats panel.
export function summarize(stats) {
  const games = Object.values(stats.games);
  // One bucket per attempt — derived, so raising MAX_ATTEMPTS can't silently
  // drop wins on the new final guess out of the histogram.
  const winByAttempt = Object.fromEntries(
    Array.from({ length: MAX_ATTEMPTS }, (_, i) => [i + 1, 0])
  );
  let wins = 0;
  for (const g of games) {
    if (g.won) {
      wins += 1;
      if (winByAttempt[g.attemptWon] != null) winByAttempt[g.attemptWon] += 1;
    }
  }
  return {
    played: games.length,
    won: wins,
    fails: games.length - wins,
    winByAttempt,
    streak: stats.daily.streak,
    maxStreak: stats.daily.maxStreak,
  };
}
