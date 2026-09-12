// The API, end to end, against real Postgres (PGlite — Postgres compiled to
// WASM, in-process, no network). Every test gets a fresh database with the
// production migrations applied, so the SQL here is the SQL that ships.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { wrapPglite, splitStatements } from '../server/db.js';
import { migrate } from '../server/migrate.js';
import { handle, CROWD_BUCKETS, IMPORT_BATCH } from '../server/app.js';
import { purge } from '../server/retention.js';
import { COOKIE } from '../server/session.js';
import { dailyIndex, londonDate } from '../client/src/engine/picker.js';

const MIGRATIONS = path.join(process.cwd(), 'db', 'migrations');

let pg;
let db;
before(async () => {
  pg = await PGlite.create();
  db = wrapPglite(pg);
  await migrate(db, MIGRATIONS);
  // A small corpus: three rent listings in daily order, one buy listing.
  const rows = [
    ['rent', '100', 1000, 'Leeds', 0],
    ['rent', '200', 2000, 'London', 1],
    ['rent', '300', 3000, 'London', 2],
    ['buy', '900', 250000, 'Bristol', 0],
  ];
  for (const [mode, id, price, city, position] of rows) {
    await db.query(
      'insert into listings (mode, id, price_amount, city, bedrooms, position) values ($1,$2,$3,$4,2,$5)',
      [mode, id, price, city, position]
    );
  }
});
after(async () => pg.close());

