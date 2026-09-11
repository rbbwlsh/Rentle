import { useEffect, useState } from 'react';
import Home from './components/Home.jsx';
import CityPicker from './components/CityPicker.jsx';
import Game from './components/Game.jsx';
import { decodeShare } from './engine/share.js';
import { MODES, modeOf, DEFAULT_MODE } from './engine/modes.js';
import { bootstrap } from './api.js';

// Tiny path-based router (no library). The buy game lives under /buy; the rent
// game keeps the bare paths it launched with, so every share link already in
// the wild still resolves.
//
//   /p/<id>        -> play that rental; ?s=<token> carries a friend's score
//   /browse        -> pick a city, then play from its pool
//   /             -> home: today's rental + a random one
//   /buy, /buy/browse, /buy/p/<id>  -> the same three, for asking prices
function readRoute() {
  const { pathname, search } = window.location;
  const isBuy = /^\/buy(\/|$)/.test(pathname);
  const mode = isBuy ? 'buy' : DEFAULT_MODE;
  const rest = isBuy ? pathname.replace(/^\/buy/, '') || '/' : pathname;

  const p = rest.match(/^\/p\/([\w-]+)\/?$/);
  if (p) {
    return {
      name: 'game',
      mode,
      listingId: p[1],
      opponent: decodeShare(new URLSearchParams(search).get('s')),
    };
  }
  if (/^\/browse\/?$/.test(rest)) return { name: 'browse', mode };
  return { name: 'home', mode };
}

export default function App() {
  const [route, setRoute] = useState(readRoute());
  const mode = modeOf(route.mode);

  // Say hello to the server once per load: establishes the session cookie and
  // moves any pre-server localStorage history up. Failure is fine — the game
  // plays and records locally either way, and the import retries next load.
  useEffect(() => {
    bootstrap().catch(() => {});
  }, []);

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
  const goHome = () => navigate(mode.homePath);

  // Switching modes keeps you on the same kind of screen where that means
  // anything. A listing id belongs to one corpus, so from mid-game the switch
  // lands on the other game's home rather than a 404.
  const switchTo = (next) => {
    if (next.key === mode.key) return;
    navigate(route.name === 'browse' ? next.browsePath : next.homePath);
  };

  return (
    <div className="flex min-h-screen flex-col items-center px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] sm:py-12">
      <header className="w-full max-w-xl mb-6 sm:mb-8 text-center">
        <button
          onClick={goHome}
          className="inline-flex items-center gap-2 text-2xl sm:text-3xl font-extrabold tracking-tight text-brand-700"
        >
          <span aria-hidden>🎰</span> Rentle
        </button>
        <p className="mt-1 text-sm text-slate-500">{mode.tagline}</p>
        <ModeToggle current={mode} onSwitch={switchTo} />
      </header>

      <main className="w-full max-w-xl flex-1">
        {route.name === 'game' ? (
          <Game
            key={`${mode.key}:${route.listingId}`}
            mode={mode}
            listingId={route.listingId}
            opponent={route.opponent}
            onHome={goHome}
            navigate={navigate}
          />
        ) : route.name === 'browse' ? (
          <CityPicker mode={mode} navigate={navigate} />
        ) : (
          <Home mode={mode} navigate={navigate} />
        )}
      </main>

      <footer className="w-full max-w-xl mt-10 text-center text-xs text-slate-400">
        Listings &amp; data from Rightmove, captured as a snapshot — prices shown
        are as listed at the time. Made for fun.
      </footer>
    </div>
  );
}

// Rent or buy. Two games, one board — the toggle is the whole of the
// difference the player has to think about.
function ModeToggle({ current, onSwitch }) {
  return (
    <div
      role="tablist"
      aria-label="Choose a game"
      className="mx-auto mt-3 inline-flex rounded-full bg-slate-200/70 p-1"
    >
      {Object.values(MODES).map((m) => {
        const active = m.key === current.key;
        return (
          <button
            key={m.key}
            role="tab"
            aria-selected={active}
            onClick={() => onSwitch(m)}
            className={`min-h-[36px] rounded-full px-5 text-sm font-semibold transition ${
              active
                ? 'bg-white text-brand-700 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <span aria-hidden className="mr-1">{m.icon}</span>
            {m.label}
          </button>
        );
      })}
    </div>
  );
}
