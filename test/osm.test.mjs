// Map URL construction. These are pure string builders, but a malformed bbox
// silently renders the wrong bit of the world rather than erroring.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  boundingBox,
  osmEmbedUrl,
  osmViewUrl,
  googleMapsUrl,
  hasLocation,
  SPAN_DEG,
} from '../client/src/engine/osm.js';

const BRISTOL = [51.461758, -2.596824];

test('the bounding box brackets the point', () => {
  const [lat, lon] = BRISTOL;
  const b = boundingBox(lat, lon);
  assert.ok(b.minLat < lat && lat < b.maxLat);
  assert.ok(b.minLon < lon && lon < b.maxLon);
  assert.ok(Math.abs(b.maxLat - lat - SPAN_DEG) < 1e-9);
});

test('the box is widened by latitude so northern maps are not squashed', () => {
  const wideBristol = boundingBox(51.46, -2.6);
  const wideEdinburgh = boundingBox(55.95, -3.19);
  const lonSpan = (b) => b.maxLon - b.minLon;
  // Edinburgh is further north, so it needs MORE longitude to cover the same
  // ground distance.
  assert.ok(lonSpan(wideEdinburgh) > lonSpan(wideBristol));
  // Both stay close to square: lon span * cos(lat) should track the lat span.
  for (const [b, lat] of [[wideBristol, 51.46], [wideEdinburgh, 55.95]]) {
    const ratio =
      ((lonSpan(b) / 2) * Math.cos((lat * Math.PI) / 180)) / (b.maxLat - lat);
    assert.ok(Math.abs(ratio - 1) < 1e-9, `box not square at ${lat}`);
  }
});

test('the embed URL carries a four-value bbox and a marker', () => {
  const url = osmEmbedUrl(...BRISTOL);
  assert.ok(url.startsWith('https://www.openstreetmap.org/export/embed.html?'));
  const params = new URL(url).searchParams;
  assert.equal(params.get('bbox').split(',').length, 4);
  assert.equal(params.get('marker'), '51.461758,-2.596824');
  assert.equal(params.get('layer'), 'mapnik');
  // No API key anywhere — that's the point of using OSM.
  assert.ok(!/key=/i.test(url));
});

test('outbound links point at the right coordinates', () => {
  assert.match(googleMapsUrl(...BRISTOL), /query=51\.461758(%2C|,)-2\.596824/);
  assert.match(osmViewUrl(...BRISTOL), /mlat=51\.461758/);
});

test('missing or bad coordinates are detectable', () => {
  assert.equal(hasLocation(51.46, -2.59), true);
  assert.equal(hasLocation(null, -2.59), false); // Number(null) === 0
  assert.equal(hasLocation(51.46, null), false);
  assert.equal(hasLocation(undefined, undefined), false);
  assert.equal(hasLocation('', ''), false); // Number('') === 0
  assert.equal(hasLocation('nope', 1), false);
  assert.equal(hasLocation('51.46', '-2.59'), true); // numeric strings are fine
});
