// Unit tests for the search client — __NEXT_DATA__ extraction, blocked-page
// detection, pagination fields, and the outcode-id binary search — against a
// fake fetch. No network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSearchClient,
  extractNextData,
  isGameableProperty,
} from '../tools/lib/searchClient.js';

const nextDataPage = (payload) =>
  `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(
    payload
  )}</script></html>`;

const searchPage = (properties, resultCount) =>
  nextDataPage({
    props: { pageProps: { searchResults: { properties, resultCount } } },
  });

const titlePage = (outcode) =>
  nextDataPage({
    props: {
      pageProps: {
        headMetaData: { title: `Properties For Sale in ${outcode} | Rightmove` },
      },
    },
  });

const ok = (html) => new Response(html, { status: 200 });
const noop = () => Promise.resolve();

test('extractNextData parses the embedded JSON and rejects pages without it', () => {
  assert.equal(extractNextData(nextDataPage({ a: 1 })).a, 1);
  assert.equal(extractNextData('<html>generic error page</html>'), null);
  assert.equal(extractNextData(''), null);
});

test('searchRent returns properties and a numeric resultCount (string input)', async () => {
  const props = [{ id: 111 }, { id: 222 }];
  const client = createSearchClient({
    fetchImpl: async () => ok(searchPage(props, '1,206')),
    sleep: noop,
  });
  const res = await client.searchRent(34, { page: 2 });
  assert.equal(res.properties.length, 2);
  assert.equal(res.resultCount, 1206);
});

test('a blocked page (HTTP 200, no __NEXT_DATA__) surfaces via lastError', async () => {
  const client = createSearchClient({
    fetchImpl: async () => ok('<html>please verify you are human</html>'),
    sleep: noop,
  });
  assert.equal(await client.searchRent(34), null);
  assert.match(client.lastError, /blocked/);
});

const cacheShim = (cache) => ({
  has: (k) => cache.has(k),
  get: (k) => cache.get(k),
  set: (k, v) => cache.set(k, v),
});

test('outcodeId binary-searches the alphabetical id space, past holes, and caches', async () => {
  // A tiny allocated universe: id N (1-based) -> OUTCODES[N-1], sorted.
  // Id 5 is a HOLE — a deallocated id serving the "couldn't find" page, as
  // seen live at OUTCODE^294 (which sits right before BS8's real id).
  const OUTCODES = ['AB1', 'AL1', 'B1', 'BS1', null, 'BS8', 'E8', 'LS1', 'M1', 'SW11', 'W2'];
  let requests = 0;
  const fetchImpl = async (url) => {
    requests += 1;
    const oid = Number(new URL(url).searchParams.get('locationIdentifier').split('^')[1]);
    const name = OUTCODES[oid - 1];
    if (name === null) {
      return ok('<html>We couldn’t find the place you were looking for.</html>');
    }
    // Beyond the allocated range: a real page whose title matches nothing.
    return ok(name ? titlePage(name) : nextDataPage({ props: { pageProps: {} } }));
  };

  const cache = new Map();
  const client = createSearchClient({ cache: cacheShim(cache), fetchImpl, sleep: noop });

  assert.equal(await client.outcodeId('M1'), 9);
  const afterFirst = requests;
  assert.ok(afterFirst > 0);

  // Cached: no new requests for the same outcode.
  assert.equal(await client.outcodeId('M1'), 9);
  assert.equal(requests, afterFirst);

  // The outcode straight after the hole is still found.
  assert.equal(await client.outcodeId('BS8'), 6);
  assert.equal(await client.outcodeId('E8'), 7);

  // Unknown outcode resolves to null without throwing.
  assert.equal(await client.outcodeId('ZZ9'), null);
});

test('a blocked probe fails the lookup WITHOUT poisoning the cache', async () => {
  const cache = new Map();
  const client = createSearchClient({
    cache: cacheShim(cache),
    // Every page looks blocked: no __NEXT_DATA__, no "couldn't find" marker.
    fetchImpl: async () => ok('<html>please verify you are human</html>'),
    sleep: noop,
  });
  assert.equal(await client.outcodeId('BS8'), null);
  assert.match(client.lastError, /could not resolve outcode BS8/);
  // Nothing cached: a later run on a healthy network can succeed.
  assert.equal(cache.size, 0);
});

test('isGameableProperty filters out non-home subtypes', () => {
  assert.equal(isGameableProperty({ id: 1, propertySubType: 'Apartment' }), true);
  assert.equal(isGameableProperty({ id: 1, propertySubType: 'Retirement Property' }), false);
  assert.equal(isGameableProperty({ id: 1, propertySubType: 'Block of Apartments' }), false);
  assert.equal(isGameableProperty({ propertySubType: 'Flat' }), false); // no id
});
