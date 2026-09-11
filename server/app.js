// The Rentle API: one handler, eight routes, no framework. Runs as a Netlify
// Function in production and is called directly by the tests.
//
// The rule that shapes everything here: the server never trusts the client's
// result. A game arrives as raw guesses; the answer comes from `listings`,
// and the same engine.js the browser runs scores it. Stats are built from
// what the server stored, never from what the client claimed.

import { summarizeGuesses, MAX_ATTEMPTS } from '../client/src/engine/engine.js';
import { londonDate, dailyIndex } from '../client/src/engine/picker.js';
import { COOKIE, newToken, hashToken, parseCookies, sessionCookie, clearCookie } from './session.js';

const MODES = new Set(['rent', 'buy']);
const MAX_GUESS = 10_000_000;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });

// --- identity ---------------------------------------------------------------

// Resolve the caller to a player, following a merge tombstone if the cookie
// predates one. Returns null when there is no valid cookie.
async function playerFromCookie(db, req) {
  const token = parseCookies(req.headers.get('cookie'))[COOKIE];
  if (!token) return null;
  const rows = await db.query(
    `select p.id, p.display_name, p.email, p.merged_into
       from sessions s join players p on p.id = s.player_id
      where s.token_hash = $1`,
    [hashToken(token)]
  );
  if (!rows.length) return null;
  let player = rows[0];
  if (player.merged_into) {
    const [target] = await db.query('select id, display_name, email, merged_into from players where id = $1', [player.merged_into]);
    if (target) player = target;
  }
  await db.query('update sessions set last_used_at = now() where token_hash = $1', [hashToken(token)]);
  return player;
}

// The caller's player, created on first contact. `setCookie` carries the
// header to send back when a session was just issued.
async function ensurePlayer(db, req) {
  const existing = await playerFromCookie(db, req);
  if (existing) return { player: existing, setCookie: null };
  const [player] = await db.query('insert into players default values returning id, display_name, email, merged_into');
  const token = newToken();
  await db.query('insert into sessions (token_hash, player_id) values ($1, $2)', [hashToken(token), player.id]);
  const secure = new URL(req.url).protocol === 'https:';
  return { player, setCookie: sessionCookie(token, { secure }) };
}

const publicPlayer = (p) => ({ id: p.id, displayName: p.display_name, claimed: Boolean(p.email) });

// --- scoring ----------------------------------------------------------------

// Clean a guess list from the wire: integers, in range, at most MAX_ATTEMPTS,
// and nothing after a win (the client stops there; a forged tail is dropped).
function cleanGuesses(input, actual) {
  if (!Array.isArray(input) || !input.length) throw new HttpError(400, 'guesses must be a non-empty array');
  const guesses = [];
  for (const g of input.slice(0, MAX_ATTEMPTS)) {
    const n = Number(g);
    if (!Number.isInteger(n) || n < 1 || n > MAX_GUESS) throw new HttpError(400, 'each guess must be a whole number of pounds');
    guesses.push(n);
    if (summarizeGuesses([n], actual).attemptWon) break;
  }
  return guesses;
}

function score(guesses, actual) {
  const { bestPct, attemptWon } = summarizeGuesses(guesses, actual);
  return {
    won: attemptWon != null,
    attemptWon,
    firstPct: Number(((guesses[0] - actual) / actual).toFixed(4)),
    bestPct: Number(bestPct.toFixed(4)),
  };
}

// Today's daily for a mode: same FNV hash over the same order the client uses,
// but as COUNT + OFFSET against `listings.position` rather than loading it.
async function dailyListingId(db, mode, dateStr) {
  const [{ n }] = await db.query('select count(*)::int as n from listings where mode = $1 and position is not null', [mode]);
  if (!n) return null;
  const [row] = await db.query(
    'select id from listings where mode = $1 and position is not null order by position offset $2 limit 1',
    [mode, dailyIndex(n, dateStr)]
  );
  return row?.id ?? null;
}

