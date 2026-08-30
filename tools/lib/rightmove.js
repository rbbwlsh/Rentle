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

// Pull the `window.PAGE_MODEL = {...}` object out of the page HTML.
export function extractPageModel(html) {
  // The assignment is on a single (very long) line. Match the balanced object
  // by scanning from the first `{` after the assignment.
  const marker = html.indexOf('window.PAGE_MODEL');
  if (marker === -1) return null;
  const start = html.indexOf('{', marker);
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
        const json = html.slice(start, i + 1);
        try {
          return JSON.parse(json);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
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

export function normalize(pageModel, id) {
  const p = pageModel?.propertyData;
  if (!p) throw new ListingError('Could not read this listing from Rightmove.', 502);

  // Rentals carry a `lettings` block; sales do not. Reject sales listings.
  const channel = (pageModel?.metadata?.channel || '').toUpperCase();
  const isRental =
    !!p.lettings ||
    channel === 'RES_LET' ||
    /(pcm|per week|per month|p\/w|pw)/i.test(
      `${p.prices?.primaryPrice || ''} ${p.prices?.secondaryPrice || ''}`
    );
  if (!isRental) {
    throw new ListingError(
      'This looks like a property for sale, not to rent. Paste a Rightmove ' +
        '"to rent" listing.'
    );
  }

  const status = p.status || {};
  if (status.published === false) {
    throw new ListingError('This listing is no longer available.', 410);
  }

  // Determine the monthly amount. `prices.primaryPrice` is a formatted string
  // (e.g. "£2,250 pcm"); the numeric value sits in `prices.price` /
  // `lettings.monthlyPrice` depending on the page version.
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

  // The full set of "ad" facts a property person would scan, pulled from the
  // same fields Rightmove's own listing page shows.
  const details = {
    propertyType: p.propertySubType || p.propertyType || 'Property',
    bedrooms: p.bedrooms ?? null,
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

  return {
    id: String(id),
    // Server-only locating fields (stripped from the public payload).
    displayAddress,
    outcode: p.address?.outcode || null,
    incode: p.address?.incode || null,
    latitude: p.location?.latitude ?? null,
    longitude: p.location?.longitude ?? null,
    priceAmount, // monthly £, server-side only
    priceLabel: p.prices?.primaryPrice || `£${priceAmount} pcm`,
    rightmoveUrl: `https://www.rightmove.co.uk/properties/${id}`,

    // Public, address-obscured fields.
    area: coarseArea(displayAddress, p.address?.outcode), // e.g. "South Yardley, Birmingham"
    bedrooms: p.bedrooms ?? null,
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
  return kept.join(', ') || (outcode ? `${outcode} area` : 'Location hidden');
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
export async function fetchListing(id) {
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
  return normalize(pageModel, id);
}
