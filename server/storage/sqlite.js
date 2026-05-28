// SQLite storage backend (local dev / single-server hosting). Uses Node's
// built-in `node:sqlite` so there are no native dependencies to compile.
// Production uses Postgres instead (see postgres.js); both expose the same API.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { shapeStats } from './shape.js';

export function createSqliteStore() {
  const file = process.env.SQLITE_PATH || path.join(process.cwd(), 'data', 'rentle.db');
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);

  return {
    async init() {
      db.exec(`
        CREATE TABLE IF NOT EXISTS guesses (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          property_id TEXT NOT NULL,
          client_id   TEXT,
          attempt     INTEGER NOT NULL,
          guess       INTEGER NOT NULL,
          won         INTEGER NOT NULL DEFAULT 0,
          created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_guesses_property ON guesses(property_id);

        CREATE TABLE IF NOT EXISTS results (
          id          TEXT PRIMARY KEY,
          property_id TEXT NOT NULL,
          client_id   TEXT,
          name        TEXT,
          won         INTEGER NOT NULL DEFAULT 0,
          attempt_won INTEGER,
          best_diff   INTEGER NOT NULL,
          created_at  TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(property_id, client_id)
        );
        CREATE INDEX IF NOT EXISTS idx_results_property ON results(property_id);

        CREATE TABLE IF NOT EXISTS challenges (
          id          TEXT PRIMARY KEY,
          property_id TEXT NOT NULL UNIQUE,
          created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    },

    // Opaque share id for a property. Idempotent: one stable id per property,
    // so the Rightmove id is never exposed to the client.
    async saveChallenge({ id, propertyId }) {
      const existing = db
        .prepare(`SELECT id FROM challenges WHERE property_id = ?`)
        .get(propertyId);
      if (existing) return existing.id;
      db.prepare(`INSERT INTO challenges (id, property_id) VALUES (?, ?)`).run(
        id,
        propertyId
      );
      return id;
    },

    async resolveChallenge(id) {
      const row = db.prepare(`SELECT property_id FROM challenges WHERE id = ?`).get(id);
      return row ? row.property_id : null;
    },

    async recordGuess({ propertyId, clientId, attempt, guess, won }) {
      db.prepare(
        `INSERT INTO guesses (property_id, client_id, attempt, guess, won)
         VALUES (?, ?, ?, ?, ?)`
      ).run(propertyId, clientId ?? null, attempt, Math.round(guess), won ? 1 : 0);
    },

    // Upsert one result per (property, client) so replays don't inflate stats.
    // Returns the result id (existing one is reused on replay).
    async recordResult({ id, propertyId, clientId, name, won, attemptWon, bestDiff }) {
      const existing = clientId
        ? db
            .prepare(`SELECT id FROM results WHERE property_id = ? AND client_id = ?`)
            .get(propertyId, clientId)
        : null;

      if (existing) {
        db.prepare(
          `UPDATE results SET name = ?, won = ?, attempt_won = ?, best_diff = ?
           WHERE id = ?`
        ).run(name ?? null, won ? 1 : 0, attemptWon ?? null, Math.round(bestDiff), existing.id);
        return existing.id;
      }

      db.prepare(
        `INSERT INTO results (id, property_id, client_id, name, won, attempt_won, best_diff)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        propertyId,
        clientId ?? null,
        name ?? null,
        won ? 1 : 0,
        attemptWon ?? null,
        Math.round(bestDiff)
      );
      return id;
    },

    async updateResultName({ id, name }) {
      db.prepare(`UPDATE results SET name = ? WHERE id = ?`).run(name ?? null, id);
    },

    async getResult(id) {
      const row = db.prepare(`SELECT * FROM results WHERE id = ?`).get(id);
      if (!row) return null;
      return {
        id: row.id,
        propertyId: row.property_id,
        name: row.name,
        won: !!row.won,
        attemptWon: row.attempt_won,
        bestDiff: row.best_diff,
      };
    },

    async getPropertyStats(propertyId, bestDiff) {
      const row = db
        .prepare(
          `SELECT
             COUNT(*) AS players,
             SUM(CASE WHEN won = 1 AND attempt_won = 1 THEN 1 ELSE 0 END) AS w1,
             SUM(CASE WHEN won = 1 AND attempt_won = 2 THEN 1 ELSE 0 END) AS w2,
             SUM(CASE WHEN won = 1 AND attempt_won = 3 THEN 1 ELSE 0 END) AS w3,
             SUM(CASE WHEN won = 1 AND attempt_won = 4 THEN 1 ELSE 0 END) AS w4,
             SUM(CASE WHEN won = 0 THEN 1 ELSE 0 END) AS fails,
             SUM(CASE WHEN best_diff > ? THEN 1 ELSE 0 END) AS worse
           FROM results WHERE property_id = ?`
        )
        .get(Math.round(bestDiff ?? Number.MAX_SAFE_INTEGER), propertyId);
      return shapeStats(row);
    },
  };
}
