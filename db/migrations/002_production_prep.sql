-- Production prep. Everything here is a fix or a saving; nothing changes what
-- the API stores.
--
-- * first_pct / best_pct were numeric(8,4): four integer digits, which a
--   £6m guess against a £500 rent (ratio 11999) overflowed into a 500.
--   MAX_GUESS over the smallest price needs seven, so twelve of precision.
-- * games_player_idx duplicated the leading columns of the unique constraint
--   on (player_id, mode, listing_id) — the same lookups, twice the bytes.
-- * games_daily_idx only ever serves daily rows, and random rounds (half the
--   table) carry null; a partial index halves it.
-- * Listing ids are Rightmove's numeric ids, sent as strings by the client
--   and cast on the way in and out. bigint halves the key bytes in the
--   listings PK, the games FK, the unique constraint and games_listing_idx.
--
-- One statement per ;-terminated line (server/db.js splits on that).

alter table games alter column first_pct type numeric(12,4);
alter table games alter column best_pct type numeric(12,4);

drop index if exists games_player_idx;

drop index if exists games_daily_idx;
create index games_daily_idx on games (mode, daily_date) where daily_date is not null;

alter table games drop constraint games_mode_listing_id_fkey;
alter table listings alter column id type bigint using id::bigint;
alter table games alter column listing_id type bigint using listing_id::bigint;
alter table games add constraint games_mode_listing_id_fkey foreign key (mode, listing_id) references listings (mode, id);
