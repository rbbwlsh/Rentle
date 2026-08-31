import { useEffect, useRef, useState } from 'react';
import { formatPcm, formatGbp } from '../format.js';
import { loadStats, setName as saveName } from '../engine/stats.js';
import { encodeShare } from '../engine/share.js';
import { shareGrid, TIERS } from '../engine/engine.js';
import PersonalStats from './PersonalStats.jsx';

// End-of-game screen. Confetti + a popped-in price on a win, the Wordle-style
// result grid, the real address, personal stats, opponent comparison, and a
// beat-my-score link with a paste-anywhere emoji grid.
export default function Reveal({
  won,
  actual,
  priceLabel,
  displayAddress,
  bestGuess,
  rightmoveUrl,
  listingId,
  tiers,
  puzzleNo,
  you,
  opponent,
  onHome,
}) {
  const off = bestGuess != null ? Math.abs(bestGuess - actual) : null;
  const offPct = off != null ? (off / actual) * 100 : null;

  return (
    <div className="relative rounded-2xl bg-white p-6 text-center shadow-xl shadow-rose-200/50 sm:p-8">
      {won && <Confetti />}
      <div className={`text-5xl ${won ? 'pop-in' : ''}`}>{won ? '🎯' : '😬'}</div>
      <h2 className="mt-2 text-2xl font-extrabold text-slate-800">
        {won ? 'Nailed it!' : 'Out of guesses!'}
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        {won
          ? `You called it within ${offPct < 1 ? '1' : Math.ceil(offPct)}% — proper valuer's eye.`
          : 'Better luck on the next one.'}
      </p>

      <div className="mt-6 rounded-xl bg-brand-50 px-4 py-5">
        <p className="text-xs uppercase tracking-wide text-brand-600">Listed at</p>
        <p
          className={`mt-1 text-4xl font-extrabold text-brand-700 ${won ? 'pop-in-late' : ''}`}
        >
          {priceLabel || formatPcm(actual)}
        </p>
        {displayAddress && (
          <p className="mt-1 text-xs text-slate-500">📍 {displayAddress}</p>
        )}
        {off != null && (
          <p className="mt-2 text-sm text-slate-500">
            Your best guess was {formatGbp(bestGuess)} —{' '}
            <span className="font-semibold text-slate-700">
              {off === 0 ? 'spot on' : `${formatGbp(off)} (${offPct.toFixed(1)}%) off`}
            </span>
          </p>
        )}
      </div>

      <ResultGrid tiers={tiers} puzzleNo={puzzleNo} won={won} />

      {opponent && you && <OpponentResult opponent={opponent} you={you} />}

      <div className="mt-6">
        <PersonalStats you={you} />
      </div>

      {you && (
        <ShareScore listingId={listingId} you={you} tiers={tiers} puzzleNo={puzzleNo} />
      )}

      <div className="mt-6 flex flex-col gap-2">
        {rightmoveUrl && (
          <a
            href={rightmoveUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-brand-300"
          >
            View on Rightmove ↗
          </a>
        )}
        <button
          onClick={onHome}
          className="rounded-xl bg-brand-600 px-4 py-3 font-semibold text-white shadow-sm transition hover:bg-brand-700"
        >
          Play another
        </button>
      </div>
    </div>
  );
}

const SQUARE_COLORS = {
  green: 'bg-emerald-500',
  yellow: 'bg-yellow-400',
  orange: 'bg-orange-400',
  red: 'bg-rose-500',
};

// The visual twin of the emoji share grid: one row per guess.
function ResultGrid({ tiers, puzzleNo, won }) {
  if (!tiers?.length) return null;
  return (
    <div className="mt-6">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {puzzleNo != null ? `Rentle #${puzzleNo}` : 'Your round'} ·{' '}
        {won ? `${tiers.length}/4` : 'X/4'}
      </p>
      <div className="mt-2 inline-flex flex-col gap-1.5">
        {tiers.map((tier, row) => {
          const t = TIERS[tier];
          return (
            <div key={row} className="flex gap-1.5">
              {[0, 1, 2, 3, 4].map((s) => (
                <span
                  key={s}
                  className={`h-6 w-6 rounded-md ${
                    s < t.squares ? SQUARE_COLORS[t.color] : 'bg-slate-200'
                  }`}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Decide who did better. A win beats a loss; among wins, fewer attempts wins;
// ties broken by who was closer (percentage when both sides have it).
function compare(a, b) {
  if (a.won !== b.won) return a.won ? -1 : 1;
  if (a.won && b.won && a.attemptWon !== b.attemptWon)
    return (a.attemptWon ?? 99) - (b.attemptWon ?? 99);
  if (a.bestPct != null && b.bestPct != null) return a.bestPct - b.bestPct;
  return a.bestDiff - b.bestDiff;
}

function OpponentResult({ opponent, you }) {
  const name = opponent.name || 'Your friend';
  const cmp = compare(you, opponent);
  const [verdict, tone] =
    cmp < 0
      ? [`You beat ${name}! 🏆`, 'bg-emerald-50 text-emerald-700']
      : cmp > 0
        ? [`${name} wins this round.`, 'bg-amber-50 text-amber-700']
        : [`Dead heat with ${name}!`, 'bg-sky-50 text-sky-700'];

  const theirLine = opponent.won
    ? `won on guess ${opponent.attemptWon}`
    : opponent.bestPct != null
      ? `within ${Math.round(opponent.bestPct * 100)}%`
      : `within ${formatGbp(opponent.bestDiff)}`;

  return (
    <div className={`mt-6 rounded-xl px-4 py-3 text-sm font-semibold ${tone}`}>
      {verdict}
      <div className="mt-0.5 text-xs font-normal opacity-80">
        {name}: {theirLine}
      </div>
    </div>
  );
}

function ShareScore({ listingId, you, tiers, puzzleNo }) {
  const [name, setNameState] = useState(() => loadStats().name || '');
  const [copied, setCopied] = useState(false);

  // The score travels in the link itself — no server, so the link is ready
  // the moment the game ends and updates live as the name is typed.
  const link = `${window.location.origin}/p/${listingId}?s=${encodeShare({
    name,
    ...you,
  })}`;
  const headline = `${puzzleNo != null ? `Rentle #${puzzleNo}` : 'Rentle'} ${
    you.won ? `${you.attemptWon}/4` : 'X/4'
  }`;
  const shareText = `${headline}\n${shareGrid(tiers)}`;

  function onNameChange(e) {
    setNameState(e.target.value);
    saveName(e.target.value);
  }

  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ text: shareText, url: link });
        return;
      } catch {
        /* cancelled — fall through to copy */
      }
    }
    copy();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${shareText}\n${link}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className="mt-6 rounded-xl border border-brand-100 bg-brand-50 p-4 text-left">
      <p className="text-sm font-semibold text-brand-700">
        Challenge your friends 🏁
      </p>
      <p className="mt-1 text-xs text-slate-500">
        Your result copies as a grid — they play the same property against your
        score.
      </p>
      <pre className="mt-2 rounded-lg bg-white px-3 py-2 text-xs leading-5 text-slate-600">
        {shareText}
      </pre>
      <input
        type="text"
        value={name}
        maxLength={24}
        onChange={onNameChange}
        placeholder="Your name (optional)"
        className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-200 outline-none"
      />
      <div className="mt-2 flex gap-2">
        <button
          onClick={copy}
          className="flex-1 rounded-lg bg-brand-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
        >
          {copied ? 'Copied!' : 'Copy result + link'}
        </button>
        <button
          onClick={share}
          className="flex-1 rounded-lg bg-brand-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
        >
          Share
        </button>
      </div>
    </div>
  );
}

// Lightweight canvas confetti — no library, fires once on mount, cleans up.
function Confetti() {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = (canvas.width = canvas.offsetWidth * dpr);
    const h = (canvas.height = canvas.offsetHeight * dpr);
    const colors = ['#e11d48', '#fb7185', '#f59e0b', '#10b981', '#3b82f6', '#fbbf24'];
    const parts = Array.from({ length: 140 }, () => ({
      x: w / 2 + (Math.random() - 0.5) * w * 0.3,
      y: h * 0.25,
      vx: (Math.random() - 0.5) * 14 * dpr,
      vy: (Math.random() * -14 - 4) * dpr,
      size: (Math.random() * 6 + 4) * dpr,
      color: colors[(Math.random() * colors.length) | 0],
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
    }));
    let frame;
    let ticks = 0;
    const draw = () => {
      ticks += 1;
      ctx.clearRect(0, 0, w, h);
      for (const p of parts) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.35 * dpr;
        p.rot += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = Math.max(0, 1 - ticks / 160);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      }
      if (ticks < 160) frame = requestAnimationFrame(draw);
      else ctx.clearRect(0, 0, w, h);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <canvas
      ref={ref}
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden
    />
  );
}
