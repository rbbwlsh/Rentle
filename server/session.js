// Anonymous identity: a random token in an httpOnly cookie, stored only as a
// hash. Server-set on purpose — a client-set id in localStorage would let
// anyone claim anyone's history by editing it, and Safari expires
// JavaScript-set cookies after seven days while leaving server-set ones alone.

import { createHash, randomBytes } from 'node:crypto';

export const COOKIE = 'rentle_session';
const ONE_YEAR = 60 * 60 * 24 * 365;

export const newToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token) => createHash('sha256').update(String(token)).digest('hex');

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// `secure` follows the request: https in production, plain http under
// `netlify dev`, where a Secure cookie would silently never be sent back.
export function sessionCookie(token, { secure = true, maxAge = ONE_YEAR } = {}) {
  return [
    `${COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    secure ? 'Secure' : null,
  ]
    .filter(Boolean)
    .join('; ');
}

export const clearCookie = (opts) => sessionCookie('', { ...opts, maxAge: 0 });