async function recordGame(db, player, { mode, listingId, guesses, playedAt = null }) {
  if (!MODES.has(mode)) throw new HttpError(400, 'unknown mode');
  const [listing] = await db.query('select price_amount from listings where mode = $1 and id = $2', [mode, String(listingId)]);
  if (!listing) throw new HttpError(404, 'that listing is not in the game');

  const clean = cleanGuesses(guesses, listing.price_amount);
  const s = score(clean, listing.price_amount);
  const when = playedAt ? new Date(playedAt) : new Date();
  const dateStr = londonDate(Number.isNaN(when.getTime()) ? new Date() : when);
  const daily = (await dailyListingId(db, mode, dateStr)) === String(listingId) ? dateStr : null;

  // First play stands: the unique constraint makes a retry, a replay or a
  // forged second submission all resolve to the row that already exists.
  const [inserted] = await db.query(
    `insert into games (player_id, mode, listing_id, daily_date, guesses, won, attempt_won, first_pct, best_pct, played_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict (player_id, mode, listing_id) do nothing
     returning id, guesses, won, attempt_won, first_pct::float8, best_pct::float8, daily_date::text`,
    [player.id, mode, String(listingId), daily, clean, s.won, s.attemptWon, s.firstPct, s.bestPct, when.toISOString()]
  );
  if (inserted) return { ...inserted, fresh: true };
  const [existing] = await db.query(
    `select id, guesses, won, attempt_won, first_pct::float8, best_pct::float8, daily_date::text
       from games where player_id = $1 and mode = $2 and listing_id = $3`,
    [player.id, mode, String(listingId)]
  );
  return { ...existing, fresh: false };
}

// --- crowd ------------------------------------------------------------------

// Seven buckets of first-guess bias, symmetric around the answer. The middle
// one (±10%) holds the win zone; the outer ones are "way off". Ratio buckets
// so a £600 Leeds flat and a £4k Chelsea townhouse draw the same shape.
export const CROWD_BUCKETS = [
  { label: '< −50%', where: 'first_pct < -0.5' },
  { label: '−50…−25%', where: 'first_pct >= -0.5 and first_pct < -0.25' },
  { label: '−25…−10%', where: 'first_pct >= -0.25 and first_pct < -0.1' },
  { label: '±10%', where: 'first_pct >= -0.1 and first_pct <= 0.1' },
  { label: '+10…25%', where: 'first_pct > 0.1 and first_pct <= 0.25' },
  { label: '+25…50%', where: 'first_pct > 0.25 and first_pct <= 0.5' },
  { label: '> +50%', where: 'first_pct > 0.5' },
];

const crowdCache = new Map();
const CROWD_TTL_MS = 60_000;

export async function crowdFor(db, mode, listingId, { bust = false } = {}) {
  const key = `${mode}:${listingId}`;
  const hit = crowdCache.get(key);
  if (!bust && hit && hit.at > Date.now() - CROWD_TTL_MS) return hit.value;

  const attempts = Array.from({ length: MAX_ATTEMPTS }, (_, i) => `count(*) filter (where attempt_won = ${i + 1})::int as a${i + 1}`);
  const buckets = CROWD_BUCKETS.map((b, i) => `count(*) filter (where ${b.where})::int as b${i}`);
  const [row] = await db.query(
    `select count(*)::int as plays,
            count(*) filter (where won)::int as wins,
            ${attempts.join(', ')},
            ${buckets.join(', ')},
            percentile_cont(0.5) within group (order by guesses[1])::float8 as median_first,
            coalesce(avg(case when first_pct < 0 then 1.0 else 0.0 end), 0)::float8 as under_share
       from games where mode = $1 and listing_id = $2`,
    [mode, String(listingId)]
  );
  const value = {
    plays: row.plays,
    wins: row.wins,
    winByAttempt: Array.from({ length: MAX_ATTEMPTS }, (_, i) => row[`a${i + 1}`]),
    buckets: CROWD_BUCKETS.map((b, i) => ({ label: b.label, count: row[`b${i}`] })),
    medianFirstGuess: row.median_first == null ? null : Math.round(row.median_first),
    underShare: Number(row.under_share.toFixed(3)),
  };
  crowdCache.set(key, { at: Date.now(), value });
  return value;
}

