// Storage facade: picks Postgres when DATABASE_URL is set (production on
// Render), otherwise SQLite (local dev). Both backends expose the same async
// API: recordGuess, recordResult, updateResultName, getResult, getPropertyStats.

import { randomBytes } from 'node:crypto';

let storePromise;

async function build() {
  let store;
  if (process.env.DATABASE_URL) {
    const { createPostgresStore } = await import('./postgres.js');
    store = createPostgresStore();
    console.log('Storage: Postgres');
  } else {
    const { createSqliteStore } = await import('./sqlite.js');
    store = createSqliteStore();
    console.log('Storage: SQLite (set DATABASE_URL to use Postgres)');
  }
  await store.init();
  return store;
}

export function getStore() {
  if (!storePromise) storePromise = build();
  return storePromise;
}

// URL-safe short id for shareable result links.
const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
export function shortId(length = 8) {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}
