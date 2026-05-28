// Thin wrapper around the backend API. Each call returns the parsed JSON, or
// throws an Error carrying the server's friendly message.

// A stable anonymous id per browser, so aggregate stats don't double-count
// replays from the same person.
export function getClientId() {
  let id = localStorage.getItem('rentle_client_id');
  if (!id) {
    id =
      (crypto.randomUUID && crypto.randomUUID()) ||
      `c_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    localStorage.setItem('rentle_client_id', id);
  }
  return id;
}

async function request(path, options) {
  let res;
  try {
    res = await fetch(path, options);
  } catch {
    throw new Error('Could not reach the server. Is it running?');
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON response */
  }
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || `Request failed (HTTP ${res.status}).`);
  }
  return data;
}

// Returns { c } — an opaque challenge id (never the Rightmove id).
export function createChallenge(url) {
  return request('/api/challenge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
}

export function getListing(c) {
  return request(`/api/listing?c=${encodeURIComponent(c)}`);
}

export function submitGuess(c, guess, attempt) {
  return request('/api/guess', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ c, guess, attempt, clientId: getClientId() }),
  });
}

// Record a finished game; returns { resultId, stats, you }.
export function recordResult({ c, won, guesses, name }) {
  return request('/api/result', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ c, won, guesses, name, clientId: getClientId() }),
  });
}

export function getResult(resultId) {
  return request(`/api/result/${encodeURIComponent(resultId)}`);
}

export function updateResultName(resultId, name) {
  return request(`/api/result/${encodeURIComponent(resultId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}
