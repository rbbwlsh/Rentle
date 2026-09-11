// The Rentle API as a Netlify Function. All the logic lives in server/app.js
// (which the tests call directly); this file only connects the database and
// hands the Request over.
//
// `path` routes /api/* here ahead of the SPA fallback — Netlify matches
// functions before redirects — so netlify.toml needs no rule for it.
//
// With no NEON_DATABASE_URL the handler answers 503 on every route and the
// client falls back to localStorage, so a deploy without a database is a
// working game with no crowd stats, not a broken one.

import { neon } from '@neondatabase/serverless';
import { connectNeon } from '../../server/db.js';
import { handle } from '../../server/app.js';

const url = process.env.NEON_DATABASE_URL;
const db = url ? connectNeon(url, { neon }) : null;

export default async (req) => handle(db, req);

export const config = { path: '/api/*' };
