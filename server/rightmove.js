// Fetches a Rightmove property page, extracts the embedded `window.PAGE_MODEL`
// JSON blob, and normalizes it into a clean listing schema.
//
// Every page at rightmove.co.uk/properties/<id> embeds the full listing as a
// JSON object assigned to `window.PAGE_MODEL`. A single server-side fetch plus
// JSON.parse gives us price, address, beds/baths, images, description, etc.
// (The fetch must run server-side: the browser is blocked by CORS and
// Rightmove's anti-bot, so the client can never read this directly.)

const BROWSER_HEADERS = {
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
function extractPageModel(html) {
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

function normalize(pageModel, id) {
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
  const sqft = sizings.find((s) => /sq.?ft/i.test(s.unit || ''));

  return {
    id: String(id),
    displayAddress: p.address?.displayAddress || 'Address hidden',
    outcode: p.address?.outcode || null,
    incode: p.address?.incode || null,
    priceAmount, // monthly £, server-side only
    priceLabel: p.prices?.primaryPrice || `£${priceAmount} pcm`,
    bedrooms: p.bedrooms ?? null,
    bathrooms: p.bathrooms ?? null,
    propertySubType: p.propertySubType || p.propertyType || 'Property',
    description: htmlToText(p.text?.description || ''),
    keyFeatures: Array.isArray(p.keyFeatures) ? p.keyFeatures : [],
    images,
    sizeSqFt: sqft ? Math.round(sqft.minimumSize || sqft.maximumSize) : null,
    latitude: p.location?.latitude ?? null,
    longitude: p.location?.longitude ?? null,
    nearestStations: Array.isArray(p.nearestStations)
      ? p.nearestStations.slice(0, 3).map((s) => ({
          name: s.name,
          miles: s.distance,
        }))
      : [],
    agent: p.customer?.branchDisplayName || p.customer?.companyName || null,
    rightmoveUrl: `https://www.rightmove.co.uk/properties/${id}`,
  };
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
    res = await fetch(url, { headers: BROWSER_HEADERS, redirect: 'follow' });
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

// Strip the answer (and other server-only fields) for the play payload.
export function publicListing(listing) {
  const { priceAmount, priceLabel, ...rest } = listing;
  return rest;
}
