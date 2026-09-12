// The client's side of /api. Everything here can fail — offline, no database
// configured yet, a cold function — and the game must not care: it plays and
// records locally regardless, and the server is an upgrade when it answers.
// Callers catch ApiUnavailable and carry on; other errors are real.

import { MODES } from './engine/modes.js';
import { loadStats, clearStats } from './engine/stats.js';

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
  me: () => call('GET', '/me'),
  stats: () => call('GET', '/stats'),
  deleteMe: () => call('DELETE', '/me'),
};

// The server processes this many games per /import call (IMPORT_BATCH in
// server/app.js); the client sends its history in slices of it.
const IMPORT_SLICE = 200;

const IMPORTED_KEY = 'rentle_imported_v1';

// First load: move any pre-server localStorage history up, once. Deliberately
// NOT a "hello" to the server — a visitor who only looks gets no cookie and
// no player row. The first game they finish (or this import, if they have
// history) is what issues the session. The flag is set only after every mode
// imported cleanly, so a failed attempt simply retries next load; the server
// dedups, so a retry is safe.
export async function bootstrap() {
  let imported = false;
  try {
    imported = localStorage.getItem(IMPORTED_KEY) === '1';
  } catch {
    /* storage unavailable: nothing to import */
  }
  if (imported) return;
  for (const mode of Object.values(MODES)) {
    const entries = Object.entries(loadStats(mode.key).games);
    for (let i = 0; i < entries.length; i += IMPORT_SLICE) {
      await api.importGames(mode.key, Object.fromEntries(entries.slice(i, i + IMPORT_SLICE)));
    }
  }
  try {
    localStorage.setItem(IMPORTED_KEY, '1');
  } catch {
    /* ignore */
  }
}

// Forget everything on this device. Also drops the imported flag — otherwise
// the next load would have nothing to import anyway, but a later game would
// find the flag set and skip a history that no longer exists.
export function clearDevice() {
  for (const mode of Object.values(MODES)) clearStats(mode.key);
  try {
    localStorage.removeItem(IMPORTED_KEY);
  } catch {
    /* ignore */
  }
}

// "Delete my data": the server forgets this player, then this device forgets
// too — otherwise the next load would import the local history straight back.
export async function forgetMe() {
  await api.deleteMe();
  clearDevice();
}
