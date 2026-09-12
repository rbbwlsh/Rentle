// Storage limitation, as code: what the database forgets, and when. Run daily
// by the Worker's cron (worker/index.js); the privacy page quotes these periods,
// so change them together.
//
// "Activity" is any of: the player's own last_seen_at, a session used, or a
// game played. sessions.last_used_at is bumped at most once a day per
// session (server/app.js), so it is the cheap, reliable signal.

export const RETENTION = {
  // A player with no activity for this long is deleted outright — games,
  // sessions and magic links cascade with them.
  player: '2 years',
  // A cookie the browser stopped sending. The cookie itself expires after a
  // year, so anything older than this is certainly dead.
  session: '13 months',
  // A player row that never recorded a game (a request that failed after the
  // cookie was issued, or an import with nothing valid in it).
  emptyPlayer: '30 days',
};

const count = (rows) => rows.length;

// Apply every rule. Returns a tally per rule for the function log. Every
// statement is idempotent and safe to run while the API is live.
export async function purge(db) {
  const out = {};

  // Magic links: spent or expired. Must run before the unverified-email rule,
  // which treats an outstanding live link as "still in progress".
  out.magicLinks = count(await db.query('delete from magic_links where used_at is not null or expires_at < now() returning 1'));

  // An email that was entered but never verified, with no live link left to
  // verify it. There is nothing to contact them about, so it goes.
  out.unverifiedEmails = count(
    await db.query(
      `update players set email = null
        where email is not null and email_verified_at is null
          and not exists (select 1 from magic_links m where m.player_id = players.id)
        returning 1`
    )
  );

  out.sessions = count(await db.query(`delete from sessions where last_used_at < now() - interval '${RETENTION.session}' returning 1`));

  // Merge tombstones are kept as long as their target: an old cookie that
  // still points at one must keep resolving to the merged player.
  out.emptyPlayers = count(
    await db.query(
      `delete from players p
        where p.merged_into is null and p.email is null
          and p.last_seen_at < now() - interval '${RETENTION.emptyPlayer}'
          and not exists (select 1 from games g where g.player_id = p.id)
          and not exists (select 1 from sessions s where s.player_id = p.id and s.last_used_at > now() - interval '${RETENTION.emptyPlayer}')
          and not exists (select 1 from players t where t.merged_into = p.id)
        returning 1`
    )
  );

  // Inactive players. Tombstones pointing at one are deleted first — they
  // reference the target, so the delete would otherwise fail on the FK.
  const stale = `
    select p.id from players p
     where p.merged_into is null
       and p.last_seen_at < now() - interval '${RETENTION.player}'
       and not exists (select 1 from games g where g.player_id = p.id and g.played_at > now() - interval '${RETENTION.player}')
       and not exists (select 1 from sessions s where s.player_id = p.id and s.last_used_at > now() - interval '${RETENTION.player}')`;
  out.tombstones = count(await db.query(`delete from players where merged_into in (${stale}) returning 1`));
  out.players = count(await db.query(`delete from players where id in (${stale}) returning 1`));

  return out;
}
