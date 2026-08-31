import { useState } from 'react';
import ImageCarousel from './ImageCarousel.jsx';
import PropertyMap from './PropertyMap.jsx';
import { formatGbp, formatMiles, formatStationType } from '../format.js';

// Displays the listing the player is guessing on with as much detail as a real
// Rightmove ad — except the price and the exact address are withheld (only an
// obscured `area` is shown), so it can't be looked up mid-game.
export default function ListingCard({ mode, listing }) {
  const [expanded, setExpanded] = useState(false);
  const d = listing.details || {};

  const headlineChips = [
    listing.bedrooms != null &&
      (listing.bedrooms === 0 ? 'Studio' : `${listing.bedrooms} bed`),
    listing.bathrooms != null && `${listing.bathrooms} bath`,
    listing.propertySubType,
    listing.sizeSqFt && `${listing.sizeSqFt.toLocaleString()} sq ft`,
  ].filter(Boolean);

  const sizeStr = listing.sizeSqFt
    ? `${listing.sizeSqFt.toLocaleString()} sq ft${
        listing.sizeSqM ? ` (${listing.sizeSqM} m²)` : ''
      }`
    : null;

  // The Rightmove "ad facts" table — only rows with a value are shown. The two
  // channels publish genuinely different facts, so the table follows the mode:
  // a sale has tenure and a service charge where a let has furnishing and a
  // tenancy length.
  const shared = [
    ['Property type', d.propertyType],
    ['Bedrooms', listing.bedrooms === 0 ? 'Studio' : listing.bedrooms],
    ['Bathrooms', listing.bathrooms],
    ['Size', sizeStr],
  ];
  const facts = [
    ...shared,
    ...(mode.key === 'buy'
      ? [
          ['Tenure', formatTenure(d.tenureType)],
          [
            'Lease remaining',
            d.yearsRemainingOnLease ? `${d.yearsRemainingOnLease} years` : null,
          ],
          [
            'Service charge',
            d.annualServiceCharge ? `${formatGbp(d.annualServiceCharge)} a year` : null,
          ],
          [
            'Ground rent',
            d.annualGroundRent ? `${formatGbp(d.annualGroundRent)} a year` : null,
          ],
          ['Council tax', d.councilTaxBand ? `Band ${d.councilTaxBand}` : null],
          // The qualifier says how the price is pitched, never what it is.
          ['Price basis', d.priceQualifier],
          ['On the market', d.listingUpdate],
        ]
      : [
          ['Furnishing', d.furnishType],
          ['Let type', d.letType],
          ['Available', formatAvailable(d.letAvailableDate)],
          [
            'Min. tenancy',
            d.minimumTermMonths ? `${d.minimumTermMonths} months` : null,
          ],
          // No deposit row: it's near-universally five weeks' rent, so showing
          // it hands over the answer.
          ['Council tax', d.councilTaxBand ? `Band ${d.councilTaxBand}` : null],
        ]),
  ].filter(([, v]) => v != null && v !== '');

  const description = listing.description || '';
  const isLong = description.length > 320;
  const shown = expanded || !isLong ? description : `${description.slice(0, 320)}…`;

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-xl shadow-rose-200/50">
      <ImageCarousel images={listing.images} alt={listing.area} />

      <div className="p-5 sm:p-6">
        {/* Obscured location */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-slate-800">{listing.area}</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              📍 Approx. area — exact address hidden
            </p>
          </div>
          {listing.imageCount > 0 && (
            <span className="flex-shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-500">
              {listing.imageCount} photo{listing.imageCount === 1 ? '' : 's'}
            </span>
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {headlineChips.map((chip) => (
            <span
              key={chip}
              className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700"
            >
              {chip}
            </span>
          ))}
        </div>

        {listing.tags?.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {listing.tags.slice(0, 4).map((t) => (
              <span
                key={t}
                className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700"
              >
                {t}
              </span>
            ))}
          </div>
        )}

        {/* Ad facts table */}
        {facts.length > 0 && (
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl bg-slate-50 p-4">
            {facts.map(([label, value]) => (
              <div key={label} className="flex flex-col">
                <dt className="text-[11px] uppercase tracking-wide text-slate-400">
                  {label}
                </dt>
                <dd className="text-sm font-medium text-slate-700">{value}</dd>
              </div>
            ))}
          </dl>
        )}

        {listing.keyFeatures?.length > 0 && (
          <div className="mt-4">
            <h3 className="text-sm font-semibold text-slate-600">Key features</h3>
            <ul className="mt-1 grid grid-cols-1 gap-1 text-sm text-slate-600 sm:grid-cols-2">
              {listing.keyFeatures.map((f, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span className="mt-0.5 text-brand-500" aria-hidden>
                    ✓
                  </span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {description && (
          <div className="mt-4">
            <h3 className="text-sm font-semibold text-slate-600">Description</h3>
            <div className="mt-1 text-sm leading-relaxed text-slate-600 whitespace-pre-line">
              {shown}
              {isLong && (
                <button
                  onClick={() => setExpanded((v) => !v)}
                  className="ml-1 font-medium text-brand-700 underline underline-offset-2"
                >
                  {expanded ? 'Show less' : 'Read more'}
                </button>
              )}
            </div>
          </div>
        )}

        <PropertyMap
          latitude={listing.latitude}
          longitude={listing.longitude}
          area={listing.area}
        />

        {listing.nearestStations?.length > 0 && (
          <div className="mt-4 border-t border-slate-100 pt-3">
            <h3 className="text-sm font-semibold text-slate-600">Nearest stations</h3>
            <ul className="mt-1 space-y-0.5 text-sm text-slate-500">
              {listing.nearestStations.map((s, i) => (
                <li key={i} className="flex justify-between">
                  <span>
                    {s.name}
                    {s.types?.length ? (
                      <span className="ml-1 text-xs text-slate-400">
                        ({s.types.map(formatStationType).join(', ')})
                      </span>
                    ) : null}
                  </span>
                  <span className="flex-shrink-0 tabular-nums text-slate-400">
                    {formatMiles(s.miles)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

// Rightmove reports tenure as a SCREAMING_ENUM.
function formatTenure(value) {
  if (!value) return null;
  return String(value)
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
}

// Rightmove dates come through as ISO strings or words like "Now". Render a
// clean date where possible.
function formatAvailable(value) {
  if (!value) return null;
  const d = new Date(value);
  if (!Number.isNaN(d.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(String(value))) {
    return d.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }
  return String(value);
}