const ORIGIN = 'https://rentle.test';
const call = (method, route, { body, cookie } = {}) =>
  handle(
    db,
    new Request(`${ORIGIN}/api${route}`, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
  );
const cookieOf = (res) => {
  const raw = res.headers.get('set-cookie');
  return raw ? raw.split(';')[0] : null;
};

test('migrations are idempotent', async () => {
  assert.deepEqual(await migrate(db, MIGRATIONS), []);
});

test('splitStatements honours end-of-line semicolons and drops comment lines', () => {
  const parts = splitStatements('-- note\ncreate table a (x int);\n\ninsert into a values (1);\n');
  assert.deepEqual(parts, ['create table a (x int)', 'insert into a values (1)']);
});

test('a first session issues an httpOnly cookie and creates a player', async () => {
  const res = await call('POST', '/session');
  assert.equal(res.status, 200);
  const raw = res.headers.get('set-cookie');
  assert.match(raw, new RegExp(`^${COOKIE}=`));
  assert.match(raw, /HttpOnly/);
  assert.match(raw, /SameSite=Lax/);
  assert.match(raw, /Secure/); // https origin
  const { player } = await res.json();
  assert.match(player.id, /^[0-9a-f-]{36}$/);
  assert.equal(player.claimed, false);

  // The same cookie comes back as the same player, with no new cookie.
  const again = await call('POST', '/session', { cookie: cookieOf(res) });
  assert.equal(again.headers.get('set-cookie'), null);
  assert.equal((await again.json()).player.id, player.id);
});

test('a plain-http origin gets a cookie without Secure, so wrangler dev works', async () => {
  const res = await handle(db, new Request('http://localhost:8888/api/session', { method: 'POST' }));
  assert.doesNotMatch(res.headers.get('set-cookie'), /Secure/);
});

test('a game is scored server-side from raw guesses, and the answer is not echoed', async () => {
  const res = await call('POST', '/games', { body: { mode: 'rent', listingId: '200', guesses: [1500, 2100, 1990] } });
  assert.equal(res.status, 201);
  const { game, crowd } = await res.json();
  assert.equal(game.won, true);
  assert.equal(game.attemptWon, 2); // 2100 is within 5% of 2000
  assert.equal(game.firstPct, -0.25); // 1500 vs 2000
  assert.equal(game.bestPct, 0.05);
  // The client stops on a win; a forged guess after one is dropped.
  assert.deepEqual(game.guesses, [1500, 2100]);
  assert.equal(JSON.stringify(game).includes('2000'), false);
  assert.equal(crowd.plays, 1);
});

test('first play stands: a second submission for the same listing is ignored', async () => {
  const first = await call('POST', '/games', { body: { mode: 'rent', listingId: '100', guesses: [500] } });
  const cookie = cookieOf(first);
  const second = await call('POST', '/games', { cookie, body: { mode: 'rent', listingId: '100', guesses: [1000] } });
  assert.equal(second.status, 200); // not 201: nothing new was created
  const { game } = await second.json();
  assert.equal(game.fresh, false);
  assert.deepEqual(game.guesses, [500]);
  assert.equal(game.won, false);
});

test('bad input is rejected with a reason, never stored', async () => {
  for (const [body, pattern] of [
    [{ mode: 'lease', listingId: '100', guesses: [1] }, /unknown mode/],
    [{ mode: 'rent', listingId: 'nope', guesses: [1] }, /not in the game/],
    [{ mode: 'rent', listingId: '100', guesses: [] }, /non-empty/],
    [{ mode: 'rent', listingId: '100', guesses: [1.5] }, /whole number/],
    [{ mode: 'rent', listingId: '100', guesses: [-5] }, /whole number/],
  ]) {
    const res = await call('POST', '/games', { body });
    assert.ok(res.status === 400 || res.status === 404, `${JSON.stringify(body)} -> ${res.status}`);
    assert.match((await res.json()).error, pattern);
  }
  const res = await call('POST', '/games', { body: 'not json' });
  assert.equal(res.status, 400);
});

test('the daily is stamped when the listing is that London day’s pick', async () => {
  // Rent order is [100, 200, 300]; whichever today's pick is, playing it
  // stamps daily_date and playing another does not.
  const order = ['100', '200', '300'];
  const today = londonDate();
  const todays = order[dailyIndex(order.length, today)];
  const other = order.find((id) => id !== todays);

  const a = await call('POST', '/games', { body: { mode: 'rent', listingId: todays, guesses: [1] } });
  assert.equal((await a.json()).game.dailyDate, today);
  const b = await call('POST', '/games', { body: { mode: 'rent', listingId: other, guesses: [1] } });
  assert.equal((await b.json()).game.dailyDate, null);
});

test('crowd aggregates plays, wins, attempts, bias buckets and the median first guess', async () => {
  // Five fresh players on the buy listing (£250,000): three under, two over.
  for (const guesses of [[125000, 260000], [200000], [240000], [300000], [400000, 255000]]) {
    await call('POST', '/games', { body: { mode: 'buy', listingId: '900', guesses } });
  }
  const res = await call('GET', '/crowd?mode=buy&listingId=900');
  assert.equal(res.status, 200);
  const { crowd } = await res.json();
  assert.equal(crowd.plays, 5);
  assert.equal(crowd.wins, 3); // 260000 (4%), 240000 (4%), 255000 (2%)
  assert.deepEqual(crowd.winByAttempt, [1, 2, 0, 0, 0]);
  assert.equal(crowd.medianFirstGuess, 240000);
  assert.equal(crowd.underShare, 0.6);
  assert.equal(crowd.buckets.length, CROWD_BUCKETS.length);
  assert.equal(crowd.buckets.reduce((n, b) => n + b.count, 0), 5);
  // 125k is -50%, 200k is -20%, 240k is -4%, 300k is +20%, 400k is +60%.
  assert.deepEqual(crowd.buckets.map((b) => b.count), [0, 1, 1, 1, 1, 0, 1]);
});

test('crowd is cached for a minute, and a fresh game busts it', async () => {
  const before = (await (await call('GET', '/crowd?mode=buy&listingId=900')).json()).crowd.plays;
  await call('POST', '/games', { body: { mode: 'buy', listingId: '900', guesses: [1] } });
  const after = (await (await call('GET', '/crowd?mode=buy&listingId=900')).json()).crowd.plays;
  assert.equal(after, before + 1);
});

test('import re-scores the old localStorage shape, dates the dailies, and is idempotent', async () => {
  const order = ['100', '200', '300'];
  const day = '2026-09-01';
  const dailyThatDay = order[dailyIndex(order.length, day)];
  const games = {
    [dailyThatDay]: { guesses: [1, 2], won: true, attemptWon: 1, completedAt: `${day}T12:00:00Z` }, // lies about winning
    300: { guesses: [3000], won: false, completedAt: '2026-09-02T09:00:00Z' },
    999: { guesses: [1], won: true, completedAt: '2026-09-02T09:00:00Z' }, // not a listing
  };
  const res = await call('POST', '/import', { body: { mode: 'rent', games } });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { imported: 2, skipped: 1, remaining: 0 });

  const cookie = cookieOf(res);
  const daily = await (await call('POST', '/games', { cookie, body: { mode: 'rent', listingId: dailyThatDay, guesses: [1] } })).json();
  assert.equal(daily.game.won, false, 'the imported "won: true" was not believed');
  assert.equal(daily.game.dailyDate, day, 'the daily date was reconstructed from completedAt');
  const on300 = await (await call('POST', '/games', { cookie, body: { mode: 'rent', listingId: '300', guesses: [1] } })).json();
  assert.equal(on300.game.won, true, 'an honest win re-scores as a win');

  const again = await call('POST', '/import', { cookie, body: { mode: 'rent', games } });
  assert.deepEqual(await again.json(), { imported: 0, skipped: 3, remaining: 0 });
});

