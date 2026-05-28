import { useState } from 'react';
import ImageCarousel from './ImageCarousel.jsx';

// Displays the listing the player is guessing on. Crucially, the rent is NOT
// part of this data (the server strips it), so there is nothing here to peek at.
export default function ListingCard({ listing }) {
  const [expanded, setExpanded] = useState(false);

  const chips = [
    listing.bedrooms != null && `${listing.bedrooms} bed`,
    listing.bathrooms != null && `${listing.bathrooms} bath`,
    listing.propertySubType,
    listing.sizeSqFt && `${listing.sizeSqFt.toLocaleString()} sq ft`,
  ].filter(Boolean);

  const description = listing.description || '';
  const isLong = description.length > 280;
  const shown = expanded || !isLong ? description : `${description.slice(0, 280)}…`;

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-xl shadow-rose-200/50">
      <ImageCarousel images={listing.images} alt={listing.displayAddress} />

      <div className="p-5 sm:p-6">
        <h2 className="text-base font-bold text-slate-800">
          {listing.displayAddress}
        </h2>

        <div className="mt-3 flex flex-wrap gap-2">
          {chips.map((chip) => (
            <span
              key={chip}
              className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700"
            >
              {chip}
            </span>
          ))}
        </div>

        {listing.keyFeatures?.length > 0 && (
          <ul className="mt-4 grid grid-cols-1 gap-1 text-sm text-slate-600 sm:grid-cols-2">
            {listing.keyFeatures.slice(0, 6).map((f, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span className="mt-0.5 text-brand-500" aria-hidden>
                  ✓
                </span>
                <span>{f}</span>
              </li>
            ))}
          </ul>
        )}

        {description && (
          <div className="mt-4 text-sm leading-relaxed text-slate-600 whitespace-pre-line">
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
        )}

        {listing.nearestStations?.length > 0 && (
          <div className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
            <span className="font-medium text-slate-600">Nearest stations: </span>
            {listing.nearestStations
              .map((s) => `${s.name} (${s.miles} mi)`)
              .join(' · ')}
          </div>
        )}
      </div>
    </div>
  );
}
