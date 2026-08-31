// Turn the scraped corpus into the static data the site ships:
//
//   client/public/data/<mode>/index.json   card-level info for every listing —
//                                          deliberately price-free, since it's
//                                          loaded before anyone has guessed
//   .../<mode>/listings/<id>.json          the full listing: details, local
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
// Every mode in tools/config/modes.js is built, each from its own corpus into
// its own output directory. The two games share this transform, the photo
// store and the image manifest, and nothing else.
//
// The daily-puzzle `order` is a seeded shuffle kept per mode (committed,
// append-only): re-scrapes add new ids to the end rather than reshuffling, so
// a redeploy doesn't change which listing is "today's".

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickComparables } from './lib/comparables.js';
import { redactListing } from './lib/redact.js';
import { MODES } from './config/modes.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = path.join(ROOT, 'data', 'images-manifest.json');
const OUT_ROOT = path.join(ROOT, 'client', 'public', 'data');

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
export function buildCorpus(listings, manifest, previousOrder = [], { mode = 'rent' } = {}) {
  const usable = listings.filter((l) => (manifest[String(l.id)] || []).length > 0);

  // Scrub the ad copy on the way in, before comparables are cut from it: the
  // corpus on disk keeps the agent's original text, but nothing that ships
  // mentions a deposit or quotes a figure a player could work the rent back
  // out of. See lib/redact.js.
  const withImages = usable.map((l) => ({
    ...redactListing(l),
    localImages: manifest[String(l.id)].map((e) => imagePathFor(l.id, e)),
  }));

  const chunks = new Map();
  for (const l of withImages) {
    const comparables = pickComparables(l, withImages, {
      imagesFor: (c) => c.localImages,
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
      mode,
      description: l.description,
      keyFeatures: l.keyFeatures,
      tags: l.tags,
      images: l.localImages,
      imageCount: l.localImages.length,
      nearestStations: l.nearestStations,
      // Public, and deliberately exact: the in-game map drops a real pin. That
      // makes location a first-class clue and does put the answer within reach
      // of anyone who reverse-searches the point — a known, accepted trade,
      // same spirit as the base64'd price.
      latitude: l.latitude ?? null,
      longitude: l.longitude ?? null,
      agent: l.agent,
      scrapedAt: l.scrapedAt,
      comparables,
      secret: encodeSecret(l),
    });
  }

  const order = buildOrder([...chunks.keys()], previousOrder);

  // City pools for the map picker: where to drop the pin, and how deep the
  // pool is. The centroid is the mean of the city's listings — good enough to
  // place a dot on a map of Great Britain, and it carries no price.
  const cities = [...new Set(withImages.map((l) => l.city).filter(Boolean))]
    .map((name) => {
      const all = withImages.filter((l) => l.city === name);
      const located = all.filter((l) => l.latitude != null && l.longitude != null);
      const mean = (key) =>
        located.length
          ? Number(
              (located.reduce((sum, l) => sum + l[key], 0) / located.length).toFixed(3)
            )
          : null;
      return { name, count: all.length, lat: mean('latitude'), lon: mean('longitude') };
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const index = {
    mode,
    builtAt: new Date().toISOString(),
    order,
    cities,
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

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function buildMode(mode, manifest) {
  const corpusDir = path.join(ROOT, mode.corpusDir);
  const orderPath = path.join(ROOT, mode.orderPath);
  const outDir = path.join(ROOT, mode.outDir);

  const listings = fs.existsSync(corpusDir)
    ? fs
        .readdirSync(corpusDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => JSON.parse(fs.readFileSync(path.join(corpusDir, f), 'utf8')))
    : [];

  const { index, chunks, dropped } = buildCorpus(listings, manifest, readJson(orderPath, []), {
    mode: mode.key,
  });

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, 'listings'), { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index));
  for (const [id, chunk] of chunks) {
    fs.writeFileSync(path.join(outDir, 'listings', `${id}.json`), JSON.stringify(chunk));
  }
  fs.writeFileSync(orderPath, JSON.stringify(index.order, null, 1));

  console.log(
    `[${mode.key}] ${chunks.size} playable listings` +
      (dropped ? ` (${dropped} dropped — no processed photos)` : '') +
      ` -> ${mode.outDir}/`
  );
  return chunks.size;
}

function main() {
  // Clear the whole output tree first, not just each mode's subdirectory: a
  // layout change (or a mode being renamed) would otherwise leave the previous
  // build's files behind to be served alongside the new ones.
  fs.rmSync(OUT_ROOT, { recursive: true, force: true });
  const manifest = readJson(MANIFEST_PATH, {});
  let total = 0;
  for (const mode of Object.values(MODES)) total += buildMode(mode, manifest);
  if (!total) {
    console.log(
      'Every corpus is empty — run `npm run seed` then `npm run images` to fill them.'
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
