import { useEffect, useState } from 'react';
import Creator from './components/Creator.jsx';
import Game from './components/Game.jsx';

// Tiny "router": if the URL has ?id=<rightmoveId> we're playing a shared
// challenge; otherwise we show the creator (home) screen.
function getIdFromLocation() {
  return new URLSearchParams(window.location.search).get('id');
}

export default function App() {
  const [id, setId] = useState(getIdFromLocation());

  // Keep state in sync with browser back/forward navigation.
  useEffect(() => {
    const onPop = () => setId(getIdFromLocation());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Navigate home without a full reload.
  const goHome = () => {
    window.history.pushState({}, '', window.location.pathname);
    setId(null);
  };

  return (
    <div className="min-h-screen flex flex-col items-center px-4 py-8 sm:py-12">
      <header className="w-full max-w-xl mb-6 sm:mb-8 text-center">
        <button
          onClick={goHome}
          className="inline-flex items-center gap-2 text-2xl sm:text-3xl font-extrabold tracking-tight text-brand-700"
        >
          <span aria-hidden>🎰</span> Rent Roulette
        </button>
        <p className="mt-1 text-sm text-slate-500">
          Guess the rent on any Rightmove listing.
        </p>
      </header>

      <main className="w-full max-w-xl flex-1">
        {id ? <Game id={id} onHome={goHome} /> : <Creator />}
      </main>

      <footer className="w-full max-w-xl mt-10 text-center text-xs text-slate-400">
        Listings &amp; data from Rightmove. Made for fun.
      </footer>
    </div>
  );
}