// --- routes -----------------------------------------------------------------

async function readJson(req) {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, 'body must be JSON');
  }
}

// The one entry point. `db` is a connected adapter (server/db.js); `req` is a
// standard Request. Returns a standard Response.
export async function handle(db, req) {
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/\.netlify\/functions\/api/, '').replace(/^\/api/, '').replace(/\/+$/, '') || '/';
  const method = req.method.toUpperCase();
  try {
    if (!db) throw new HttpError(503, 'stats are unavailable right now');

    if (method === 'POST' && route === '/session') {
      const { player, setCookie } = await ensurePlayer(db, req);
      await db.query('update players set last_seen_at = now() where id = $1', [player.id]);
      return json({ player: publicPlayer(player) }, 200, setCookie ? { 'set-cookie': setCookie } : {});
    }

    if (method === 'POST' && route === '/games') {
      const body = await readJson(req);
      const { player, setCookie } = await ensurePlayer(db, req);
      const game = await recordGame(db, player, { mode: body.mode, listingId: body.listingId, guesses: body.guesses });
      const crowd = await crowdFor(db, body.mode, body.listingId, { bust: game.fresh });
      return json({ game: publicGame(game), crowd }, game.fresh ? 201 : 200, setCookie ? { 'set-cookie': setCookie } : {});
    }

    if (method === 'GET' && route === '/crowd') {
      const mode = url.searchParams.get('mode');
      const listingId = url.searchParams.get('listingId');
      if (!MODES.has(mode) || !listingId) throw new HttpError(400, 'mode and listingId are required');
      return json({ crowd: await crowdFor(db, mode, listingId) }, 200, { 'cache-control': 'public, max-age=60' });
    }

    if (method === 'POST' && route === '/import') {
      // One-shot migration of the pre-server localStorage shape:
      // { mode, games: { [listingId]: { guesses, completedAt } } }. Every game
      // is re-scored here — the stored `won` is not believed — and the unique
      // constraint makes running it twice harmless.
      const body = await readJson(req);
      if (!MODES.has(body.mode) || !body.games || typeof body.games !== 'object') throw new HttpError(400, 'mode and games are required');
      const { player, setCookie } = await ensurePlayer(db, req);
      let imported = 0;
      let skipped = 0;
      for (const [listingId, g] of Object.entries(body.games).slice(0, 2000)) {
        try {
          const r = await recordGame(db, player, { mode: body.mode, listingId, guesses: g?.guesses, playedAt: g?.completedAt });
          r.fresh ? imported++ : skipped++;
        } catch (err) {
          if (err instanceof HttpError) skipped++;
          else throw err;
        }
      }
      return json({ imported, skipped }, 200, setCookie ? { 'set-cookie': setCookie } : {});
    }

    if (method === 'DELETE' && route === '/me') {
      // The "delete my data" button: the player row goes and everything
      // cascades — sessions, games, magic links. Nothing is retained.
      const player = await playerFromCookie(db, req);
      if (player) await db.query('delete from players where id = $1', [player.id]);
      const secure = url.protocol === 'https:';
      return new Response(null, { status: 204, headers: { 'set-cookie': clearCookie({ secure }) } });
    }

    throw new HttpError(404, 'no such route');
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: 'something went wrong' }, 500);
  }
}

const publicGame = (g) => ({
  guesses: g.guesses,
  won: g.won,
  attemptWon: g.attempt_won,
  firstPct: g.first_pct,
  bestPct: g.best_pct,
  dailyDate: g.daily_date,
  fresh: g.fresh,
});
