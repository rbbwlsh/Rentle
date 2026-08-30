// Rightmove search client — finds to-rent listing ids around an outcode.
//
// Ported from the deal-analyser's Python client, which tracks Rightmove's
// CURRENT page shape (the old `window.jsonModel` search pages are gone):
//
//   * Every search page is a Next.js app whose full result set is embedded as
//     JSON in `<script id="__NEXT_DATA__">`. One fetch, one parse, 25 listings.
//   * Searching needs Rightmove's own numeric id for an outcode
//     (`OUTCODE^34` = AL1). The typeahead endpoint that used to resolve those
//     is blocked, but the ids are allocated in alphabetical order, so
//     `outcodeId` binary-searches the id space and reads the outcode back out
//     of the page title. ~11 requests the first time, then cached forever.
//   * Rightmove serves HTTP 200 with a generic page (no __NEXT_DATA__) when it
//     blocks a request, so "no data" is surfaced via `lastError`, never
//     swallowed.

import { fetchWithRetry } from './fetchRetry.js';
import { BROWSER_HEADERS } from './rightmove.js';

const BASE = 'https://www.rightmove.co.uk';

// The id space is alphabetical over every UK outcode; ~2,900 are allocated.
export const MAX_OUTCODE_ID = 4096;

const NEXT_DATA_RE =
  /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/;
const TITLE_OUTCODE_RE = /\bin ([A-Z]{1,2}\d[A-Z\d]?)\s*\|/;

// Rightmove mixes non-homes into residential results; none belong in the game.
export const EXCLUDED_SUBTYPES = [
  'hotel', 'retirement', 'park home', 'houseboat', 'land', 'garage',
  'parking', 'block of apartments', 'commercial', 'mobile home',
];

export function extractNextData(html) {
  const m = NEXT_DATA_RE.exec(html || '');
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Factory so the seed CLI shares one politeness clock and one disk cache, and
// tests can inject a fake fetch and a no-op sleep.
export function createSearchClient({
  cache,
  fetchImpl = fetchWithRetry,
  sleep = defaultSleep,
  delayMs = 1100,
} = {}) {
  const client = { lastError: '' };

  // Fetch a page and return { data, html }, sleeping afterwards (success or
  // failure) so every Rightmove request is throttled. Throws on network
  // failure or a non-200 so callers can tell "bad request" from "no data".
  async function fetchPage(path, params) {
    const url = `${BASE}/${path}?${new URLSearchParams(params)}`;
    let res;
    try {
      res = await fetchImpl(url, { headers: BROWSER_HEADERS, redirect: 'follow' });
    } catch (err) {
      client.lastError = `Rightmove unreachable: ${err.message}`;
      throw new Error(client.lastError);
    } finally {
      await sleep(delayMs + Math.random() * 400);
    }
    if (res.status !== 200) {
      client.lastError = `Rightmove returned HTTP ${res.status}`;
      throw new Error(client.lastError);
    }
    const html = await res.text();
    return { data: extractNextData(html), html };
  }

  async function nextData(path, params) {
    let page;
    try {
      page = await fetchPage(path, params);
    } catch {
      return null;
    }
    if (!page.data) {
      // A generic error page with no __NEXT_DATA__ — usually a bad
      // locationIdentifier or Rightmove blocking this network, both HTTP 200.
      client.lastError =
        'Rightmove served a page with no listing data (blocked or bad location)';
      return null;
    }
    client.lastError = '';
    return page.data;
  }

  // The outcode name at a numeric id, read from the page title. The id space
  // has HOLES — deallocated ids serve a recognisable "couldn't find the
  // place" page — which are a real, cacheable null. Anything else that fails
  // to parse (blocked network, transient error) throws instead, so a bad run
  // never poisons the cache. Real lookups are cached forever.
  async function outcodeAt(oid) {
    const key = `outcode_at:${oid}`;
    if (cache?.has(key)) return cache.get(key);
    const { data, html } = await fetchPage('property-for-sale/find.html', {
      locationIdentifier: `OUTCODE^${oid}`,
      radius: '0.0',
    });
    const title = data?.props?.pageProps?.headMetaData?.title || '';
    const m = TITLE_OUTCODE_RE.exec(title);
    const name = m ? m[1] : null;
    if (name == null && !data && !/find the place you were looking for/i.test(html)) {
      client.lastError =
        'Rightmove served a page with no listing data (blocked or bad location)';
      throw new Error(client.lastError);
    }
    cache?.set(key, name);
    return name;
  }

  // The outcode at the first allocated id >= i (scanning past a short run of
  // holes). Monotone non-decreasing in i, which is what the binary search
  // needs. Returns null when everything in the window is a hole — treated as
  // past the end of the allocated range.
  async function nameAtOrAbove(i, maxScan = 8) {
    for (let q = i; q < i + maxScan && q <= MAX_OUTCODE_ID; q++) {
      const name = await outcodeAt(q);
      if (name != null) return { q, name };
    }
    return null;
  }

  // Rightmove's numeric id for an outcode, e.g. "AL1" -> 34. Ids are
  // allocated in string-alphabetical order (EH16 < EH2 < EH3 < EH30), so
  // binary search over the id space, reading names back from page titles.
  async function outcodeId(outcode) {
    const target = String(outcode || '').toUpperCase().trim();
    if (!target) return null;
    const key = `outcode:${target}`;
    if (cache?.has(key)) return cache.get(key);

    let lo = 1;
    let hi = MAX_OUTCODE_ID;
    let found = null;
    try {
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const res = await nameAtOrAbove(mid);
        if (res == null || res.name > target) {
          hi = mid - 1;
          continue;
        }
        if (res.name === target) {
          found = res.q;
          break;
        }
        lo = res.q + 1;
      }
    } catch (err) {
      // Probe failed (blocked/transient): report, and cache nothing so a
      // later run can retry.
      client.lastError = `could not resolve outcode ${target}: ${err.message}`;
      return null;
    }

    cache?.set(key, found);
    if (found == null) {
      client.lastError = `could not resolve Rightmove's id for outcode ${target}`;
    }
    return found;
  }

  // One page of to-rent results around an outcode id. `page` is 0-based, 25
  // results per page, newest first.
  async function searchRent(oid, { page = 0, includeLetAgreed = false } = {}) {
    const data = await nextData('property-to-rent/find.html', {
      locationIdentifier: `OUTCODE^${oid}`,
      radius: '0.0',
      sortType: '6',
      index: String(page * 25),
      includeLetAgreed: includeLetAgreed ? 'true' : 'false',
    });
    if (!data) return null;
    const results = data.props?.pageProps?.searchResults || {};
    // resultCount arrives as a string ("206"), sometimes with a comma.
    const total = Number(String(results.resultCount ?? '0').replace(/,/g, '')) || 0;
    return {
      properties: Array.isArray(results.properties) ? results.properties : [],
      resultCount: total,
    };
  }

  client.outcodeAt = outcodeAt;
  client.outcodeId = outcodeId;
  client.searchRent = searchRent;
  client.nextData = nextData;
  return client;
}

// Whether a search result looks like an ordinary rentable home.
export function isGameableProperty(prop) {
  const subtype = String(prop?.propertySubType || '').toLowerCase();
  if (EXCLUDED_SUBTYPES.some((word) => subtype.includes(word))) return false;
  return Boolean(prop?.id);
}
