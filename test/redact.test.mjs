// Unit tests for the copy scrubber: the shipped ad text must never quote a
// figure a player could work the rent back out of — a deposit above all, which
// is near-universally five weeks' rent — while ordinary prose survives intact.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactText, redactList, redactListing, revealsPrice } from '../tools/lib/redact.js';

test('price-revealing fragments are recognised in every guise agents write them', () => {
  for (const s of [
    'RENT - £1,100.00 PCM',
    'Available Now. £102pppw including bills',
    '| GBP161.50pppw | 1 Room in STUDENT HOUSE SHARE |',
    'Deposit: Equivalent to 5 weeks’ rent',
    'DEPOSIT - 900',
    'A holding fee is payable on application',
    'This property comes with a Zero Deposit option',
    'Custodial terms and conditions | DPS (depositprotection.com)',
    'Monthly rent: 1,600',
    'Bills are 150 per calendar month on top',
  ]) {
    assert.equal(revealsPrice(s), true, s);
  }
});

test('prose that says nothing about money is left alone', () => {
  for (const s of [
    'Three double bedrooms and one bathroom.',
    'Bristol’s newest build-to-rent community — 374 contemporary apartments',
    '150mb high-speed WiFi - included in your rent',
    'Council Tax band: D',
    'The spa and residents’ lounge are on the ground floor.',
    'Situated on the 19th floor of a modern development.',
  ]) {
    assert.equal(revealsPrice(s), false, s);
  }
});

test('only the offending sentence or line goes, and the rest reads normally', () => {
  const before =
    'Upstairs there are 3 double bedrooms.\n\nRENT - £1,100.00 PCM\n\nDEPOSIT - £900\n\nAvailable Immediately.';
  assert.equal(
    redactText(before),
    'Upstairs there are 3 double bedrooms.\n\nAvailable Immediately.'
  );

  // Mid-paragraph, the surrounding sentences survive untouched.
  assert.equal(
    redactText('A bright flat. The rent is £1,200 pcm. Viewings this week.'),
    'A bright flat. Viewings this week.'
  );

  // Untouched copy comes back byte-identical, and empty stays empty.
  const clean = 'A delightful maisonette in the heart of Kingsdown.\n\nTwo floors.';
  assert.equal(redactText(clean), clean);
  assert.equal(redactText(''), '');
  assert.equal(redactText(null), null);
});

test('a bullet that mentions money is dropped whole, not trimmed', () => {
  assert.deepEqual(
    redactList(['Garden', '£217 pppw inc bills', 'Close to amenities', 'Deposit free option']),
    ['Garden', 'Close to amenities']
  );
});

test('redactListing scrubs the copy and drops the deposit from the ad facts', () => {
  const out = redactListing({
    id: '1',
    bedrooms: 3,
    details: { propertyType: 'Flat', deposit: 1609, councilTaxBand: 'C' },
    description: 'Lovely home. Deposit: £1,609.',
    keyFeatures: ['Garden', 'Rent £1,395 pcm'],
    tags: ['Deposit free'],
  });
  assert.equal('deposit' in out.details, false);
  assert.deepEqual(out.details, { propertyType: 'Flat', councilTaxBand: 'C' });
  assert.equal(out.description, 'Lovely home.');
  assert.deepEqual(out.keyFeatures, ['Garden']);
  assert.deepEqual(out.tags, []);
  // Untouched fields pass straight through.
  assert.equal(out.bedrooms, 3);
});

test('removing a cell takes its separator with it — no dangling "D |"', () => {
  assert.equal(
    redactText('Council Tax Band: D | Holding Deposit: £357.69 | Deposit: £1788.00'),
    'Council Tax Band: D'
  );
  // A leading separator on a surviving line goes too.
  assert.equal(redactText('Rent: £1,200 pcm\nLovely flat.'), 'Lovely flat.');
  // The agent's own pipe-wrapped headline is untouched when nothing offends.
  const headline = '| 2 Double Bedroom | Allocated Parking | Furnished |';
  assert.equal(redactText(headline), headline);
});

test('sale ads name the price in their own idiom, with or without a £', () => {
  // The bare £ rule covers most sale copy; these are the phrasings that give
  // the asking price away without one.
  for (const line of [
    'Guide Price 425,000 for this superb family home.',
    'Offers in excess of 300,000 invited.',
    'OIRO 250,000 — no onward chain.',
    'Asking price 189,950, ready to move into.',
  ]) {
    assert.equal(revealsPrice(line), true, `should reveal: ${line}`);
  }
  // And the ordinary sale sentence that mentions no money survives.
  assert.equal(
    revealsPrice('A three-bedroom semi with a south-facing garden and no chain.'),
    false
  );
});

test('a sale description keeps its prose and loses only the price sentence', () => {
  const text =
    'A beautifully presented two-bedroom apartment. Guide Price £340,000. ' +
    'The living room opens onto a private balcony.';
  const out = redactText(text);
  assert.ok(out.includes('beautifully presented'));
  assert.ok(out.includes('private balcony'));
  assert.ok(!out.includes('340,000'));
  assert.ok(!/guide price/i.test(out));
});
