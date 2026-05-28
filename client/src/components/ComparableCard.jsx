import { formatPcm, formatDistance } from '../format.js';

// A nearby rental shown as a price-context hint — ad-level detail, but with the
// address obscured and no outbound link (it's a price anchor, not the answer).
export default function ComparableCard({ property }) {
  if (!property) return null;
  const meta = [
    property.bedrooms != null && `${property.bedrooms} bed`,
    property.bathrooms != null && `${property.bathrooms} bath`,
    property.propertySubType,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex gap-3 p-3">
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
              {formatPcm(property.price)}
            </span>
            <span className="flex-shrink-0 text-xs text-slate-400">
              {formatDistance(property.distanceMiles)}
            </span>
          </div>
          {meta && <p className="text-xs font-medium text-slate-600">{meta}</p>}
          {property.area && (
            <p className="truncate text-xs text-slate-400">{property.area}</p>
          )}
          {property.addedOrReduced && (
            <p className="mt-0.5 text-[11px] text-emerald-600">
              {property.addedOrReduced}
            </p>
          )}
        </div>
      </div>
      {property.summary && (
        <p className="border-t border-slate-100 px-3 py-2 text-xs leading-relaxed text-slate-500">
          {property.summary}
        </p>
      )}
    </div>
  );
}
