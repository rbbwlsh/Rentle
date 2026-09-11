// One tiny query interface over two Postgres drivers: Neon's HTTP driver in
// production (no connection to hold open across a serverless invocation) and
// PGlite — real Postgres compiled to WASM — in tests, so the whole API is
// exercised against actual SQL with no network and no service to provision.
//
// The interface is deliberately small: `query(text, params) -> rows`. Both
// drivers return numeric columns as strings, so anything summed or averaged
// is cast to float8 in the SELECT rather than parsed on the way out.

import fs from 'node:fs';
import path from 'node:path';

export function connectNeon(connectionString, { neon }) {
  const sql = neon(connectionString);
  return { query: (text, params = []) => sql.query(text, params) };
}

export function wrapPglite(pg) {
  return { query: async (text, params = []) => (await pg.query(text, params)).rows };
}

// Split a migration file into statements. Neon's HTTP driver runs one
// statement per request, so multi-statement files can't be sent whole. The
// rule is "a semicolon at end of line ends a statement" — simple, and the
// migrations are written to honour it (no $$ bodies).
export function splitStatements(sqlText) {
  return sqlText
    .split(/;\s*$/m)
    .map((s) => s.replace(/^\s*--[^\n]*$/gm, '').trim())
    .filter(Boolean);
}

// Apply every migration in `dir` that hasn't been applied, in name order.
// Idempotent: a second run is a no-op.
export async function migrate(db, dir) {
  await db.query(
    'create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())'
  );
  const applied = new Set((await db.query('select name from schema_migrations')).map((r) => r.name));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const ran = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const statement of splitStatements(text)) await db.query(statement);
    await db.query('insert into schema_migrations (name) values ($1)', [file]);
    ran.push(file);
  }
  return ran;
}
