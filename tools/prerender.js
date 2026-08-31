// Prerender per-listing share pages after `vite build`.
//
// A static host can't inject Open Graph tags per request the way the old
// Express server did, so this writes client/dist/p/<id>/index.html for every
// playable listing: the built index.html with its <!--META_START/END--> block
// replaced by listing-specific, answer-free tags. Netlify serves these real
// files ahead of the SPA fallback, so shared links unfurl with the property
// photo while every other path still hits the app shell.
//
// og:image / og:url must be ABSOLUTE for link previews — the origin comes from
// SITE_URL or tools/config/site.json. After first deploy, set the real URL
// there, rebuild, redeploy.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'client', 'dist');
const DATA = path.join(ROOT, 'client', 'public', 'data');

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
  const beds = card.bedrooms != null ? `${card.bedrooms}-bed ` : '';
  const type = (card.propertySubType || 'property').toLowerCase();
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

function main() {
  const template = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
  const index = JSON.parse(fs.readFileSync(path.join(DATA, 'index.json'), 'utf8'));

  const defaults = {
    title: 'Rentle — Guess the Rent',
    description:
      'The daily guess-the-rent game on real UK listings. Five guesses, real hints — can you read the market?',
    image: `${SITE_URL}/og.png`,
    url: `${SITE_URL}/`,
  };

  // Root + browse pages get the default card with absolute URLs.
  fs.writeFileSync(path.join(DIST, 'index.html'), inject(template, defaults));
  fs.mkdirSync(path.join(DIST, 'browse'), { recursive: true });
  fs.writeFileSync(
    path.join(DIST, 'browse', 'index.html'),
    inject(template, { ...defaults, url: `${SITE_URL}/browse` })
  );

  for (const card of index.listings) {
    const meta = {
      title: `Guess the rent — ${card.area}`,
      description: `How much is this ${describe(card)}? Take a guess on Rentle.`,
      image: `${SITE_URL}${card.thumb}`,
      url: `${SITE_URL}/p/${card.id}`,
    };
    const dir = path.join(DIST, 'p', card.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), inject(template, meta));
  }

  console.log(
    `Prerendered ${index.listings.length} share pages under /p/ (origin ${SITE_URL}).`
  );
}

main();
