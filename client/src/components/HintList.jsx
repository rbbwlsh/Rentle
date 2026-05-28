import ComparableCard from './ComparableCard.jsx';

// Renders the accumulated hints from earlier wrong guesses. A hint is either a
// nearby comparable (with price) or a "too high / too low" direction nudge.
export default function HintList({ hints }) {
  if (!hints.length) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-slate-500">Hints</h3>
      {hints.map((hint, i) => (
        <div key={i}>
          {hint.type === 'comparable' ? (
            <div className="space-y-1.5">
              <p className="text-xs text-slate-500">
                💡 A nearby rental for context:
              </p>
              <ComparableCard property={hint.property} />
            </div>
          ) : (
            <div
              className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold ${
                hint.direction === 'high'
                  ? 'bg-sky-50 text-sky-700'
                  : 'bg-amber-50 text-amber-700'
              }`}
            >
              {hint.direction === 'high' ? (
                <>Your guess was too high ⬇️ aim lower</>
              ) : (
                <>Your guess was too low ⬆️ aim higher</>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
