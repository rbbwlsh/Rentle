// Apply db/migrations/*.sql in name order. Kept apart from db.js because it
// reads files: db.js is bundled into the Worker, this is only ever run from
// tools/migrate.js and the tests.

import fs from 'node:fs';
import path from 'node:path';
import { splitStatements } from './db.js';

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
