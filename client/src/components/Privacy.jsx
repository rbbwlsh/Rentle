import { useEffect, useState } from 'react';
import { api, forgetMe, clearDevice, ApiUnavailable } from '../api.js';
import { MODES } from '../engine/modes.js';
import { loadStats } from '../engine/stats.js';
import { RETENTION } from '../../../server/retention.js';
import site from '../../../tools/config/site.json';

const EFFECTIVE = '12 September 2026';

// The privacy notice, with the two controls that make it enforceable: an
// export of everything held against this browser, and its deletion. Every
// statement below is a fact about the code — what server/app.js stores, the
// periods server/retention.js enforces, where the database is — so a change
// to any of those is a change to this page.
export default function Privacy() {
  const [me, setMe] = useState(undefined); // undefined: checking; null: server unreachable
  const [status, setStatus] = useState('');

  useEffect(() => {
    api
      .me()
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  const device = Object.fromEntries(Object.values(MODES).map((m) => [m.key, loadStats(m.key)]));
  const deviceGames = Object.values(device).reduce((n, s) => n + Object.keys(s.games).length, 0);
  const serverGames = me?.player ? me.games.length : 0;
  const anything = serverGames > 0 || deviceGames > 0 || Boolean(me?.player);

  function download() {
    const payload = {
      exportedAt: new Date().toISOString(),
      server: me?.player ? me : { player: null, games: [] },
      thisDevice: device,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rentle-data-${payload.exportedAt.slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus(`Downloaded: ${serverGames} server game${serverGames === 1 ? '' : 's'}, ${deviceGames} on this device.`);
  }

  async function erase() {
    if (!window.confirm('Delete every game recorded for this browser — on the server and on this device? This cannot be undone.')) return;
    setStatus('');
    try {
      await forgetMe();
      setMe({ player: null, games: [] });
      setStatus('Deleted. Nothing is held for this browser, on the server or on this device.');
    } catch (err) {
      if (!(err instanceof ApiUnavailable)) {
        setStatus('The server returned an error. Nothing was deleted; please try again or email us.');
        return;
      }
      clearDevice();
      setStatus(
        me?.player
          ? 'This device is cleared, but the server could not be reached, so its copy remains. Try again later, or email us and we will delete it.'
          : 'This device is cleared. The server was not reachable, but it holds nothing for this browser.'
      );
    }
  }

  return (
    <div className="rounded-2xl bg-white p-6 text-left shadow-lg sm:p-8">
      <h1 className="text-xl font-extrabold tracking-tight text-slate-800">Privacy Notice</h1>
      <p className="mt-1 text-xs text-slate-400">Effective {EFFECTIVE}</p>
      <p className="mt-3 text-sm text-slate-600">
        This notice explains what information Rentle collects when you play, why, how long it
        is kept, who can see it, and the rights you have over it under the UK General Data
        Protection Regulation and the Data Protection Act 2018.
      </p>

      <Section n="1" title="Who is responsible">
        <p>
          Rentle (rentle-uk.uk) is operated by a private individual in the United Kingdom, who
          is the controller of any personal data described here. Contact:{' '}
          <Mail />.
        </p>
      </Section>

      <Section n="2" title="Information we collect">
        <p>
          <strong>Game records.</strong> When you finish a round, the server records the
          listing you played, each guess you entered, the time, and whether and on which guess
          you won. Nothing else about you is collected: no name, no email address, no location.
        </p>
        <p>
          <strong>A session identifier.</strong> So that your games can be told apart from
          everyone else's, the server issues a random token in a cookie named{' '}
          <code>rentle_session</code>. Only a one-way hash of the token is stored. The
          identifier is pseudonymous: it does not identify you, but it links your games to one
          another, which is why we treat it as personal data.
        </p>
        <p>
          <strong>Records on this device.</strong> Your browser also keeps a copy of your
          results and daily streak in its local storage. That copy never leaves the device
          except when it is first uploaded to create your server record.
        </p>
        <p>
          <strong>Server logs.</strong> Our hosting providers keep standard access logs (IP
          address, browser type, time of request) for a short period for security and fault
          diagnosis, as all web hosting does. We do not use these to identify players.
        </p>
      </Section>

      <Section n="3" title="Why we use it, and the legal basis">
        <p>
          We use game records for two purposes: to show you your own record and streak, and to
          compile anonymous aggregate statistics ("how everyone did") shown after each round.
          Our lawful basis is legitimate interests (Article 6(1)(f) UK GDPR): operating the game
          you have chosen to play, in a way that has minimal impact on you. We do not build
          profiles, make automated decisions about you, or use the data for advertising.
        </p>
      </Section>

      <Section n="4" title="Cookies">
        <p>
          The <code>rentle_session</code> cookie is set only when you finish your first round,
          not on arrival. It is strictly necessary to provide the record and streak feature
          you use by playing, and is therefore exempt from the consent requirement in
          regulation 6 of the Privacy and Electronic Communications Regulations. It lasts one
          year and is not used for tracking, analytics or advertising. No third-party cookies
          are set. Visiting the site without playing sets no cookie at all.
        </p>
      </Section>

      <Section n="5" title="Who can see it, and where it is held">
        <p>
          Personal data is not sold, rented or shared with any third party for their own
          purposes. It is processed by two service providers acting on our instructions:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Neon, Inc.</strong> — hosts the database, in London, United Kingdom.
          </li>
          <li>
            <strong>Cloudflare, Inc.</strong> — hosts the site and its application code, served
            from the Cloudflare data centre nearest to you.
          </li>
        </ul>
        <p>
          Both providers are headquartered in the United States and are bound by data
          processing agreements incorporating the UK International Data Transfer Addendum.
          Aggregate statistics shown on the site contain no personal data.
        </p>
      </Section>

      <Section n="6" title="How long we keep it">
        <p>Retention is enforced automatically, every day, by the same code that runs the game:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Game records and the associated identifier are deleted after{' '}
            <strong>{RETENTION.player}</strong> without activity.
          </li>
          <li>
            A session cookie's server-side record is deleted after{' '}
            <strong>{RETENTION.session}</strong> without use.
          </li>
          <li>
            An identifier with no game records is deleted after{' '}
            <strong>{RETENTION.emptyPlayer}</strong>.
          </li>
        </ul>
        <p>You may delete everything sooner at any time using the control in section 7.</p>
      </Section>

      <Section n="7" title="Your rights">
        <p>
          You have the right to access the personal data we hold about you, to have it
          corrected or erased, to restrict or object to its processing, and to receive it in a
          portable form. Because we hold no contact details, these rights are provided
          directly on this page for the browser you are using:
        </p>
        <p className="text-slate-500">
          {me === undefined
            ? 'Checking the server…'
            : me === null
              ? 'The server is not reachable at the moment; the controls below act on this device only.'
              : me.player
                ? `Held on the server for this browser: ${serverGames} game${serverGames === 1 ? '' : 's'}. On this device: ${deviceGames}.`
                : `Nothing is held on the server for this browser. On this device: ${deviceGames} game${deviceGames === 1 ? '' : 's'}.`}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={download}
            disabled={me === undefined}
            className="min-h-[40px] rounded-full bg-slate-100 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50"
          >
            Download my data
          </button>
          <button
            onClick={erase}
            disabled={me === undefined || !anything}
            className="min-h-[40px] rounded-full bg-rose-50 px-4 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
          >
            Delete my data
          </button>
        </div>
        {status && <p className="text-sm text-slate-600">{status}</p>}
        <p>
          The download is a JSON file containing your server record and this device's copy.
          Deletion removes both; it cannot be undone. If you played in another browser, repeat
          it there. For any request we cannot fulfil this way, email <Mail /> — we respond
          within one month as the law requires, and usually far sooner. You also have the right
          to lodge a complaint with the Information Commissioner's Office (ico.org.uk).
        </p>
      </Section>

      <Section n="8" title="Security">
        <p>
          All traffic is encrypted in transit (HTTPS). Session tokens are stored only as
          hashes, so a copy of the database cannot be used to impersonate a player. Access to
          the database and hosting accounts is limited to the operator.
        </p>
      </Section>

      <Section n="9" title="Property listings and third-party content">
        <p>
          Rentle is an independent project. It is not affiliated with, endorsed by or connected
          to Rightmove, and Rightmove has no involvement in it.
        </p>
        <p>
          The properties featured are a fixed snapshot of advertisements that were publicly
          available on rightmove.co.uk at the time the snapshot was taken. Prices and details
          are as advertised at that time and are not updated; a property may since have been
          let, sold, re-priced or withdrawn. Each round links to the original advertisement.
          Nothing on this site constitutes advice or a basis for any decision about renting or
          purchasing property.
        </p>
        <p>
          Advertisement text and photographs remain the property of the estate agents and
          photographers who created them, and Rightmove retains its rights in its listings
          database. This material is reproduced in reduced form solely for the purpose of a
          free, non-commercial game with no advertising. No information about a property or an
          agent is combined with any information about a player.
        </p>
        <p>
          <strong>Removal requests.</strong> If you are the agent, photographer, owner or
          occupier of a featured property, or a rights holder, and wish a listing to be removed,
          email <Mail /> with the Rightmove link. Listings are removed on request, without the
          need to state a reason, normally within two working days.
        </p>
      </Section>

      <Section n="10" title="Changes to this notice">
        <p>
          If what we collect or how we use it changes, this notice will be updated and the
          effective date above revised. Material changes will be highlighted on the site.
        </p>
      </Section>
    </div>
  );
}

function Mail() {
  return (
    <a href={`mailto:${site.contactEmail}`} className="underline">
      {site.contactEmail}
    </a>
  );
}

function Section({ n, title, children }) {
  return (
    <section className="mt-6 space-y-2 text-sm text-slate-600">
      <h2 className="text-base font-bold text-slate-800">
        <span className="mr-2 text-slate-400">{n}.</span>
        {title}
      </h2>
      {children}
    </section>
  );
}