test('DELETE /me erases the player and everything under them', async () => {
  const created = await call('POST', '/games', { body: { mode: 'rent', listingId: '100', guesses: [1] } });
  const cookie = cookieOf(created);
  const { player } = await (await call('POST', '/session', { cookie })).json();
  const res = await call('DELETE', '/me', { cookie });
  assert.equal(res.status, 204);
  assert.match(res.headers.get('set-cookie'), /Max-Age=0/);
  assert.deepEqual(await db.query('select 1 from players where id = $1', [player.id]), []);
  assert.deepEqual(await db.query('select 1 from games where player_id = $1', [player.id]), []);
  // The old cookie is now nobody: the next call makes a fresh player.
  const fresh = await call('POST', '/session', { cookie });
  assert.notEqual((await fresh.json()).player.id, player.id);
});

test('a wild guess against a cheap listing is stored, not a 500', async () => {
  // £6m against £1,000 is a first_pct of 5999 — numeric(8,4) overflowed here.
  const res = await call('POST', '/games', { body: { mode: 'rent', listingId: '100', guesses: [6_000_000] } });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).game.firstPct, 5999);
});

test('a bad request never leaves a player row or a cookie behind', async () => {
  const [{ n: before }] = await db.query('select count(*)::int as n from players');
  const res = await call('POST', '/games', { body: { mode: 'rent', listingId: '424242', guesses: [1] } });
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('set-cookie'), null);
  const [{ n: after }] = await db.query('select count(*)::int as n from players');
  assert.equal(after, before);
});

test('import pages: at most a batch per call, and the response says what is left', async () => {
  const games = { 100: { guesses: [1] }, 200: { guesses: [1] }, 300: { guesses: [1] } };
  const first = await call('POST', '/import?limit=2', { body: { mode: 'rent', games } });
  assert.deepEqual(await first.json(), { imported: 2, skipped: 0, remaining: 1 });
  const cookie = cookieOf(first);
  // The client sends the NEXT slice, not the same object again.
  const rest = Object.fromEntries(Object.entries(games).slice(2));
  const second = await call('POST', '/import?limit=2', { cookie, body: { mode: 'rent', games: rest } });
  assert.deepEqual(await second.json(), { imported: 1, skipped: 0, remaining: 0 });
  // The cap cannot be raised past the batch size from the outside.
  const big = Object.fromEntries(Array.from({ length: IMPORT_BATCH + 1 }, (_, i) => [String(900000 + i), { guesses: [1] }]));
  const capped = await call('POST', `/import?limit=${IMPORT_BATCH * 10}`, { cookie, body: { mode: 'rent', games: big } });
  assert.equal((await capped.json()).remaining, 1);
});

