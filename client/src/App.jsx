import { useEffect, useState } from 'react';
import Home from './components/Home.jsx';
import Browse from './components/Browse.jsx';
import Game from './components/Game.jsx';
import { decodeShare } from './engine/share.js';

// Tiny path-based router (no library):
//   /p/<id>    -> play that listing; ?s=<token> carries a friend's score to beat
//   /browse    -> pick a listing from the corpus
//   /          -> home: daily puzzle + random
function readRoute() {
  const { pathname, search } = window.location;
  const p = pathname.match(/^\/p\/([\w-]+)\/?$/);
  if (p) {
    return {
      name: 'game',
      listingId: p[1],
      opponent: decodeShare(new URLSearchParams(search).get('s')),
    };
  }
  if (/^\/browse\/?$/.test(pathname)) return { name: 'browse' };
  return { name: 'home' };
}

export default function App() {
  const [route, setRoute] = useState(readRoute());

  // Keep state in sync with browser back/forward navigation.
  useEffect(() => {
    const onPop = () => setRoute(readRoute());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = (path) => {
    window.history.pushState({}, '', path);
    setRoute(readRoute());
    window.scrollTo(0, 0);
  };
  const goHome = () => navigate('/');

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
          The daily guess-the-rent game on real UK listings.
        </p>
      </header>

      <main className="w-full max-w-xl flex-1">
        {route.name === 'game' ? (
          <Game
            key={route.listingId}
            listingId={route.listingId}
            opponent={route.opponent}
            onHome={goHome}
            navigate={navigate}
          />
        ) : route.name === 'browse' ? (
          <Browse navigate={navigate} />
        ) : (
          <Home navigate={navigate} />
        )}
      </main>

      <footer className="w-full max-w-xl mt-10 text-center text-xs text-slate-400">
        Listings &amp; data from Rightmove, captured as a snapshot — rents shown
        are as listed at the time. Made for fun.
      </footer>
    </div>
  );
}
