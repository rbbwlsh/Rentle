// Fetches a Rightmove property page, extracts the embedded `window.PAGE_MODEL`
// JSON blob, and normalizes it into a clean listing schema.
//
// Every page at rightmove.co.uk/properties/<id> embeds the full listing as a
// JSON object assigned to `window.PAGE_MODEL`. A single fetch plus JSON.parse
// gives us price, address, beds/baths, images, description, etc. (The fetch
// cannot run in a browser: CORS and Rightmove's anti-bot block it, which is
// why the corpus is scraped ahead of time by tools/seed.js.)

import { fetchWithRetry } from './fetchRetry.js';

export const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-GB,en;q=0.9',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
};

// A user-facing error with an HTTP status the API layer can reuse.
export class ListingError extends Error {
  constructor(message, status = 422) {
    super(message);
    this.name = 'ListingError';
    this.status = status;
  }
}

// Accept a full Rightmove property URL or a bare numeric id, and return the id.
export function parseRightmoveUrl(input) {
  if (input == null) throw new ListingError('Please provide a Rightmove link.');
  const raw = String(input).trim();
  if (!raw) throw new ListingError('Please provide a Rightmove link.');

  // Bare numeric id.
  if (/^\d{4,}$/.test(raw)) return raw;

  // .../properties/12345678  (optionally with trailing path/query/hash)
  const propMatch = raw.match(/rightmove\.co\.uk\/properties\/(\d{4,})/i);
  if (propMatch) return propMatch[1];

  // Legacy .../property-to-rent/property-12345678.html style.
  const legacyMatch = raw.match(/property-(\d{4,})\.html/i);
  if (legacyMatch) return legacyMatch[1];

  throw new ListingError(
    "That doesn't look like a Rightmove listing link. Paste a URL like " +
      'https://www.rightmove.co.uk/properties/123456789'
  );
}

// Pull the page model out of the page HTML. Two formats exist:
//   * legacy: `window.PAGE_MODEL = {...plain JSON...}`
//   * current: `window.__PAGE_MODEL = {"data": "<flattened>", "encoding": ...}`
//     where `data` is a devalue-style flat array — index 0 is the root, object
//     values and array elements are indices into the array — that needs
//     hydrating back into the same shape the legacy pages carried.
export function extractPageModel(html) {
  const plain = scanObject(html, 'window.PAGE_MODEL');
  if (plain?.propertyData) return plain;

  const wrapped = scanObject(html, 'window.__PAGE_MODEL');
  if (wrapped) {
    try {
      const flat =
        typeof wrapped.data === 'string' ? JSON.parse(wrapped.data) : wrapped.data;
      if (Array.isArray(flat) && flat.length) {
        const model = hydrateFlat(0, flat, new Map());
        if (model?.propertyData) return model;
      }
    } catch {
      return null;
    }
  }
  return null;
}

