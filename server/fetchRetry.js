// fetch() with small exponential backoff for transient failures. Retries on
// network errors and 429/5xx; does NOT retry 403/404 (those are definitive —
// e.g. Rightmove blocking the IP, or a missing listing).
export async function fetchWithRetry(url, options = {}, { attempts = 3, baseDelayMs = 300 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, options);
      if (res.status === 429 || res.status >= 500) {
        if (i < attempts - 1) {
          await sleep(baseDelayMs * 2 ** i);
          continue;
        }
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await sleep(baseDelayMs * 2 ** i);
    }
  }
  if (lastErr) throw lastErr;
  // Exhausted retries on 429/5xx — return one final attempt's response.
  return fetch(url, options);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
