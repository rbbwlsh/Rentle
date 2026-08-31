import { useState } from 'react';
import { osmEmbedUrl, osmViewUrl, googleMapsUrl, hasLocation } from '../engine/osm.js';

// Where the property actually is, on a real street map.
//
// An OpenStreetMap embed rather than Google's: it needs no API key, so there's
// no secret to leak in a fully static build. The Google Maps link is there for
// Street View and directions.
//
// The iframe starts inert behind a transparent shield. On a phone, dragging a
// live map iframe hijacks the page scroll and traps you mid-listing; you have
// to tap in deliberately.
export default function PropertyMap({ latitude, longitude, area }) {
  const [live, setLive] = useState(false);
  if (!hasLocation(latitude, longitude)) return null;

  const lat = Number(latitude);
  const lon = Number(longitude);

  return (
    <div className="mt-4 border-t border-slate-100 pt-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-600">Location</h3>
        <a
          href={googleMapsUrl(lat, lon)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-medium text-brand-700 underline underline-offset-2"
        >
          Open in Google Maps ↗
        </a>
      </div>

      <div className="relative mt-2 overflow-hidden rounded-xl border border-slate-200">
        <iframe
          title={`Map showing the property in ${area || 'the UK'}`}
          src={osmEmbedUrl(lat, lon)}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="block h-52 w-full bg-slate-100 sm:h-64"
        />
        {!live && (
          <button
            type="button"
            onClick={() => setLive(true)}
            aria-label="Activate the map"
            className="absolute inset-0 flex items-end justify-center bg-transparent pb-3"
          >
            <span className="rounded-full bg-white/90 px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm backdrop-blur">
              Tap to move the map
            </span>
          </button>
        )}
      </div>

      <div className="mt-1.5 flex items-baseline justify-between gap-2">
        <p className="text-xs text-slate-400">
          📍 The pin is the property — the street address is still hidden.
        </p>
        <a
          href={osmViewUrl(lat, lon)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-shrink-0 text-xs text-slate-400 underline underline-offset-2"
        >
          Larger map
        </a>
      </div>
    </div>
  );
}
