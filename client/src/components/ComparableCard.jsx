import { formatPcm, formatDistance } from '../format.js';

// A nearby rental shown as a price-context hint.
export default function ComparableCard({ property }) {
  if (!property) return null;
  const meta = [
    property.bedrooms != null && `${property.bedrooms} bed`,
    property.propertySubType,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <a
      href={property.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex gap-3 rounded-xl border border-slate-200 bg-white p-3 transition hover:border-brand-300 hover:shadow-sm"
    >
      {property.imageUrl ? (
        <img
          src={property.imageUrl}
          alt={property.address}
          className="h-16 w-20 flex-shrink-0 rounded-lg object-cover"
          loading="lazy"
        />
      ) : (
        <div className="flex h-16 w-20 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[10px] text-slate-400">
          No photo
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-bold text-slate-800">
            {formatPcm(property.price)}
          </span>
          <span className="flex-shrink-0 text-xs text-slate-400">
            {formatDistance(property.distanceMiles)}
          </span>
        </div>
        {meta && <p className="truncate text-xs text-slate-500">{meta}</p>}
        {property.address && (
          <p className="truncate text-xs text-slate-400">{property.address}</p>
        )}
      </div>
    </a>
  );
}
