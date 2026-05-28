import { useState } from 'react';
import { createChallenge } from '../api.js';

// Home screen: paste a Rightmove URL, create a challenge, and get a shareable
// link to send to friends.
export default function Creator() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const [copied, setCopied] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setShareUrl('');
    setLoading(true);
    try {
      const { id } = await createChallenge(url);
      const link = `${window.location.origin}${window.location.pathname}?id=${id}`;
      setShareUrl(link);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-xl shadow-rose-200/50 p-6 sm:p-8">
      <h2 className="text-lg font-bold text-slate-800">Create a challenge</h2>
      <p className="mt-1 text-sm text-slate-500">
        Paste a Rightmove <span className="font-medium">to-rent</span> listing.
        We&apos;ll hide the price and give you a link to send to friends — see
        who guesses closest.
      </p>

      <form onSubmit={handleSubmit} className="mt-5 space-y-3">
        <input
          type="text"
          inputMode="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.rightmove.co.uk/properties/123456789"
          className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-200 outline-none"
        />
        <button
          type="submit"
          disabled={loading || !url.trim()}
          className="w-full rounded-xl bg-brand-600 px-4 py-3 font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Loading listing…' : 'Create challenge'}
        </button>
      </form>

      {error && (
        <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}

      {shareUrl && (
        <div className="mt-6 rounded-xl border border-brand-100 bg-brand-50 p-4">
          <p className="text-sm font-semibold text-brand-700">
            Challenge ready! 🎉
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Share this link. Anyone who opens it gets 4 guesses with hints.
          </p>
          <div className="mt-3 flex gap-2">
            <input
              readOnly
              value={shareUrl}
              onFocus={(e) => e.target.select()}
              className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600"
            />
            <button
              onClick={copy}
              className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-700"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <a
            href={shareUrl}
            className="mt-3 inline-block text-sm font-medium text-brand-700 underline underline-offset-2"
          >
            Play it yourself →
          </a>
        </div>
      )}
    </div>
  );
}
