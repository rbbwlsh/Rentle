import { useEffect, useState } from 'react';
import { api, forgetMe, ApiUnavailable } from '../api.js';
import { RETENTION } from '../../../server/retention.js';
import site from '../../../tools/config/site.json';

// The privacy notice, and the two buttons that make it true: export
// everything held against this browser's cookie, or delete it. Written for a
// player, not a lawyer — but every claim below is a fact about the code:
// what is stored is what server/app.js stores, and how long is what
// server/retention.js enforces.
export default function Privacy() {
  const [me, setMe] = useState(undefined); // undefined: loading; null: API off
  const [exported, setExported] = useState(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    api
      .me()
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  async function onExport() {
    setStatus('');
    try {
      const data = await api.me();
      setMe(data);
      setExported(JSON.stringify(data, null, 2));
    } catch (err) {
      setStatus(err instanceof ApiUnavailable ? 'The server is not reachable right now.' : 'Something went wrong.');
    }
  }

  async function onDelete() {
    if (!window.confirm('Delete every game recorded for this browser, on the server and on this device? This cannot be undone.')) return;
    setStatus('');
    try {
      await forgetMe();
      setMe({ player: null, games: [] });
      setExported(null);
      setStatus('Done. Nothing is held for this browser any more.');
    } catch (err) {
      setStatus(err instanceof ApiUnavailable ? 'The server is not reachable right now — try again later.' : 'Something went wrong.');
    }
  }

  const held = me?.player ? me.games.length : 0;

  return (
    <div className="rounded-2xl bg-white p-6 text-left shadow-lg sm:p-8">
      <h1 className="text-xl font-extrabold tracking-tight text-slate-800">Privacy &amp; your data</h1>
      <p className="mt-2 text-sm text-slate-600">
        Rentle is a game. It stores as little as it can, keeps it in the UK, never sells or shares
        it, and lets you delete it in one tap. Here is exactly what that means.
      </p>

      <Section title="What is stored">
        <p>
          When you finish a game, the server records <strong>your guesses</strong>, which listing
          they were for, when you played, and whether you won — nothing else. To tell your games
          apart from everyone else's it sets a cookie (<code>rentle_session</code>) holding a
          random token; only a hash of that token is kept. There is no name, email or account
          unless you later choose to add one.
        </p>
        <p>
          Just visiting stores nothing. The cookie is set by the first game you finish, because
          it is what makes your record and streak work across days. It is not used for
          advertising or tracking, which is why there is no cookie banner.
        </p>
        <p>
          The hosting providers keep standard server logs (IP address, browser, time) for a short
          period for security and debugging, as every website's hosts do.
        </p>
      </Section>

      <Section title="Why, and on what basis">
        <p>
          Your guesses are used for two things: your own record, and the anonymous crowd stats
          shown after each round ("most people guessed low"). Under UK GDPR the basis is
          legitimate interests — running the game you chose to play — and the cookie is strictly
          necessary for it under PECR. Nothing is profiled and nothing is passed to anyone.
        </p>
      </Section>

      <Section title="Where it lives">
        <p>
          The database is Neon Postgres, hosted in London. The site and its API run on
          Cloudflare, at the data centre nearest you. Both companies are US-based and act
          only as processors under data-processing agreements that include the UK's
          international transfer terms.
        </p>
      </Section>

      <Section title="How long">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            A player with no activity for <strong>{RETENTION.player}</strong> is deleted, games
            and all.
          </li>
          <li>
            A cookie unused for <strong>{RETENTION.session}</strong> is forgotten.
          </li>
          <li>
            A player record with no games is dropped after <strong>{RETENTION.emptyPlayer}</strong>.
          </li>
          <li>An email entered but never verified is cleared once its link expires.</li>
        </ul>
        <p>This runs automatically every day.</p>
      </Section>

      <Section title="Your rights">
        <p>
          You can see everything held for this browser, or delete it, right here — no request,
          no waiting. Deleting also clears the record on this device, so nothing is re-uploaded.
        </p>
        <p className="text-slate-500">
          {me === undefined
            ? 'Checking…'
            : me === null
              ? 'The server is not reachable right now, so nothing can be shown or deleted here.'
              : me.player
                ? `Held for this browser: ${held} game${held === 1 ? '' : 's'}.`
                : 'Nothing is held for this browser.'}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={onExport}
            disabled={me == null}
            className="min-h-[40px] rounded-full bg-slate-100 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50"
          >
            Show my data
          </button>
          <button
            onClick={onDelete}
            disabled={me == null || !me.player}
            className="min-h-[40px] rounded-full bg-rose-50 px-4 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
          >
            Delete my data
          </button>
        </div>
        {status && <p className="text-sm text-slate-600">{status}</p>}
        {exported && (
          <pre className="max-h-64 overflow-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-700">{exported}</pre>
        )}
        <p>
          For anything else — a question, a complaint, or to exercise a right this page does not
          cover — email{' '}
          <a href={`mailto:${site.contactEmail}`} className="underline">
            {site.contactEmail}
          </a>
          . You can also complain to the ICO at ico.org.uk.
        </p>
      </Section>

      <Section title="The listings, the photos and Rightmove">
        <p>
          Rentle is an independent game made by one person. It is not affiliated with, endorsed
          by or connected to Rightmove, and Rightmove has no involvement in it.
        </p>
        <p>
          The homes in the game are a small, fixed snapshot of adverts that were publicly
          viewable on rightmove.co.uk when the snapshot was taken. Prices and details are as
          listed at that moment; a property may since have let, sold, changed price or been
          withdrawn. Every round links to the original advert, and nothing here is advice or a
          basis for any decision about renting or buying — go to the source.
        </p>
        <p>
          The advert text and photographs belong to the estate agents and photographers who
          made them, and Rightmove has rights in its listings database. They appear here in
          reduced form for one purpose only: a free guessing game with no advertising and
          nothing for sale. Nothing about a property or an agent is combined with anything about
          a player.
        </p>
        <p>
          <strong>If you would rather a listing was not in the game</strong> — because you are the
          agent, the photographer, the owner or the occupier, or for any reason at all — email{' '}
          <a href={`mailto:${site.contactEmail}`} className="underline">
            {site.contactEmail}
          </a>{' '}
          with the Rightmove link. It will be taken down promptly, normally within two working
          days, no questions asked. The same address reaches the person who runs the game
          directly, for Rightmove or anyone else with a concern.
        </p>
      </Section>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="mt-6 space-y-2 text-sm text-slate-600">
      <h2 className="text-base font-bold text-slate-800">{title}</h2>
      {children}
    </section>
  );
}
