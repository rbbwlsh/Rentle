// Shared shaping so the SQLite and Postgres backends return identical stats
// objects. Kept dependency-free so neither backend has to load the other.
export function shapeStats(row) {
  const players = Number(row.players) || 0;
  const fails = Number(row.fails) || 0;
  const winByAttempt = {
    1: Number(row.w1) || 0,
    2: Number(row.w2) || 0,
    3: Number(row.w3) || 0,
    4: Number(row.w4) || 0,
  };
  const winners = winByAttempt[1] + winByAttempt[2] + winByAttempt[3] + winByAttempt[4];
  return {
    players,
    winByAttempt,
    fails,
    winRate: players ? Math.round((winners / players) * 100) : 0,
    // % of players you were strictly closer than.
    percentile: players ? Math.round(((Number(row.worse) || 0) / players) * 100) : 0,
  };
}
