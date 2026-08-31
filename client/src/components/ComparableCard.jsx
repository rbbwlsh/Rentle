import { useId, useState } from 'react';
import ImageCarousel from './ImageCarousel.jsx';
import { formatPcm, formatDistance, formatMiles, formatStationType } from '../format.js';

// A nearby rental shown as a price-context hint. Its own price IS shown — that
// is the whole point of a comparable — but it expands in place into a redacted
// version of the ad: more photos, the facts table, features and description,
// with the street address, agent and Rightmove link all withheld so it stays a
// price anchor rather than a route to the answer.
export default function ComparableCard({ property }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  if (!property) return null;

  const meta = [
    property.bedrooms != null && `${property.bedrooms} bed`,
    property.bathrooms != null && `${property.bathrooms} bath`,
    property.propertySubType,
  ]
    .filter(Boolean)
    .join(' · ');

  const facts = [
    ['Type', property.propertySubType],
    ['Bedrooms', property.bedrooms],
    ['Bathrooms', property.bathrooms],
    ['Size', property.sizeSqFt ? `${property.sizeSqFt.toLocaleString()} sq ft` : null],
    ['Furnishing', property.furnishType],
    ['Let type', property.letType],
    ['Council tax', property.councilTaxBand ? `Band ${property.councilTaxBand}` : null],
  ].filter(([, v]) => v != null && v !== '');

  const photos = property.images?.length
    ? property.images
    : property.imageUrl
      ? [property.imageUrl]
      : [];

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full gap-3 p-3 text-left transition active:bg-slate-50 sm:hover:bg-slate-50"
      >
        {property.imageUrl ? (
          <div className="relative h-20 w-24 flex-shrink-0">
            <img
              src={property.imageUrl}
              alt={property.area}
              className="h-20 w-24 rounded-lg object-cover"
              loading="lazy"
            />
            {property.imageCount > 1 && (
              <span className="absolute bottom-1 right-1 rounded bg-black/55 px-1.5 text-[10px] text-white">
                {property.imageCount}
              </span>
            )}
          </div>
        ) : (
          <div className="flex h-20 w-24 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[10px] text-slate-400">
            No photo
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-base font-bold text-slate-800">
              {property.priceLabel || formatPcm(property.price)}
            </span>
            <span className="flex-shrink-0 text-xs text-slate-400">
              {formatDistance(property.distanceMiles)}
            </span>
          </div>
          {meta && <p className="text-xs font-medium text-slate-600">{meta}</p>}
          {property.area && (
            <p className="truncate text-xs text-slate-400">{property.area}</p>
          )}
          <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-brand-700">
            {open ? 'Hide details' : 'See details'}
            <span
              className={`transition-transform ${open ? 'rotate-180' : ''}`}
              aria-hidden
            >
              ⌄
            </span>
          </span>
        </div>
      </button>

      {open && (
        <div id={panelId} className="border-t border-slate-100 p-3">
          {photos.length > 0 && <ImageCarousel images={photos} alt={property.area} />}

          {facts.length > 0 && (
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg bg-slate-50 p-3">
              {facts.map(([label, value]) => (
                <div key={label} className="flex flex-col">
                  <dt className="text-[10px] uppercase tracking-wide text-slate-400">
                    {label}
                  </dt>
                  <dd className="text-xs font-medium text-slate-700">{value}</dd>
                </div>
              ))}
            </dl>
          )}

          {property.keyFeatures?.length > 0 && (
            <ul className="mt-3 grid grid-cols-1 gap-1 text-xs text-slate-600 sm:grid-cols-2">
              {property.keyFeatures.map((f, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span className="mt-0.5 text-brand-500" aria-hidden>
                    ✓
                  </span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          )}

          {property.nearestStation && (
            <p className="mt-3 flex justify-between gap-2 border-t border-slate-100 pt-2 text-xs text-slate-500">
              <span>
                🚉 {property.nearestStation.name}
                {property.nearestStation.types?.length ? (
                  <span className="ml-1 text-slate-400">
                    ({property.nearestStation.types.map(formatStationType).join(', ')})
                  </span>
                ) : null}
              </span>
              <span className="flex-shrink-0 tabular-nums text-slate-400">
                {formatMiles(property.nearestStation.miles)}
              </span>
            </p>
          )}

          {property.description && (
            <p className="mt-3 text-xs leading-relaxed text-slate-500">
              {property.description}
            </p>
          )}

          <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-400">
            🔒 A different property, shown for price context — its address and
            listing link are hidden so it can&apos;t give the answer away.
          </p>
        </div>
      )}

      {!open && property.summary && (
        <p className="border-t border-slate-100 px-3 py-2 text-xs leading-relaxed text-slate-500">
          {property.summary}
        </p>
      )}
    </div>
  );
}
