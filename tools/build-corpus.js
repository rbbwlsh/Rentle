// Turn the scraped corpus into the static data the site ships:
//
//   client/public/data/index.json          card-level info for every listing —
//                                          deliberately price-free, since it's
//                                          loaded before anyone has guessed
//   client/public/data/listings/<id>.json  the full listing: details, local
//                                          image paths, precomputed comparable
//                                          hints, and the answer tucked into a
//                                          base64 `secret` so it at least
//                                          doesn't sit in plain text in the
//                                          network tab
//
// Pure local transform — no network — so it runs in CI and before every dev
// build. Listings without a single usable photo are dropped: a photo-less
// guess-the-rent round isn't a game.
//
// The daily-puzzle `order` is a seeded shuffle kept in data/order.json
// (committed, append-only): re-scrapes add new ids to the end rather than
// reshuffling, so a redeploy doesn't change which listing is "today's".

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickComparables } from './lib/comparables.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS_DIR = path.join(ROOT, 'data', 'corpus');
const MANIFEST_PATH = path.join(ROOT, 'data', 'images-manifest.json');
const ORDER_PATH = path.join(ROOT, 'data', 'order.json');
const OUT_DIR = path.join(ROOT, 'client', 'public', 'data');

// Deterministic PRNG (mulberry32) so the daily order is stable across machines.
function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle(ids, seed = 20260830) {
  const rand = seededRandom(seed);
  const out = [...ids];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Extend a previous order with any new ids (shuffled), dropping ids that have
// left the corpus. Append-only so existing positions survive a re-scrape.
export function buildOrder(ids, previousOrder = []) {
  const alive = new Set(ids.map(String));
  const kept = previousOrder.filter((id) => alive.has(String(id)));
  const seen = new Set(kept.map(String));
  const fresh = seededShuffle(ids.map(String).filter((id) => !seen.has(id)).sort());
  return [...kept, ...fresh];
}

const imagePathFor = (id, entry) => `/img/${id}/${entry.file}`;

// The answer, base64-encoded. Not security — just keeps the rent out of a
// casual "view source"; anyone determined can decode it, and that's fine.
function encodeSecret(listing) {
  return Buffer.from(
    JSON.stringify({
      priceAmount: listing.priceAmount,
      priceLabel: listing.priceLabel,
      displayAddress: listing.displayAddress,
      rightmoveUrl: listing.rightmoveUrl,
    }),
    'utf8'
  ).toString('base64');
}

// Pure transform: corpus listings + image manifest -> { index, chunks }.
export function buildCorpus(listings, manifest, previousOrder = []) {
  const usable = listings.filter((l) => (manifest[String(l.id)] || []).length > 0);

  const withImages = usable.map((l) => ({
    ...l,
    localImages: manifest[String(l.id)].map((e) => imagePathFor(l.id, e)),
  }));

  const chunks = new Map();
  for (const l of withImages) {
    const comparables = pickComparables(l, withImages, {
      imageUrlFor: (c) => c.localImages[0],
    });
    chunks.set(String(l.id), {
      id: String(l.id),
      city: l.city,
      area: l.area,
      bedrooms: l.bedrooms,
      bathrooms: l.bathrooms,
      propertySubType: l.propertySubType,
      details: l.details,
      sizeSqFt: l.sizeSqFt,
      sizeSqM: l.sizeSqM,
      description: l.description,
      keyFeatures: l.keyFeatures,
      tags: l.tags,
      images: l.localImages,
      imageCount: l.localImages.length,
      nearestStations: l.nearestStations,
      agent: l.agent,
      scrapedAt: l.scrapedAt,
      comparables,
      secret: encodeSecret(l),
    });
  }

  const order = buildOrder([...chunks.keys()], previousOrder);
  const index = {
    builtAt: new Date().toISOString(),
    order,
    listings: order.map((id) => {
      const c = chunks.get(id);
      return {
        id,
        city: c.city,
        area: c.area,
        bedrooms: c.bedrooms,
        bathrooms: c.bathrooms,
        propertySubType: c.propertySubType,
        thumb: c.images[0],
        imageCount: c.imageCount,
      };
    }),
  };

  return { index, chunks, dropped: listings.length - usable.length };
}

function main() {
  const listings = fs.existsSync(CORPUS_DIR)
    ? fs
        .readdirSync(CORPUS_DIR)
        .filter((f) => f.endsWith('.json'))
        .map((f) => JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, f), 'utf8')))
    : [];
  let manifest = {};
  try {
    manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  } catch {
    /* no images processed yet */
  }
  let previousOrder = [];
  try {
    previousOrder = JSON.parse(fs.readFileSync(ORDER_PATH, 'utf8'));
  } catch {
    /* first build */
  }

  const { index, chunks, dropped } = buildCorpus(listings, manifest, previousOrder);

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT_DIR, 'listings'), { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify(index));
  for (const [id, chunk] of chunks) {
    fs.writeFileSync(
      path.join(OUT_DIR, 'listings', `${id}.json`),
      JSON.stringify(chunk)
    );
  }
  fs.writeFileSync(ORDER_PATH, JSON.stringify(index.order, null, 1));

  console.log(
    `Corpus built: ${chunks.size} playable listings` +
      (dropped ? ` (${dropped} dropped — no processed photos)` : '') +
      ` -> client/public/data/`
  );
  if (!chunks.size) {
    console.log(
      'The corpus is empty — run `npm run seed` then `npm run images` to fill it.'
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
