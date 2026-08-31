// The city map's geometry. A wrong projection doesn't throw — it just puts
// pins in the sea — so the shape is asserted rather than eyeballed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  project,
  COASTLINE,
  COAST_PATH,
  VIEW_W,
  VIEW_H,
} from '../client/src/engine/ukmap.js';

// The six cities the corpus covers, at their real centroids.
const CITIES = {
  London: [-0.115, 51.519],
  Bristol: [-2.603, 51.455],
  Birmingham: [-1.912, 52.475],
  Manchester: [-2.232, 53.46],
  Leeds: [-1.541, 53.81],
  Edinburgh: [-3.197, 55.95],
};

// Ray casting over the projected outline.
function inside([px, py], polygon) {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      hit = !hit;
    }
  }
  return hit;
}

test('the projection is upright: north is up and east is right', () => {
  const [, yEdinburgh] = project(...CITIES.Edinburgh);
  const [, yLeeds] = project(...CITIES.Leeds);
  const [, yLondon] = project(...CITIES.London);
  assert.ok(yEdinburgh < yLeeds, 'Edinburgh should sit above Leeds');
  assert.ok(yLeeds < yLondon, 'Leeds should sit above London');

  const [xBristol] = project(...CITIES.Bristol);
  const [xLondon] = project(...CITIES.London);
  assert.ok(xBristol < xLondon, 'Bristol should sit west of London');
});

test('every city pin lands on land, inside the viewBox', () => {
  const outline = COASTLINE.map(([lon, lat]) => project(lon, lat));
  for (const [name, coords] of Object.entries(CITIES)) {
    const [x, y] = project(...coords);
    assert.ok(x >= 0 && x <= VIEW_W, `${name} is off the map horizontally`);
    assert.ok(y >= 0 && y <= VIEW_H, `${name} is off the map vertically`);
    assert.ok(inside([x, y], outline), `${name} pin fell in the sea`);
  }
});

test('the coastline renders as one closed path within the viewBox', () => {
  assert.match(COAST_PATH, /^M[\d.]+ [\d.]+/);
  assert.match(COAST_PATH, /Z$/);
  const nums = COAST_PATH.match(/-?\d+\.\d+/g).map(Number);
  assert.ok(nums.length >= COASTLINE.length * 2);
  assert.ok(Math.min(...nums) >= 0, 'the outline must not spill outside the viewBox');

  // Aspect ratio: Great Britain is markedly taller than it is wide.
  assert.ok(VIEW_H > VIEW_W * 1.5);
});
