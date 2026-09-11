// Load the answer key: every corpus listing, for every mode, into `listings`
// — price, city, bedrooms, and its slot in the daily order. The server scores
// against this table, so it must be re-run after any re-scrape, and it is
// safe to re-run at any time (upsert on (mode, id)).
//
//   NEON_DATABASE_URL=postgres://... node tools/seed-db.js
//
// Listings whose photos never processed are still seeded: the client cannot
// play them, but a stale share link might submit one, and a 404 there is
// clearer than a foreign-key error.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';
import { connectNeon } from '../server/db.js';
import { MODES } from './config/modes.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Pure: corpus listings + the mode's order -> rows for `listings`.
export function listingRows(mode, listings, order) {
  const position = new Map(order.map((id, i) => [String(id), i]));
  return listings.map((l) => ({
    mode,
    id: String(l.id),
    priceAmount: l.priceAmount,
    city: l.city,
    area: l.area ?? null,
    bedrooms: l.bedrooms ?? null,
    propertySubType: l.propertySubType ?? null,
    position: position.get(String(l.id)) ?? null,
  }));
}

export async function seedListings(db, rows) {
  // One statement per row keeps this driver-agnostic; ~1,000 rows is seconds.
  for (const r of rows) {
    await db.query(
      `insert into listings (mode, id, price_amount, city, area, bedrooms, property_sub_type, position)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (mode, id) do update set
         price_amount = excluded.price_amount, city = excluded.city, area = excluded.area,
         bedrooms = excluded.bedrooms, property_sub_type = excluded.property_sub_type,
         position = excluded.position`,
      [r.mode, r.id, r.priceAmount, r.city, r.area, r.bedrooms, r.propertySubType, r.position]
    );
  }
  return rows.length;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function main() {
  const url = process.env.NEON_DATABASE_URL;
  if (!url) {
    console.error('NEON_DATABASE_URL is not set.');
    process.exit(2);
  }
  const db = connectNeon(url, { neon });
  for (const mode of Object.values(MODES)) {
    const dir = path.join(ROOT, mode.corpusDir);
    const listings = fs.existsSync(dir)
      ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => readJson(path.join(dir, f), null)).filter(Boolean)
      : [];
    const order = readJson(path.join(ROOT, mode.orderPath), []);
    const n = await seedListings(db, listingRows(mode.key, listings, order));
    console.log(`[${mode.key}] seeded ${n} listings (${order.length} in the daily order).`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((err) => { console.error(err); process.exit(1); });
