// Prerender per-listing share pages after `vite build`.
//
// A static host can't inject Open Graph tags per request the way the old
// Express server did, so this writes an index.html for every playable listing
// in every mode — client/dist/p/<id>/ for the rent game, client/dist/buy/p/<id>/
// for the buy one: the built index.html with its <!--META_START/END--> block
// replaced by listing-specific, answer-free tags. The static-asset layer
// serves these real files ahead of the SPA fallback, so shared links unfurl
// with the property photo while every other path still hits the app shell.
//
// og:image / og:url must be ABSOLUTE for link previews — the origin comes from
// SITE_URL or tools/config/site.json. After first deploy, set the real URL
// there, rebuild, redeploy.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODES } from './config/modes.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'client', 'dist');

const siteConfig = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'tools', 'config', 'site.json'), 'utf8')
);
const SITE_URL = (process.env.SITE_URL || siteConfig.siteUrl).replace(/\/$/, '');

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function describe(card) {
  const type = (card.propertySubType || 'property').toLowerCase();
  if (card.bedrooms === 0) return `studio ${type} in ${card.area}`;
  const beds = card.bedrooms != null ? `${card.bedrooms}-bed ` : '';
  return `${beds}${type} in ${card.area}`;
}

function metaTags(m) {
  return [
    `<title>${esc(m.title)}</title>`,
    `<meta name="description" content="${esc(m.description)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Rentle" />`,
    `<meta property="og:title" content="${esc(m.title)}" />`,
    `<meta property="og:description" content="${esc(m.description)}" />`,
    `<meta property="og:image" content="${esc(m.image)}" />`,
    `<meta property="og:url" content="${esc(m.url)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(m.title)}" />`,
    `<meta name="twitter:description" content="${esc(m.description)}" />`,
    `<meta name="twitter:image" content="${esc(m.image)}" />`,
  ].join('\n    ');
}

const inject = (template, meta) =>
  template.replace(/<!--META_START-->[\s\S]*?<!--META_END-->/, metaTags(meta));

function writePage(relPath, template, meta) {
  const dir = path.join(DIST, relPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), inject(template, meta));
}

// Per-mode share copy. Neither variant names a price — the card has to be
// safe to unfurl in a group chat before anyone has guessed.
const COPY = {
  rent: {
    title: 'Rentle — Guess the Rent',
    description:
      'The daily guess-the-rent game on real UK listings. Five guesses, real hints — can you read the market?',
    listingTitle: (card) => `Guess the rent — ${card.area}`,
    listingDescription: (card) => `How much is this ${describe(card)}? Take a guess on Rentle.`,
  },
  buy: {
    title: 'Rentle Buy — Guess the Asking Price',
    description:
      'The daily guess-the-asking-price game on real UK homes for sale. Five guesses, real hints — can you read the market?',
    listingTitle: (card) => `Guess the asking price — ${card.area}`,
    listingDescription: (card) =>
      `What's this ${describe(card)} on the market for? Take a guess on Rentle.`,
  },
};

function main() {
  const template = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');

  // Injection consumes the markers, so a second run against a prerendered
// dist/ would quietly stamp the home page's tags on every share page. Fail
// instead: this runs after `vite build`, which writes a fresh template.
if (!/<!--META_START-->[\s\S]*?<!--META_END-->/.test(template)) {
  throw new Error('client/dist/index.html has no META_START/META_END block — run `npm run build`, not prerender.js on its own.');
}
  let total = 0;

  for (const mode of Object.values(MODES)) {
    const indexPath = path.join(ROOT, mode.outDir, 'index.json');
    if (!fs.existsSync(indexPath)) {
      console.log(`[${mode.key}] no built index — skipping.`);
      continue;
    }
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    const copy = COPY[mode.key];

    const defaults = {
      title: copy.title,
      description: copy.description,
      image: `${SITE_URL}/og.png`,
      url: `${SITE_URL}${mode.homePath}`,
    };

    // The rent game owns the root document; every other entry point gets its
    // own real file so its link preview is right.
    if (mode.homePath === '/') {
      fs.writeFileSync(path.join(DIST, 'index.html'), inject(template, defaults));
    } else {
      writePage(mode.homePath, template, defaults);
    }
    writePage(mode.browsePath, template, {
      ...defaults,
      url: `${SITE_URL}${mode.browsePath}`,
    });

    for (const card of index.listings) {
      writePage(`${mode.routePrefix}/${card.id}`, template, {
        title: copy.listingTitle(card),
        description: copy.listingDescription(card),
        // A thumb is site-relative (/img/...) or, with imageBase pointing at
        // object storage, already absolute.
        image: /^https?:\/\//.test(card.thumb) ? card.thumb : `${SITE_URL}${card.thumb}`,
        url: `${SITE_URL}${mode.routePrefix}/${card.id}`,
      });
    }
    total += index.listings.length;
    console.log(
      `[${mode.key}] prerendered ${index.listings.length} share pages under ${mode.routePrefix}/.`
    );
  }

  console.log(`${total} share pages in total (origin ${SITE_URL}).`);
}

main();