// Find `marker` and parse the balanced `{...}` object that follows it. The
// assignment is on a single (very long) line, so the object is matched by
// scanning braces (string- and escape-aware) from the first `{`.
function scanObject(html, marker) {
  const at = html.indexOf(marker);
  if (at === -1) return null;
  const start = html.indexOf('{', at);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

// Rebuild a value from a devalue-style flat array. Primitives are stored as
// literal nodes; objects map keys to indices; arrays hold indices (a string
// first element marks a tagged special type, e.g. ["Date", <index>]).
// Negative indices encode literals that JSON can't: undefined, NaN, ±Infinity.
function hydrateFlat(index, flat, cache) {
  if (index === -1) return undefined;
  if (index === -3) return NaN;
  if (index === -4) return Infinity;
  if (index === -5) return -Infinity;
  if (index === -6) return -0;
  if (cache.has(index)) return cache.get(index);

  const node = flat[index];
  if (node === null || typeof node !== 'object') {
    cache.set(index, node);
    return node;
  }
  if (Array.isArray(node)) {
    if (typeof node[0] === 'string') {
      // Tagged type. Dates matter (letAvailableDate); anything else keeps its
      // payload values so normalize() can still read what it needs.
      if (node[0] === 'Date') return new Date(flat[node[1]] ?? node[1]);
      const out = node.slice(1).map((i) => hydrateFlat(i, flat, cache));
      cache.set(index, out);
      return out;
    }
    const out = [];
    cache.set(index, out);
    for (const i of node) out.push(hydrateFlat(i, flat, cache));
    return out;
  }
  const out = {};
  cache.set(index, out);
  for (const [key, i] of Object.entries(node)) out[key] = hydrateFlat(i, flat, cache);
  return out;
}

// Strip HTML tags/entities from Rightmove's description into readable text.
function htmlToText(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&pound;/g, '£')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Convert a Rightmove price into a monthly (pcm) amount.
function toMonthly(amount, frequency) {
  if (!amount) return null;
  const freq = String(frequency || '').toLowerCase();
  if (freq.includes('week')) return Math.round((amount * 52) / 12);
  if (freq.includes('year') || freq.includes('annum'))
    return Math.round(amount / 12);
  if (freq.includes('day')) return Math.round((amount * 365) / 12);
  // Default: already monthly.
  return Math.round(amount);
}

// A generous UK bounding box, from the Scilly/Channel approaches up to
// Shetland. Rightmove occasionally serves a listing with a foreign geocode —
// a real "Lower Canal Walk, Southampton, Hampshire" came back at 36.84,
// -76.02, which is Southampton, VIRGINIA. One of those drags a whole town's
// map centroid into the Atlantic, drops the in-game pin on the wrong
// continent, and makes every comparable distance a four-figure number.
const UK_BOUNDS = { minLat: 49.5, maxLat: 61.0, minLon: -8.7, maxLon: 2.0 };

export function inUnitedKingdom(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  return (
    lat >= UK_BOUNDS.minLat &&
    lat <= UK_BOUNDS.maxLat &&
    lon >= UK_BOUNDS.minLon &&
    lon <= UK_BOUNDS.maxLon
  );
}

// Sale prices outside this band aren't a fair guess: below it are parking
// spaces, timeshares and lease-extension lots; above it the slider stops being
// usable and the round becomes a coin flip on a trophy asset.
export const BUY_MIN_PRICE = 25000;
export const BUY_MAX_PRICE = 2000000;

const channelOf = (pageModel, p) =>
  String(pageModel?.metadata?.channel || p?.channel || '').toUpperCase();

// Which channel a page is on. The explicit channel is authoritative when
// present; the price-string sniff is the fallback for older page shapes.
function isRentalModel(pageModel, p) {
  const channel = channelOf(pageModel, p);
  if (channel === 'RES_LET') return true;
  if (channel === 'RES_BUY') return false;
  return (
    !!p.lettings ||
    /(pcm|per week|per month|p\/w|pw)/i.test(
      `${p.prices?.primaryPrice || ''} ${p.prices?.secondaryPrice || ''}`
    )
  );
}

// Whether the address slot holds an actual address. Investment and
// development ads on the sale channel put marketing copy there instead
// ("Fully Furnished Homes in Manchester City Centre", "Fully Managed
// Manchester Buy to Let - 6% Rental Yields | ..."), and those make terrible
// rounds: no street, no tenure, no floor area, and the "property" is a unit
// type rather than one specific home. A real ad address is comma-separated,
// or at minimum carries its own outcode.
export function looksLikeAddress(displayAddress, outcode) {
  const a = String(displayAddress || '').trim();
  if (!a) return false;
  if (a.includes('|')) return false;
  if (/\d+\s*%|yields?\b|buy to let|investment opportunity|per annum/i.test(a)) {
    return false;
  }
  if (a.includes(',')) return true;
  return Boolean(outcode) && a.toUpperCase().includes(String(outcode).toUpperCase());
}

// Sale listings whose headline number isn't an asking price anyone could
// guess. `dontShow` filters most of these at search time, but a live studio
// search still returned an auction lot with the filter applied, so each one is
// re-checked here against the detail page.
function assertGameableSale(p) {
  const label = `${p.prices?.primaryPrice || ''} ${p.prices?.displayPriceQualifier || ''}`;
  if (p.sharedOwnership?.sharedOwnershipFlag) {
    throw new ListingError('Shared ownership — the headline price is for a part share.');
  }
  if (p.affordableBuyingScheme) {
    throw new ListingError('Affordable-buying scheme — the headline price is discounted.');
  }
  if (p.commercial || p.businessForSale) {
    throw new ListingError('Commercial listing, not a home.');
  }
  if (p.auction || /auction/i.test(label)) {
    throw new ListingError('Auction lot — a guide price is not an asking price.');
  }
}

// The asking price. Sale detail pages carry NO numeric `prices.price` (only
// the search rows do), so the formatted `primaryPrice` string is the source of
// truth. A price RANGE ("£250,000 - £275,000") concatenates into a number far
// outside the band and is rejected there, which is the outcome we want.
function salePrice(p) {
  const label = String(p.prices?.primaryPrice || '').trim();
  const qualifier = cleanStr(p.prices?.displayPriceQualifier);
  if (/price on application|\bpoa\b/i.test(`${label} ${qualifier || ''}`)) {
    throw new ListingError('No asking price on this listing (POA).');
  }
  const amount = p.prices?.price ?? parsePriceString(label);
  if (!amount) {
    throw new ListingError('Could not determine the asking price for this listing.', 502);
  }
  if (amount < BUY_MIN_PRICE || amount > BUY_MAX_PRICE) {
    throw new ListingError(`Asking price £${amount} is outside the playable range.`);
  }
  return { priceAmount: Math.round(amount), priceLabel: label || `£${amount}`, qualifier };
}

// The monthly rent, normalised from whatever frequency the ad quotes.
function rentPrice(p) {
  const rawAmount =
    p.lettings?.monthlyPrice ??
    p.prices?.price ??
    parsePriceString(p.prices?.primaryPrice);
  const frequency =
    p.lettings?.monthlyPrice != null
      ? 'monthly'
      : p.prices?.frequency || inferFrequency(p.prices?.primaryPrice);
  const priceAmount = toMonthly(rawAmount, frequency);
  if (!priceAmount) {
    throw new ListingError('Could not determine the rent for this listing.', 502);
  }
  return { priceAmount, priceLabel: p.prices?.primaryPrice || `£${priceAmount} pcm`, qualifier: null };
}

// `mode` picks the channel to accept ('rent' | 'buy'). `bedsHint` is the
// bedroom count the search stratum was filtered on: sale detail pages
// sometimes report `bedrooms: null` for a studio the search knew was 0-bed,
// and the buy corpus is stratified by bedroom count, so the hint stands in.
export function normalize(pageModel, id, { mode = 'rent', bedsHint = null } = {}) {
  const p = pageModel?.propertyData;
  if (!p) throw new ListingError('Could not read this listing from Rightmove.', 502);

  const rental = isRentalModel(pageModel, p);
  if (mode === 'rent' && !rental) {
    throw new ListingError(
      'This looks like a property for sale, not to rent. Paste a Rightmove ' +
        '"to rent" listing.'
    );
  }
  if (mode === 'buy' && rental) {
    throw new ListingError(
      'This looks like a rental listing, not a property for sale.'
    );
  }

  const status = p.status || {};
  if (status.published === false) {
    throw new ListingError('This listing is no longer available.', 410);
  }

  if (mode === 'buy') {
    assertGameableSale(p);
    if (!looksLikeAddress(p.address?.displayAddress, p.address?.outcode)) {
      throw new ListingError(
        'Marketing copy in place of an address — a development or buy-to-let ' +
          'pitch, not one specific home.'
      );
    }
  }
  const { priceAmount, priceLabel, qualifier } = mode === 'buy' ? salePrice(p) : rentPrice(p);

  const images = Array.isArray(p.images)
    ? p.images.map((img) => img.url).filter(Boolean)
    : [];

  const sizings = Array.isArray(p.sizings) ? p.sizings : [];
  const sqftEntry = sizings.find((s) => /sq.?ft/i.test(s.unit || ''));
  const sqmEntry = sizings.find((s) => /sq.?m|m²/i.test(s.unit || ''));
  const sizeSqFt = sqftEntry
    ? Math.round(sqftEntry.maximumSize || sqftEntry.minimumSize)
    : sqmEntry
      ? Math.round((sqmEntry.maximumSize || sqmEntry.minimumSize) * 10.7639)
      : null;
  const sizeSqM = sqmEntry
    ? Math.round(sqmEntry.maximumSize || sqmEntry.minimumSize)
    : sizeSqFt
      ? Math.round(sizeSqFt / 10.7639)
      : null;

  const lettings = p.lettings || {};
  const livingCosts = p.livingCosts || {};
  const tenure = p.tenure || {};
  const bedrooms = p.bedrooms ?? (mode === 'buy' ? bedsHint : null);

  // The full set of "ad" facts a property person would scan, pulled from the
  // same fields Rightmove's own listing page shows. The two channels publish
  // genuinely different facts: a sale has tenure and a service charge where a
  // let has furnishing and a deposit.
  //
  // `prices.pricePerSqFt` is deliberately NOT carried on the buy side — with
  // the floor area already on the card it multiplies straight back into the
  // answer.
  const details =
    mode === 'buy'
      ? {
          propertyType: p.propertySubType || p.propertyType || 'Property',
          bedrooms,
          bathrooms: p.bathrooms ?? null,
          sizeSqFt,
          sizeSqM,
          tenureType: cleanStr(tenure.tenureType),
          yearsRemainingOnLease: Number.isFinite(tenure.yearsRemainingOnLease)
            ? tenure.yearsRemainingOnLease
            : null,
          annualGroundRent: Number.isFinite(livingCosts.annualGroundRent)
            ? livingCosts.annualGroundRent
            : null,
          annualServiceCharge: Number.isFinite(livingCosts.annualServiceCharge)
            ? livingCosts.annualServiceCharge
            : null,
          councilTaxBand: cleanStr(livingCosts.councilTaxBand),
          priceQualifier: qualifier,
          listingUpdate: cleanStr(p.listingHistory?.listingUpdateReason),
        }
      : {
          propertyType: p.propertySubType || p.propertyType || 'Property',
          bedrooms,
          bathrooms: p.bathrooms ?? null,
          sizeSqFt,
          sizeSqM,
          letType: cleanStr(lettings.letType),
          furnishType: cleanStr(lettings.furnishType),
          letAvailableDate: cleanStr(lettings.letAvailableDate),
          deposit: Number.isFinite(lettings.deposit) ? lettings.deposit : null,
          minimumTermMonths: Number.isFinite(lettings.minimumTermInMonths)
            ? lettings.minimumTermInMonths
            : null,
          councilTaxBand: cleanStr(livingCosts.councilTaxBand),
        };

  const displayAddress = p.address?.displayAddress || '';
  const latitude = p.location?.latitude ?? null;
  const longitude = p.location?.longitude ?? null;
  // Located listings only. The map pin is a first-class clue and the
  // comparables are ranked by real distance, so a listing we cannot place is
  // not a playable round — and a foreign geocode is worse than none.
  if (latitude != null && longitude != null && !inUnitedKingdom(latitude, longitude)) {
    throw new ListingError(
      `Coordinates ${latitude}, ${longitude} are outside the UK — bad geocode.`
    );
  }

  return {
    id: String(id),
    mode,
    // Server-only locating fields (stripped from the public payload).
    displayAddress,
    outcode: p.address?.outcode || null,
    incode: p.address?.incode || null,
    latitude,
    longitude,
    priceAmount, // monthly £ (rent) or asking price £ (buy), server-side only
    priceLabel,
    rightmoveUrl: `https://www.rightmove.co.uk/properties/${id}`,

    // Public, address-obscured fields.
    area: coarseArea(displayAddress, p.address?.outcode), // e.g. "South Yardley, Birmingham"
    bedrooms,
    bathrooms: p.bathrooms ?? null,
    propertySubType: details.propertyType,
    details,
    sizeSqFt,
    sizeSqM,
    description: htmlToText(p.text?.description || ''),
    keyFeatures: Array.isArray(p.keyFeatures) ? p.keyFeatures : [],
    tags: Array.isArray(p.tags) ? p.tags.filter(Boolean) : [],
    images,
    imageCount: images.length,
    nearestStations: Array.isArray(p.nearestStations)
      ? p.nearestStations.slice(0, 4).map((s) => ({
          name: s.name,
          miles: s.distance,
          types: Array.isArray(s.types) ? s.types : [],
        }))
      : [],
    agent: p.customer?.branchDisplayName || p.customer?.companyName || null,
  };
}

function cleanStr(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s && s.toLowerCase() !== 'ask agent' ? s : s || null;
}

// Reduce a full Rightmove address to a neighbourhood-level label so the exact
// property can't be googled straight away. Drops house/flat numbers, the
// street, and the postcode — keeping the locality + town (e.g.
// "Church Road, South Yardley, Birmingham, B25" -> "South Yardley, Birmingham").
export function coarseArea(displayAddress, outcode) {
  if (!displayAddress) return outcode ? `${outcode} area` : 'Location hidden';
  const postcode = /\b[A-Z]{1,2}\d[A-Z\d]?(?:\s*\d[A-Z]{2})?\b/i;
  const street =
    /\b(road|rd|street|st|lane|ln|avenue|ave|close|cl|drive|dr|way|court|ct|crescent|cres|place|pl|terrace|tce|grove|gardens|gdns|walk|row|hill|mews|square|sq|parade|rise|view|gate|green|wharf|quay|boulevard|broadway|approach|vale|fields?|meadow|chase|copse|spinney)\b/i;
  const unit = /^(flat|apartment|apt|unit|room|studio|penthouse|plot|no\.?|\d+[a-z]?)\b/i;

  const parts = displayAddress
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  let kept = parts.filter((p) => !street.test(p) && !postcode.test(p) && !unit.test(p));
  if (kept.length === 0) kept = parts.filter((p) => !postcode.test(p)).slice(-1);
  // Keep the last two surviving parts (locality, town).
  kept = kept.slice(-2);
  const label = kept.join(', ');
  // Sale ads sometimes put marketing copy in the address slot ("Fully
  // Furnished Homes in Manchester City Centre"). A long, comma-free result is
  // that, not a place — fall back to the outcode rather than print the pitch.
  if (!label || (!label.includes(',') && label.length > 40)) {
    return outcode ? `${outcode} area` : 'Location hidden';
  }
  return label;
}

function parsePriceString(str) {
  if (!str) return null;
  const digits = String(str).replace(/[^\d]/g, '');
  return digits ? Number(digits) : null;
}

function inferFrequency(str) {
  const s = String(str || '').toLowerCase();
  if (s.includes('pw') || s.includes('week')) return 'weekly';
  return 'monthly';
}

// Fetch + parse a single listing by id. Throws ListingError on any failure.
export async function fetchListing(id, opts = {}) {
  const url = `https://www.rightmove.co.uk/properties/${id}`;
  let res;
  try {
    res = await fetchWithRetry(url, { headers: BROWSER_HEADERS, redirect: 'follow' });
  } catch (err) {
    throw new ListingError(
      `Could not reach Rightmove (${err.message}). Check your connection.`,
      502
    );
  }

  if (res.status === 404 || res.status === 410) {
    throw new ListingError('That listing could not be found on Rightmove.', 404);
  }
  if (!res.ok) {
    throw new ListingError(
      `Rightmove returned an error (HTTP ${res.status}). It may be blocking ` +
        'automated requests from this network.',
      502
    );
  }

  const html = await res.text();
  const pageModel = extractPageModel(html);
  if (!pageModel) {
    throw new ListingError(
      'Could not parse this Rightmove page. The listing may have been removed.',
      502
    );
  }
  return normalize(pageModel, id, opts);
}
