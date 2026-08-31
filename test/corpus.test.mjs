// Unit tests for the corpus builder: the index must be price-free, chunks
// must carry a decodable secret and local image paths, comparables must come
// from the same city, and the daily order must be append-only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCorpus, buildOrder } from '../tools/build-corpus.js';

const listing = (id, city, over = {}) => ({
  id,
  city,
  sourceOutcode: 'X1',
  scrapedAt: '2026-08-30T00:00:00Z',
  area: `${city} area`,
  bedrooms: 2,
  bathrooms: 1,
  propertySubType: 'Flat',
  details: { propertyType: 'Flat', councilTaxBand: 'C' },
  sizeSqFt: 700,
  sizeSqM: 65,
  description: 'A lovely flat with lots of light and a balcony. '.repeat(10),
  keyFeatures: ['Balcony'],
  tags: [],
  images: [`https://media/${id}/a.jpg`],
  imageCount: 1,
  nearestStations: [],
  agent: 'Acme',
  displayAddress: `${id} Test Street, ${city}`,
  outcode: 'X1',
  incode: '1AB',
  latitude: 51.5,
  longitude: -0.1,
  priceAmount: 2000,
  priceLabel: '£2,000 pcm',
  rightmoveUrl: `https://www.rightmove.co.uk/properties/${id}`,
  ...over,
});

const manifest = {
  1: [{ file: '1.webp', w: 1200, h: 800 }, { file: '2.webp', w: 1200, h: 800 }],
  2: [{ file: '1.webp', w: 1200, h: 800 }],
  4: [{ file: '1.webp', w: 900, h: 600 }],
  // id 3 has no entry -> dropped
};

const listings = [
  listing('1', 'London', { priceAmount: 2000 }),
  listing('2', 'London', { latitude: 51.502, longitude: -0.101, priceAmount: 1900, bedrooms: 2 }),
  listing('3', 'London'),
  listing('4', 'Leeds', { latitude: 53.8, longitude: -1.55, priceAmount: 900 }),
];

test('listings without processed photos are dropped', () => {
  const { index, chunks, dropped } = buildCorpus(listings, manifest);
  assert.equal(dropped, 1);
  assert.equal(chunks.has('3'), false);
  assert.deepEqual([...index.order].sort(), ['1', '2', '4']);
});

test('the index is completely price-free', () => {
  const { index } = buildCorpus(listings, manifest);
  const raw = JSON.stringify(index).toLowerCase();
  assert.ok(!raw.includes('price'));
  assert.ok(!raw.includes('2000'));
  assert.ok(!raw.includes('displayaddress'));
});

test('chunks carry local image paths and a decodable secret', () => {
  const { chunks } = buildCorpus(listings, manifest);
  const c = chunks.get('1');
  assert.deepEqual(c.images, ['/img/1/1.webp', '/img/1/2.webp']);
  assert.equal(c.imageCount, 2);
  assert.equal(JSON.stringify(c).includes('media/'), false); // no CDN URLs leak

  const secret = JSON.parse(Buffer.from(c.secret, 'base64').toString('utf8'));
  assert.equal(secret.priceAmount, 2000);
  assert.equal(secret.priceLabel, '£2,000 pcm');
  assert.equal(secret.displayAddress, '1 Test Street, London');
  assert.match(secret.rightmoveUrl, /properties\/1$/);
  // The public part of the chunk must not contain the price outside `secret`.
  const { secret: _s, ...publicPart } = c;
  assert.ok(!JSON.stringify(publicPart).toLowerCase().includes('priceamount'));
});

test('comparables come from the same city, with local thumbs and distance', () => {
  const { chunks } = buildCorpus(listings, manifest);
  const london = chunks.get('1').comparables;
  assert.equal(london.length, 1);
  assert.equal(london[0].price, 1900);
  assert.equal(london[0].imageUrl, '/img/2/1.webp');
  assert.equal(typeof london[0].distanceMiles, 'number');
  assert.ok(london[0].summary.length <= 221);

  // Leeds has no same-city partner: no comparables (game degrades to
  // direction-only hints, exactly like the old live-search failure path).
  assert.deepEqual(chunks.get('4').comparables, []);
});

test('city pools carry a count and a centroid to pin on the map', () => {
  const { index } = buildCorpus(listings, manifest);
  const byName = Object.fromEntries(index.cities.map((c) => [c.name, c]));
  assert.deepEqual(Object.keys(byName).sort(), ['Leeds', 'London']);
  assert.equal(byName.London.count, 2); // id 3 was dropped for having no photos
  assert.equal(byName.Leeds.count, 1);
  // Centroid is the mean of the city's listings, not of the whole corpus.
  assert.ok(Math.abs(byName.London.lat - 51.501) < 1e-6);
  assert.ok(Math.abs(byName.Leeds.lat - 53.8) < 1e-6);
  // Deepest pool first, so the map can lead with it.
  assert.equal(index.cities[0].name, 'London');
});

test('the order is append-only across rebuilds', () => {
  const first = buildOrder(['1', '2', '4'], []);
  const again = buildOrder(['1', '2', '4'], first);
  assert.deepEqual(again, first);

  const grown = buildOrder(['1', '2', '4', '9'], first);
  assert.deepEqual(grown.slice(0, 3), first);
  assert.equal(grown[3], '9');

  // A listing that left the corpus is dropped without disturbing the rest.
  const shrunk = buildOrder(['1', '4'], first);
  assert.deepEqual(shrunk, first.filter((id) => id !== '2'));
});
