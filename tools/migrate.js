// Apply db/migrations/*.sql to the production database. Idempotent — run it
// after every pull that touches db/migrations/, and before tools/seed-db.js on
// a fresh database.
//
//   NEON_DATABASE_URL=postgres://... node tools/migrate.js

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';
import { connectNeon } from '../server/db.js';
import { migrate } from '../server/migrate.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.NEON_DATABASE_URL;
if (!url) {
  console.error('NEON_DATABASE_URL is not set. Get it from the Neon console.');
  process.exit(2);
}
const ran = await migrate(connectNeon(url, { neon }), path.join(ROOT, 'db', 'migrations'));
console.log(ran.length ? `Applied: ${ran.join(', ')}` : 'Nothing to apply — schema is current.');
