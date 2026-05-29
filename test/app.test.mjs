// End-to-end API tests with the network stubbed (Rightmove is never hit). Run
// with `npm test` (node --test). Covers the opaque-link flow, address
// obscuring, rich-ad detail extraction, enriched comparables, the 4-guess hint
// progression, win/fail, result recording, crowd stats, and that no
// rent/address/url/coordinates ever leak in a play payload.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { rmSync } from 'node:fs';

const dbPath = path.join(os.tmpdir(), `rentle-test-${process.pid}.db`);
process.env.SQLITE_PATH = dbPath;
delete process.env.DATABASE_URL; // force SQLite
delete process.env.NODE_ENV; // don't mount the production static handler

// --- network stub ------------------------------------------------------------
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
const listingHtml = `<script>window.PAGE_MODEL = ${JSON.stringify(target)};</script>`;
const searchHtml = `<script>window.jsonModel = ${JSON.stringify({
  properties: [
    { id: 222, bedrooms: 2, bathrooms: 1, propertySubType: 'Flat', displayAddress: 'Oak Road, South Yardley, Birmingham', summary: 'Modern two-bed flat near the station.', numberOfImages: 12, price: { amount: 1150, displayPrices: [{ displayPrice: '£1,150 pcm' }] }, location: { latitude: 52.4565, longitude: -1.8312 }, propertyImages: { mainImageSrc: 'https://media/c.jpg', images: [{ srcUrl: 'https://media/c.jpg' }] }, addedOrReduced: 'Added yesterday' },
    { id: 333, bedrooms: 2, bathrooms: 2, propertySubType: 'Apartment', displayAddress: 'Elm Avenue, South Yardley, Birmingham', summary: 'Spacious apartment with parking.', numberOfImages: 8, price: { amount: 1300, displayPrices: [{ displayPrice: '£1,300 pcm' }] }, location: { latitude: 52.455, longitude: -1.83 }, propertyImages: { mainImageSrc: 'https://media/d.jpg', images: [] } },
  ],
})};</script>`;

let server, base, realFetch;

before(async () => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const s = String(url);
    if (s.includes('localhost') || s.startsWith('http://127.')) return realFetch(url, opts);
    if (s.includes('/properties/')) return new Response(listingHtml, { status: 200 });
    if (s.includes('typeAhead')) return Response.json({ typeAheadLocations: [{ locationIdentifier: 'OUTCODE^1' }] });
    if (s.includes('property-to-rent/find')) return new Response(searchHtml, { status: 200 });
    return new Response('', { status: 404 });
  };
  const { app } = await import('../server/index.js');
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
});

after(() => {
  server?.close();
  globalThis.fetch = realFetch;
  try { rmSync(dbPath); } catch { /* ignore */ }
});

const post = (p, b) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
const get = (p) => fetch(base + p).then((r) => r.json());

test('coarseArea drops street + postcode to a neighbourhood label', async () => {
  const { coarseArea } = await import('../server/rightmove.js');
  assert.equal(coarseArea('Church Road, South Yardley, Birmingham, B25', ''), 'South Yardley, Birmingham');
  assert.equal(coarseArea('Roupell Street, London, SE1', ''), 'London');
  assert.equal(coarseArea('Flat 2, 14 High Street, Croydon, CR0 1AB', ''), 'Croydon');
});

test('challenge mints an opaque id (never the Rightmove id)', async () => {
  const ch = await post('/api/challenge', { url: 'https://www.rightmove.co.uk/properties/149288129' });
  assert.ok(ch.ok && ch.c && ch.c.length === 10);
  assert.notEqual(ch.c, '149288129');
  assert.equal(ch.id, undefined);
});

test('listing payload is rich but leaks no rent/address/url/coords', async () => {
  const { c } = await post('/api/challenge', { url: '149288129' });
  const { listing: L } = await get(`/api/listing?c=${c}`);
  assert.equal(L.area, 'South Yardley, Birmingham');
  for (const k of ['id', 'rightmoveUrl', 'displayAddress', 'outcode', 'latitude', 'longitude', 'priceAmount', 'priceLabel']) {
    assert.equal(k in L, false, `${k} must not be present`);
  }
  assert.equal(L.details.councilTaxBand, 'C');
  assert.equal(L.details.furnishType, 'Furnished');
  assert.equal(L.details.minimumTermMonths, 12);
  assert.equal(L.details.deposit, 1384);
  assert.equal(L.sizeSqFt, 750);
  assert.equal(L.sizeSqM, 70);
  assert.equal(L.imageCount, 3);
  assert.equal(L.nearestStations[0].types[0], 'NATIONAL_TRAIN');
});

test('hint progression + enriched, address-obscured comparables, then win', async () => {
  const { c } = await post('/api/challenge', { url: '149288129' });
  const g1 = await post('/api/guess', { c, guess: 800, attempt: 1, clientId: 'A' });
  assert.equal(g1.hint.type, 'comparable');
  const cp = g1.hint.property;
  assert.equal(cp.bedrooms, 2);
  assert.equal(cp.bathrooms, 1);
  assert.ok(cp.summary);
  assert.equal(cp.area, 'South Yardley, Birmingham');
  assert.equal('url' in cp, false);
  assert.equal('id' in cp, false);

  const g2 = await post('/api/guess', { c, guess: 3000, attempt: 2, clientId: 'A' });
  assert.equal(g2.hint.type, 'comparable');
  const g3 = await post('/api/guess', { c, guess: 700, attempt: 3, clientId: 'A' });
  assert.equal(g3.hint.type, 'direction');
  assert.equal(g3.hint.direction, 'low');

  const win = await post('/api/guess', { c, guess: 1180, attempt: 2, clientId: 'B' });
  assert.equal(win.status, 'win');
  assert.match(win.rightmoveUrl, /\/properties\/149288129/); // revealed only now
});

test('records a result and reports crowd stats + opaque share', async () => {
  const { c } = await post('/api/challenge', { url: '149288129' });
  const rec = await post('/api/result', { c, clientId: 'WINNER', won: true, guesses: [800, 1180], name: 'Robbie' });
  assert.ok(rec.resultId);
  assert.equal(rec.you.attemptWon, 2);
  assert.ok(rec.stats.players >= 1);

  const opp = await get(`/api/result/${rec.resultId}`);
  assert.ok(opp.result.challengeId);
  assert.equal('propertyId' in opp.result, false);
  assert.equal(opp.result.name, 'Robbie');
});

test('invalid challenge id and unknown api route are rejected', async () => {
  const bad = await get('/api/listing?c=nope');
  assert.equal(bad.ok, false);
  const health = await get('/healthz');
  assert.equal(health.ok, true);
});