test('GET /me is the export: the player and every game, and nothing for a stranger', async () => {
  const nobody = await call('GET', '/me');
  assert.equal(nobody.status, 200);
  assert.deepEqual(await nobody.json(), { player: null, games: [] });
  assert.equal(nobody.headers.get('set-cookie'), null, 'looking is not playing: no cookie is issued');

  const played = await call('POST', '/games', { body: { mode: 'rent', listingId: '200', guesses: [1500, 2000] } });
  const cookie = cookieOf(played);
  const { player, games } = await (await call('GET', '/me', { cookie })).json();
  assert.match(player.id, /^[0-9a-f-]{36}$/);
  assert.equal(player.email, null);
  assert.ok(player.createdAt);
  assert.equal(games.length, 1);
  assert.equal(games[0].listingId, '200');
  assert.equal(games[0].mode, 'rent');
  assert.deepEqual(games[0].guesses, [1500, 2000]);
  assert.equal(games[0].won, true);
  assert.ok(games[0].playedAt);
});

test('DELETE /me also removes merge tombstones that point at the player', async () => {
  const played = await call('POST', '/games', { body: { mode: 'rent', listingId: '300', guesses: [1] } });
  const cookie = cookieOf(played);
  const { player } = await (await call('POST', '/session', { cookie })).json();
  const [tomb] = await db.query('insert into players (merged_into) values ($1) returning id', [player.id]);
  assert.equal((await call('DELETE', '/me', { cookie })).status, 204);
  assert.deepEqual(await db.query('select 1 from players where id in ($1, $2)', [player.id, tomb.id]), []);
});

test('sessions.last_used_at is bumped at most once a day', async () => {
  const played = await call('POST', '/games', { body: { mode: 'rent', listingId: '100', guesses: [1] } });
  const cookie = cookieOf(played);
  const stamp = async () => (await db.query('select last_used_at from sessions s join players p on p.id = s.player_id order by s.created_at desc limit 1'))[0].last_used_at;
  await db.query(`update sessions set last_used_at = now() - interval '1 hour' where last_used_at = (select max(last_used_at) from sessions)`);
  const anHourAgo = await stamp();
  await call('GET', '/me', { cookie });
  assert.equal(String(await stamp()), String(anHourAgo), 'an hour old: left alone');
  await db.query(`update sessions set last_used_at = now() - interval '2 days' where last_used_at = $1`, [anHourAgo]);
  await call('GET', '/me', { cookie });
  assert.ok(new Date(await stamp()) > new Date(anHourAgo), 'two days old: refreshed');
});

