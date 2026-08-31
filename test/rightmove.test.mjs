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

// --- the buy channel -------------------------------------------------------

// Mirrors a real for-sale PAGE_MODEL. The shape differs from a lettings one in
// ways that matter: there is NO numeric `prices.price` on a sale detail page
// (only the search rows carry one), and tenure/service charge stand where
// furnishing and deposit do on a let.
const saleTarget = {
  metadata: { channel: 'RES_BUY' },
  propertyData: {
    id: 92532438, bedrooms: 2, bathrooms: 1, propertySubType: 'Apartment', propertyType: 'Flat',
    status: { published: true },
    address: { displayAddress: 'Whitworth Street West, Manchester, Greater Manchester, M1', outcode: 'M1', incode: '5WW' },
    prices: { primaryPrice: '£340,000', secondaryPrice: null, displayPriceQualifier: 'Offers Over', pricePerSqFt: 451 },
    lettings: null,
    tenure: { tenureType: 'LEASEHOLD', yearsRemainingOnLease: 992, message: null },
    livingCosts: { councilTaxBand: 'C', annualServiceCharge: 900, annualGroundRent: null },
    sharedOwnership: { sharedOwnershipFlag: false, ownershipPercentage: null },
    affordableBuyingScheme: false, commercial: false, businessForSale: false, auction: false,
    listingHistory: { listingUpdateReason: 'Reduced on 27/08/2026' },
    text: { description: 'A bright two-bedroom apartment. '.repeat(12) },
    keyFeatures: ['Two double bedrooms', 'Secure parking'],
    tags: [],
    images: [{ url: 'https://media/1.jpg' }, { url: 'https://media/2.jpg' }],
    sizings: [{ unit: 'sqft', maximumSize: 753 }],
    location: { latitude: 53.474, longitude: -2.245 },
    nearestStations: [{ name: 'Deansgate', distance: 0.3, types: ['NATIONAL_TRAIN'] }],
    customer: { branchDisplayName: 'Acme Sales' },
  },
};
const sale = (over = (p) => p) => {
  const c = JSON.parse(JSON.stringify(saleTarget));
  over(c.propertyData, c);
  return c;
};

test('buy mode reads the asking price out of the formatted string', () => {
  // The real page has no `prices.price`, so parsing primaryPrice is the only
  // route to the number.
  const l = normalize(sale(), '92532438', { mode: 'buy' });
  assert.equal(l.priceAmount, 340000);
  assert.equal(l.priceLabel, '£340,000');
  assert.equal(l.mode, 'buy');
  assert.equal(l.details.tenureType, 'LEASEHOLD');
  assert.equal(l.details.yearsRemainingOnLease, 992);
  assert.equal(l.details.annualServiceCharge, 900);
  assert.equal(l.details.priceQualifier, 'Offers Over');
  assert.equal(l.details.listingUpdate, 'Reduced on 27/08/2026');
  assert.equal(l.area, 'Manchester, Greater Manchester');
  // Lettings-only facts have no meaning on a sale and must not appear.
  assert.equal(l.details.furnishType, undefined);
  assert.equal(l.details.deposit, undefined);
});

test('price per sq ft never ships: with the floor area it IS the answer', () => {
  const l = normalize(sale(), '1', { mode: 'buy' });
  assert.equal(l.sizeSqFt, 753);
  const raw = JSON.stringify(l);
  assert.ok(!/pricePerSqFt/i.test(raw));
  assert.ok(!raw.includes('451'));
});

test('a sale detail page that does carry a numeric price is believed', () => {
  const l = normalize(sale((p) => { p.prices.price = 335000; }), '1', { mode: 'buy' });
  assert.equal(l.priceAmount, 335000);
});

test('each mode rejects the other channel', () => {
  assert.throws(() => normalize(clone(), '1', { mode: 'buy' }), (err) =>
    err instanceof ListingError && /rental listing/.test(err.message)
  );
  assert.throws(() => normalize(sale(), '1', { mode: 'rent' }), (err) =>
    err instanceof ListingError && /for sale/.test(err.message)
  );
});

test('sale listings whose headline is not an asking price are rejected', () => {
  const rejects = [
    ['shared ownership', (p) => { p.sharedOwnership.sharedOwnershipFlag = true; }, /part share/],
    ['affordable scheme', (p) => { p.affordableBuyingScheme = true; }, /discounted/],
    ['auction flag', (p) => { p.auction = true; }, /guide price is not/i],
    ['auction in the label', (p) => { p.prices.primaryPrice = '£120,000 (Auction)'; }, /guide price is not/i],
    ['commercial', (p) => { p.commercial = true; }, /Commercial/],
    ['POA', (p) => { p.prices.primaryPrice = 'Price on application'; }, /POA/],
    ['over the ceiling', (p) => { p.prices.primaryPrice = '£2,500,000'; }, /outside the playable range/],
    ['under the floor', (p) => { p.prices.primaryPrice = '£12,000'; }, /outside the playable range/],
    // A range concatenates into a nonsense number, which the band catches.
    ['a price range', (p) => { p.prices.primaryPrice = '£250,000 - £275,000'; }, /outside the playable range/],
    // Development and buy-to-let pitches put marketing copy in the address.
    ['marketing copy for an address', (p) => { p.address.displayAddress = 'Fully Furnished Homes in Manchester City Centre'; }, /Marketing copy/],
  ];
  for (const [label, mutate, pattern] of rejects) {
    assert.throws(
      () => normalize(sale(mutate), '1', { mode: 'buy' }),
      (err) => err instanceof ListingError && pattern.test(err.message),
      `expected "${label}" to be rejected`
    );
  }
});

test('bedsHint stands in when a sale page reports no bedroom count', () => {
  // Real studios come back with `bedrooms: null` even when the search that
  // found them filtered on 0 beds, and the buy corpus is stratified by count.
  const l = normalize(sale((p) => { p.bedrooms = null; }), '1', { mode: 'buy', bedsHint: 0 });
  assert.equal(l.bedrooms, 0);
  assert.equal(l.details.bedrooms, 0);
  // Without a hint it stays unknown rather than inventing a number.
  assert.equal(normalize(sale((p) => { p.bedrooms = null; }), '1', { mode: 'buy' }).bedrooms, null);
});

test('coarseArea falls back to the outcode rather than printing a sales pitch', () => {
  assert.equal(coarseArea('Fully Furnished Homes in Manchester City Centre', 'M1'), 'M1 area');
  assert.equal(coarseArea('Mersey Road, Manchester, M20', 'M20'), 'Manchester');
});

test('a foreign geocode is rejected, whatever the address says', () => {
  // Rightmove really served "Lower Canal Walk, Southampton, Hampshire" at
  // 36.84, -76.02 — Southampton, Virginia. One of those drags the town's map
  // centroid into the Atlantic and puts the in-game pin on the wrong continent.
  assert.throws(
    () => normalize(sale((p) => { p.location = { latitude: 36.838952, longitude: -76.019058 }; }), '1', { mode: 'buy' }),
    (err) => err instanceof ListingError && /outside the UK/.test(err.message)
  );
  // The far corners of the UK still pass: Scilly and Shetland.
  for (const [latitude, longitude] of [[49.92, -6.32], [60.15, -1.15]]) {
    const l = normalize(sale((p) => { p.location = { latitude, longitude }; }), '1', { mode: 'buy' });
    assert.equal(l.latitude, latitude);
  }
  // A listing with no coordinates at all is still allowed through; it simply
  // gets no map and no comparables.
  assert.equal(normalize(sale((p) => { p.location = {}; }), '1', { mode: 'buy' }).latitude, null);
});
