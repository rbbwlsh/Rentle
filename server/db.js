// One tiny query interface over two Postgres drivers: Neon's HTTP driver in
// production (no connection to hold open across a serverless invocation) and
// PGlite — real Postgres compiled to WASM — in tests, so the whole API is
// exercised against actual SQL with no network and no service to provision.
//
// The interface is deliberately small: `query(text, params) -> rows`. Both
// drivers return numeric columns as strings, so anything summed or averaged
// is cast to float8 in the SELECT rather than parsed on the way out.
//
// This file is bundled into the Worker, so it must not import node:fs —
// migrations (which read files) live in server/migrate.js.

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
