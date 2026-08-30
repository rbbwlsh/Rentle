// Unit tests for the PAGE_MODEL parser — the contract with Rightmove's
// property pages. The fixture mirrors the real embedded JSON shape.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractPageModel,
  normalize,
  coarseArea,
  parseRightmoveUrl,
  ListingError,
} from '../tools/lib/rightmove.js';

const target = {
  metadata: { channel: 'RES_LET' },
  propertyData: {
    id: 149288129, bedrooms: 2, bathrooms: 1, propertySubType: 'Apartment', propertyType: 'Flat',
    status: { published: true },
    address: { displayAddress: 'Church Road, South Yardley, Birmingham, B25', outcode: 'B25', incode: '8XX' },
    prices: { primaryPrice: '£1,200 pcm', price: 1200, frequency: 'monthly' },
    lettings: { monthlyPrice: 1200, letType: 'Long term', furnishType: 'Furnished', letAvailableDate: '2026-06-01', deposit: 1384, minimumTermInMonths: 12 },
    livingCosts: { councilTaxBand: 'C' },
    text: { description: 'A bright two-bedroom apartment. '.repeat(15) },
    keyFeatures: ['Two double bedrooms', 'Allocated parking'],
    tags: ['Online viewing available'],
    images: [{ url: 'https://media/1.jpg' }, { url: 'https://media/2.jpg' }, { url: 'https://media/3.jpg' }],
    sizings: [{ unit: 'sqft', maximumSize: 750 }],
    location: { latitude: 52.456, longitude: -1.831 },
    nearestStations: [{ name: 'Acocks Green', distance: 0.8, types: ['NATIONAL_TRAIN'] }],
    customer: { branchDisplayName: 'Acme Lettings' },
  },
};

const clone = () => JSON.parse(JSON.stringify(target));

test('extractPageModel pulls the balanced JSON object out of the page', () => {
  const html = `<script>window.PAGE_MODEL = ${JSON.stringify(target)};</script>`;
  const model = extractPageModel(html);
  assert.equal(model.propertyData.id, 149288129);
  assert.equal(extractPageModel('<html>no model here</html>'), null);
});

// The inverse of the hydrator: flatten a value into the devalue-style array
// the current pages embed, so the fixture can exercise the same code path.
function flatten(value) {
  const flat = [];
  const add = (v) => {
    const idx = flat.length;
    flat.push(null);
    if (v === null || typeof v !== 'object') flat[idx] = v;
    else if (Array.isArray(v)) flat[idx] = v.map(add);
    else {
      const node = {};
      flat[idx] = node;
      for (const [k, x] of Object.entries(v)) node[k] = add(x);
    }
    return idx;
  };
  add(value);
  return flat;
}

test('extractPageModel hydrates the current flattened __PAGE_MODEL format', () => {
  const wrapped = { data: JSON.stringify(flatten(target)), encoding: 'on' };
  const html = `<script>window.__PAGE_MODEL = ${JSON.stringify(wrapped)}</script>`;
  const model = extractPageModel(html);
  assert.deepEqual(model, target);
  // And normalize reads it exactly as it reads the legacy shape.
  const l = normalize(model, '149288129');
  assert.equal(l.priceAmount, 1200);
  assert.equal(l.imageCount, 3);
});

test('normalize extracts the full ad: details, sizes, images, stations', () => {
  const l = normalize(clone(), '149288129');
  assert.equal(l.id, '149288129');
  assert.equal(l.priceAmount, 1200);
  assert.equal(l.priceLabel, '£1,200 pcm');
  assert.equal(l.displayAddress, 'Church Road, South Yardley, Birmingham, B25');
  assert.equal(l.area, 'South Yardley, Birmingham');
  assert.equal(l.details.furnishType, 'Furnished');
  assert.equal(l.details.deposit, 1384);
  assert.equal(l.details.minimumTermMonths, 12);
  assert.equal(l.details.councilTaxBand, 'C');
  assert.equal(l.sizeSqFt, 750);
  assert.equal(l.sizeSqM, 70);
  assert.deepEqual(l.images, ['https://media/1.jpg', 'https://media/2.jpg', 'https://media/3.jpg']);
  assert.equal(l.imageCount, 3);
  assert.equal(l.nearestStations[0].types[0], 'NATIONAL_TRAIN');
  assert.equal(l.agent, 'Acme Lettings');
  assert.equal(l.latitude, 52.456);
});

test('weekly rents are normalised to monthly', () => {
  const weekly = clone();
  delete weekly.propertyData.lettings.monthlyPrice;
  weekly.propertyData.prices = { primaryPrice: '£300 pw', price: 300, frequency: 'weekly' };
  const l = normalize(weekly, '1');
  assert.equal(l.priceAmount, 1300); // 300 * 52 / 12
});

test('sale listings and unpublished listings are rejected', () => {
  const sale = clone();
  sale.metadata.channel = 'RES_BUY';
  delete sale.propertyData.lettings;
  sale.propertyData.prices = { primaryPrice: '£450,000', price: 450000 };
  assert.throws(() => normalize(sale, '1'), (err) =>
    err instanceof ListingError && /for sale/.test(err.message)
  );

  const gone = clone();
  gone.propertyData.status.published = false;
  assert.throws(() => normalize(gone, '1'), (err) => err.status === 410);
});

test('coarseArea drops street + postcode to a neighbourhood label', () => {
  assert.equal(coarseArea('Church Road, South Yardley, Birmingham, B25', ''), 'South Yardley, Birmingham');
  assert.equal(coarseArea('Roupell Street, London, SE1', ''), 'London');
  assert.equal(coarseArea('Flat 2, 14 High Street, Croydon, CR0 1AB', ''), 'Croydon');
});

test('parseRightmoveUrl accepts ids, property URLs and legacy URLs', () => {
  assert.equal(parseRightmoveUrl('149288129'), '149288129');
  assert.equal(parseRightmoveUrl('https://www.rightmove.co.uk/properties/149288129#photos'), '149288129');
  assert.equal(parseRightmoveUrl('https://www.rightmove.co.uk/property-to-rent/property-99887766.html'), '99887766');
  assert.throws(() => parseRightmoveUrl('https://example.com/'), ListingError);
});
