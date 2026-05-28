import { useState } from 'react';

// Simple image carousel with prev/next controls and dot indicators. Falls back
// gracefully if there are no images or an image fails to load.
export default function ImageCarousel({ images = [], alt = 'Property photo' }) {
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState({});

  const usable = images.filter((_, i) => !failed[i]);
  if (!usable.length) {
    return (
      <div className="flex aspect-[4/3] w-full items-center justify-center rounded-xl bg-slate-100 text-slate-400">
        No photos available
      </div>
    );
  }

  const safeIndex = Math.min(index, images.length - 1);
  const go = (delta) =>
    setIndex((i) => (i + delta + images.length) % images.length);

  return (
    <div className="relative overflow-hidden rounded-xl bg-slate-100">
      <img
        src={images[safeIndex]}
        alt={alt}
        onError={() => setFailed((f) => ({ ...f, [safeIndex]: true }))}
        className="aspect-[4/3] w-full object-cover"
        loading="lazy"
      />

      {images.length > 1 && (
        <>
          <button
            onClick={() => go(-1)}
            aria-label="Previous photo"
            className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white backdrop-blur hover:bg-black/60"
          >
            ‹
          </button>
          <button
            onClick={() => go(1)}
            aria-label="Next photo"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white backdrop-blur hover:bg-black/60"
          >
            ›
          </button>
          <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1.5">
            {images.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i === safeIndex ? 'w-4 bg-white' : 'w-1.5 bg-white/60'
                }`}
              />
            ))}
          </div>
          <div className="absolute right-2 top-2 rounded-full bg-black/50 px-2 py-0.5 text-xs text-white">
            {safeIndex + 1}/{images.length}
          </div>
        </>
      )}
    </div>
  );
}
