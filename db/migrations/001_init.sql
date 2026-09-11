-- Rentle player data. Everything derived (bias, miss, streaks) is a pure
-- function of `games.guesses` and `listings.price_amount`; the two *_pct
-- columns are stored for query speed and can always be regenerated.
--
-- Statements are split on ";" at end of line by server/db.js — keep one
-- statement per terminated line and no $$ bodies.

create table players (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  display_name      text check (display_name is null or length(display_name) <= 24),
  email             text,
  email_verified_at timestamptz,
  merged_into       uuid references players(id)
);
-- Case-insensitive uniqueness without the citext extension, which PGlite
-- (the test database) does not bundle. Emails are lower-cased on the way in.
create unique index players_email_idx on players (lower(email));

create table sessions (
  token_hash    text primary key,
  player_id     uuid not null references players(id) on delete cascade,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz not null default now()
);
create index sessions_player_idx on sessions (player_id);

-- The answer key, seeded at build time from data/corpus*/ by tools/seed-db.js.
-- `position` is the listing's slot in the mode's daily order (data/order*.json),
-- null for listings not in the built game; the server picks the daily from it
-- with the same hash the client uses.
create table listings (
  mode              text not null check (mode in ('rent', 'buy')),
  id                text not null,
  price_amount      integer not null check (price_amount > 0),
  city              text not null,
  area              text,
  bedrooms          smallint,
  property_sub_type text,
  position          integer,
  primary key (mode, id)
);
create index listings_order_idx on listings (mode, position);

create table games (
  id            bigserial primary key,
  player_id     uuid not null references players(id) on delete cascade,
  mode          text not null,
  listing_id    text not null,
  daily_date    date,
  guesses       integer[] not null check (cardinality(guesses) between 1 and 5),
  won           boolean not null,
  attempt_won   smallint check (attempt_won between 1 and 5),
  first_pct     numeric(8,4) not null,
  best_pct      numeric(8,4) not null,
  played_at     timestamptz not null default now(),
  unique (player_id, mode, listing_id),
  foreign key (mode, listing_id) references listings (mode, id)
);
create index games_player_idx on games (player_id, mode);
create index games_listing_idx on games (mode, listing_id);
create index games_daily_idx on games (mode, daily_date);

create table magic_links (
  token_hash  text primary key,
  player_id   uuid not null references players(id) on delete cascade,
  email       text not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz
);
