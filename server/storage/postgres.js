// Postgres storage backend (production, e.g. Render managed Postgres). Selected
// automatically when DATABASE_URL is set. Mirrors sqlite.js exactly.

import pg from 'pg';
import { shapeStats } from './shape.js';

export function createPostgresStore() {
  const connectionString = process.env.DATABASE_URL;
  // Managed providers (Render/Neon/Supabase) require SSL; local ones don't.
  const ssl =
    /localhost|127\.0\.0\.1/.test(connectionString) ? false : { rejectUnauthorized: false };
  const pool = new pg.Pool({ connectionString, ssl });

  return {
    async init() {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS guesses (
          id          BIGSERIAL PRIMARY KEY,
          property_id TEXT NOT NULL,
          client_id   TEXT,
          attempt     INTEGER NOT NULL,
          guess       INTEGER NOT NULL,
          won         BOOLEAN NOT NULL DEFAULT FALSE,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_guesses_property ON guesses(property_id);

        CREATE TABLE IF NOT EXISTS results (
          id          TEXT PRIMARY KEY,
          property_id TEXT NOT NULL,
          client_id   TEXT,
          name        TEXT,
          won         BOOLEAN NOT NULL DEFAULT FALSE,
          attempt_won INTEGER,
          best_diff   INTEGER NOT NULL,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE(property_id, client_id)
        );
        CREATE INDEX IF NOT EXISTS idx_results_property ON results(property_id);

        CREATE TABLE IF NOT EXISTS challenges (
          id          TEXT PRIMARY KEY,
          property_id TEXT NOT NULL UNIQUE,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);
    },

    // Opaque share id for a property. Idempotent: one stable id per property.
    async saveChallenge({ id, propertyId }) {
      const { rows } = await pool.query(
        `INSERT INTO challenges (id, property_id) VALUES ($1, $2)
         ON CONFLICT (property_id) DO UPDATE SET property_id = EXCLUDED.property_id
         RETURNING id`,
        [id, propertyId]
      );
      return rows[0].id;
    },

    async resolveChallenge(id) {
      const { rows } = await pool.query(
        `SELECT property_id FROM challenges WHERE id = $1`,
        [id]
      );
      return rows.length ? rows[0].property_id : null;
    },

    async recordGuess({ propertyId, clientId, attempt, guess, won }) {
      await pool.query(
        `INSERT INTO guesses (property_id, client_id, attempt, guess, won)
         VALUES ($1, $2, $3, $4, $5)`,
        [propertyId, clientId ?? null, attempt, Math.round(guess), !!won]
      );
    },

    // Upsert one result per (property, client); returns the effective id.
    async recordResult({ id, propertyId, clientId, name, won, attemptWon, bestDiff }) {
      // With a client id we can rely on the UNIQUE constraint to dedupe.
      if (clientId) {
        const { rows } = await pool.query(
          `INSERT INTO results (id, property_id, client_id, name, won, attempt_won, best_diff)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (property_id, client_id) DO UPDATE SET
             name = EXCLUDED.name, won = EXCLUDED.won,
             attempt_won = EXCLUDED.attempt_won, best_diff = EXCLUDED.best_diff
           RETURNING id`,
          [id, propertyId, clientId, name ?? null, !!won, attemptWon ?? null, Math.round(bestDiff)]
        );
        return rows[0].id;
      }
      await pool.query(
        `INSERT INTO results (id, property_id, client_id, name, won, attempt_won, best_diff)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, propertyId, null, name ?? null, !!won, attemptWon ?? null, Math.round(bestDiff)]
      );
      return id;
    },

    async updateResultName({ id, name }) {
      await pool.query(`UPDATE results SET name = $1 WHERE id = $2`, [name ?? null, id]);
    },

    async getResult(id) {
      const { rows } = await pool.query(`SELECT * FROM results WHERE id = $1`, [id]);
      if (!rows.length) return null;
      const row = rows[0];
      return {
        id: row.id,
        propertyId: row.property_id,
        name: row.name,
        won: row.won,
        attemptWon: row.attempt_won,
        bestDiff: row.best_diff,
      };
    },

    async getPropertyStats(propertyId, bestDiff) {
      const { rows } = await pool.query(
        `SELECT
           COUNT(*) AS players,
           COUNT(*) FILTER (WHERE won AND attempt_won = 1) AS w1,
           COUNT(*) FILTER (WHERE won AND attempt_won = 2) AS w2,
           COUNT(*) FILTER (WHERE won AND attempt_won = 3) AS w3,
           COUNT(*) FILTER (WHERE won AND attempt_won = 4) AS w4,
           COUNT(*) FILTER (WHERE NOT won) AS fails,
           COUNT(*) FILTER (WHERE best_diff > $1) AS worse
         FROM results WHERE property_id = $2`,
        [Math.round(bestDiff ?? Number.MAX_SAFE_INTEGER), propertyId]
      );
      return shapeStats(rows[0]);
    },
  };
}
