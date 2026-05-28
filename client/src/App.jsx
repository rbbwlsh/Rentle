import { useEffect, useState } from 'react';
import Creator from './components/Creator.jsx';
import Game from './components/Game.jsx';
import { getResult } from './api.js';

// Tiny "router" based on query params:
//   ?r=<resultId>  -> play a friend's shared challenge (beat their score)
//   ?id=<propId>   -> play a property someone shared
//   (neither)      -> the creator (home) screen
function readRoute() {
  const params = new URLSearchParams(window.location.search);
  return { resultId: params.get('r'), id: params.get('id') };
}

export default function App() {
  const [route, setRoute] = useState(readRoute());
  const [opponent, setOpponent] = useState(null);
  const [loadingOpponent, setLoadingOpponent] = useState(false);
  const [opponentError, setOpponentError] = useState('');

  // Keep state in sync with browser back/forward navigation.
  useEffect(() => {
    const onPop = () => setRoute(readRoute());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // When playing a shared result, fetch the opponent's score + property id.
  useEffect(() => {
    setOpponent(null);
    setOpponentError('');
    if (!route.resultId) return;
    setLoadingOpponent(true);
    getResult(route.resultId)
      .then((data) => setOpponent(data.result))
      .catch((err) => setOpponentError(err.message))
      .finally(() => setLoadingOpponent(false));
  }, [route.resultId]);

  const goHome = () => {
    window.history.pushState({}, '', window.location.pathname);
    setRoute({ resultId: null, id: null });
  };

  const playingId = opponent?.propertyId || route.id;

  return (
    <div className="min-h-screen flex flex-col items-center px-4 py-8 sm:py-12">
      <header className="w-full max-w-xl mb-6 sm:mb-8 text-center">
        <button
          onClick={goHome}
          className="inline-flex items-center gap-2 text-2xl sm:text-3xl font-extrabold tracking-tight text-brand-700"
        >
          <span aria-hidden>🎰</span> Rentle
        </button>
        <p className="mt-1 text-sm text-slate-500">
          Guess the rent on any Rightmove listing.
        </p>
      </header>

      <main className="w-full max-w-xl flex-1">
        {route.resultId && loadingOpponent && (
          <div className="rounded-2xl bg-white p-10 text-center text-slate-400 shadow-lg">
            Loading challenge…
          </div>
        )}
        {route.resultId && opponentError && (
          <div className="rounded-2xl bg-white p-8 text-center shadow-lg">
            <div className="text-3xl">🔗</div>
            <p className="mt-3 text-sm text-slate-600">{opponentError}</p>
            <button
              onClick={goHome}
              className="mt-5 rounded-xl bg-brand-600 px-4 py-2.5 font-semibold text-white hover:bg-brand-700"
            >
              Start your own
            </button>
          </div>
        )}
        {playingId && !(route.resultId && (loadingOpponent || opponentError)) ? (
          <Game id={playingId} opponent={opponent} onHome={goHome} />
        ) : (
          !route.resultId && <Creator />
        )}
      </main>

      <footer className="w-full max-w-xl mt-10 text-center text-xs text-slate-400">
        Listings &amp; data from Rightmove. Made for fun.
      </footer>
    </div>
  );
}
