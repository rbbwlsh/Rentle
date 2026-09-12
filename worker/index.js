// The site and its API as one Cloudflare Worker. Static files (client/dist,
// built by `npm run build`) are served by the assets binding; /api/* goes to
// server/app.js, the same handler the tests call directly; the daily
// retention purge runs on the cron trigger in wrangler.jsonc.
//
// wrangler.jsonc routes /api/* here BEFORE the asset layer (run_worker_first),
// so the SPA fallback (not_found_handling) can never swallow an API call.
//
// With no NEON_DATABASE_URL secret the API answers 503 on every route and the
// client falls back to localStorage: a deploy without a database is a working
// game with no crowd stats, not a broken one.

import { neon } from '@neondatabase/serverless';
import { connectNeon } from '../server/db.js';
import { handle } from '../server/app.js';
import { purge } from '../server/retention.js';

const dbFor = (env) => (env.NEON_DATABASE_URL ? connectNeon(env.NEON_DATABASE_URL, { neon }) : null);

export default {
  async fetch(req, env) {
    const { pathname } = new URL(req.url);
    if (pathname === '/api' || pathname.startsWith('/api/')) return handle(dbFor(env), req);
    return env.ASSETS.fetch(req);
  },

  async scheduled(_event, env, ctx) {
    const db = dbFor(env);
    if (!db) return;
    ctx.waitUntil(purge(db).then((tally) => console.log(`retention: ${JSON.stringify(tally)}`)));
  },
};
