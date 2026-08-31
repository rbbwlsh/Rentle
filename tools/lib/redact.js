// Strips rent-revealing text out of listing copy at build time.
//
// The ad body is scraped verbatim, and letting agents put the answer right in
// it: "RENT - £1,100.00 PCM", "£102pppw including bills", "Deposit: equivalent
// to five weeks' rent". A deposit is the loudest tell of all — it's almost
// always five weeks' rent, so a player can divide it back out — which is why
// any mention of one goes, not just the number beside it.
//
// The scrub runs over data/corpus (raw, untouched on disk) on its way into
// client/public/data, so the shipped payload never carries the giveaway even
// for someone reading the network tab.
//
// Granularity is the sentence, line or bullet: a segment that reveals a price
// is dropped whole, because half a redacted clause ("Rent is …") still tells
// the player what was there. Prose that says nothing about money survives
// untouched.

// A price marker in a rental ad is always money, so one alone is disqualifying.
const REVEALS = [
  /£/,
  /\bgbp\b/i,
  // Rate units, which agents jam straight onto the figure ("£102pppw",
  // "GBP161.50pppw") — so allow a digit where a word boundary would be, while
  // still refusing to match inside a word like "spa".
  /(?<![a-z])(?:pcm|pppw|ppw|pw|pa)\b/i,
  /\bper\s+(?:calendar\s+month|month|week|annum)\b/i,
  // Deposits in every guise: the "no deposit needed!" pitches that still quote
  // the traditional five weeks as their comparison, and the deposit-scheme
  // boilerplate ("depositprotection.com") — hence no word boundaries.
  /deposit/i,
  /\bholding\s+(?:fee|deposit|sum)\b/i,
  /\b(?:zero|nil|no)[-\s]deposit\b/i,
  // "five weeks' rent", "one month's rent", "6 weeks rent".
  /\b(?:\d+|a|one|two|three|four|five|six|seven|eight|nine|ten)\s*[-–]?\s*(?:weeks?|months?)[’']?s?\s+rent\b/i,
  // A figure quoted straight off a rent label: "Rent 1100", "Monthly rent:
  // 1,600". The number has to sit on the label, so a build-to-rent block of
  // 374 apartments and 150mb broadband "included in your rent" both survive.
  /(?<!\bto[- ])\b(?:weekly|monthly|asking|advance|current)?\s*rent(?:al)?\s*(?:amount|price|of|is|from|:|=|-|–)*\s*£?\d[\d,]{2,6}/i,
];

// Does this fragment give away (or let you back out) the rent?
export function revealsPrice(text) {
  const s = String(text ?? '');
  return REVEALS.some((re) => re.test(s));
}

// Sentence, line and bullet boundaries. Kept in the split output so surviving
// text rejoins exactly as it was written.
const SEGMENT = /(\r?\n+|\s*\|\s*|(?<=[.!?…])\s+)/;

// Free text with every price-revealing segment removed.
//
// Each segment is joined by the delimiter that PRECEDES it, and the first
// survivor drops its own — so removing the last cell of a pipe-separated line
// ("Council Tax Band: D | Holding Deposit: £357.69") takes the separator with
// it rather than leaving a dangling "D |" that advertises the redaction.
export function redactText(text) {
  if (text == null) return text;
  const parts = String(text).split(SEGMENT);
  let out = '';
  let first = true;
  for (let i = 0; i < parts.length; i += 2) {
    const segment = parts[i];
    const before = i === 0 ? '' : (parts[i - 1] ?? '');
    if (revealsPrice(segment)) continue;
    out += (first ? '' : before) + segment;
    first = false;
  }
  return out
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Bullets are atomic: a feature that mentions money is dropped, not trimmed.
export function redactList(items) {
  if (!Array.isArray(items)) return items;
  return items.filter((item) => !revealsPrice(item));
}

// A corpus listing with its player-visible copy scrubbed and the deposit
// dropped from the ad facts. Everything else passes through untouched.
export function redactListing(listing) {
  const { deposit, ...details } = listing.details || {};
  return {
    ...listing,
    details,
    description: redactText(listing.description),
    keyFeatures: redactList(listing.keyFeatures),
    tags: redactList(listing.tags),
  };
}