test('the retention purge forgets what the privacy page says it forgets, and nothing else', async () => {
  const pg3 = await PGlite.create();
  const db3 = wrapPglite(pg3);
  await migrate(db3, MIGRATIONS);
  await db3.query("insert into listings (mode, id, price_amount, city, position) values ('rent', 1, 1000, 'Leeds', 0)");
  const mk = async (cols, vals) => (await db3.query(`insert into players (${cols}) values (${vals}) returning id`))[0].id;

  const active = await mk('last_seen_at', "now() - interval '3 years'"); // old row, but played last week
  await db3.query("insert into games (player_id, mode, listing_id, guesses, won, first_pct, best_pct, played_at) values ($1, 'rent', 1, '{1}', false, -0.9, -0.9, now() - interval '7 days')", [active]);
  const stale = await mk('last_seen_at', "now() - interval '3 years'");
  await db3.query("insert into games (player_id, mode, listing_id, guesses, won, first_pct, best_pct, played_at) values ($1, 'rent', 1, '{1}', false, -0.9, -0.9, now() - interval '3 years')", [stale]);
  await db3.query("insert into sessions (token_hash, player_id, last_used_at) values ('stale-s', $1, now() - interval '3 years')", [stale]);
  const tomb = await mk('merged_into', `'${stale}'`);
  const empty = await mk('last_seen_at', "now() - interval '40 days'"); // never played
  const fresh = await mk('last_seen_at', 'now()'); // never played, but only just arrived
  const unverified = await mk('email, last_seen_at', "'x@example.com', now()");
  const pending = await mk('email, last_seen_at', "'y@example.com', now()");
  await db3.query("insert into magic_links (token_hash, player_id, email, expires_at) values ('live', $1, 'y@example.com', now() + interval '10 minutes')", [pending]);
  await db3.query("insert into magic_links (token_hash, player_id, email, expires_at) values ('dead', $1, 'x@example.com', now() - interval '1 day')", [unverified]);
  await db3.query("insert into sessions (token_hash, player_id, last_used_at) values ('old-cookie', $1, now() - interval '14 months')", [active]);
  await db3.query("insert into sessions (token_hash, player_id, last_used_at) values ('live-cookie', $1, now() - interval '1 day')", [active]);

  const tally = await purge(db3);
  assert.deepEqual(tally, { magicLinks: 1, unverifiedEmails: 1, sessions: 2, emptyPlayers: 1, tombstones: 1, players: 1 });

  const ids = new Set((await db3.query('select id from players')).map((r) => r.id));
  assert.ok(ids.has(active), 'a player who played recently stays');
  assert.ok(ids.has(fresh), 'a brand-new empty player stays');
  assert.ok(ids.has(unverified) && ids.has(pending), 'players with emails stay');
  assert.ok(!ids.has(stale) && !ids.has(tomb) && !ids.has(empty));
  const emails = Object.fromEntries((await db3.query('select id, email from players')).map((r) => [r.id, r.email]));
  assert.equal(emails[unverified], null, 'the unverified email with no live link is cleared');
  assert.equal(emails[pending], 'y@example.com', 'a verification still in flight is left alone');
  assert.deepEqual((await db3.query('select token_hash from sessions order by 1')).map((r) => r.token_hash), ['live-cookie']);
  // Running it again finds nothing.
  assert.deepEqual(Object.values(await purge(db3)), [0, 0, 0, 0, 0, 0]);
  await pg3.close();
});

test('with no database the API says so instead of crashing', async () => {
  const res = await handle(null, new Request(`${ORIGIN}/api/session`, { method: 'POST' }));
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /unavailable/);
});

test('unknown routes are 404', async () => {
  assert.equal((await call('GET', '/nope')).status, 404);
});

test('seeded from the real corpus, the server picks the same daily as the client', async () => {
  const { listingRows, seedListings } = await import('../tools/seed-db.js');
  const { pickDaily } = await import('../client/src/engine/picker.js');
  const fs = await import('node:fs');
  const { MODES } = await import('../tools/config/modes.js');

  const pg2 = await PGlite.create();
  const db2 = wrapPglite(pg2);
  await migrate(db2, MIGRATIONS);
  for (const mode of Object.values(MODES)) {
    const dir = path.join(process.cwd(), mode.corpusDir);
    const listings = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
    const order = JSON.parse(fs.readFileSync(path.join(process.cwd(), mode.orderPath), 'utf8'));
    await seedListings(db2, listingRows(mode.key, listings, order));

    // Ten days either side of today: every one must agree.
    for (let d = -10; d <= 10; d++) {
      const date = londonDate(new Date(Date.now() + d * 86400000));
      const [{ n }] = await db2.query('select count(*)::int as n from listings where mode = $1 and position is not null', [mode.key]);
      const [row] = await db2.query('select id::text as id from listings where mode = $1 and position is not null order by position offset $2 limit 1', [mode.key, dailyIndex(n, date)]);
      assert.equal(row.id, String(pickDaily(order, date)), `${mode.key} ${date}`);
    }
  }
  await pg2.close();
});
