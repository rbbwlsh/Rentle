// The client's side of /api. Everything here can fail — offline, no database
// configured yet, a cold function — and the game must not care: it plays and
// records locally regardless, and the server is an upgrade when it answers.
// Callers catch ApiUnavailable and carry on; other errors are real.

import { MODES } from './engine/modes.js';
import { loadStats } from './engine/stats.js';

export class ApiUnavailable extends Error {}

async function call(method, path, body) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiUnavailable('offline');
  }
  if (res.status === 503) throw new ApiUnavailable('no database');
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const api = {
  session: () => call('POST', '/session'),
  submitGame: (mode, listingId, guesses) => call('POST', '/games', { mode, listingId, guesses }),
  crowd: (mode, listingId) => call('GET', `/crowd?mode=${mode}&listingId=${encodeURIComponent(listingId)}`),
  importGames: (mode, games) => call('POST', '/import', { mode, games }),
  deleteMe: () => call('DELETE', '/me'),
};

const IMPORTED_KEY = 'rentle_imported_v1';

// First contact: establish the session, then move any pre-server history up
// once. The flag is set only after every mode imported cleanly, so a failed
// attempt simply retries next load; the server dedups, so a retry is safe.
export async function bootstrap() {
  const { player } = await api.session();
  let imported = false;
  try {
    imported = localStorage.getItem(IMPORTED_KEY) === '1';
  } catch {
    /* storage unavailable: nothing to import */
  }
  if (!imported) {
    for (const mode of Object.values(MODES)) {
      const games = loadStats(mode.key).games;
      if (Object.keys(games).length) await api.importGames(mode.key, games);
    }
    try {
      localStorage.setItem(IMPORTED_KEY, '1');
    } catch {
      /* ignore */
    }
  }
  return player;
}
