// fetch() with small exponential backoff for transient failures. Retries on
// network errors and 429/5xx; does NOT retry 403/404 (those are definitive —
// e.g. Rightmove blocking the IP, or a missing listing). A 429 with a
// Retry-After header is honoured, capped so one bad header can't stall a run.
export async function fetchWithRetry(url, options = {}, { attempts = 3, baseDelayMs = 300 } = {}) {
  let lastErr;
  let res;
  for (let i = 0; i < attempts; i++) {
    try {
      res = await fetch(url, options);
      if (res.status === 429 || res.status >= 500) {
        if (i < attempts - 1) {
          await sleep(retryDelayMs(res, baseDelayMs * 2 ** i));
          continue;
        }
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await sleep(baseDelayMs * 2 ** i);
    }
  }
  if (res) return res; // exhausted retries on 429/5xx — surface the last response
  throw lastErr;
}

// Prefer the server's Retry-After (seconds) over our own backoff, capped at 60s.
function retryDelayMs(res, fallbackMs) {
  const header = Number(res.headers?.get?.('retry-after'));
  if (Number.isFinite(header) && header > 0) return Math.min(header, 60) * 1000;
  return fallbackMs;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
