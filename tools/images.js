// Download and re-host each corpus listing's photos.
//
// Hot-linking Rightmove's media CDN from a static site would rot (and leak
// traffic to them), so up to MAX_IMAGES per listing are downloaded once,
// resized and recompressed with sharp, and written to client/public/img/ —
// which Vite copies verbatim into the deployed site. What was processed is
// recorded in data/images-manifest.json (committed), so the corpus build is
// reproducible without the binaries and a re-run only fetches what's missing.
//
// Every mode's corpus is processed into the same photo store: Rightmove ids
// are globally unique, so /img/<id>/ and the manifest are shared between the
// rent and buy games rather than duplicated per mode.
//
// Usage:
//   node tools/images.js              process every corpus listing not in the manifest
//   node tools/images.js --redo <id>  re-download one listing's photos

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { fetchWithRetry } from './lib/fetchRetry.js';
import { BROWSER_HEADERS } from './lib/rightmove.js';
import { MODES } from './config/modes.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMG_DIR = path.join(ROOT, 'client', 'public', 'img');
const MANIFEST_PATH = path.join(ROOT, 'data', 'images-manifest.json');

const MAX_IMAGES = 8;
const MAX_WIDTH = 1200;
const WEBP_QUALITY = 70;
const DELAY_MS = 300;

const IMG_HEADERS = {
  'User-Agent': BROWSER_HEADERS['User-Agent'],
  'Accept-Language': BROWSER_HEADERS['Accept-Language'],
  Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveManifest(manifest) {
  const tmp = `${MANIFEST_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 1));
  fs.renameSync(tmp, MANIFEST_PATH);
}

async function processListing(listing, manifest) {
  const id = String(listing.id);
  const urls = (listing.images || []).slice(0, MAX_IMAGES);
  if (!urls.length) {
    manifest[id] = [];
    return { id, saved: 0, of: 0 };
  }

  const dir = path.join(IMG_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  const entries = [];

  for (let i = 0; i < urls.length; i++) {
    try {
      const res = await fetchWithRetry(urls[i], { headers: IMG_HEADERS });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const file = `${entries.length + 1}.webp`;
      const out = await sharp(buf)
        .rotate() // respect EXIF orientation
        .resize({ width: MAX_WIDTH, withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY })
        .toFile(path.join(dir, file));
      entries.push({ file, w: out.width, h: out.height });
    } catch (err) {
      console.error(`  ${id} image ${i + 1}: ${err.message}`);
    }
    await sleep(DELAY_MS);
  }

  manifest[id] = entries;
  return { id, saved: entries.length, of: urls.length };
}

async function main() {
  const redo = process.argv.includes('--redo')
    ? process.argv[process.argv.indexOf('--redo') + 1]
    : null;

  const manifest = loadManifest();
  const listings = [];
  for (const mode of Object.values(MODES)) {
    const dir = path.join(ROOT, mode.corpusDir);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      listings.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
    }
  }

  const todo = listings.filter((l) =>
    redo ? String(l.id) === redo : !(String(l.id) in manifest)
  );
  console.log(
    `${listings.length} corpus listings; ${todo.length} to process ` +
      `(≤${MAX_IMAGES} photos each, ${MAX_WIDTH}px webp q${WEBP_QUALITY}).`
  );

  let done = 0;
  let images = 0;
  for (const listing of todo) {
    const r = await processListing(listing, manifest);
    done += 1;
    images += r.saved;
    console.log(`  [${done}/${todo.length}] ${r.id}: ${r.saved}/${r.of} photos`);
    if (done % 10 === 0) saveManifest(manifest);
  }
  saveManifest(manifest);

  const empty = Object.values(manifest).filter((e) => !e.length).length;
  console.log(
    `\nDone: ${images} images this run; manifest covers ` +
      `${Object.keys(manifest).length} listings (${empty} with no usable photos).`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
